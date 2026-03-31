import { NWCClient } from "@getalby/sdk";
import { log } from "./logger.js";

export type NwcClient = NWCClient;

export interface NwcWallet {
  client: NwcClient;
  balanceSats: number;
  /** Millisats from NWC `get_balance` (NIP-47). */
  balanceRaw: number;
  walletAlias?: string;
}

export interface PaymentResult {
  preimage: string;
  feesPaid: number;
}

export interface InvoiceResult {
  bolt11: string;
  expiresAt?: number;
}

async function getBalanceSnapshot(client: NwcClient): Promise<{ balanceMsat: number; balanceSats: number }> {
  const bal = await client.getBalance();
  /** NIP-47: `balance` is millisats. */
  const balanceMsat = Number(bal.balance ?? 0);
  const balanceSats = Math.floor(balanceMsat / 1000);
  return { balanceMsat, balanceSats };
}

/**
 * Connects to the wallet behind `NWC_URL` and reads its reported Lightning balance.
 * `balanceSats` is derived from the NWC response (Alby-style wallets often return millisats in `balance`).
 */
export async function initNwc(nwcUrl: string): Promise<NwcWallet> {
  log.info("nwc", "connecting NWC client", { nwcUrl: log.redactNwcUrl(nwcUrl) });

  const client = new NWCClient({
    nostrWalletConnectUrl: nwcUrl
  });

  let walletAlias: string | undefined;
  try {
    const info = await client.getInfo();
    walletAlias = info.alias ?? undefined;
    log.info("nwc", "get_info ok", { alias: walletAlias ?? "(none)" });
  } catch (e) {
    log.warn("nwc", "get_info failed (continuing)", { error: e instanceof Error ? e.message : String(e) });
  }

  const { balanceMsat, balanceSats } = await getBalanceSnapshot(client);

  log.info("nwc", "wallet balance snapshot (NIP-47 get_balance)", {
    walletAlias: walletAlias ?? "(unknown)",
    balanceMsat,
    balanceSats
  });

  return { client, balanceSats, balanceRaw: balanceMsat, walletAlias };
}

export async function payInvoice(client: NwcClient, bolt11: string): Promise<PaymentResult> {
  log.info("nwc", "pay_invoice request", {
    invoicePrefix: bolt11.slice(0, 28) + (bolt11.length > 28 ? "…" : ""),
    invoiceLen: bolt11.length
  });
  const result = await client.payInvoice({ invoice: bolt11 });
  const feesPaid = (result as any).fees_paid ?? 0;
  log.info("nwc", "pay_invoice ok", {
    preimageLen: result.preimage?.length ?? 0,
    feesPaid
  });
  return {
    preimage: result.preimage,
    feesPaid
  };
}

export async function payInvoiceWithRetries(params: {
  nwcUrl: string;
  bolt11: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  /**
   * If set, we will only attempt payment when NWC balance is >= this value.
   * Useful to ensure inbound funding has arrived before spending.
   */
  minBalanceSats?: number;
  /** If `minBalanceSats` is set, wait up to this many ms for balance to reach it. */
  waitForBalanceMs?: number;
  /** Poll interval while waiting for balance. */
  balancePollMs?: number;
}): Promise<PaymentResult & { attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(10, params.maxAttempts ?? 3));
  const baseDelayMs = Math.max(250, params.baseDelayMs ?? 1500);
  const minBalanceSats =
    typeof params.minBalanceSats === "number" && Number.isFinite(params.minBalanceSats) ? params.minBalanceSats : undefined;
  const waitForBalanceMs = Math.max(0, params.waitForBalanceMs ?? 0);
  const balancePollMs = Math.max(250, params.balancePollMs ?? 1500);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    let client: NwcClient | null = null;
    try {
      const wallet = await initNwc(params.nwcUrl);
      client = wallet.client;
      log.info("nwc", "pay_invoice attempt", {
        attempt,
        maxAttempts,
        balanceSats: wallet.balanceSats,
        walletAlias: wallet.walletAlias ?? "(unknown)",
        minBalanceSats: minBalanceSats ?? null,
        waitForBalanceMs
      });

      if (minBalanceSats !== undefined) {
        const deadline = Date.now() + waitForBalanceMs;
        let current = wallet.balanceSats;
        while (current < minBalanceSats && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, balancePollMs));
          const snap = await getBalanceSnapshot(client);
          current = snap.balanceSats;
          log.info("nwc", "balance poll before pay", {
            attempt,
            balanceSats: snap.balanceSats,
            balanceMsat: snap.balanceMsat,
            minBalanceSats
          });
        }

        const finalSnap = await getBalanceSnapshot(client);
        if (finalSnap.balanceSats < minBalanceSats) {
          throw new Error(
            `Insufficient NWC balance to pay. balanceSats=${finalSnap.balanceSats} requiredMinSats=${minBalanceSats}`
          );
        }
      }

      const paid = await payInvoice(client, params.bolt11);
      return { ...paid, attempts: attempt };
    } catch (e) {
      lastErr = e;
      log.warn("nwc", "pay_invoice attempt failed", {
        attempt,
        maxAttempts,
        elapsedMs: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e)
      });
      try {
        // Best-effort: close websocket between attempts (SDK exposes close()).
        (client as any)?.close?.();
      } catch {
        /* ignore */
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

export async function createInvoice(
  client: NwcClient,
  amountSats: number,
  description = "paysats topup"
): Promise<InvoiceResult> {
  log.info("nwc", "make_invoice", { amountSats, amountMsat: amountSats * 1000, description });
  const result = await client.makeInvoice({
    amount: amountSats * 1000,
    description
  });

  log.info("nwc", "make_invoice ok", {
    invoiceLen: result.invoice?.length ?? 0,
    invoicePrefix: String(result.invoice || "").slice(0, 28) + (String(result.invoice || "").length > 28 ? "…" : ""),
    expiresAt: (result as any).expires_at
  });
  return {
    bolt11: result.invoice,
    expiresAt: (result as any).expires_at
  };
}
