/**
 * List IDRX redeem rails: banks + e-wallets (signed GET, same HMAC as redeem-request).
 *
 *   npm run idrx:methods
 */
import "dotenv/config";
import { getIdrxTransactionMethods } from "../src/idrxRedeem.js";

const EWALLET_HINTS = /GOPAY|OVO|DANA|SHOPEE|LINKAJA|IMKAS/i;

async function main() {
  const out = await getIdrxTransactionMethods();
  const rows = out.data ?? [];
  console.log(JSON.stringify(out, null, 2));
  const ew = rows.filter((r) => EWALLET_HINTS.test(r.bankName));
  if (ew.length) {
    console.log("\n--- E-wallet / GoPay–style (name heuristic) ---");
    console.log(JSON.stringify(ew, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
