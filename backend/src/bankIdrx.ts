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
 * Preimage: `{bankName}_{bankAccount}` (same `bankName` / account string as redeem-request), then SHA-256.
 */
export function hashBankAccountForIdrxBurn(
  bankAccount: string,
  bankName?: string,
): string {
  const name = (bankName && bankName.trim()) || idrxBcaBankName();
  const acct = bankAccount.trim().replace(/\s+/g, "");
  return sha256HexUtf8(`${name}_${acct}`);
}
