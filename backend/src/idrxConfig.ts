import { requireBaseErc4337ReceiveAddress } from "./baseErc4337Address.js";

export const IDRX_BASE_CHAIN_ID = 8453;

export function idrxBaseContractAddress(): string {
  return (
    process.env.IDRX_BASE_CONTRACT?.trim() ||
    "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22"
  );
}

export function requireBaseRpcUrl(): string {
  const u = process.env.BASE_RPC_URL?.trim();
  if (!u) throw new Error("BASE_RPC_URL is required for IDRX on Base");
  return u;
}

/**
 * LiFi delivers Base IDRX to this address — default: WDK ERC-4337 Safe on Base (same seed/path as Arbitrum).
 * Override with IDRX_BASE_RECIPIENT if needed.
 */
export function idrxBaseRecipientAddress(): string {
  const explicit = process.env.IDRX_BASE_RECIPIENT?.trim();
  if (explicit) return explicit;
  return requireBaseErc4337ReceiveAddress();
}

export function idrxBcaBankCode(): string {
  return process.env.IDRX_BCA_BANK_CODE?.trim() || "014";
}

export function idrxBcaBankName(): string {
  return process.env.IDRX_BCA_BANK_NAME?.trim() || "BANK CENTRAL ASIA";
}

const DEFAULT_IDRX_BURN_AMOUNT_IDR = 21_000;

/** Whole IDR to pass to `burnWithAccountNumber` / redeem `amountTransfer` (default 21000). */
export function idrxBurnAmountIdr(): number {
  const raw = process.env.IDRX_BURN_AMOUNT_IDR?.trim();
  const n = raw ? Number(raw) : DEFAULT_IDRX_BURN_AMOUNT_IDR;
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(
      "IDRX_BURN_AMOUNT_IDR must be a positive integer (whole IDR units)",
    );
  }
  return n;
}
