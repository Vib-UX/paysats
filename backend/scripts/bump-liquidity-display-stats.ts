/**
 * Bump public liquidity banner stats: +3 or +4 orders and matching IDR / sats (BTC/IDR aligned).
 * Run daily via cron, e.g. `0 14 * * * cd /path/to/backend && npx tsx scripts/bump-liquidity-display-stats.ts`
 */
import "dotenv/config";
import { appendSyntheticDailyBump } from "../src/liquidityDisplayStats.js";

async function fetchBtcIdrSimple(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=idr",
    { headers: { accept: "application/json" } },
  );
  const body = (await res.json().catch(() => ({}))) as { bitcoin?: { idr?: number } };
  const n = Number(body?.bitcoin?.idr);
  if (!Number.isFinite(n) || n <= 0) throw new Error("CoinGecko BTC/IDR unavailable");
  return n;
}

async function main() {
  const btcIdr = await fetchBtcIdrSimple();
  const out = appendSyntheticDailyBump(btcIdr);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
