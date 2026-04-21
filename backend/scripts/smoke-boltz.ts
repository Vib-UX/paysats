/**
 * Smoke test: Boltz UI → LN invoice only (no Prisma / no API order row).
 * Usage: `npx tsx scripts/smoke-boltz.ts`
 */
import "dotenv/config";
import { createBoltzSwap } from "../src/boltz.js";
import { requireArbitrumReceiveAddress } from "../src/arbitrumErc4337Address.js";
import { initSpark, paySparkInvoice } from "../src/spark.js";

const SATS = Number(process.env.SMOKE_SATS || 1000);

async function main() {
  const receive = requireArbitrumReceiveAddress();
  console.log("Receive (Arbitrum ERC-4337 Safe):", receive);

  const swap = await createBoltzSwap({
    satAmount: SATS,
    receiveAddress: receive,
    log: (m) => console.log("[boltz]", m)
  });

  console.log("\n--- Boltz swap ---");
  console.log("swapId:", swap.swapId);
  console.log("invoice prefix:", swap.invoice.slice(0, 40) + "…");
  console.log("satsAmount:", swap.satsAmount, "usdtAmount:", swap.usdtAmount);

  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    console.log("\nWDK_SEED not set — skipping pay_invoice.");
    return;
  }

  const { account } = await initSpark(seed);
  console.log("\nPaying invoice via Spark...");
  const maxFeeSats = Number(process.env.SPARK_PAY_MAX_FEE_SATS || "1000") || 1000;
  const paid = await paySparkInvoice(account, swap.invoice, maxFeeSats);
  console.log("Paid, id:", paid.id, "status:", paid.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
