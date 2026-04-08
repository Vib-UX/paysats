/**
 * Print the IDRX burn binding hash for BCA (same as crypto-js sha256 on UTF-8 preimage).
 *
 *   npx tsx scripts/idrx-bank-hash.ts 4191464375
 *   # or: IDRX_BURN_BANK_DIGITS=… npx tsx scripts/idrx-bank-hash.ts
 */
import "dotenv/config";
import { idrxBcaBankName } from "../src/idrxConfig.js";
import { hashBankAccountForIdrxBurn, sha256HexUtf8 } from "../src/bankIdrx.js";

const digits =
  process.argv[2]?.trim() || process.env.IDRX_BURN_BANK_DIGITS?.trim();
if (!digits) {
  console.error("Pass bank account digits as argv or set IDRX_BURN_BANK_DIGITS");
  process.exit(1);
}

const name = idrxBcaBankName();
const preimage = `${name}_${digits.trim().replace(/\s+/g, "")}`;
const hash = hashBankAccountForIdrxBurn(digits);
if (sha256HexUtf8(preimage) !== hash) {
  throw new Error("internal: hash mismatch");
}
console.log("Bank name (config):", name);
console.log("Preimage (UTF-8):", preimage);
console.log("SHA-256 hex (burn arg):", hash);
