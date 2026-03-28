/**
 * Smoke test: Boltz UI → LN invoice only (no Prisma / no API order row).
 * Usage: `npx tsx scripts/smoke-boltz.ts`
 */
import "dotenv/config";
import { createBoltzSwap } from "../src/boltz.js";
import { requireArbitrumReceiveAddress } from "../src/arbitrumErc4337Address.js";
import { initNwc, payInvoice } from "../src/nwc.js";

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

  const nwc = process.env.NWC_URL?.trim();
  if (!nwc) {
    console.log("\nNWC_URL not set — skipping pay_invoice.");
    return;
  }

  const { client } = await initNwc(nwc);
  console.log("\nPaying invoice via NWC...");
  const paid = await payInvoice(client, swap.invoice);
  console.log("Paid, preimage length:", paid.preimage?.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
