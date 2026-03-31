/**
 * Smoke: POST /api/p2pm/sell flow via createP2pmSellOrder (same as server).
 * Usage from backend: `npx tsx scripts/smoke-p2pm.ts`
 */
import "dotenv/config";
import { createP2pmSellOrder } from "../src/p2pm.js";

async function main() {
  const usdc = Number(process.env.P2P_SMOKE_USDC || "1");
  const result = await createP2pmSellOrder(
    {
      usdcAmount: usdc,
      payoutMethod: "gopay",
      recipientDetails: process.env.P2P_SMOKE_PAYOUT?.trim() || "",
    },
    { log: (m) => console.log("[p2pm]", m) },
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
