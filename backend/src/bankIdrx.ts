import { createHash } from "crypto";
import { idrxBcaBankName } from "./idrxConfig.js";

/**
 * Lowercase hex sha256 (no `0x` prefix), UTF-8 input.
 * Equivalent to `import sha256 from "crypto-js/sha256"; sha256(preimage).toString()`.
 */
export function sha256HexUtf8(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * IDRX `burnWithAccountNumber` second argument: hex string binding.
 * Preimage must match IDRX samples: `{bankName}_{bankAccountNumber}` (e.g. `BANK CENTRAL ASIA_4191464375`),
 * then SHA-256. Bank name comes from `IDRX_BCA_BANK_NAME` / `idrxBcaBankName()` (default BCA).
 */
export function hashBankAccountForIdrxBurn(bankAccountDigits: string): string {
  const name = idrxBcaBankName();
  const digits = bankAccountDigits.trim().replace(/\s+/g, "");
  return sha256HexUtf8(`${name}_${digits}`);
}
