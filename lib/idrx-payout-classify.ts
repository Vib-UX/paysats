/** Keep in sync with backend/src/idrxPayoutClassify.ts */
const EWALLET_BANK_CODES = new Set([
  "789",
  "911",
  "1010",
  "1011",
  "1012",
  "1013",
  "1014",
]);

export function isIdrxEwalletBankCode(bankCode: string): boolean {
  return EWALLET_BANK_CODES.has(String(bankCode || "").trim());
}
