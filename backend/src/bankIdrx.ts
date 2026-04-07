import { createHash } from "crypto";
import { idrxBcaBankName } from "./idrxConfig.js";

/** Lowercase hex sha256 (no 0x), UTF-8 input — matches typical IDRX burn examples. */
export function sha256HexUtf8(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** `{bankName}_{accountNumber}` then sha256 — BCA default bank name from env/config. */
export function hashBankAccountForIdrxBurn(bankAccountDigits: string): string {
  const name = idrxBcaBankName();
  return sha256HexUtf8(`${name}_${bankAccountDigits}`);
}
