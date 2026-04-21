import express, { type Request, type Response } from "express";
import { apiKeyAuth, requireTenant } from "./apiKeyAuth.js";
import { deriveArbitrumErc4337ReceiveAddress } from "./arbitrumErc4337Address.js";
import { deriveBaseErc4337ReceiveAddress } from "./baseErc4337Address.js";
import { deriveBscErc4337ReceiveAddress } from "./bscErc4337Address.js";
import { LIFI_BTCB_BSC, LIFI_CBTC_BASE } from "./lifiQuote.js";
import { getCachedIdrxTransactionMethods } from "./idrxRedeem.js";
import {
  isIdrxEwalletBankCode,
  sortIdrxMethodsForUi,
} from "./idrxPayoutClassify.js";
import { readLiquidityDisplayStats } from "./liquidityDisplayStats.js";
import { log } from "./logger.js";
import {
  createOfframpOrder,
  fetchBtcIdrQuoteCached,
  isDbAccessError,
  memoryOrders,
} from "./offrampCore.js";
import { prisma } from "./prisma.js";

export const v1Router = express.Router();

v1Router.use(apiKeyAuth);

v1Router.get("/quote/btc-idr", async (_req, res) => {
  try {
    const q = await fetchBtcIdrQuoteCached();
    return res.json(q);
  } catch (error) {
    log.error("v1", "GET /v1/quote/btc-idr failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Quote failed",
    });
  }
});

v1Router.get("/payout/methods", async (_req, res) => {
  try {
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
    log.error("v1", "GET /v1/payout/methods failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "IDRX methods unavailable",
    });
  }
});

v1Router.get("/deposit/rails", async (_req, res) => {
  try {
    const seed = process.env.WDK_SEED?.trim();
    const bitcoinOnchain = {
      label: "Bitcoin (on-chain)",
      summary: "Native BTC via Tether WDK Spark deposit addresses.",
    };
    if (!seed) {
      return res.json({
        bitcoinOnchain,
        configured: false,
        error: "WDK_SEED is not configured on the paysats backend.",
      });
    }
    const arb = deriveArbitrumErc4337ReceiveAddress(seed);
    const base = deriveBaseErc4337ReceiveAddress(seed);
    const bsc = deriveBscErc4337ReceiveAddress(seed);
    return res.json({
      configured: true,
      bitcoinOnchain,
      lightning: {
        label: "Lightning Network",
        summary: "Default — create an order and pay the returned BOLT11 invoice.",
      },
      arbitrumUsdt: {
        chainId: arb.chainId,
        safeAddress: arb.safeAddress,
        token: "USDT",
        role: "Boltz receive (internal).",
      },
      baseCbbtc: {
        chainId: base.chainId,
        safeAddress: base.safeAddress,
        token: "cbBTC",
        contractAddress: LIFI_CBTC_BASE,
        decimals: 8,
        depositChannel: "cbbtc",
      },
      bscBtcb: {
        chainId: bsc.chainId,
        safeAddress: bsc.safeAddress,
        token: "BTCB",
        contractAddress: LIFI_BTCB_BSC,
        decimals: 18,
        depositChannel: "btcb",
      },
    });
  } catch (error) {
    log.error("v1", "GET /v1/deposit/rails failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build deposit rails",
    });
  }
});

v1Router.get("/platform/stats", async (_req, res) => {
  try {
    const stats = readLiquidityDisplayStats();
    return res.json({ ...stats, fetchedAt: new Date().toISOString() });
  } catch (error) {
    log.error("v1", "GET /v1/platform/stats failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load platform stats",
    });
  }
});

v1Router.post("/offramp/orders", async (req: Request, res: Response) => {
  const tenant = requireTenant(req);
  try {
    log.info("v1", "POST /v1/offramp/orders", {
      tenantId: tenant.id,
      body: { ...req.body, recipientDetails: undefined },
    });
    const out = await createOfframpOrder(req.body ?? {}, {
      tenantId: tenant.id,
    });
    return res.json(out);
  } catch (error) {
    log.error("v1", "POST /v1/offramp/orders failed", error, {
      tenantId: tenant.id,
    });
    const message =
      error instanceof Error ? error.message : "Failed to create offramp order";
    const status = /required|invalid|must match|unsupported/i.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

v1Router.get("/offramp/orders/:id", async (req: Request, res: Response) => {
  const tenant = requireTenant(req);
  const orderId = req.params.id;
  try {
    const mem = memoryOrders.get(orderId);
    if (mem) {
      if (mem.tenantId && mem.tenantId !== tenant.id) {
        return res.status(404).json({ error: "Order not found" });
      }
      return res.json(mem);
    }
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId: tenant.id },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json(order);
  } catch (error) {
    if (isDbAccessError(error)) {
      return res.status(503).json({ error: "Database not available" });
    }
    log.error("v1", "GET /v1/offramp/orders/:id failed", error, {
      tenantId: tenant.id,
      orderId,
    });
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load order",
    });
  }
});

v1Router.get("/offramp/orders", async (req: Request, res: Response) => {
  const tenant = requireTenant(req);
  try {
    const take = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const orders = await prisma.order.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take,
    });
    return res.json({ orders, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (isDbAccessError(error)) {
      return res.json({ orders: [], fetchedAt: new Date().toISOString() });
    }
    log.error("v1", "GET /v1/offramp/orders failed", error, {
      tenantId: tenant.id,
    });
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list orders",
    });
  }
});
