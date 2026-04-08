/**
 * LiFi: Arbitrum USDT → Base IDRX via Tether WDK ERC-4337 (same pattern as lifi-exec-arb-usdt-base-usdc.ts).
 *
 * Usage: `npx tsx scripts/lifi-exec-arb-usdt-base-idrx.ts`
 *
 * Env: WDK_SEED, LIFI_API_KEY, ARBITRUM_RPC_URL, PIMLICO_API_KEY (or ARBITRUM_BUNDLER_URL),
 *      BASE_RPC_URL (for IDRX decimals read — optional if IDRX_DECIMALS set).
 */
import "dotenv/config";
import { deriveArbitrumErc4337ReceiveAddress } from "../src/arbitrumErc4337Address.js";
import { executeUsdtToIdrxOnBase } from "../src/swap.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in backend/.env`);
  return v;
}

async function main() {
  requireEnv("LIFI_API_KEY");
  const seed = requireEnv("WDK_SEED");
  const { safeAddress } = deriveArbitrumErc4337ReceiveAddress(seed);

  const fromMin = process.env.LIFI_AMOUNT_MIN_UNITS?.trim();
  const usdtAmount = fromMin ? Number(fromMin) / 1e6 : 1;

  const result = await executeUsdtToIdrxOnBase({
    walletAddress: safeAddress,
    usdtAmount,
  });

  console.log(
    "Done. IDRX (human est., IDR):",
    result.idrxAmountIdr,
    "| userOp hash:",
    result.txHash,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
