/**
 * Standalone P2P.me executor — run locally where Firefox + logged-in / passkey profile exist.
 * Expose with ngrok: `ngrok http 8787` → point your main app at the HTTPS URL.
 *
 *   cd backend && npm run p2p:executor
 *
 * Optional: set P2P_EXECUTOR_SECRET and send `Authorization: Bearer <secret>` (or header `X-P2P-Executor-Secret`).
 */
import "dotenv/config";
import cors from "cors";
import express from "express";
import { createP2pmSellOrder, getP2pmOrderStatus } from "./p2pm.js";
import { log } from "./logger.js";

const app = express();
const port = Number(process.env.P2P_EXECUTOR_PORT || 8787);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "p2p-executor", port });
});

function requireExecutorAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const secret = process.env.P2P_EXECUTOR_SECRET?.trim();
  if (!secret) {
    return next();
  }
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
  const header = req.headers["x-p2p-executor-secret"];
  const xSecret = typeof header === "string" ? header.trim() : "";
  if (bearer === secret || xSecret === secret) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized — set Authorization: Bearer or X-P2P-Executor-Secret" });
}

app.use(requireExecutorAuth);

app.post("/api/p2pm/sell", async (req, res) => {
  try {
    log.info("p2p-executor", "POST /api/p2pm/sell", {
      usdcAmount: req.body?.usdcAmount,
      payoutMethod: req.body?.payoutMethod
    });
    const result = await createP2pmSellOrder(
      {
        usdcAmount: Number(req.body.usdcAmount),
        payoutMethod: req.body.payoutMethod,
        recipientDetails: String(req.body.recipientDetails || "")
      },
      { log: (m) => log.info("p2pm", m) }
    );
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to place p2p.me sell"
    });
  }
});

app.get("/api/p2pm/order-status/:orderId", async (req, res) => {
  try {
    const status = await getP2pmOrderStatus(req.params.orderId);
    return res.json(status);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to check p2p.me order"
    });
  }
});

app.listen(port, () => {
  log.info("p2p-executor", `listening`, {
    port,
    auth: process.env.P2P_EXECUTOR_SECRET ? "secret required" : "open (set P2P_EXECUTOR_SECRET for ngrok)"
  });
});
