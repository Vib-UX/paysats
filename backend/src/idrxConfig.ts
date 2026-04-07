import { Wallet } from "ethers";

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

export function requireIdrxBurnPrivateKey(): string {
  const k = process.env.IDRX_BURN_PRIVATE_KEY?.trim();
  if (!k) throw new Error("IDRX_BURN_PRIVATE_KEY is required for IDRX burn on Base");
  return k;
}

/** LiFi delivers Base IDRX here; must match the burn signer address. */
export function idrxBaseRecipientAddress(): string {
  const explicit = process.env.IDRX_BASE_RECIPIENT?.trim();
  if (explicit) return explicit;
  return new Wallet(requireIdrxBurnPrivateKey()).address;
}

export function idrxBcaBankCode(): string {
  return process.env.IDRX_BCA_BANK_CODE?.trim() || "014";
}

export function idrxBcaBankName(): string {
  return process.env.IDRX_BCA_BANK_NAME?.trim() || "BANK CENTRAL ASIA";
}
