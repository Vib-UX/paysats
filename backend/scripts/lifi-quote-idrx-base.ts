/**
 * Spike: LiFi quote Arbitrum USDT → Base IDRX (no execution).
 * Usage: from backend root, with env LIFI_API_KEY, ARBITRUM receive (fromAddress), BASE recipient (toAddress).
 *
 *   LIFI_API_KEY=... FROM_ADDRESS=0x... TO_ADDRESS=0x... npx tsx scripts/lifi-quote-idrx-base.ts
 */
import "dotenv/config";
import {
  fetchLifiQuote,
  LIFI_IDRX_BASE,
  LIFI_USDT_ARBITRUM,
} from "../src/lifiQuote.js";

async function main() {
  const apiKey = process.env.LIFI_API_KEY?.trim();
  const fromAddress = process.env.FROM_ADDRESS?.trim();
  const toAddress = process.env.TO_ADDRESS?.trim();
  const fromUsdt = process.env.FROM_USDT || "10";
  if (!apiKey) throw new Error("Set LIFI_API_KEY");
  if (!fromAddress) throw new Error("Set FROM_ADDRESS (Arbitrum Safe / fromAddress)");
  if (!toAddress) throw new Error("Set TO_ADDRESS (Base recipient for IDRX)");

  const fromAmount = String(Math.max(1, Math.floor(Number(fromUsdt) * 1e6)));
  console.log("Quote params:", {
    fromChain: "42161",
    toChain: "8453",
    fromToken: LIFI_USDT_ARBITRUM,
    toToken: LIFI_IDRX_BASE,
    fromAmount,
    fromAddress,
    toAddress,
  });

  const q = await fetchLifiQuote({
    apiKey,
    fromAddress,
    toAddress,
    fromAmount,
    toToken: LIFI_IDRX_BASE,
    slippage: process.env.LIFI_SLIPPAGE || "0.03",
  });

  console.log("OK:", JSON.stringify(q, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
