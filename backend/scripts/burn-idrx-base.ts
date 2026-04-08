/**
 * Burn fixed whole IDR on Base (`IDRX_BURN_AMOUNT_IDR`, default 21000) via WDK ERC-4337 Safe.
 *
 * Prereqs: Safe IDRX balance ≥ burn amount; paymaster gas token on the Safe (see BASE_PAYMASTER_TOKEN_ADDRESS).
 *
 * Usage:
 *   IDRX_BURN_BANK_DIGITS="1234567890" npm run burn:idrx
 *   # or: npx tsx scripts/burn-idrx-base.ts 1234567890
 */
import "dotenv/config";
import { Contract, JsonRpcProvider } from "ethers";
import { hashBankAccountForIdrxBurn } from "../src/bankIdrx.js";
import { burnIdrxWithBaseWdk } from "../src/baseWdk4337.js";
import { deriveBaseErc4337ReceiveAddress } from "../src/baseErc4337Address.js";
import { idrxHumanIdrToRaw, readIdrxDecimalsOnBase } from "../src/idrxBurn.js";
import {
  idrxBaseContractAddress,
  idrxBaseRecipientAddress,
  idrxBurnAmountIdr,
  requireBaseRpcUrl,
} from "../src/idrxConfig.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in backend/.env`);
  return v;
}

async function readIdrxBalanceRaw(holder: string): Promise<bigint> {
  const provider = new JsonRpcProvider(requireBaseRpcUrl());
  const c = new Contract(
    idrxBaseContractAddress(),
    ["function balanceOf(address account) view returns (uint256)"],
    provider,
  );
  return BigInt(await c.balanceOf(holder));
}

async function main() {
  const seed = requireEnv("WDK_SEED");
  const digits =
    process.env.IDRX_BURN_BANK_DIGITS?.trim() || process.argv[2]?.trim();
  if (!digits) {
    throw new Error(
      "Set IDRX_BURN_BANK_DIGITS or pass bank account digits as first argv",
    );
  }

  const holder = idrxBaseRecipientAddress();
  const { safeAddress } = deriveBaseErc4337ReceiveAddress(seed);
  if (holder.toLowerCase() !== safeAddress.toLowerCase()) {
    console.warn(
      "Note: IDRX_BASE_RECIPIENT differs from WDK Base Safe — burn uses recipient address as holder.",
    );
  }

  const decimals = await readIdrxDecimalsOnBase();
  const burnHumanIdr = idrxBurnAmountIdr();
  const minRedeemIdr =
    Number(process.env.IDRX_MIN_REDEEM_IDR?.trim() || "20000") || 20_000;
  if (burnHumanIdr < minRedeemIdr) {
    throw new Error(
      `IDRX_BURN_AMOUNT_IDR (${burnHumanIdr}) is below IDRX_MIN_REDEEM_IDR (${minRedeemIdr})`,
    );
  }
  const burnRaw = idrxHumanIdrToRaw(BigInt(burnHumanIdr), decimals);

  const bal = await readIdrxBalanceRaw(holder);
  if (bal < burnRaw) {
    throw new Error(
      `IDRX balance ${bal.toString()} raw < burn ${burnRaw.toString()} raw (${burnHumanIdr} IDR) on ${holder}`,
    );
  }

  const hashBinding = hashBankAccountForIdrxBurn(digits);
  const { txHash, userOpHash } = await burnIdrxWithBaseWdk({
    seed,
    expectedSafeAddress: holder,
    amountRaw: burnRaw,
    hashedAccountNumberHex: hashBinding,
  });

  console.log("Redeem / Basescan tx hash (bundle):", txHash);
  console.log("UserOp hash:", userOpHash);
  console.log("Burn IDR (human):", burnHumanIdr);
  console.log("Amount raw:", burnRaw.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
