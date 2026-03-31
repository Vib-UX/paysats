import "./playwrightBrowsersPath.js";
import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  deriveArbitrumErc4337ReceiveAddress,
  requireArbitrumReceiveAddress
} from "./arbitrumErc4337Address.js";
import { createBoltzSwap, getBoltzSwapStatus } from "./boltz.js";
import { log } from "./logger.js";
import { createInvoice, initNwc, payInvoice, payInvoiceWithRetries } from "./nwc.js";
import { prisma } from "./prisma.js";
import { OrderState, requireTransition } from "./state.js";
import { executeUsdtToUsdcSwap } from "./swap.js";
import { createP2pmSellOrder } from "./p2pm.js";
import { fetchLifiQuote } from "./lifiQuote.js";
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
  merchantName?: string | null;
  qrisPayload?: string | null;
};

const memoryOrders = new Map<string, MemoryOrder>();

function isDbAccessError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("P1010") || msg.toLowerCase().includes("denied access") || msg.includes("User was denied access");
}

function nowIso(): string {
  return new Date().toISOString();
}

function isNwcTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes("reply timeout") || msg.includes("Nip47ReplyTimeoutError");
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

function requireNwcUrl(): string {
  const url = process.env.NWC_URL?.trim();
  if (!url) {
    log.error("nwc", "NWC_URL missing", undefined);
    throw new Error("NWC_URL is not configured on the server.");
  }
  log.info("nwc", "using NWC_URL from env", { nwcUrl: log.redactNwcUrl(url) });
  return url;
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
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizePayoutMethod(method: unknown): "gopay" | "bank_transfer" {
  const m = String(method || "").trim().toLowerCase();
  if (m === "gopay") return "gopay";
  if (m === "bank_transfer" || m === "bank" || m === "bca") return "bank_transfer";
  throw new Error("Invalid payoutMethod (expected gopay or bank_transfer)");
}

function normalizeRecipientDetails(payoutMethod: "gopay" | "bank_transfer", raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s) throw new Error("recipientDetails is required");

  if (payoutMethod === "gopay") {
    // Require +CC-NNN… (e.g. +91-9650840815). Preserve formatting for downstream automation.
    if (!/^\+\d{1,3}-\d{6,14}$/.test(s)) {
      throw new Error("GoPay recipientDetails must be in +CC-NNN… format (example: +91-9650840815)");
    }
    return s;
  }

  // bank_transfer: keep digits only
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
  satAmount: number;
  payoutMethod: "gopay" | "bank_transfer";
  recipientDetails: string;
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
      payoutMethod: params.payoutMethod,
      fundingInvoicePrefix: params.bolt11.slice(0, 28) + (params.bolt11.length > 28 ? "…" : ""),
      fundingInvoiceLen: params.bolt11.length
    });
    logArbitrumAgentAddresses(params.orderId);

    const nwcUrl = requireNwcUrl();
    const { client, balanceSats, balanceRaw, walletAlias } = await initNwc(nwcUrl);
    log.info("pipeline", "NWC operator wallet (pays Boltz / makes invoices)", {
      orderId: params.orderId,
      walletAlias: walletAlias ?? "(unknown)",
      balanceSats,
      balanceMsat: balanceRaw
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
      const invoicePaymentHash = (o as any).invoicePaymentHash ?? null;
      if (state === "FAILED" || state === "COMPLETED") {
        log.info("pipeline", "stopped invoice wait — terminal order state", { orderId: params.orderId, state });
        return;
      }
      if (invoicePaidAt) break;

      let inv: any;
      try {
        inv = await (client as any).lookupInvoice({ invoice: params.bolt11 });
      } catch (e) {
        log.warn("pipeline", "lookupInvoice failed (will retry)", {
          orderId: params.orderId,
          pollCount,
          error: e instanceof Error ? e.message : String(e)
        });
        await delay(3000);
        continue;
      }
      const paid = Boolean(inv?.paid || inv?.settled_at || inv?.settledAt);
      const paymentHash = typeof inv?.payment_hash === "string" ? inv.payment_hash : null;
      log.info("pipeline", "funding invoice poll (lookupInvoice)", {
        orderId: params.orderId,
        pollCount,
        paid,
        paymentHashPrefix: paymentHash ? paymentHash.slice(0, 16) + "…" : null,
        amountMsat: inv?.amount ?? inv?.amount_msat ?? undefined
      });

      if (paymentHash && !invoicePaymentHash) {
        const mem = memoryOrders.get(params.orderId);
        if (mem) {
          memoryOrders.set(params.orderId, { ...mem, invoicePaymentHash: paymentHash, updatedAt: nowIso() });
        } else {
          await prisma.order
            .update({ where: { id: params.orderId }, data: { invoicePaymentHash: paymentHash } as any })
            .catch(() => {});
        }
      }

      if (paid) {
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
          preimageLen: typeof inv?.preimage === "string" ? inv.preimage.length : undefined
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
      log: (msg) => log.info("boltz", msg, { orderId: params.orderId })
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

    log.info("pipeline", "paying Boltz Lightning invoice via NWC (operator wallet)", {
      orderId: params.orderId,
      boltzInvoiceLen: boltz.invoice.length
    });
    // NWC balance can lag behind invoice settlement; wait/poll before paying the Boltz invoice.
    const balanceBufferSats = Math.max(0, Number(process.env.NWC_PAY_BALANCE_BUFFER_SATS || "50") || 50);
    const waitForBalanceMs = Math.max(0, Number(process.env.NWC_WAIT_FOR_BALANCE_MS || "60000") || 60_000);
    const balancePollMs = Math.max(250, Number(process.env.NWC_BALANCE_POLL_MS || "1500") || 1500);
    const minBalanceSats = Math.max(0, Math.ceil(Number(boltz.satsAmount || 0))) + balanceBufferSats;
    log.info("pipeline", "pre-pay balance guard for Boltz invoice", {
      orderId: params.orderId,
      minBalanceSats,
      balanceBufferSats,
      waitForBalanceMs,
      balancePollMs
    });
    const seed = process.env.WDK_SEED?.trim();
    const confirmMaxWaitMs = Math.max(0, Number(process.env.BOLTZ_USDT_CONFIRM_MAX_WAIT_MS || "240000") || 240_000);
    const confirmPollMs = Math.max(500, Number(process.env.BOLTZ_USDT_CONFIRM_POLL_MS || "5000") || 5_000);
    let startUsdtRaw: bigint | undefined = undefined;
    if (seed) {
      // Best-effort starting balance snapshot so we can detect an actual increase.
      const start = await waitForArbitrumUsdtBalance({
        orderId: params.orderId,
        seed,
        maxWaitMs: 1,
        pollMs: 1
      });
      startUsdtRaw = start.balanceRaw;
      log.info("pipeline", "Arbitrum USDT starting balance snapshot", {
        orderId: params.orderId,
        usdtRaw: startUsdtRaw.toString()
      });
    } else {
      log.warn("pipeline", "WDK_SEED missing; cannot confirm Boltz success via Arbitrum USDT balance", {
        orderId: params.orderId
      });
    }

    let boltzLnPreimage: string | null = null;
    try {
      const boltzPay = await payInvoiceWithRetries({
        nwcUrl,
        bolt11: boltz.invoice,
        maxAttempts: Number(process.env.NWC_PAY_MAX_ATTEMPTS || "3") || 3,
        baseDelayMs: Number(process.env.NWC_PAY_BASE_DELAY_MS || "1500") || 1500,
        minBalanceSats,
        waitForBalanceMs,
        balancePollMs
      });
      boltzLnPreimage = (boltzPay.preimage && String(boltzPay.preimage).trim()) || null;
      log.info("pipeline", "Boltz Lightning invoice paid", {
        orderId: params.orderId,
        preimageLen: boltzPay.preimage?.length ?? 0,
        feesPaid: boltzPay.feesPaid,
        attempts: (boltzPay as any).attempts ?? null
      });
    } catch (e) {
      // Sometimes pay_invoice times out but the payment still succeeded. Confirm by watching Arbitrum USDT balance.
      log.warn("pipeline", "pay_invoice failed; attempting Arbitrum USDT confirmation", {
        orderId: params.orderId,
        error: e instanceof Error ? e.message : String(e),
        confirmMaxWaitMs,
        confirmPollMs
      });
      if (seed) {
        const confirmed = await waitForArbitrumUsdtBalance({
          orderId: params.orderId,
          seed,
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
      } else {
        throw e;
      }
    }

    if (boltzLnPreimage) {
      const mem = memoryOrders.get(params.orderId);
      if (mem) {
        memoryOrders.set(params.orderId, {
          ...mem,
          boltzLnPreimage,
          boltzLnInvoice: mem.boltzLnInvoice || boltz.invoice,
          updatedAt: nowIso()
        });
      } else {
        await prisma.order
          .update({
            where: { id: params.orderId },
            data: { boltzLnPreimage, boltzLnInvoice: boltz.invoice }
          })
          .catch(() => {});
      }
    }

    // Also do a best-effort confirmation even on success, to catch cases where NWC returned ok but routing is delayed.
    if (seed) {
      await waitForArbitrumUsdtBalance({
        orderId: params.orderId,
        seed,
        startBalanceRaw: startUsdtRaw,
        maxWaitMs: confirmMaxWaitMs,
        pollMs: confirmPollMs
      }).catch(() => {});
    }
    await advanceOrderState(params.orderId, "USDT_RECEIVED");

    // Swap USDT(Arb) -> USDC(Base) (placeholder implementation).
    const usdcRecipientBase = "0x47D02EE816f6D66E39333F3a06dB14294F773378";
    log.info("pipeline", "USDT on Arbitrum received at agent Safe — next: USDT→USDC (Base)", {
      orderId: params.orderId,
      safePrefix: `${receiveAddress.slice(0, 10)}…${receiveAddress.slice(-6)}`,
      usdcBaseRecipient: usdcRecipientBase
    });
    if (process.env.LIFI_API_KEY?.trim()) {
      // Fetch a LiFi quote primarily to verify we are targeting the correct Base recipient.
      // Execution is handled elsewhere (WDK userOp script); this is a safety check / audit trail.
      try {
        const fromAmountMinUnits = String(Math.max(1, Math.floor(Number(boltz.usdtAmount || 0) * 1e6)));
        log.info("pipeline", "LiFi quote request (Arb USDT → Base USDC)", {
          orderId: params.orderId,
          fromAddress: `${receiveAddress.slice(0, 10)}…${receiveAddress.slice(-6)}`,
          toAddress: usdcRecipientBase,
          fromAmountMinUnits
        });
        const quote = await fetchLifiQuote({
          apiKey: String(process.env.LIFI_API_KEY),
          fromAddress: receiveAddress,
          toAddress: usdcRecipientBase,
          fromAmount: fromAmountMinUnits,
          slippage: process.env.LIFI_SLIPPAGE?.trim() || "0.03"
        });
        log.info("lifi", "quote fetched for offramp", {
          orderId: params.orderId,
          toAddress: usdcRecipientBase,
          tool: quote.toolDetails?.name || quote.tool || "(unknown)",
          toAmountMin: quote.estimate?.toAmountMin,
          toAmount: quote.estimate?.toAmount
        });
      } catch (e) {
        log.warn("lifi", "quote fetch failed (continuing with placeholder swap)", {
          orderId: params.orderId,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    } else {
      log.info("pipeline", "LIFI_API_KEY not set — skipping LiFi quote log step", { orderId: params.orderId });
    }

    log.info("pipeline", "executeUsdtToUsdcSwap (WDK+LiFi)", {
      orderId: params.orderId,
      usdtAmount: Number(boltz.usdtAmount || 0) || 0
    });
    const swap = await executeUsdtToUsdcSwap({
      usdtAmount: Number(boltz.usdtAmount || 0) || 0,
      walletAddress: receiveAddress
    });
    log.info("pipeline", "USDC swap step finished", {
      orderId: params.orderId,
      usdcAmount: swap.usdcAmount,
      swapTxHash: swap.txHash
    });
    {
      const mem = memoryOrders.get(params.orderId);
      if (mem) {
        memoryOrders.set(params.orderId, { ...mem, usdcAmount: swap.usdcAmount, swapTxHash: swap.txHash, updatedAt: nowIso() });
      } else {
        await prisma.order
          .update({ where: { id: params.orderId }, data: { usdcAmount: swap.usdcAmount, swapTxHash: swap.txHash } })
          .catch(() => {});
      }
    }
    await advanceOrderState(params.orderId, "USDC_SWAPPED");

    // Optional safety pause: stop after swap, do not proceed to P2P.me offramp.
    if (process.env.PAUSE_P2P_FLOW === "1") {
      log.warn("pipeline", "PAUSE_P2P_FLOW=1 — stopping after USDC swap (no P2P.me)", {
        orderId: params.orderId,
        usdcAmount: swap.usdcAmount
      });
      return;
    }

    log.info("pipeline", "starting P2P.me IDR offramp", { orderId: params.orderId });
    // Offramp to IDR via P2P.me automation.
    const p2pm = await createP2pmSellOrder({
      usdcAmount: swap.usdcAmount,
      payoutMethod: params.payoutMethod,
      recipientDetails: params.recipientDetails
    });
    log.info("pipeline", "P2P.me sell order submitted", {
      orderId: params.orderId,
      p2pmOrderId: p2pm.orderId,
      status: p2pm.status
    });
    {
      const mem = memoryOrders.get(params.orderId);
      if (mem) {
        memoryOrders.set(params.orderId, { ...mem, p2pmOrderId: p2pm.orderId, p2pmPayoutMethod: params.payoutMethod, updatedAt: nowIso() });
      } else {
        await prisma.order
          .update({
            where: { id: params.orderId },
            data: { p2pmOrderId: p2pm.orderId, p2pmPayoutMethod: params.payoutMethod }
          })
          .catch(() => {});
      }
    }
    await advanceOrderState(params.orderId, "P2PM_ORDER_PLACED");

    // For now we don't have robust confirmation/settlement polling.
    await advanceOrderState(params.orderId, "IDR_SETTLED");
    await advanceOrderState(params.orderId, "COMPLETED");
    log.info("pipeline", "offramp pipeline completed", { orderId: params.orderId });
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
    log.info("api", "GET /api/nwc/balance");
    const nwcUrl = requireNwcUrl();
    const { balanceSats, balanceRaw, walletAlias } = await initNwc(nwcUrl);
    return res.json({
      balanceSats,
      balanceMsat: balanceRaw,
      walletAlias: walletAlias ?? null,
      hint: "balance from NWC get_balance (NIP-47 millisats → sats) for the wallet in NWC_URL"
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

app.post("/api/nwc/create-invoice", async (req, res) => {
  try {
    log.info("api", "POST /api/nwc/create-invoice", { body: { ...req.body, nwcUrl: undefined } });
    const amountSats = Number(req.body.amountSats || 0);
    const description = String(req.body.description || "paysats topup");
    if (amountSats <= 0) {
      return res.status(400).json({ error: "amountSats is required and must be positive" });
    }

    const nwcUrl = requireNwcUrl();
    const { client, balanceSats, balanceRaw, walletAlias } = await initNwc(nwcUrl);
    const invoice = await createInvoice(client, amountSats, description);
    log.info("api", "create-invoice success", { amountSats, balanceSats, balanceMsat: balanceRaw, walletAlias });
    return res.json({
      ...invoice,
      balanceSats,
      balanceMsat: balanceRaw,
      walletAlias: walletAlias ?? null
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
    const recipientDetails = normalizeRecipientDetails(payoutMethod, req.body.recipientDetails);

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

    let client: Awaited<ReturnType<typeof initNwc>>["client"] | null = null;
    let invoice: { bolt11: string; expiresAt?: number };
    try {
      const nwcUrl = requireNwcUrl();
      const nwc = await initNwc(nwcUrl);
      client = nwc.client;
      invoice = await createInvoice(
        client,
        satAmount,
        `paysats offramp ${idrAmount.toLocaleString("id-ID")} IDR (${payoutMethod})`
      );
    } catch (e) {
      if (process.env.ALLOW_STUB_INVOICE === "1") {
        log.warn("nwc", "NWC unavailable; using stub invoice (ALLOW_STUB_INVOICE=1)", {
          error: e instanceof Error ? e.message : String(e)
        });
        invoice = makeStubInvoice();
      } else if (isNwcTimeout(e)) {
        return res.status(503).json({
          error:
            "Lightning wallet (NWC_URL) did not respond in time. Check relay connectivity and that the wallet is online."
        });
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
          payoutRecipient: recipientDetails,
          invoiceBolt11: invoice.bolt11,
          invoiceExpiresAt: invoice.expiresAt ? new Date(invoice.expiresAt * 1000) : null,
          merchantName: "Offramp"
        } as any
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
        payoutRecipient: recipientDetails,
        invoiceBolt11: invoice.bolt11,
        invoiceExpiresAt: invoice.expiresAt ? new Date(invoice.expiresAt * 1000).toISOString() : null,
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
        usdcAmount: null
      });
      log.warn("db", "DB unavailable; using in-memory order store", { orderId });
    }

    // Kick off background watcher: once invoice is paid, agents run the pipeline.
    if (client && invoice.bolt11 && invoice.bolt11.startsWith("ln")) {
      log.info("pipeline", "offramp order created — background watcher will run after response", {
        orderId,
        satAmount,
        idrAmount,
        invoicePrefix: invoice.bolt11.slice(0, 28) + (invoice.bolt11.length > 28 ? "…" : "")
      });
      watchInvoiceAndRunOfframpPipeline({
        orderId,
        bolt11: invoice.bolt11,
        satAmount,
        payoutMethod,
        recipientDetails
      }).catch((e) => log.error("pipeline", "watcher crashed (unhandled)", e, { orderId }));
    } else if (!client) {
      log.warn("pipeline", "Not starting invoice watcher (stub invoice or no NWC client)", { orderId });
    }

    return res.json({
      orderId,
      bolt11: invoice.bolt11,
      satAmount,
      idrAmount,
      btcIdr,
      fetchedAt,
      invoiceExpiresAt: invoice.expiresAt ?? null
    });
  } catch (error) {
    log.error("api", "POST /api/offramp/create failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create offramp order" });
  }
});

app.post("/api/nwc/pay-invoice", async (req, res) => {
  try {
    log.info("api", "POST /api/nwc/pay-invoice", {
      bolt11Prefix: String(req.body.bolt11 || "").slice(0, 20)
    });
    const bolt11 = String(req.body.bolt11 || "");
    if (!bolt11) {
      return res.status(400).json({ error: "bolt11 is required" });
    }
    const nwcUrl = requireNwcUrl();
    const { client } = await initNwc(nwcUrl);
    const payment = await payInvoice(client, bolt11);
    log.info("api", "pay-invoice success", { preimageLen: payment.preimage?.length });
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
      log: (msg) => log.info("boltz", msg)
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

    const nwcForPay = process.env.NWC_URL?.trim();
    if (nwcForPay) {
      log.info("api", "paying Boltz Lightning invoice via NWC", {
        orderId: order.id,
        swapId: swap.swapId,
        boltzInvoiceLen: swap.invoice.length
      });
      const balanceBufferSats = Math.max(0, Number(process.env.NWC_PAY_BALANCE_BUFFER_SATS || "50") || 50);
      const waitForBalanceMs = Math.max(0, Number(process.env.NWC_WAIT_FOR_BALANCE_MS || "60000") || 60_000);
      const balancePollMs = Math.max(250, Number(process.env.NWC_BALANCE_POLL_MS || "1500") || 1500);
      const minBalanceSats = Math.max(0, Math.ceil(Number((swap as any).satsAmount || satAmount || 0))) + balanceBufferSats;
      log.info("api", "pre-pay balance guard for Boltz invoice", {
        orderId: order.id,
        minBalanceSats,
        balanceBufferSats,
        waitForBalanceMs,
        balancePollMs
      });
      const payResult = await payInvoiceWithRetries({
        nwcUrl: nwcForPay,
        bolt11: swap.invoice,
        maxAttempts: Number(process.env.NWC_PAY_MAX_ATTEMPTS || "3") || 3,
        baseDelayMs: Number(process.env.NWC_PAY_BASE_DELAY_MS || "1500") || 1500,
        minBalanceSats,
        waitForBalanceMs,
        balancePollMs
      });
      log.info("api", "Boltz invoice paid", {
        orderId: order.id,
        preimageLen: payResult.preimage?.length ?? 0,
        feesPaid: payResult.feesPaid,
        attempts: (payResult as any).attempts ?? null
      });
      await advanceOrderState(order.id, "LN_INVOICE_PAID");
    } else {
      log.warn("api", "NWC_URL not set; skipping automatic boltz invoice payment");
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
