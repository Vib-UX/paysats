import "./playwrightBrowsersPath.js";
import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  deriveArbitrumErc4337ReceiveAddress,
  requireArbitrumReceiveAddress,
} from "./arbitrumErc4337Address.js";
import { deriveBaseErc4337ReceiveAddress } from "./baseErc4337Address.js";
import { deriveBscErc4337ReceiveAddress } from "./bscErc4337Address.js";
import { createBoltzSwap, getBoltzSwapStatus } from "./boltz.js";
import { log } from "./logger.js";
import {
  initSpark,
  createSparkInvoice,
  paySparkInvoice,
  paySparkInvoiceWithRetries,
} from "./spark.js";
import { prisma } from "./prisma.js";
import {
  executeBtcbToIdrxFromBsc,
  executeCbbtcToIdrxOnBase,
  executeUsdtToUsdcSwap,
} from "./swap.js";
import { LIFI_BTCB_BSC, LIFI_CBTC_BASE } from "./lifiQuote.js";
import { getCachedIdrxTransactionMethods } from "./idrxRedeem.js";
import {
  isIdrxEwalletBankCode,
  sortIdrxMethodsForUi,
} from "./idrxPayoutClassify.js";
import { readLiquidityDisplayStats } from "./liquidityDisplayStats.js";
import {
  advanceOrderState,
  createOfframpOrder,
  fetchBtcIdrQuoteCached,
  isDbAccessError,
  memoryOrders,
  requireWdkSeed,
} from "./offrampCore.js";
import { v1Router } from "./v1Router.js";

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(cors());
app.use(express.json());

// SDK-facing, authenticated router.
app.use("/v1", v1Router);

app.get("/api/nwc/balance", async (_req, res) => {
  try {
    log.info("api", "GET /api/nwc/balance (Spark)");
    const seed = requireWdkSeed();
    const { balanceSats } = await initSpark(seed);
    return res.json({
      balanceSats,
      hint: "balance from Spark getBalance (sats) for the wallet derived from WDK_SEED",
    });
  } catch (error) {
    log.error("api", "GET /api/nwc/balance failed", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to read balance" });
  }
});

app.get("/api/quote/btc-idr", async (_req, res) => {
  try {
    log.info("api", "GET /api/quote/btc-idr");
    const q = await fetchBtcIdrQuoteCached();
    return res.json(q);
  } catch (error) {
    log.error("api", "GET /api/quote/btc-idr failed", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Quote failed" });
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
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to create invoice" });
  }
});

/**
 * Legacy unauthenticated endpoint used by the internal Next.js frontend.
 * Delegates to the same shared core as the /v1 SDK route but without a tenantId.
 */
app.post("/api/offramp/create", async (req, res) => {
  try {
    log.info("api", "POST /api/offramp/create", {
      body: { ...req.body, recipientDetails: undefined },
    });
    const out = await createOfframpOrder(req.body ?? {}, { tenantId: null });
    return res.json(out);
  } catch (error) {
    log.error("api", "POST /api/offramp/create failed", error);
    const message =
      error instanceof Error ? error.message : "Failed to create offramp order";
    const status = /required|invalid|must match|unsupported/i.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
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
    const maxFeeSats =
      Number(req.body.maxFeeSats || process.env.SPARK_PAY_MAX_FEE_SATS || 1000) || 1000;
    const seed = requireWdkSeed();
    const { account } = await initSpark(seed);
    const payment = await paySparkInvoice(account, bolt11, maxFeeSats);
    log.info("api", "pay-invoice success (Spark)", {
      id: payment.id,
      status: payment.status,
    });
    return res.json(payment);
  } catch (error) {
    log.error("api", "POST /api/nwc/pay-invoice failed", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to pay invoice" });
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
      safePrefix: derived.safeAddress.slice(0, 10),
    });
    return res.json({
      chainId: derived.chainId,
      ownerAddress: derived.ownerAddress,
      safeAddress: derived.safeAddress,
      note: "ERC-4337 Safe counterfactual address on Arbitrum One (WDK predictSafeAddress).",
    });
  } catch (error) {
    log.error("api", "GET /api/wallet/arbitrum-receive-address failed", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to derive address" });
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
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to derive address" });
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
      apiMethods: ["getSingleUseDepositAddress", "getStaticDepositAddress", "claimStaticDeposit"],
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
        rpcNote:
          "Requires BNB_RPC_URL or BSC_RPC_URL + BSC bundler (BSC_BUNDLER_URL or PIMLICO_API_KEY) for execution.",
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
      cbbtcAmount: req.body.cbbtcAmount != null ? Number(req.body.cbbtcAmount) : undefined,
      fromAmountMinUnits:
        req.body.fromAmountMinUnits != null ? String(req.body.fromAmountMinUnits) : undefined,
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
      btcbAmount: req.body.btcbAmount != null ? Number(req.body.btcbAmount) : undefined,
      fromAmountMinUnits:
        req.body.fromAmountMinUnits != null ? String(req.body.fromAmountMinUnits) : undefined,
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
      merchant: req.body.merchant,
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
          .updateMany({
            where: { boltzSwapId: swap.swapId },
            data: { boltzTxHash: txHash },
          })
          .catch(() => {});
      },
    });
    log.info("api", "boltz swap created", {
      swapId: swap.swapId,
      invoiceLen: swap.invoice?.length,
    });
    const order = await prisma.order.create({
      data: {
        state: "IDLE",
        satAmount,
        merchantName: String(req.body.merchant || "Unknown Merchant"),
        qrisPayload: String(req.body.qrisPayload || ""),
        idrAmount: Number(req.body.idrAmount || 0),
        boltzSwapId: swap.swapId,
      },
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
        Math.max(0, Math.ceil(Number((swap as any).satsAmount || satAmount || 0))) +
        balanceBufferSats;
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
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to create Boltz swap" });
  }
});

app.get("/api/boltz/swap-status/:swapId", async (req, res) => {
  try {
    const status = await getBoltzSwapStatus(req.params.swapId);
    return res.json(status);
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to get swap status" });
  }
});

app.post("/api/swap/usdt-to-usdc", async (req, res) => {
  try {
    const result = await executeUsdtToUsdcSwap({
      usdtAmount: Number(req.body.usdtAmount),
      walletAddress: String(req.body.walletAddress),
    });
    return res.json(result);
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Swap execution failed" });
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
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to load order status" });
  }
});

app.listen(port, () => {
  log.info("server", `paysats backend listening`, { port });
});
