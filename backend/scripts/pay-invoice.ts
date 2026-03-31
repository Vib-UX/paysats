import "dotenv/config";
import "websocket-polyfill"; // required in node.js for @getalby/sdk NWC

import { payInvoiceWithRetries } from "../src/nwc.js";
import { log } from "../src/logger.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in backend/.env`);
  return v;
}

async function main() {
  const nwcUrl = requireEnv("NWC_URL");
  const bolt11 = process.env.BOLT11?.trim() || process.argv.slice(2).join(" ").trim();
  if (!bolt11) {
    throw new Error("Usage: BOLT11=ln... npx tsx scripts/pay-invoice.ts  (or pass invoice as argv)");
  }

  const minBalanceSatsRaw = process.env.MIN_BALANCE_SATS?.trim();
  const minBalanceSats = minBalanceSatsRaw ? Number(minBalanceSatsRaw) : undefined;
  const waitForBalanceMs = Number(process.env.WAIT_FOR_BALANCE_MS || "0") || 0;

  log.info("script", "pay-invoice start", {
    bolt11Prefix: bolt11.slice(0, 28) + (bolt11.length > 28 ? "…" : ""),
    bolt11Len: bolt11.length,
    minBalanceSats: Number.isFinite(minBalanceSats as number) ? minBalanceSats : null,
    waitForBalanceMs
  });

  const result = await payInvoiceWithRetries({
    nwcUrl,
    bolt11,
    maxAttempts: Number(process.env.NWC_PAY_MAX_ATTEMPTS || "3") || 3,
    baseDelayMs: Number(process.env.NWC_PAY_BASE_DELAY_MS || "1500") || 1500,
    minBalanceSats: Number.isFinite(minBalanceSats as number) ? (minBalanceSats as number) : undefined,
    waitForBalanceMs
  });

  log.info("script", "pay-invoice success", {
    attempts: result.attempts,
    preimageLen: result.preimage?.length ?? 0,
    feesPaid: result.feesPaid
  });
}

main().catch((e) => {
  log.error("script", "pay-invoice failed", e);
  process.exit(1);
});

