/**
 * Display whole sats as a BTC decimal (1 BTC = 100_000_000 sats).
 * Trims trailing zeros after the decimal; up to 8 fractional digits.
 */
export function formatSatsAsBtc(sats: number | null | undefined): string {
  if (sats == null || !Number.isFinite(sats) || sats <= 0) return "0";
  const btc = sats / 1e8;
  const trimmed = btc.toFixed(8).replace(/\.?0+$/, "");
  return trimmed || "0";
}
