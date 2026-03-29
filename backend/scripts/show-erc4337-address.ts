/**
 * Print ERC-4337 Safe + owner for the configured WDK seed (Arbitrum derivation).
 * Usage: `npx tsx scripts/show-erc4337-address.ts`
 */
import "dotenv/config";
import { deriveArbitrumErc4337ReceiveAddress } from "../src/arbitrumErc4337Address.js";

const seed = process.env.WDK_SEED?.trim();
if (!seed) {
  console.error("Set WDK_SEED in backend/.env");
  process.exit(1);
}

const { ownerAddress, safeAddress, chainId } = deriveArbitrumErc4337ReceiveAddress(seed);
console.log(JSON.stringify({ chainId, ownerAddress, safeAddress }, null, 2));
console.log(
  "\nFund the Safe on Arbitrum with USDT (USDT0) at:",
  safeAddress
);
