/**
 * LiFi flow (quote → allowance → approve → execute) via Tether WDK ERC-4337.
 * Core logic lives in `src/swap.ts` (`executeUsdtToUsdcSwap`).
 *
 * Usage: `npx tsx scripts/lifi-exec-arb-usdt-base-usdc.ts`
 */
import "dotenv/config";
import { deriveArbitrumErc4337ReceiveAddress } from "../src/arbitrumErc4337Address.js";
import { executeUsdtToUsdcSwap } from "../src/swap.js";

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

  const result = await executeUsdtToUsdcSwap({
    walletAddress: safeAddress,
    usdtAmount,
    fromAmountMinUnits: fromMin
  });

  console.log("Done. USDC (human est.):", result.usdcAmount, "| userOp hash:", result.txHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
