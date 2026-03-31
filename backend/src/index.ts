import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  deriveArbitrumErc4337ReceiveAddress,
  requireArbitrumReceiveAddress
} from "./arbitrumErc4337Address.js";
import { createBoltzSwap, getBoltzSwapStatus } from "./boltz.js";
import { log } from "./logger.js";
import { createInvoice, initNwc, payInvoice } from "./nwc.js";
import { prisma } from "./prisma.js";
import { OrderState, requireTransition } from "./state.js";
import { executeUsdtToUsdcSwap } from "./swap.js";

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(cors());
app.use(express.json());

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
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Order not found");
  requireTransition(order.state as OrderState, next);
  return prisma.order.update({
    where: { id: orderId },
    data: { state: next, completedAt: next === "COMPLETED" ? new Date() : order.completedAt }
  });
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
      log.info("api", "paying boltz invoice via NWC");
      const { client } = await initNwc(nwcForPay);
      await payInvoice(client, swap.invoice);
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
