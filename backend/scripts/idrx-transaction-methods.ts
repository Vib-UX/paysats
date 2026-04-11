/**
 * List IDRX redeem rails: banks + e-wallets (signed GET, same HMAC as redeem-request).
 *
 *   npm run idrx:methods
 */
import "dotenv/config";
import { isIdrxEwalletBankCode } from "../src/idrxPayoutClassify.js";
import { getIdrxTransactionMethods } from "../src/idrxRedeem.js";

async function main() {
  const out = await getIdrxTransactionMethods();
  const rows = out.data ?? [];
  console.log(JSON.stringify(out, null, 2));
  const ew = rows.filter((r) => isIdrxEwalletBankCode(r.bankCode));
  if (ew.length) {
    console.log("\n--- E-wallets (bankCode allowlist) ---");
    console.log(JSON.stringify(ew, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
