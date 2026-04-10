/**
 * LiFi quote: Base cbBTC → Base IDRX (no execution).
 *
 *   LIFI_API_KEY=... FROM_ADDRESS=0x... TO_ADDRESS=0x... npx tsx scripts/lifi-quote-cbbtc-idrx.ts
 */
import "dotenv/config";
import {
  fetchLifiQuoteCrossChain,
  LIFI_CBTC_BASE,
  LIFI_CHAIN_BASE,
  LIFI_IDRX_BASE,
} from "../src/lifiQuote.js";

async function main() {
  const apiKey = process.env.LIFI_API_KEY?.trim();
  const fromAddress = process.env.FROM_ADDRESS?.trim();
  const toAddress = process.env.TO_ADDRESS?.trim();
  const fromCbbtc = process.env.FROM_CBTC_BTC || "0.0001";
  if (!apiKey) throw new Error("Set LIFI_API_KEY");
  if (!fromAddress) throw new Error("Set FROM_ADDRESS (Base Safe)");
  if (!toAddress) throw new Error("Set TO_ADDRESS (Base IDRX recipient)");

  const fromAmount = String(Math.max(1, Math.floor(Number(fromCbbtc) * 1e8)));
  const q = await fetchLifiQuoteCrossChain({
    apiKey,
    fromChain: LIFI_CHAIN_BASE,
    toChain: LIFI_CHAIN_BASE,
    fromToken: LIFI_CBTC_BASE,
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
