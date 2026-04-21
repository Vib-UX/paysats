import {
  deriveArbitrumErc4337ReceiveAddress,
  requireArbitrumReceiveAddress,
} from "./arbitrumErc4337Address.js";
import { deriveBaseErc4337ReceiveAddress } from "./baseErc4337Address.js";
import { deriveBscErc4337ReceiveAddress } from "./bscErc4337Address.js";
import { createBoltzSwap } from "./boltz.js";
import { log } from "./logger.js";
import {
  initSpark,
  createSparkInvoice,
  lookupSparkInvoice,
  paySparkInvoiceWithRetries,
  type SparkInvoiceResult,
} from "./spark.js";
import { prisma } from "./prisma.js";
import { OrderState, requireTransition } from "./state.js";
import {
  executeUsdtToIdrxOnBase,
} from "./swap.js";
import {
  fetchLifiQuote,
  LIFI_BTCB_BSC,
  LIFI_CBTC_BASE,
  LIFI_IDRX_BASE,
} from "./lifiQuote.js";
import { idrxBaseRecipientAddress } from "./idrxConfig.js";
import { getCachedIdrxTransactionMethods } from "./idrxRedeem.js";
import {
  isIdrxEwalletBankCode,
} from "./idrxPayoutClassify.js";
import { runBankIdrxBurnOnly, runBankIdrxRedeemOnly } from "./idrxOfframp.js";
import { recordOfframpCompletionVolume } from "./liquidityDisplayStats.js";
import { waitForArbitrumUsdtBalance } from "./arbUsdtConfirm.js";

export type MemoryOrder = {
  id: string;
  tenantId?: string | null;
  state: OrderState;
  satAmount: number;
  idrAmount: number;
  btcIdr?: number | null;
  btcIdrFetchedAt?: string | null;
  p2pmPayoutMethod?: string | null;
  payoutRecipient?: string | null;
  invoiceBolt11?: string | null;
  invoiceLnId?: string | null;
  invoiceExpiresAt?: string | null;
  invoicePaidAt?: string | null;
  invoicePaymentHash?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  usdtAmount?: number | null;
  usdcAmount?: number | null;
  boltzSwapId?: string | null;
  boltzLnInvoice?: string | null;
  boltzLnPreimage?: string | null;
  boltzTxHash?: string | null;
  swapTxHash?: string | null;
  p2pmOrderId?: string | null;
  bankAccountName?: string | null;
  idrxBurnTxHash?: string | null;
  idrxRedeemId?: string | null;
  idrxAmountIdr?: number | null;
  merchantName?: string | null;
  qrisPayload?: string | null;
  depositChannel?: string | null;
  depositChainId?: number | null;
  depositTokenAddress?: string | null;
  depositToAddress?: string | null;
  idrxPayoutBankCode?: string | null;
  idrxPayoutBankName?: string | null;
};

export const memoryOrders = new Map<string, MemoryOrder>();

export function isDbAccessError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("P1010") ||
    msg.toLowerCase().includes("denied access") ||
    msg.includes("User was denied access")
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeStubInvoice(): { bolt11: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const bolt11 = `paysats_stub_invoice_${Date.now().toString(36)}`;
  return { bolt11, expiresAt };
}

export async function fetchBtcIdrFromCoinGecko(): Promise<{
  btcIdr: number;
  usdcIdr: number;
  fetchedAt: string;
  source: string;
}> {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,usd-coin&vs_currencies=idr&include_last_updated_at=true";
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as any;
  const btcIdr = Number(body?.bitcoin?.idr);
  const usdcIdr = Number(body?.["usd-coin"]?.idr);
  const lastUpdatedAt = Number(body?.bitcoin?.last_updated_at);
  if (
    !Number.isFinite(btcIdr) ||
    btcIdr <= 0 ||
    !Number.isFinite(usdcIdr) ||
    usdcIdr <= 0
  ) {
    throw new Error("CoinGecko quote unavailable");
  }
  const fetchedAt =
    Number.isFinite(lastUpdatedAt) && lastUpdatedAt > 0
      ? new Date(lastUpdatedAt * 1000)
      : new Date();
  return {
    btcIdr,
    usdcIdr,
    fetchedAt: fetchedAt.toISOString(),
    source: "coingecko",
  };
}

export async function fetchBtcIdrFromCoinMarketCap(): Promise<{
  btcIdr: number;
  usdcIdr: number;
  fetchedAt: string;
  source: string;
}> {
  const apiKey = process.env.COINMARKETCAP_API_KEY?.trim();
  if (!apiKey) throw new Error("COINMARKETCAP_API_KEY missing");
  const url =
    "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC,USDC&convert=IDR";
  const res = await fetch(url, {
    headers: { accept: "application/json", "X-CMC_PRO_API_KEY": apiKey },
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(
      `CoinMarketCap quote ${res.status}: ${body?.status?.error_message || "failed"}`,
    );
  }
  const btcQuote = body?.data?.BTC?.quote?.IDR;
  const usdcQuote = body?.data?.USDC?.quote?.IDR;
  const btcIdr = Number(btcQuote?.price);
  const usdcIdr = Number(usdcQuote?.price);
  const lastUpdated =
    (typeof btcQuote?.last_updated === "string" && btcQuote.last_updated) ||
    (typeof usdcQuote?.last_updated === "string" && usdcQuote.last_updated) ||
    null;
  if (
    !Number.isFinite(btcIdr) ||
    btcIdr <= 0 ||
    !Number.isFinite(usdcIdr) ||
    usdcIdr <= 0
  ) {
    throw new Error("CoinMarketCap quote unavailable");
  }
  const fetchedAt = lastUpdated ? new Date(lastUpdated) : new Date();
  return {
    btcIdr,
    usdcIdr,
    fetchedAt: fetchedAt.toISOString(),
    source: "coinmarketcap",
  };
}

export async function fetchBtcIdrQuote(): Promise<{
  btcIdr: number;
  usdcIdr: number;
  fetchedAt: string;
  source: string;
}> {
  if (process.env.COINMARKETCAP_API_KEY?.trim()) {
    try {
      return await fetchBtcIdrFromCoinMarketCap();
    } catch (e) {
      log.warn("quote", "CoinMarketCap failed; falling back to CoinGecko", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return fetchBtcIdrFromCoinGecko();
}

let cachedBtcIdr: {
  value: { btcIdr: number; usdcIdr: number; fetchedAt: string; source: string };
  cachedAtMs: number;
} | null = null;

export async function fetchBtcIdrQuoteCached(): Promise<{
  btcIdr: number;
  usdcIdr: number;
  fetchedAt: string;
  source: string;
}> {
  const ttlMs = 120_000;
  if (cachedBtcIdr && Date.now() - cachedBtcIdr.cachedAtMs < ttlMs) {
    return cachedBtcIdr.value;
  }
  const q = await fetchBtcIdrQuote();
  cachedBtcIdr = { value: q, cachedAtMs: Date.now() };
  return q;
}

export function requireWdkSeed(): string {
  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    log.error("spark", "WDK_SEED missing", undefined);
    throw new Error("WDK_SEED is not configured on the server.");
  }
  return seed;
}

export async function advanceOrderState(
  orderId: string,
  next: OrderState,
): Promise<unknown> {
  const mem = memoryOrders.get(orderId);
  if (mem) {
    const from = mem.state;
    requireTransition(from, next);
    const updated: MemoryOrder = {
      ...mem,
      state: next,
      updatedAt: nowIso(),
      completedAt:
        next === "COMPLETED" ? nowIso() : mem.completedAt ?? null,
    };
    memoryOrders.set(orderId, updated);
    log.info("pipeline", "state transition", { orderId, from, to: next });
    return updated as any;
  }

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order not found");
    const from = order.state as OrderState;
    requireTransition(from, next);
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        state: next,
        completedAt: next === "COMPLETED" ? new Date() : order.completedAt,
      },
    });
    log.info("pipeline", "state transition", { orderId, from, to: next });
    return updated;
  } catch (e) {
    if (isDbAccessError(e)) {
      throw new Error("Database not available (permission denied).");
    }
    throw e;
  }
}

export function logArbitrumAgentAddresses(orderId: string): void {
  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    log.warn("pipeline", "WDK_SEED not set; cannot log Arbitrum agent (Safe) address", {
      orderId,
    });
    return;
  }
  try {
    const { ownerAddress, safeAddress, chainId } =
      deriveArbitrumErc4337ReceiveAddress(seed);
    log.info("pipeline", "Arbitrum agent (WDK ERC-4337)", {
      orderId,
      chainId,
      ownerAddress,
      safeAddress,
    });
  } catch (e) {
    log.warn("pipeline", "failed to derive Arbitrum agent address", {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    const b = deriveBaseErc4337ReceiveAddress(seed);
    log.info("pipeline", "Base agent (WDK ERC-4337)", {
      orderId,
      chainId: b.chainId,
      ownerAddress: b.ownerAddress,
      safeAddress: b.safeAddress,
    });
  } catch (e) {
    log.warn("pipeline", "failed to derive Base agent address", {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function normalizePayoutMethod(method: unknown): "bank_transfer" {
  const m = String(method || "bank_transfer").trim().toLowerCase();
  if (m === "gopay") {
    throw new Error(
      "Unsupported payoutMethod: use bank_transfer with idrxBankCode and idrxBankName from IDRX methods.",
    );
  }
  if (m === "bank_transfer" || m === "bank" || m === "bca") return "bank_transfer";
  throw new Error("Invalid payoutMethod (expected bank_transfer)");
}

export async function assertValidIdrxPayoutPair(
  bankCode: string,
  bankName: string,
): Promise<void> {
  const out = await getCachedIdrxTransactionMethods();
  const rows = out.data ?? [];
  const c = bankCode.trim();
  const n = bankName.trim();
  const ok = rows.some(
    (r) =>
      String(r.bankCode ?? "").trim() === c &&
      String(r.bankName ?? "").trim() === n,
  );
  if (!ok) {
    throw new Error(
      "idrxBankCode and idrxBankName must match a row from IDRX GET /transaction/method",
    );
  }
}

export function normalizeBankAccountName(raw: unknown): string {
  const s = String(raw || "").trim();
  if (s) return s;
  return process.env.IDRX_DEFAULT_BANK_ACCOUNT_NAME?.trim() || "Paysats user";
}

export function normalizeDepositChannel(
  raw: unknown,
): "lightning" | "cbbtc" | "btcb" {
  const m = String(raw ?? "lightning").trim().toLowerCase();
  if (m === "" || m === "lightning" || m === "ln") return "lightning";
  if (m === "cbbtc") return "cbbtc";
  if (m === "btcb") return "btcb";
  throw new Error("Invalid depositChannel (expected lightning, cbbtc, or btcb)");
}

export function evmDepositQrValue(toAddress: string, chainId: number): string {
  return `ethereum:${toAddress}@${chainId}`;
}

export function normalizeRecipientDetails(
  isEwallet: boolean,
  raw: unknown,
): string {
  const s = String(raw || "").trim();
  if (!s) throw new Error("recipientDetails is required");

  if (isEwallet) {
    let digits: string;
    if (/^\+\d{1,3}-\d{6,14}$/.test(s)) {
      digits = s.replace(/\D/g, "");
    } else {
      const d = s.replace(/\D/g, "");
      if (!/^\d{10,15}$/.test(d)) {
        throw new Error(
          "E-wallet recipientDetails must be +CC-NNN… (example: +62-81234567890) or a 10–15 digit mobile (digits only)",
        );
      }
      digits = d;
    }
    if (digits.length < 10 || digits.length > 15) {
      throw new Error("E-wallet mobile number must be 10–15 digits after normalizing");
    }
    return digits;
  }

  const digits = s.replace(/[^\d]/g, "");
  if (!digits) throw new Error("recipientDetails is required");
  return digits;
}

export function computeSatsFromIdr(idrAmount: number, btcIdr: number): number {
  const sats = Math.ceil((idrAmount / btcIdr) * 1e8);
  return Math.max(1, sats);
}

export function computeIdrFromSatsFloor(satAmount: number, btcIdr: number): number {
  const idr = Math.floor((satAmount / 1e8) * btcIdr);
  return Math.max(0, idr);
}

const offrampWatchers = new Map<string, true>();

export type WatchInvoiceParams = {
  orderId: string;
  bolt11: string;
  invoiceLnId: string;
  satAmount: number;
  recipientDetails: string;
  bankAccountName: string;
  idrxPayoutBankCode: string;
  idrxPayoutBankName: string;
};

export async function watchInvoiceAndRunOfframpPipeline(
  params: WatchInvoiceParams,
): Promise<void> {
  if (offrampWatchers.has(params.orderId)) {
    log.warn("pipeline", "watcher already running; skip duplicate", {
      orderId: params.orderId,
    });
    return;
  }
  offrampWatchers.set(params.orderId, true);

  try {
    log.info(
      "pipeline",
      "offramp pipeline started — waiting for user to pay funding invoice",
      {
        orderId: params.orderId,
        satAmount: params.satAmount,
        idrxPayoutBankCode: params.idrxPayoutBankCode,
        fundingInvoicePrefix:
          params.bolt11.slice(0, 28) + (params.bolt11.length > 28 ? "…" : ""),
        fundingInvoiceLen: params.bolt11.length,
      },
    );
    logArbitrumAgentAddresses(params.orderId);

    const wdkSeed = requireWdkSeed();
    const spark = await initSpark(wdkSeed);
    log.info("pipeline", "Spark operator wallet (pays Boltz / makes invoices)", {
      orderId: params.orderId,
      balanceSats: spark.balanceSats,
    });

    const startedAt = Date.now();
    const maxWaitMs = 60 * 60 * 1000;
    let pollCount = 0;
    while (Date.now() - startedAt < maxWaitMs) {
      pollCount += 1;
      const o =
        memoryOrders.get(params.orderId) ??
        (await prisma.order
          .findUnique({ where: { id: params.orderId } })
          .catch(() => null));
      if (!o) {
        log.warn("pipeline", "order disappeared during wait; abort", {
          orderId: params.orderId,
        });
        return;
      }
      const state = (o as any).state as OrderState;
      const invoicePaidAt = (o as any).invoicePaidAt ?? null;
      if (state === "FAILED" || state === "COMPLETED") {
        log.info("pipeline", "stopped invoice wait — terminal order state", {
          orderId: params.orderId,
          state,
        });
        return;
      }
      if (invoicePaidAt) break;

      let lookupResult: { paid: boolean; raw: any };
      try {
        lookupResult = await lookupSparkInvoice(spark.account, params.invoiceLnId);
      } catch (e) {
        log.warn("pipeline", "lookupSparkInvoice failed (will retry)", {
          orderId: params.orderId,
          pollCount,
          error: e instanceof Error ? e.message : String(e),
        });
        await delay(3000);
        continue;
      }
      log.info(
        "pipeline",
        "funding invoice poll (Spark getLightningReceiveRequest)",
        { orderId: params.orderId, pollCount, paid: lookupResult.paid },
      );

      if (lookupResult.paid) {
        const mem = memoryOrders.get(params.orderId);
        if (mem) {
          memoryOrders.set(params.orderId, {
            ...mem,
            invoicePaidAt: nowIso(),
            updatedAt: nowIso(),
          });
        } else {
          await prisma.order
            .update({
              where: { id: params.orderId },
              data: { invoicePaidAt: new Date() } as any,
            })
            .catch(() => {});
        }
        log.info("pipeline", "funding invoice settled by user", {
          orderId: params.orderId,
          pollCount,
        });
        await advanceOrderState(params.orderId, "LN_INVOICE_PAID");
        break;
      }

      await delay(3000);
    }

    const orderAfterPaid =
      memoryOrders.get(params.orderId) ??
      (await prisma.order
        .findUnique({ where: { id: params.orderId } })
        .catch(() => null));
    if (!(orderAfterPaid as any)?.invoicePaidAt) {
      log.warn(
        "pipeline",
        "funding invoice wait timeout or never paid — stopping pipeline",
        { orderId: params.orderId, maxWaitMs, polls: pollCount },
      );
      return;
    }

    await advanceOrderState(params.orderId, "BOLTZ_SWAP_PENDING");

    const receiveAddress = requireArbitrumReceiveAddress();
    log.info("pipeline", "starting Boltz (LN→USDT Arbitrum UI automation)", {
      orderId: params.orderId,
      satAmount: params.satAmount,
      boltzReceiveAddress: `${receiveAddress.slice(0, 10)}…${receiveAddress.slice(-6)}`,
    });
    const boltz = await createBoltzSwap({
      satAmount: params.satAmount,
      receiveAddress,
      log: (msg) => log.info("boltz", msg, { orderId: params.orderId }),
      onBoltzClaimTxHash: (txHash) => {
        const mem = memoryOrders.get(params.orderId);
        if (mem) {
          memoryOrders.set(params.orderId, {
            ...mem,
            boltzTxHash: txHash,
            updatedAt: nowIso(),
          });
        }
        prisma.order
          .update({ where: { id: params.orderId }, data: { boltzTxHash: txHash } })
          .catch(() => {});
      },
    });
    log.info(
      "pipeline",
      "Boltz swap created — have Boltz pay invoice to complete swap",
      {
        orderId: params.orderId,
        boltzSwapId: boltz.swapId,
        boltzQuotedSats: boltz.satsAmount,
        boltzQuotedUsdt: boltz.usdtAmount,
      },
    );

    {
      const mem = memoryOrders.get(params.orderId);
      if (mem) {
        memoryOrders.set(params.orderId, {
          ...mem,
          boltzSwapId: boltz.swapId,
          boltzLnInvoice: boltz.invoice,
          usdtAmount: Number(boltz.usdtAmount || 0) || null,
          updatedAt: nowIso(),
        });
      } else {
        await prisma.order
          .update({
            where: { id: params.orderId },
            data: {
              boltzSwapId: boltz.swapId,
              boltzLnInvoice: boltz.invoice,
              usdtAmount: Number(boltz.usdtAmount || 0) || null,
            },
          })
          .catch(() => {});
      }
    }

    log.info("pipeline", "paying Boltz Lightning invoice via Spark (operator wallet)", {
      orderId: params.orderId,
      boltzInvoiceLen: boltz.invoice.length,
    });
    const balanceBufferSats = Math.max(
      0,
      Number(process.env.SPARK_PAY_BALANCE_BUFFER_SATS || "50") || 50,
    );
    const waitForBalanceMs = Math.max(
      0,
      Number(process.env.SPARK_WAIT_FOR_BALANCE_MS || "60000") || 60_000,
    );
    const balancePollMs = Math.max(
      250,
      Number(process.env.SPARK_BALANCE_POLL_MS || "1500") || 1500,
    );
    const maxFeeSats = Math.max(
      0,
      Number(process.env.SPARK_PAY_MAX_FEE_SATS || "1000") || 1000,
    );
    const minBalanceSats =
      Math.max(0, Math.ceil(Number(boltz.satsAmount || 0))) + balanceBufferSats;

    const confirmMaxWaitMs = Math.max(
      0,
      Number(process.env.BOLTZ_USDT_CONFIRM_MAX_WAIT_MS || "240000") || 240_000,
    );
    const confirmPollMs = Math.max(
      500,
      Number(process.env.BOLTZ_USDT_CONFIRM_POLL_MS || "5000") || 5_000,
    );
    let startUsdtRaw: bigint | undefined = undefined;
    {
      const start = await waitForArbitrumUsdtBalance({
        orderId: params.orderId,
        seed: wdkSeed,
        maxWaitMs: 1,
        pollMs: 1,
      });
      startUsdtRaw = start.balanceRaw;
    }

    try {
      const boltzPay = await paySparkInvoiceWithRetries({
        seed: wdkSeed,
        bolt11: boltz.invoice,
        maxAttempts: Number(process.env.SPARK_PAY_MAX_ATTEMPTS || "3") || 3,
        baseDelayMs: Number(process.env.SPARK_PAY_BASE_DELAY_MS || "1500") || 1500,
        minBalanceSats,
        waitForBalanceMs,
        balancePollMs,
        maxFeeSats,
        boltzSwapId: boltz.swapId,
        startUsdtRaw,
      });
      log.info("pipeline", "Boltz Lightning invoice paid via Spark", {
        orderId: params.orderId,
        payId: boltzPay.id,
        status: boltzPay.status,
        attempts: boltzPay.attempts,
      });
    } catch (e) {
      log.warn("pipeline", "Spark pay_invoice failed; attempting Arbitrum USDT confirmation", {
        orderId: params.orderId,
        error: e instanceof Error ? e.message : String(e),
      });
      const confirmed = await waitForArbitrumUsdtBalance({
        orderId: params.orderId,
        seed: wdkSeed,
        startBalanceRaw: startUsdtRaw,
        maxWaitMs: confirmMaxWaitMs,
        pollMs: confirmPollMs,
      });
      if (confirmed.satisfied) {
        log.info(
          "pipeline",
          "Boltz success confirmed via Arbitrum USDT balance (despite pay_invoice error)",
          {
            orderId: params.orderId,
            usdtRaw: confirmed.balanceRaw.toString(),
          },
        );
      } else {
        throw e;
      }
    }

    await waitForArbitrumUsdtBalance({
      orderId: params.orderId,
      seed: wdkSeed,
      startBalanceRaw: startUsdtRaw,
      maxWaitMs: confirmMaxWaitMs,
      pollMs: confirmPollMs,
    }).catch(() => {});
    await advanceOrderState(params.orderId, "USDT_RECEIVED");

    const fromAmountMinUnits = String(
      Math.max(1, Math.floor(Number(boltz.usdtAmount || 0) * 1e6)),
    );
    const pauseAfterLifi =
      process.env.PAUSE_AFTER_LIFI === "1" || process.env.PAUSE_P2P_FLOW === "1";

    const idrxRecipient = idrxBaseRecipientAddress();
    log.info("pipeline", "USDT on Arbitrum — next: LiFi USDT → IDRX (Base)", {
      orderId: params.orderId,
    });
    if (process.env.LIFI_API_KEY?.trim()) {
      try {
        const quote = await fetchLifiQuote({
          apiKey: String(process.env.LIFI_API_KEY),
          fromAddress: receiveAddress,
          toAddress: idrxRecipient,
          fromAmount: fromAmountMinUnits,
          toToken: LIFI_IDRX_BASE,
          slippage: process.env.LIFI_SLIPPAGE?.trim() || "0.03",
        });
        log.info("lifi", "quote fetched (IDRX path)", {
          orderId: params.orderId,
          tool: quote.toolDetails?.name || quote.tool || "(unknown)",
          toAmount: quote.estimate?.toAmount,
        });
      } catch (e) {
        log.warn("lifi", "IDRX quote fetch failed (continuing to swap attempt)", {
          orderId: params.orderId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const idrxSwap = await executeUsdtToIdrxOnBase({
      usdtAmount: Number(boltz.usdtAmount || 0) || 0,
      walletAddress: receiveAddress,
    });
    log.info("pipeline", "LiFi IDRX swap finished", {
      orderId: params.orderId,
      idrxAmountIdr: idrxSwap.idrxAmountIdr,
      swapTxHash: idrxSwap.txHash,
    });
    {
      const mem = memoryOrders.get(params.orderId);
      const patch = {
        idrxAmountIdr: idrxSwap.idrxAmountIdr,
        swapTxHash: idrxSwap.txHash,
        updatedAt: nowIso(),
      };
      if (mem) {
        memoryOrders.set(params.orderId, { ...mem, ...patch });
      } else {
        await prisma.order
          .update({
            where: { id: params.orderId },
            data: {
              idrxAmountIdr: idrxSwap.idrxAmountIdr,
              swapTxHash: idrxSwap.txHash,
            },
          })
          .catch(() => {});
      }
    }
    await advanceOrderState(params.orderId, "USDC_SWAPPED");

    if (pauseAfterLifi) {
      log.warn(
        "pipeline",
        "PAUSE_AFTER_LIFI / PAUSE_P2P_FLOW — stopping after LiFi (no IDRX burn)",
        { orderId: params.orderId, idrxAmountIdr: idrxSwap.idrxAmountIdr },
      );
      return;
    }

    if (!process.env.BASE_RPC_URL?.trim()) {
      throw new Error("BASE_RPC_URL is not set (required for IDRX burn via WDK on Base).");
    }
    if (!process.env.IDRX_API_KEY?.trim() || !process.env.IDRX_API_SECRET?.trim()) {
      throw new Error("IDRX_API_KEY / IDRX_API_SECRET not set (required for redeem-request).");
    }

    const orderForBurn =
      memoryOrders.get(params.orderId) ??
      (await prisma.order
        .findUnique({ where: { id: params.orderId } })
        .catch(() => null));
    const idrFromOrder =
      orderForBurn && (orderForBurn as { idrAmount?: unknown }).idrAmount != null
        ? Number((orderForBurn as { idrAmount: number }).idrAmount)
        : NaN;
    const burnAmountIdr =
      Number.isFinite(idrFromOrder) && idrFromOrder > 0
        ? Math.floor(idrFromOrder)
        : undefined;

    const burnOut = await runBankIdrxBurnOnly({
      orderId: params.orderId,
      recipientDigits: params.recipientDetails,
      payoutBankName: params.idrxPayoutBankName,
      idrxAmountMinRaw: idrxSwap.idrxAmountMinRaw,
      burnAmountIdr,
    });
    {
      const mem = memoryOrders.get(params.orderId);
      const patch = {
        idrxBurnTxHash: burnOut.burnTxHash,
        updatedAt: nowIso(),
      };
      if (mem) {
        memoryOrders.set(params.orderId, { ...mem, ...patch });
      } else {
        await prisma.order
          .update({
            where: { id: params.orderId },
            data: { idrxBurnTxHash: burnOut.burnTxHash },
          })
          .catch(() => {});
      }
    }
    await advanceOrderState(params.orderId, "P2PM_ORDER_PLACED");

    const redeemId = await runBankIdrxRedeemOnly({
      orderId: params.orderId,
      burnTxHash: burnOut.burnTxHash,
      amountTransfer: burnOut.amountTransfer,
      recipientDigits: params.recipientDetails,
      bankAccountName: params.bankAccountName,
      holderAddress: burnOut.holderAddress,
      bankCode: params.idrxPayoutBankCode,
      bankName: params.idrxPayoutBankName,
    });
    {
      const mem = memoryOrders.get(params.orderId);
      const patch = {
        idrxRedeemId: redeemId,
        p2pmOrderId: redeemId,
        updatedAt: nowIso(),
      };
      if (mem) {
        memoryOrders.set(params.orderId, { ...mem, ...patch });
      } else {
        await prisma.order
          .update({
            where: { id: params.orderId },
            data: { idrxRedeemId: redeemId, p2pmOrderId: redeemId },
          })
          .catch(() => {});
      }
    }
    await advanceOrderState(params.orderId, "P2PM_ORDER_CONFIRMED");
    await advanceOrderState(params.orderId, "IDR_SETTLED");
    await advanceOrderState(params.orderId, "COMPLETED");
    log.info("pipeline", "offramp pipeline completed (IDRX path)", {
      orderId: params.orderId,
    });
    try {
      const oDone =
        memoryOrders.get(params.orderId) ??
        (await prisma.order.findUnique({ where: { id: params.orderId } }));
      const merch = String((oDone as { merchantName?: string | null })?.merchantName || "");
      const idrDone = Number((oDone as { idrAmount?: number | null })?.idrAmount);
      if (
        merch === "Offramp" &&
        Number.isFinite(idrDone) &&
        idrDone > 0 &&
        params.satAmount > 0
      ) {
        recordOfframpCompletionVolume({
          satAmount: params.satAmount,
          idrAmount: idrDone,
        });
      }
    } catch (e) {
      log.warn("liquidity", "platform stats update skipped", {
        orderId: params.orderId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (error) {
    log.error("pipeline", "offramp pipeline failed", error, {
      orderId: params.orderId,
    });
    try {
      const mem = memoryOrders.get(params.orderId);
      if (mem) {
        memoryOrders.set(params.orderId, {
          ...mem,
          state: "FAILED",
          updatedAt: nowIso(),
        });
      } else {
        await prisma.order.update({
          where: { id: params.orderId },
          data: { state: "FAILED" },
        });
      }
    } catch {
      /* ignore */
    }
  } finally {
    offrampWatchers.delete(params.orderId);
  }
}

export type CreateOfframpInput = {
  satAmount?: number;
  idrAmount?: number;
  payoutMethod?: string;
  idrxBankCode: string;
  idrxBankName: string;
  recipientDetails: string;
  bankAccountName?: string;
  depositChannel?: string;
};

export type CreateOfframpOutput = {
  orderId: string;
  bolt11: string | null;
  satAmount: number;
  idrAmount: number;
  btcIdr: number;
  fetchedAt: string;
  invoiceExpiresAt: string | null;
  deposit?: {
    channel: "cbbtc" | "btcb";
    chainId: number;
    chainName: string;
    tokenSymbol: string;
    tokenAddress: string;
    toAddress: string;
    decimals: number;
    qrValue: string;
  };
};

/**
 * Shared offramp creation used by both the legacy `/api/offramp/create` route
 * (no tenantId) and the new `/v1/offramp/orders` route (tenant-scoped).
 */
export async function createOfframpOrder(
  input: CreateOfframpInput,
  options: { tenantId?: string | null } = {},
): Promise<CreateOfframpOutput> {
  const payoutMethod = normalizePayoutMethod(input.payoutMethod);
  const idrxBankCode = String(input.idrxBankCode || "").trim();
  const idrxBankName = String(input.idrxBankName || "").trim();
  if (!idrxBankCode || !idrxBankName) {
    throw new Error(
      "idrxBankCode and idrxBankName are required (from GET /v1/payout/methods)",
    );
  }
  await assertValidIdrxPayoutPair(idrxBankCode, idrxBankName);
  const isEwallet = isIdrxEwalletBankCode(idrxBankCode);
  const recipientDetails = normalizeRecipientDetails(
    isEwallet,
    input.recipientDetails,
  );
  const bankAccountName = normalizeBankAccountName(input.bankAccountName);
  const depositChannel = normalizeDepositChannel(input.depositChannel);

  const { btcIdr, fetchedAt } = await fetchBtcIdrQuoteCached();
  const requestedSats = Number(input.satAmount || 0);
  const requestedIdr = Number(input.idrAmount || 0);

  const satAmount =
    Number.isFinite(requestedSats) && requestedSats > 0
      ? Math.max(1, Math.floor(requestedSats))
      : computeSatsFromIdr(requestedIdr, btcIdr);

  const idrAmount =
    Number.isFinite(requestedIdr) && requestedIdr > 0
      ? requestedIdr
      : computeIdrFromSatsFloor(satAmount, btcIdr);

  if (!Number.isFinite(satAmount) || satAmount <= 0) {
    throw new Error("satAmount or idrAmount is required and must be positive");
  }

  const tenantId = options.tenantId ?? null;

  if (depositChannel !== "lightning") {
    const seed = process.env.WDK_SEED?.trim();
    if (!seed) {
      throw new Error(
        "WDK_SEED is not configured; cannot derive EVM deposit addresses for cbBTC/BTCB.",
      );
    }

    let depositToAddress: string;
    let depositChainId: number;
    let depositTokenAddress: string;
    let tokenSymbol: string;
    let chainName: string;
    let decimals: number;

    if (depositChannel === "cbbtc") {
      const d = deriveBaseErc4337ReceiveAddress(seed);
      depositToAddress = d.safeAddress;
      depositChainId = 8453;
      depositTokenAddress = LIFI_CBTC_BASE;
      tokenSymbol = "cbBTC";
      chainName = "Base";
      decimals = 8;
    } else {
      const d = deriveBscErc4337ReceiveAddress(seed);
      depositToAddress = d.safeAddress;
      depositChainId = 56;
      depositTokenAddress = LIFI_BTCB_BSC;
      tokenSymbol = "BTCB";
      chainName = "BNB Chain";
      decimals = 18;
    }

    const qrValue = evmDepositQrValue(depositToAddress, depositChainId);

    let orderId: string;
    try {
      const order = await prisma.order.create({
        data: {
          tenantId,
          state: "ROUTE_SHOWN",
          satAmount,
          idrAmount,
          btcIdr,
          btcIdrFetchedAt: new Date(fetchedAt),
          p2pmPayoutMethod: payoutMethod,
          idrxPayoutBankCode: idrxBankCode,
          idrxPayoutBankName: idrxBankName,
          payoutRecipient: recipientDetails,
          bankAccountName,
          invoiceBolt11: null,
          invoiceExpiresAt: null,
          depositChannel,
          depositChainId,
          depositTokenAddress,
          depositToAddress,
          merchantName: "Offramp",
        } as any,
      });
      orderId = order.id;
    } catch (e) {
      if (!isDbAccessError(e)) throw e;
      orderId = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const createdAt = nowIso();
      memoryOrders.set(orderId, {
        id: orderId,
        tenantId,
        state: "ROUTE_SHOWN",
        satAmount,
        idrAmount,
        btcIdr,
        btcIdrFetchedAt: fetchedAt,
        p2pmPayoutMethod: payoutMethod,
        idrxPayoutBankCode: idrxBankCode,
        idrxPayoutBankName: idrxBankName,
        payoutRecipient: recipientDetails,
        bankAccountName,
        invoiceBolt11: null,
        invoiceExpiresAt: null,
        depositChannel,
        depositChainId,
        depositTokenAddress,
        depositToAddress,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        merchantName: "Offramp",
        qrisPayload: null,
        boltzSwapId: null,
        boltzLnInvoice: null,
        boltzLnPreimage: null,
        boltzTxHash: null,
        swapTxHash: null,
        p2pmOrderId: null,
        usdtAmount: null,
        usdcAmount: null,
      });
      log.warn("db", "DB unavailable; using in-memory order store", { orderId });
    }

    log.info(
      "api",
      "offramp order created (wrapped deposit — no Lightning watcher)",
      { orderId, tenantId, depositChannel, satAmount },
    );

    return {
      orderId,
      bolt11: null,
      satAmount,
      idrAmount,
      btcIdr,
      fetchedAt,
      invoiceExpiresAt: null,
      deposit: {
        channel: depositChannel,
        chainId: depositChainId,
        chainName,
        tokenSymbol,
        tokenAddress: depositTokenAddress,
        toAddress: depositToAddress,
        decimals,
        qrValue,
      },
    };
  }

  let invoice: SparkInvoiceResult;
  let sparkReady = false;
  try {
    const seed = requireWdkSeed();
    const { account } = await initSpark(seed);
    invoice = await createSparkInvoice(
      account,
      satAmount,
      `paysats offramp ${idrAmount.toLocaleString("id-ID")} IDR (${idrxBankName})`,
    );
    sparkReady = true;
  } catch (e) {
    if (process.env.ALLOW_STUB_INVOICE === "1") {
      log.warn("spark", "Spark unavailable; using stub invoice (ALLOW_STUB_INVOICE=1)", {
        error: e instanceof Error ? e.message : String(e),
      });
      invoice = { bolt11: makeStubInvoice().bolt11, invoiceId: "" };
    } else {
      throw e;
    }
  }

  let orderId: string;
  try {
    const order = await prisma.order.create({
      data: {
        tenantId,
        state: "ROUTE_SHOWN",
        satAmount,
        idrAmount,
        btcIdr,
        btcIdrFetchedAt: new Date(fetchedAt),
        p2pmPayoutMethod: payoutMethod,
        idrxPayoutBankCode: idrxBankCode,
        idrxPayoutBankName: idrxBankName,
        payoutRecipient: recipientDetails,
        bankAccountName,
        invoiceBolt11: invoice.bolt11,
        invoiceLnId: invoice.invoiceId || null,
        merchantName: "Offramp",
      } as any,
    });
    orderId = order.id;
  } catch (e) {
    if (!isDbAccessError(e)) throw e;
    orderId = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = nowIso();
    memoryOrders.set(orderId, {
      id: orderId,
      tenantId,
      state: "ROUTE_SHOWN",
      satAmount,
      idrAmount,
      btcIdr,
      btcIdrFetchedAt: fetchedAt,
      p2pmPayoutMethod: payoutMethod,
      idrxPayoutBankCode: idrxBankCode,
      idrxPayoutBankName: idrxBankName,
      payoutRecipient: recipientDetails,
      bankAccountName,
      invoiceBolt11: invoice.bolt11,
      invoiceLnId: invoice.invoiceId || null,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      merchantName: "Offramp",
      qrisPayload: null,
      boltzSwapId: null,
      boltzLnInvoice: null,
      boltzLnPreimage: null,
      boltzTxHash: null,
      swapTxHash: null,
      p2pmOrderId: null,
      usdtAmount: null,
      usdcAmount: null,
    });
    log.warn("db", "DB unavailable; using in-memory order store", { orderId });
  }

  if (
    sparkReady &&
    invoice.bolt11 &&
    invoice.bolt11.startsWith("ln") &&
    invoice.invoiceId
  ) {
    log.info(
      "pipeline",
      "offramp order created — background watcher will run after response",
      {
        orderId,
        tenantId,
        satAmount,
        idrAmount,
      },
    );
    watchInvoiceAndRunOfframpPipeline({
      orderId,
      bolt11: invoice.bolt11,
      invoiceLnId: invoice.invoiceId,
      satAmount,
      recipientDetails,
      bankAccountName,
      idrxPayoutBankCode: idrxBankCode,
      idrxPayoutBankName: idrxBankName,
    }).catch((e) =>
      log.error("pipeline", "watcher crashed (unhandled)", e, { orderId }),
    );
  } else if (!sparkReady) {
    log.warn(
      "pipeline",
      "Not starting invoice watcher (stub invoice or Spark unavailable)",
      { orderId },
    );
  }

  return {
    orderId,
    bolt11: invoice.bolt11,
    satAmount,
    idrAmount,
    btcIdr,
    fetchedAt,
    invoiceExpiresAt: null,
  };
}
