import WalletManagerSpark from "@tetherto/wdk-wallet-spark";
import { log } from "./logger.js";
import { waitForArbitrumUsdtBalance } from "./arbUsdtConfirm.js";
import { getBoltzSwapStatus } from "./boltz.js";

type SparkAccount = Awaited<ReturnType<WalletManagerSpark["getAccount"]>>;

export interface SparkWallet {
  wallet: WalletManagerSpark;
  account: SparkAccount;
  balanceSats: number;
}

export interface SparkPaymentResult {
  id: string;
  status: string;
}

export interface SparkInvoiceResult {
  bolt11: string;
  invoiceId: string;
}

const SPARK_NETWORK =
  (process.env.SPARK_NETWORK?.trim() as "MAINNET" | "REGTEST") || "MAINNET";

export async function initSpark(seed: string): Promise<SparkWallet> {
  log.info("spark", "initializing Spark wallet", { network: SPARK_NETWORK });
  const wallet = new WalletManagerSpark(seed, { network: SPARK_NETWORK });
  const account = await wallet.getAccount(0);
  const balanceRaw = await account.getBalance();
  const balanceSats = Number(balanceRaw);

  log.info("spark", "Spark wallet ready", { balanceSats, network: SPARK_NETWORK });
  return { wallet, account, balanceSats };
}

export async function createSparkInvoice(
  account: SparkAccount,
  amountSats: number,
  memo = "paysats topup",
): Promise<SparkInvoiceResult> {
  log.info("spark", "createLightningInvoice", { amountSats, memo });
  const result: any = await account.createLightningInvoice({ amountSats, memo });
  const bolt11: string = String(result.invoice?.encodedInvoice ?? "");
  const invoiceId: string = String(result.id ?? "");

  log.info("spark", "createLightningInvoice ok", {
    invoiceLen: bolt11?.length ?? 0,
    invoicePrefix:
      String(bolt11 || "").slice(0, 28) +
      (String(bolt11 || "").length > 28 ? "…" : ""),
    invoiceId,
  });

  return { bolt11, invoiceId };
}

export async function lookupSparkInvoice(
  account: SparkAccount,
  invoiceId: string,
): Promise<{ paid: boolean; raw: any }> {
  const req = await account.getLightningReceiveRequest(invoiceId);
  if (!req) return { paid: false, raw: null };
  const status = String((req as any).status || "").toUpperCase();
  const paid = status === "INVOICE_PAID" || status === "PAYMENT_SETTLED" || status === "COMPLETED";
  return { paid, raw: req };
}

export async function paySparkInvoice(
  account: SparkAccount,
  bolt11: string,
  maxFeeSats?: number,
): Promise<SparkPaymentResult> {
  log.info("spark", "payLightningInvoice", {
    invoicePrefix: bolt11.slice(0, 28) + (bolt11.length > 28 ? "…" : ""),
    invoiceLen: bolt11.length,
    maxFeeSats: maxFeeSats ?? null,
  });

  const result = await (account as any).payLightningInvoice({
    encodedInvoice: bolt11,
    ...(maxFeeSats != null ? { maxFeeSats } : {}),
  });

  const id = (result as any).id ?? "";
  const status = String((result as any).status || "");
  log.info("spark", "payLightningInvoice ok", { id, status });
  return { id, status };
}

export async function getSparkBalance(account: SparkAccount): Promise<number> {
  const raw = await account.getBalance();
  return Number(raw);
}

export async function paySparkInvoiceWithRetries(params: {
  seed: string;
  bolt11: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  minBalanceSats?: number;
  waitForBalanceMs?: number;
  balancePollMs?: number;
  maxFeeSats?: number;
  /** Pass the Boltz swap ID and pre-pay USDT snapshot so we can detect silent success before retrying. */
  boltzSwapId?: string;
  startUsdtRaw?: bigint;
}): Promise<SparkPaymentResult & { attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(10, params.maxAttempts ?? 3));
  const baseDelayMs = Math.max(250, params.baseDelayMs ?? 1500);
  const minBalanceSats =
    typeof params.minBalanceSats === "number" && Number.isFinite(params.minBalanceSats)
      ? params.minBalanceSats
      : undefined;
  const waitForBalanceMs = Math.max(0, params.waitForBalanceMs ?? 0);
  const balancePollMs = Math.max(250, params.balancePollMs ?? 1500);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    let sparkWallet: SparkWallet | null = null;
    try {
      // Before retrying, check if a previous attempt silently succeeded
      if (attempt > 1) {
        const silentSuccess = await checkSilentPaymentSuccess(params);
        if (silentSuccess) {
          log.info("spark", "previous pay attempt succeeded silently — skipping retry", {
            attempt,
            checkMethod: silentSuccess,
          });
          return { id: "", status: "confirmed_via_" + silentSuccess, attempts: attempt };
        }
      }

      sparkWallet = await initSpark(params.seed);
      const { account, balanceSats } = sparkWallet;

      log.info("spark", "pay_invoice attempt", {
        attempt,
        maxAttempts,
        balanceSats,
        minBalanceSats: minBalanceSats ?? null,
        waitForBalanceMs,
      });

      if (minBalanceSats !== undefined) {
        const deadline = Date.now() + waitForBalanceMs;
        let current = balanceSats;
        while (current < minBalanceSats && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, balancePollMs));
          current = await getSparkBalance(account);
          log.info("spark", "balance poll before pay", {
            attempt,
            balanceSats: current,
            minBalanceSats,
          });
        }

        const finalBal = await getSparkBalance(account);
        if (finalBal < minBalanceSats) {
          throw new Error(
            `Insufficient Spark balance to pay. balanceSats=${finalBal} requiredMinSats=${minBalanceSats}`,
          );
        }
      }

      const paid = await paySparkInvoice(account, params.bolt11, params.maxFeeSats);
      return { ...paid, attempts: attempt };
    } catch (e) {
      lastErr = e;
      log.warn("spark", "pay_invoice attempt failed", {
        attempt,
        maxAttempts,
        elapsedMs: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      });

      try {
        if (sparkWallet) {
          await sparkWallet.account.cleanupConnections();
          sparkWallet.account.dispose();
        }
      } catch {
        /* ignore cleanup errors */
      }

      if (attempt < maxAttempts) {
        const jitter = Math.floor(Math.random() * 250);
        const delayMs = baseDelayMs * attempt + jitter;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Before retrying a Boltz invoice payment, check if the previous attempt
 * silently succeeded by verifying either:
 * 1. Arbitrum USDT balance increased (Boltz claimed on-chain)
 * 2. Boltz API reports the swap as completed
 */
async function checkSilentPaymentSuccess(params: {
  seed: string;
  boltzSwapId?: string;
  startUsdtRaw?: bigint;
}): Promise<"usdt_balance" | "boltz_status" | false> {
  // Check Boltz swap status
  if (params.boltzSwapId) {
    try {
      const status = await getBoltzSwapStatus(params.boltzSwapId);
      if (status.status === "completed") {
        log.info("spark", "Boltz swap already completed (silent success)", {
          boltzSwapId: params.boltzSwapId,
          txHash: status.txHash,
        });
        return "boltz_status";
      }
    } catch (e) {
      log.warn("spark", "Boltz status check failed (continuing)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Check Arbitrum USDT balance increase
  if (params.startUsdtRaw !== undefined) {
    try {
      const current = await waitForArbitrumUsdtBalance({
        orderId: "retry-check",
        seed: params.seed,
        startBalanceRaw: params.startUsdtRaw,
        maxWaitMs: 5000,
        pollMs: 2500,
      });
      if (current.satisfied) {
        log.info("spark", "Arbitrum USDT balance increased (silent success)", {
          balanceRaw: current.balanceRaw.toString(),
          startRaw: params.startUsdtRaw.toString(),
        });
        return "usdt_balance";
      }
    } catch (e) {
      log.warn("spark", "USDT balance check failed (continuing)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return false;
}
