import "./playwrightBrowsersPath.js";
import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  deriveArbitrumErc4337ReceiveAddress,
  requireArbitrumReceiveAddress
} from "./arbitrumErc4337Address.js";
import { deriveBaseErc4337ReceiveAddress } from "./baseErc4337Address.js";
import { deriveBscErc4337ReceiveAddress } from "./bscErc4337Address.js";
import { createBoltzSwap, getBoltzSwapStatus } from "./boltz.js";
import { log } from "./logger.js";
import {
  initSpark,
  createSparkInvoice,
  lookupSparkInvoice,
  paySparkInvoice,
  paySparkInvoiceWithRetries,
  type SparkInvoiceResult,
} from "./spark.js";
import { prisma } from "./prisma.js";
import { OrderState, requireTransition } from "./state.js";
import {
  executeBtcbToIdrxFromBsc,
  executeCbbtcToIdrxOnBase,
  executeUsdtToIdrxOnBase,
  executeUsdtToUsdcSwap,
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
  sortIdrxMethodsForUi,
} from "./idrxPayoutClassify.js";
import { runBankIdrxBurnOnly, runBankIdrxRedeemOnly } from "./idrxOfframp.js";
import {
  readLiquidityDisplayStats,
  recordOfframpCompletionVolume,
} from "./liquidityDisplayStats.js";
import { waitForArbitrumUsdtBalance } from "./arbUsdtConfirm.js";

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(cors());
app.use(express.json());

type MemoryOrder = {
  id: string;
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
  // carry through existing fields that receipt UI expects
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

const memoryOrders = new Map<string, MemoryOrder>();

function isDbAccessError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("P1010") || msg.toLowerCase().includes("denied access") || msg.includes("User was denied access");
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeStubInvoice(): { bolt11: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const bolt11 = `paysats_stub_invoice_${Date.now().toString(36)}`;
  return { bolt11, expiresAt };
}

async function fetchBtcIdrFromCoinGecko(): Promise<{ btcIdr: number; usdcIdr: number; fetchedAt: string; source: string }> {
  // CoinGecko Simple Price: https://www.coingecko.com/en/api/documentation
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,usd-coin&vs_currencies=idr&include_last_updated_at=true";
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  const body = (await res.json().catch(() => ({}))) as any;
  const btcIdr = Number(body?.bitcoin?.idr);
  const usdcIdr = Number(body?.["usd-coin"]?.idr);
  const lastUpdatedAt = Number(body?.bitcoin?.last_updated_at);
  if (!Number.isFinite(btcIdr) || btcIdr <= 0 || !Number.isFinite(usdcIdr) || usdcIdr <= 0) {
    throw new Error("CoinGecko quote unavailable");
  }
  const fetchedAt = Number.isFinite(lastUpdatedAt) && lastUpdatedAt > 0 ? new Date(lastUpdatedAt * 1000) : new Date();
  return { btcIdr, usdcIdr, fetchedAt: fetchedAt.toISOString(), source: "coingecko" };
}

async function fetchBtcIdrFromCoinMarketCap(): Promise<{ btcIdr: number; usdcIdr: number; fetchedAt: string; source: string }> {
  // CoinMarketCap Quotes Latest: https://coinmarketcap.com/api/documentation/v1/#operation/getV1CryptocurrencyQuotesLatest
  const apiKey = process.env.COINMARKETCAP_API_KEY?.trim();
  if (!apiKey) throw new Error("COINMARKETCAP_API_KEY missing");

  const url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC,USDC&convert=IDR";
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-CMC_PRO_API_KEY": apiKey
    }
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(`CoinMarketCap quote ${res.status}: ${body?.status?.error_message || "failed"}`);
  }
  const btcQuote = body?.data?.BTC?.quote?.IDR;
  const usdcQuote = body?.data?.USDC?.quote?.IDR;
  const btcIdr = Number(btcQuote?.price);
  const usdcIdr = Number(usdcQuote?.price);
  const lastUpdated =
    (typeof btcQuote?.last_updated === "string" && btcQuote.last_updated) ||
    (typeof usdcQuote?.last_updated === "string" && usdcQuote.last_updated) ||
    null;
  if (!Number.isFinite(btcIdr) || btcIdr <= 0 || !Number.isFinite(usdcIdr) || usdcIdr <= 0) {
    throw new Error("CoinMarketCap quote unavailable");
  }
  const fetchedAt = lastUpdated ? new Date(lastUpdated) : new Date();
  return { btcIdr, usdcIdr, fetchedAt: fetchedAt.toISOString(), source: "coinmarketcap" };
}

async function fetchBtcIdrQuote(): Promise<{ btcIdr: number; usdcIdr: number; fetchedAt: string; source: string }> {
  if (process.env.COINMARKETCAP_API_KEY?.trim()) {
    try {
      return await fetchBtcIdrFromCoinMarketCap();
    } catch (e) {
      log.warn("quote", "CoinMarketCap failed; falling back to CoinGecko", {
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return fetchBtcIdrFromCoinGecko();
}

let cachedBtcIdr: {
  value: { btcIdr: number; usdcIdr: number; fetchedAt: string; source: string };
  cachedAtMs: number;
} | null = null;
async function fetchBtcIdrQuoteCached(): Promise<{ btcIdr: number; usdcIdr: number; fetchedAt: string; source: string }> {
  const ttlMs = 120_000;
  if (cachedBtcIdr && Date.now() - cachedBtcIdr.cachedAtMs < ttlMs) {
    return cachedBtcIdr.value;
  }
  const q = await fetchBtcIdrQuote();
  cachedBtcIdr = { value: q, cachedAtMs: Date.now() };
  return q;
}

function requireWdkSeed(): string {
  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    log.error("spark", "WDK_SEED missing", undefined);
    throw new Error("WDK_SEED is not configured on the server.");
  }
  return seed;
}

async function advanceOrderState(orderId: string, next: OrderState) {
  // Memory fallback
  const mem = memoryOrders.get(orderId);
  if (mem) {
    const from = mem.state;
    requireTransition(from, next);
    const updated: MemoryOrder = {
      ...mem,
      state: next,
      updatedAt: nowIso(),
      completedAt: next === "COMPLETED" ? nowIso() : mem.completedAt ?? null
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
      data: { state: next, completedAt: next === "COMPLETED" ? new Date() : order.completedAt }
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

function logArbitrumAgentAddresses(orderId: string): void {
  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    log.warn("pipeline", "WDK_SEED not set; cannot log Arbitrum agent (Safe) address", { orderId });
    return;
  }
  try {
    const { ownerAddress, safeAddress, chainId } = deriveArbitrumErc4337ReceiveAddress(seed);
    log.info("pipeline", "Arbitrum agent (WDK ERC-4337)", {
      orderId,
      chainId,
      ownerAddress,
      safeAddress,
      note: "USDT from Boltz lands on safeAddress; LN operator is NWC_URL wallet (separate)"
    });
  } catch (e) {
    log.warn("pipeline", "failed to derive Arbitrum agent address", {
      orderId,
      error: e instanceof Error ? e.message : String(e)
    });
  }
  try {
    const b = deriveBaseErc4337ReceiveAddress(seed);
    log.info("pipeline", "Base agent (WDK ERC-4337)", {
      orderId,
      chainId: b.chainId,
      ownerAddress: b.ownerAddress,
      safeAddress: b.safeAddress,
      note: "LiFi USDT→IDRX delivers here; burn userOps use same seed; Pimlico gas token default Base USDC."
    });
  } catch (e) {
    log.warn("pipeline", "failed to derive Base agent address", {
      orderId,
      error: e instanceof Error ? e.message : String(e)
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizePayoutMethod(method: unknown): "bank_transfer" {
  const m = String(method || "bank_transfer").trim().toLowerCase();
  if (m === "gopay") {
    throw new Error(
      "Unsupported payoutMethod: use bank_transfer with idrxBankCode and idrxBankName from IDRX methods.",
    );
  }
  if (m === "bank_transfer" || m === "bank" || m === "bca") return "bank_transfer";
  throw new Error("Invalid payoutMethod (expected bank_transfer)");
}

async function assertValidIdrxPayoutPair(
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

function normalizeBankAccountName(raw: unknown): string {
  const s = String(raw || "").trim();
  if (s) return s;
  return process.env.IDRX_DEFAULT_BANK_ACCOUNT_NAME?.trim() || "Paysats user";
}

function normalizeDepositChannel(raw: unknown): "lightning" | "cbbtc" | "btcb" {
  const m = String(raw ?? "lightning").trim().toLowerCase();
  if (m === "" || m === "lightning" || m === "ln") return "lightning";
  if (m === "cbbtc") return "cbbtc";
  if (m === "btcb") return "btcb";
  throw new Error("Invalid depositChannel (expected lightning, cbbtc, or btcb)");
}

function evmDepositQrValue(toAddress: string, chainId: number): string {
  return `ethereum:${toAddress}@${chainId}`;
}

function normalizeRecipientDetails(isEwallet: boolean, raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s) throw new Error("recipientDetails is required");

  if (isEwallet) {
    /** Digits-only for IDRX redeem `bankAccount` (and burn hash); must match preimage rules. */
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

function computeSatsFromIdr(idrAmount: number, btcIdr: number): number {
  // sats = ceil((idr / btcIdr) * 1e8)
  const sats = Math.ceil((idrAmount / btcIdr) * 1e8);
  return Math.max(1, sats);
}

function computeIdrFromSatsFloor(satAmount: number, btcIdr: number): number {
  // idr = floor((sats / 1e8) * btcIdr)
  const idr = Math.floor((satAmount / 1e8) * btcIdr);
  return Math.max(0, idr);
}

const offrampWatchers = new Map<string, true>();

async function watchInvoiceAndRunOfframpPipeline(params: {
  orderId: string;
  bolt11: string;
  invoiceLnId: string;
  satAmount: number;
  recipientDetails: string;
  bankAccountName: string;
  idrxPayoutBankCode: string;
  idrxPayoutBankName: string;
}): Promise<void> {
  if (offrampWatchers.has(params.orderId)) {
    log.warn("pipeline", "watcher already running; skip duplicate", { orderId: params.orderId });
    return;
  }
  offrampWatchers.set(params.orderId, true);

  try {
    log.info("pipeline", "offramp pipeline started — waiting for user to pay funding invoice", {
      orderId: params.orderId,
      satAmount: params.satAmount,
      idrxPayoutBankCode: params.idrxPayoutBankCode,
      fundingInvoicePrefix: params.bolt11.slice(0, 28) + (params.bolt11.length > 28 ? "…" : ""),
      fundingInvoiceLen: params.bolt11.length
    });
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
      const o = memoryOrders.get(params.orderId) ?? (await prisma.order.findUnique({ where: { id: params.orderId } }).catch(() => null));
      if (!o) {
        log.warn("pipeline", "order disappeared during wait; abort", { orderId: params.orderId });
        return;
      }
      const state = (o as any).state as OrderState;
      const invoicePaidAt = (o as any).invoicePaidAt ?? null;
      if (state === "FAILED" || state === "COMPLETED") {
        log.info("pipeline", "stopped invoice wait — terminal order state", { orderId: params.orderId, state });
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
          error: e instanceof Error ? e.message : String(e)
        });
        await delay(3000);
        continue;
      }
      log.info("pipeline", "funding invoice poll (Spark getLightningReceiveRequest)", {
        orderId: params.orderId,
        pollCount,
        paid: lookupResult.paid,
      });

      if (lookupResult.paid) {
        const mem = memoryOrders.get(params.orderId);
        if (mem) {
          memoryOrders.set(params.orderId, { ...mem, invoicePaidAt: nowIso(), updatedAt: nowIso() });
        } else {
          await prisma.order
            .update({ where: { id: params.orderId }, data: { invoicePaidAt: new Date() } as any })
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
      (await prisma.order.findUnique({ where: { id: params.orderId } }).catch(() => null));
    if (!(orderAfterPaid as any)?.invoicePaidAt) {
      log.warn("pipeline", "funding invoice wait timeout or never paid — stopping pipeline", {
        orderId: params.orderId,
        maxWaitMs,
        polls: pollCount
      });
      return;
    }

    // Pipeline (best-effort; existing modules are placeholders in places).
    await advanceOrderState(params.orderId, "BOLTZ_SWAP_PENDING");

    const receiveAddress = requireArbitrumReceiveAddress();
    log.info("pipeline", "starting Boltz (LN→USDT Arbitrum UI automation)", {
      orderId: params.orderId,
      satAmount: params.satAmount,
      boltzReceiveAddress: `${receiveAddress.slice(0, 10)}…${receiveAddress.slice(-6)}`
    });
    const boltz = await createBoltzSwap({
      satAmount: params.satAmount,
      receiveAddress,
      log: (msg) => log.info("boltz", msg, { orderId: params.orderId }),
      onBoltzClaimTxHash: (txHash) => {
        const mem = memoryOrders.get(params.orderId);
        if (mem) {
          memoryOrders.set(params.orderId, { ...mem, boltzTxHash: txHash, updatedAt: nowIso() });
        }
        prisma.order
          .update({ where: { id: params.orderId }, data: { boltzTxHash: txHash } })
          .catch(() => {});
      }
    });
    log.info("pipeline", "Boltz swap created — have Boltz pay invoice to complete swap", {
      orderId: params.orderId,
      boltzSwapId: boltz.swapId,
      boltzQuotedSats: boltz.satsAmount,
      boltzQuotedUsdt: boltz.usdtAmount,
      boltzLnInvoicePrefix: boltz.invoice.slice(0, 28) + (boltz.invoice.length > 28 ? "…" : "")
    });

    {
      const mem = memoryOrders.get(params.orderId);
      if (mem) {
        memoryOrders.set(params.orderId, {
          ...mem,
          boltzSwapId: boltz.swapId,
          boltzLnInvoice: boltz.invoice,
          usdtAmount: Number(boltz.usdtAmount || 0) || null,
          updatedAt: nowIso()
        });
      } else {
        await prisma.order
          .update({
            where: { id: params.orderId },
            data: {
              boltzSwapId: boltz.swapId,
              boltzLnInvoice: boltz.invoice,
              usdtAmount: Number(boltz.usdtAmount || 0) || null
            }
          })
          .catch(() => {});
      }
    }

    log.info("pipeline", "paying Boltz Lightning invoice via Spark (operator wallet)", {
      orderId: params.orderId,
      boltzInvoiceLen: boltz.invoice.length
    });
    const balanceBufferSats = Math.max(0, Number(process.env.SPARK_PAY_BALANCE_BUFFER_SATS || "50") || 50);
    const waitForBalanceMs = Math.max(0, Number(process.env.SPARK_WAIT_FOR_BALANCE_MS || "60000") || 60_000);
    const balancePollMs = Math.max(250, Number(process.env.SPARK_BALANCE_POLL_MS || "1500") || 1500);
    const maxFeeSats = Math.max(0, Number(process.env.SPARK_PAY_MAX_FEE_SATS || "1000") || 1000);
    const minBalanceSats = Math.max(0, Math.ceil(Number(boltz.satsAmount || 0))) + balanceBufferSats;
    log.info("pipeline", "pre-pay balance guard for Boltz invoice", {
      orderId: params.orderId,
      minBalanceSats,
      balanceBufferSats,
      waitForBalanceMs,
      balancePollMs,
      maxFeeSats
    });
    const confirmMaxWaitMs = Math.max(0, Number(process.env.BOLTZ_USDT_CONFIRM_MAX_WAIT_MS || "240000") || 240_000);
    const confirmPollMs = Math.max(500, Number(process.env.BOLTZ_USDT_CONFIRM_POLL_MS || "5000") || 5_000);
    let startUsdtRaw: bigint | undefined = undefined;
    {
      const start = await waitForArbitrumUsdtBalance({
        orderId: params.orderId,
        seed: wdkSeed,
        maxWaitMs: 1,
        pollMs: 1
      });
      startUsdtRaw = start.balanceRaw;
      log.info("pipeline", "Arbitrum USDT starting balance snapshot", {
        orderId: params.orderId,
        usdtRaw: startUsdtRaw.toString()
      });
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
        confirmMaxWaitMs,
        confirmPollMs
      });
      const confirmed = await waitForArbitrumUsdtBalance({
        orderId: params.orderId,
        seed: wdkSeed,
        startBalanceRaw: startUsdtRaw,
        maxWaitMs: confirmMaxWaitMs,
        pollMs: confirmPollMs
      });
      if (confirmed.satisfied) {
        log.info("pipeline", "Boltz success confirmed via Arbitrum USDT balance (despite pay_invoice error)", {
          orderId: params.orderId,
          usdtRaw: confirmed.balanceRaw.toString()
        });
      } else {
        throw e;
      }
    }

    // Best-effort confirmation even on success to catch routing delays.
    await waitForArbitrumUsdtBalance({
      orderId: params.orderId,
      seed: wdkSeed,
      startBalanceRaw: startUsdtRaw,
      maxWaitMs: confirmMaxWaitMs,
      pollMs: confirmPollMs
    }).catch(() => {});
    await advanceOrderState(params.orderId, "USDT_RECEIVED");

    const fromAmountMinUnits = String(
      Math.max(1, Math.floor(Number(boltz.usdtAmount || 0) * 1e6)),
    );
    const pauseAfterLifi =
      process.env.PAUSE_AFTER_LIFI === "1" || process.env.PAUSE_P2P_FLOW === "1";

    {
      const idrxRecipient = idrxBaseRecipientAddress();
      log.info("pipeline", "USDT on Arbitrum — next: LiFi USDT → IDRX (Base)", {
        orderId: params.orderId,
        safePrefix: `${receiveAddress.slice(0, 10)}…${receiveAddress.slice(-6)}`,
        idrxBaseRecipient: `${idrxRecipient.slice(0, 10)}…${idrxRecipient.slice(-6)}`,
      });
      if (process.env.LIFI_API_KEY?.trim()) {
        try {
          log.info("pipeline", "LiFi quote request (Arb USDT → Base IDRX)", {
            orderId: params.orderId,
            fromAmountMinUnits,
          });
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
            toAmountMin: quote.estimate?.toAmountMin,
            toAmount: quote.estimate?.toAmount,
          });
        } catch (e) {
          log.warn("lifi", "IDRX quote fetch failed (continuing to swap attempt)", {
            orderId: params.orderId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      log.info("pipeline", "executeUsdtToIdrxOnBase (WDK+LiFi)", {
        orderId: params.orderId,
        usdtAmount: Number(boltz.usdtAmount || 0) || 0,
      });
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
        log.warn("pipeline", "PAUSE_AFTER_LIFI / PAUSE_P2P_FLOW — stopping after LiFi (no IDRX burn)", {
          orderId: params.orderId,
          idrxAmountIdr: idrxSwap.idrxAmountIdr,
        });
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
        (await prisma.order.findUnique({ where: { id: params.orderId } }).catch(() => null));
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
    }
  } catch (error) {
    log.error("pipeline", "offramp pipeline failed", error, { orderId: params.orderId });
    try {
      const mem = memoryOrders.get(params.orderId);
      if (mem) {
        memoryOrders.set(params.orderId, { ...mem, state: "FAILED", updatedAt: nowIso() });
      } else {
        await prisma.order.update({ where: { id: params.orderId }, data: { state: "FAILED" } });
      }
    } catch {
      /* ignore */
    }
  } finally {
    offrampWatchers.delete(params.orderId);
  }
}

app.get("/api/nwc/balance", async (_req, res) => {
  try {
    log.info("api", "GET /api/nwc/balance (Spark)");
    const seed = requireWdkSeed();
    const { balanceSats } = await initSpark(seed);
    return res.json({
      balanceSats,
      hint: "balance from Spark getBalance (sats) for the wallet derived from WDK_SEED"
    });
  } catch (error) {
    log.error("api", "GET /api/nwc/balance failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to read balance" });
  }
});

app.get("/api/quote/btc-idr", async (_req, res) => {
  try {
    log.info("api", "GET /api/quote/btc-idr");
    const q = await fetchBtcIdrQuoteCached();
    return res.json(q);
  } catch (error) {
    log.error("api", "GET /api/quote/btc-idr failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Quote failed" });
  }
});

app.get("/api/idrx/transaction-methods", async (_req, res) => {
  try {
    log.info("api", "GET /api/idrx/transaction-methods");
    const raw = await getCachedIdrxTransactionMethods();
    const sorted = sortIdrxMethodsForUi(raw.data ?? []);
    const data = sorted.map((r) => ({
      bankCode: r.bankCode,
      bankName: r.bankName,
      maxAmountTransfer: r.maxAmountTransfer,
      kind: isIdrxEwalletBankCode(r.bankCode) ? ("ewallet" as const) : ("bank" as const),
    }));
    return res.json({
      statusCode: raw.statusCode,
      message: raw.message,
      data,
    });
  } catch (error) {
    log.error("api", "GET /api/idrx/transaction-methods failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "IDRX methods unavailable",
    });
  }
});

app.get("/api/liquidity/platform-stats", async (_req, res) => {
  try {
    log.info("api", "GET /api/liquidity/platform-stats");
    const stats = readLiquidityDisplayStats();
    return res.json({
      ...stats,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    log.error("api", "GET /api/liquidity/platform-stats failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load platform stats",
    });
  }
});

app.get("/api/offramp/routed-snapshots", async (_req, res) => {
  try {
    log.info("api", "GET /api/offramp/routed-snapshots");
    const rows = await prisma.order.findMany({
      where: { merchantName: "Offramp" },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        createdAt: true,
        state: true,
        satAmount: true,
        idrAmount: true,
        idrxAmountIdr: true,
        depositChannel: true,
      },
    });
    return res.json({
      orders: rows,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isDbAccessError(error)) {
      return res.json({ orders: [], fetchedAt: new Date().toISOString() });
    }
    log.error("api", "GET /api/offramp/routed-snapshots failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load routed orders",
    });
  }
});

app.post("/api/nwc/create-invoice", async (req, res) => {
  try {
    log.info("api", "POST /api/nwc/create-invoice (Spark)", { body: req.body });
    const amountSats = Number(req.body.amountSats || 0);
    const description = String(req.body.description || "paysats topup");
    if (amountSats <= 0) {
      return res.status(400).json({ error: "amountSats is required and must be positive" });
    }

    const seed = requireWdkSeed();
    const { account, balanceSats } = await initSpark(seed);
    const invoice = await createSparkInvoice(account, amountSats, description);
    log.info("api", "create-invoice success (Spark)", { amountSats, balanceSats });
    return res.json({
      bolt11: invoice.bolt11,
      invoiceId: invoice.invoiceId,
      balanceSats,
    });
  } catch (error) {
    log.error("api", "POST /api/nwc/create-invoice failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create invoice" });
  }
});

app.post("/api/offramp/create", async (req, res) => {
  try {
    log.info("api", "POST /api/offramp/create", { body: { ...req.body, recipientDetails: undefined } });

    const payoutMethod = normalizePayoutMethod(req.body.payoutMethod);
    const idrxBankCode = String(req.body.idrxBankCode || "").trim();
    const idrxBankName = String(req.body.idrxBankName || "").trim();
    if (!idrxBankCode || !idrxBankName) {
      return res.status(400).json({
        error: "idrxBankCode and idrxBankName are required (from GET /api/idrx/transaction-methods)",
      });
    }
    await assertValidIdrxPayoutPair(idrxBankCode, idrxBankName);
    const isEwallet = isIdrxEwalletBankCode(idrxBankCode);
    const recipientDetails = normalizeRecipientDetails(
      isEwallet,
      req.body.recipientDetails,
    );
    const bankAccountName = normalizeBankAccountName(req.body.bankAccountName);
    const depositChannel = normalizeDepositChannel(req.body.depositChannel);

    const { btcIdr, fetchedAt } = await fetchBtcIdrQuoteCached();
    const requestedSats = Number(req.body.satAmount || 0);
    const requestedIdr = Number(req.body.idrAmount || 0);

    const satAmount =
      Number.isFinite(requestedSats) && requestedSats > 0
        ? Math.max(1, Math.floor(requestedSats))
        : computeSatsFromIdr(requestedIdr, btcIdr);

    const idrAmount =
      Number.isFinite(requestedIdr) && requestedIdr > 0 ? requestedIdr : computeIdrFromSatsFloor(satAmount, btcIdr);

    if (!Number.isFinite(satAmount) || satAmount <= 0) {
      return res.status(400).json({ error: "satAmount or idrAmount is required and must be positive" });
    }

    if (depositChannel !== "lightning") {
      const seed = process.env.WDK_SEED?.trim();
      if (!seed) {
        return res.status(400).json({
          error:
            "WDK_SEED is not configured; cannot derive EVM deposit addresses for cbBTC/BTCB.",
        });
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

      log.info("api", "offramp order created (wrapped deposit — no Lightning watcher)", {
        orderId,
        depositChannel,
        satAmount,
      });

      return res.json({
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
      });
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

    if (sparkReady && invoice.bolt11 && invoice.bolt11.startsWith("ln") && invoice.invoiceId) {
      log.info("pipeline", "offramp order created — background watcher will run after response", {
        orderId,
        satAmount,
        idrAmount,
        invoicePrefix: invoice.bolt11.slice(0, 28) + (invoice.bolt11.length > 28 ? "…" : ""),
      });
      watchInvoiceAndRunOfframpPipeline({
        orderId,
        bolt11: invoice.bolt11,
        invoiceLnId: invoice.invoiceId,
        satAmount,
        recipientDetails,
        bankAccountName,
        idrxPayoutBankCode: idrxBankCode,
        idrxPayoutBankName: idrxBankName,
      }).catch((e) => log.error("pipeline", "watcher crashed (unhandled)", e, { orderId }));
    } else if (!sparkReady) {
      log.warn("pipeline", "Not starting invoice watcher (stub invoice or Spark unavailable)", { orderId });
    }

    return res.json({
      orderId,
      bolt11: invoice.bolt11,
      satAmount,
      idrAmount,
      btcIdr,
      fetchedAt,
    });
  } catch (error) {
    log.error("api", "POST /api/offramp/create failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create offramp order" });
  }
});

app.post("/api/nwc/pay-invoice", async (req, res) => {
  try {
    log.info("api", "POST /api/nwc/pay-invoice (Spark)", {
      bolt11Prefix: String(req.body.bolt11 || "").slice(0, 20),
    });
    const bolt11 = String(req.body.bolt11 || "");
    if (!bolt11) {
      return res.status(400).json({ error: "bolt11 is required" });
    }
    const maxFeeSats = Number(req.body.maxFeeSats || process.env.SPARK_PAY_MAX_FEE_SATS || 1000) || 1000;
    const seed = requireWdkSeed();
    const { account } = await initSpark(seed);
    const payment = await paySparkInvoice(account, bolt11, maxFeeSats);
    log.info("api", "pay-invoice success (Spark)", { id: payment.id, status: payment.status });
    return res.json(payment);
  } catch (error) {
    log.error("api", "POST /api/nwc/pay-invoice failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to pay invoice" });
  }
});

app.get("/api/wallet/arbitrum-receive-address", async (_req, res) => {
  try {
    const seed = process.env.WDK_SEED?.trim();
    if (!seed) {
      return res.status(400).json({ error: "WDK_SEED is not configured on the server." });
    }
    const derived = deriveArbitrumErc4337ReceiveAddress(seed);
    log.info("api", "GET /api/wallet/arbitrum-receive-address", {
      chainId: derived.chainId,
      safePrefix: derived.safeAddress.slice(0, 10)
    });
    return res.json({
      chainId: derived.chainId,
      ownerAddress: derived.ownerAddress,
      safeAddress: derived.safeAddress,
      note: "ERC-4337 Safe counterfactual address on Arbitrum One (WDK predictSafeAddress)."
    });
  } catch (error) {
    log.error("api", "GET /api/wallet/arbitrum-receive-address failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to derive address" });
  }
});

app.get("/api/wallet/base-receive-address", async (_req, res) => {
  try {
    const seed = process.env.WDK_SEED?.trim();
    if (!seed) {
      return res.status(400).json({ error: "WDK_SEED is not configured on the server." });
    }
    const derived = deriveBaseErc4337ReceiveAddress(seed);
    log.info("api", "GET /api/wallet/base-receive-address", {
      chainId: derived.chainId,
      safePrefix: derived.safeAddress.slice(0, 10),
    });
    return res.json({
      chainId: derived.chainId,
      ownerAddress: derived.ownerAddress,
      safeAddress: derived.safeAddress,
      note: "ERC-4337 Safe counterfactual address on Base (same seed/path as Arbitrum; LiFi IDRX recipient + burn).",
    });
  } catch (error) {
    log.error("api", "GET /api/wallet/base-receive-address failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to derive address" });
  }
});

app.get("/api/wallet/deposit-rails", async (_req, res) => {
  try {
    const seed = process.env.WDK_SEED?.trim();
    const bitcoinOnchain = {
      label: "Bitcoin (on-chain)",
      summary:
        "Receive native BTC using Tether WDK Spark: single-use or static deposit addresses, then claim or route into settlement.",
      wdkDocsUrl:
        "https://docs.wdk.tether.io/sdk/wallet-modules/wallet-spark/usage/deposits-and-withdrawals",
      apiMethods: [
        "getSingleUseDepositAddress",
        "getStaticDepositAddress",
        "claimStaticDeposit",
      ],
    };

    if (!seed) {
      return res.json({
        bitcoinOnchain,
        configured: false,
        error: "WDK_SEED is not configured; EVM receive addresses unavailable.",
      });
    }

    const arb = deriveArbitrumErc4337ReceiveAddress(seed);
    const base = deriveBaseErc4337ReceiveAddress(seed);
    const bsc = deriveBscErc4337ReceiveAddress(seed);

    log.info("api", "GET /api/wallet/deposit-rails", {
      arbPrefix: arb.safeAddress.slice(0, 10),
      basePrefix: base.safeAddress.slice(0, 10),
      bscPrefix: bsc.safeAddress.slice(0, 10),
    });

    return res.json({
      configured: true,
      bitcoinOnchain,
      lightning: {
        label: "Lightning Network",
        summary: "Bolt11 funding invoice → operator wallet → Boltz LN→USDT (Arbitrum).",
      },
      arbitrumUsdt: {
        chainId: arb.chainId,
        safeAddress: arb.safeAddress,
        ownerAddress: arb.ownerAddress,
        token: "USDT",
        role: "Boltz receive; LiFi USDT → Base IDRX for BCA bank path.",
      },
      baseCbbtc: {
        chainId: base.chainId,
        safeAddress: base.safeAddress,
        ownerAddress: base.ownerAddress,
        token: "cbBTC",
        contractAddress: LIFI_CBTC_BASE,
        decimals: 8,
        role: "Send cbBTC on Base to this Safe; LiFi swap to IDRX then burn/redeem.",
        swapApi: "POST /api/swap/cbbtc-to-idrx",
      },
      bscBtcb: {
        chainId: bsc.chainId,
        safeAddress: bsc.safeAddress,
        ownerAddress: bsc.ownerAddress,
        token: "BTCB",
        contractAddress: LIFI_BTCB_BSC,
        decimals: 18,
        role: "Send BTCB on BNB Chain to this Safe; LiFi swap to Base IDRX then burn/redeem.",
        swapApi: "POST /api/swap/btcb-to-idrx",
        rpcNote: "Requires BNB_RPC_URL or BSC_RPC_URL + BSC bundler (BSC_BUNDLER_URL or PIMLICO_API_KEY) for execution.",
      },
    });
  } catch (error) {
    log.error("api", "GET /api/wallet/deposit-rails failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build deposit rails",
    });
  }
});

app.post("/api/swap/cbbtc-to-idrx", async (req, res) => {
  try {
    const walletAddress = String(req.body.walletAddress || "").trim();
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required (Base ERC-4337 Safe)" });
    }
    const result = await executeCbbtcToIdrxOnBase({
      walletAddress,
      cbbtcAmount:
        req.body.cbbtcAmount != null ? Number(req.body.cbbtcAmount) : undefined,
      fromAmountMinUnits:
        req.body.fromAmountMinUnits != null
          ? String(req.body.fromAmountMinUnits)
          : undefined,
    });
    return res.json(result);
  } catch (error) {
    log.error("api", "POST /api/swap/cbbtc-to-idrx failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "cbBTC→IDRX swap failed",
    });
  }
});

app.post("/api/swap/btcb-to-idrx", async (req, res) => {
  try {
    const walletAddress = String(req.body.walletAddress || "").trim();
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required (BNB ERC-4337 Safe)" });
    }
    const result = await executeBtcbToIdrxFromBsc({
      walletAddress,
      btcbAmount:
        req.body.btcbAmount != null ? Number(req.body.btcbAmount) : undefined,
      fromAmountMinUnits:
        req.body.fromAmountMinUnits != null
          ? String(req.body.fromAmountMinUnits)
          : undefined,
    });
    return res.json(result);
  } catch (error) {
    log.error("api", "POST /api/swap/btcb-to-idrx failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "BTCB→IDRX swap failed",
    });
  }
});

app.post("/api/boltz/create-swap", async (req, res) => {
  try {
    log.info("api", "POST /api/boltz/create-swap", {
      satAmount: req.body.satAmount,
      merchant: req.body.merchant
    });
    const satAmount = Number(req.body.satAmount || 0);
    let receiveAddress = String(req.body.receiveAddress || "").trim();
    if (!receiveAddress) {
      receiveAddress = requireArbitrumReceiveAddress();
      log.info("api", "using WDK-derived Arbitrum ERC-4337 receive address");
    }
    if (satAmount <= 0) return res.status(400).json({ error: "Invalid satAmount" });

    const swap = await createBoltzSwap({
      satAmount,
      receiveAddress,
      log: (msg) => log.info("boltz", msg),
      onBoltzClaimTxHash: (txHash) => {
        void prisma.order
          .updateMany({ where: { boltzSwapId: swap.swapId }, data: { boltzTxHash: txHash } })
          .catch(() => {});
      }
    });
    log.info("api", "boltz swap created", { swapId: swap.swapId, invoiceLen: swap.invoice?.length });
    const order = await prisma.order.create({
      data: {
        state: "IDLE",
        satAmount,
        merchantName: String(req.body.merchant || "Unknown Merchant"),
        qrisPayload: String(req.body.qrisPayload || ""),
        idrAmount: Number(req.body.idrAmount || 0),
        boltzSwapId: swap.swapId
      }
    });

    await advanceOrderState(order.id, "NWC_CONNECTED");
    await advanceOrderState(order.id, "QR_SCANNED");
    await advanceOrderState(order.id, "ROUTE_SHOWN");

    const wdkSeedForPay = process.env.WDK_SEED?.trim();
    if (wdkSeedForPay) {
      log.info("api", "paying Boltz Lightning invoice via Spark", {
        orderId: order.id,
        swapId: swap.swapId,
        boltzInvoiceLen: swap.invoice.length,
      });
      const balanceBufferSats = Math.max(0, Number(process.env.SPARK_PAY_BALANCE_BUFFER_SATS || "50") || 50);
      const waitForBalanceMs = Math.max(0, Number(process.env.SPARK_WAIT_FOR_BALANCE_MS || "60000") || 60_000);
      const balancePollMs = Math.max(250, Number(process.env.SPARK_BALANCE_POLL_MS || "1500") || 1500);
      const maxFeeSats = Math.max(0, Number(process.env.SPARK_PAY_MAX_FEE_SATS || "1000") || 1000);
      const minBalanceSats = Math.max(0, Math.ceil(Number((swap as any).satsAmount || satAmount || 0))) + balanceBufferSats;
      const payResult = await paySparkInvoiceWithRetries({
        seed: wdkSeedForPay,
        bolt11: swap.invoice,
        maxAttempts: Number(process.env.SPARK_PAY_MAX_ATTEMPTS || "3") || 3,
        baseDelayMs: Number(process.env.SPARK_PAY_BASE_DELAY_MS || "1500") || 1500,
        minBalanceSats,
        waitForBalanceMs,
        balancePollMs,
        maxFeeSats,
        boltzSwapId: swap.swapId,
      });
      log.info("api", "Boltz invoice paid via Spark", {
        orderId: order.id,
        payId: payResult.id,
        status: payResult.status,
        attempts: payResult.attempts,
      });
      await advanceOrderState(order.id, "LN_INVOICE_PAID");
    } else {
      log.warn("api", "WDK_SEED not set; skipping automatic boltz invoice payment");
    }

    await advanceOrderState(order.id, "BOLTZ_SWAP_PENDING");

    return res.json({ orderId: order.id, invoice: swap.invoice, swapId: swap.swapId });
  } catch (error) {
    log.error("api", "POST /api/boltz/create-swap failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create Boltz swap" });
  }
});

app.get("/api/boltz/swap-status/:swapId", async (req, res) => {
  try {
    const status = await getBoltzSwapStatus(req.params.swapId);
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get swap status" });
  }
});

app.post("/api/swap/usdt-to-usdc", async (req, res) => {
  try {
    const result = await executeUsdtToUsdcSwap({
      usdtAmount: Number(req.body.usdtAmount),
      walletAddress: String(req.body.walletAddress)
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Swap execution failed" });
  }
});

app.get("/api/order/:id/status", async (req, res) => {
  try {
    const mem = memoryOrders.get(req.params.id);
    if (mem) return res.json(mem);

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json(order);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load order status" });
  }
});

app.listen(port, () => {
  log.info("server", `paysats backend listening`, { port });
});
