/**
 * LiFi quote: BNB Chain BTCB → Base IDRX (no execution).
 *
 *   LIFI_API_KEY=... FROM_ADDRESS=0x... TO_ADDRESS=0x... npx tsx scripts/lifi-quote-btcb-idrx.ts
 */
import "dotenv/config";
import {
  fetchLifiQuoteCrossChain,
  LIFI_BTCB_BSC,
  LIFI_CHAIN_BASE,
  LIFI_CHAIN_BSC,
  LIFI_IDRX_BASE,
} from "../src/lifiQuote.js";

async function main() {
  const apiKey = process.env.LIFI_API_KEY?.trim();
  const fromAddress = process.env.FROM_ADDRESS?.trim();
  const toAddress = process.env.TO_ADDRESS?.trim();
  const fromBtcb = process.env.FROM_BTCB_BTC || "0.0001";
  if (!apiKey) throw new Error("Set LIFI_API_KEY");
  if (!fromAddress) throw new Error("Set FROM_ADDRESS (BNB Safe)");
  if (!toAddress) throw new Error("Set TO_ADDRESS (Base IDRX recipient)");

  const fromAmount = String(
    BigInt(Math.max(1, Math.floor(Number(fromBtcb) * 1e18))),
  );
  const q = await fetchLifiQuoteCrossChain({
    apiKey,
    fromChain: LIFI_CHAIN_BSC,
    toChain: LIFI_CHAIN_BASE,
    fromToken: LIFI_BTCB_BSC,
    toToken: LIFI_IDRX_BASE,
    fromAddress,
    toAddress,
    fromAmount,
    slippage: process.env.LIFI_SLIPPAGE || "0.03",
  });

  console.log("OK:", JSON.stringify(q, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
