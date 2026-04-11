/** IDRX `bankCode` values that use phone-style `+CC-NNN…` recipient (not bank account digits). */
const EWALLET_BANK_CODES = new Set([
  "789", // IMKAS
  "911", // LINKAJA
  "1010", // OVO
  "1011", // GOPAY
  "1012", // DANA
  "1013", // SHOPEEPAY
  "1014", // LINKAJA DIRECT
]);

export function isIdrxEwalletBankCode(bankCode: string): boolean {
  return EWALLET_BANK_CODES.has(String(bankCode || "").trim());
}

/** BCA first, then others by localized bank name. */
export function sortIdrxMethodsForUi<
  T extends { bankCode: string; bankName: string },
>(rows: T[]): T[] {
  const bca = "014";
  const copy = [...rows];
  copy.sort((a, b) => {
    const ac = String(a.bankCode).trim();
    const bc = String(b.bankCode).trim();
    if (ac === bca && bc !== bca) return -1;
    if (bc === bca && ac !== bca) return 1;
    return a.bankName.localeCompare(b.bankName, "id-ID");
  });
  return copy;
}
