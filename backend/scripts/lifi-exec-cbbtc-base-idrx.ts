/**
 * LiFi: Base cbBTC → Base IDRX via Tether WDK ERC-4337 (Base Safe).
 *
 *   npx tsx scripts/lifi-exec-cbbtc-base-idrx.ts
 *
 * Env: WDK_SEED, LIFI_API_KEY, BASE_RPC_URL, PIMLICO_API_KEY (or BASE_BUNDLER_URL),
 *      Safe must hold cbBTC + Base USDC for gas paymaster.
 */
import "dotenv/config";
import { deriveBaseErc4337ReceiveAddress } from "../src/baseErc4337Address.js";
import { executeCbbtcToIdrxOnBase } from "../src/swap.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in backend/.env`);
  return v;
}

async function main() {
  requireEnv("LIFI_API_KEY");
  const seed = requireEnv("WDK_SEED");
  const { safeAddress } = deriveBaseErc4337ReceiveAddress(seed);

  const fromMin = process.env.LIFI_CBTC_AMOUNT_MIN_UNITS?.trim();
  const result = await executeCbbtcToIdrxOnBase({
    walletAddress: safeAddress,
    cbbtcAmount: fromMin ? undefined : Number(process.env.LIFI_CBTC_BTC || "0.0001"),
    fromAmountMinUnits: fromMin,
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
