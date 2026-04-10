/**
 * LiFi: BNB Chain BTCB → Base IDRX via Tether WDK ERC-4337 (BNB Safe).
 *
 *   npx tsx scripts/lifi-exec-btcb-bsc-idrx.ts
 *
 * Env: WDK_SEED, LIFI_API_KEY, BNB_RPC_URL or BSC_RPC_URL, PIMLICO_API_KEY (or BSC_BUNDLER_URL),
 *      Safe must hold BTCB + BSC USDT for gas paymaster.
 */
import "dotenv/config";
import { deriveBscErc4337ReceiveAddress } from "../src/bscErc4337Address.js";
import { executeBtcbToIdrxFromBsc } from "../src/swap.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in backend/.env`);
  return v;
}

async function main() {
  requireEnv("LIFI_API_KEY");
  const seed = requireEnv("WDK_SEED");
  const { safeAddress } = deriveBscErc4337ReceiveAddress(seed);

  const fromMin = process.env.LIFI_BTCB_AMOUNT_MIN_UNITS?.trim();
  const result = await executeBtcbToIdrxFromBsc({
    walletAddress: safeAddress,
    btcbAmount: fromMin ? undefined : Number(process.env.LIFI_BTCB_BTC || "0.0001"),
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
