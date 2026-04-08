/**
 * POST IDRX redeem-request for BCA (bank transfer off-ramp after Base burn).
 *
 * `txHash` must be the **Base L2 transaction hash** that included the burn (EntryPoint bundle),
 * not the ERC-4337 userOp hash. After a local burn, use the "Redeem / Basescan tx hash" line.
 *
 * Env:
 *   IDRX_REDEEM_BURN_TX_HASH — bundle tx hash (or pass as first argv)
 *   IDRX_BURN_BANK_DIGITS — BCA account number digits
 *   WDK_SEED — to derive default walletAddress (Base Safe) unless IDRX_BASE_RECIPIENT set
 *   IDRX_DEFAULT_BANK_ACCOUNT_NAME — optional
 *
 *   npm run idrx:redeem:bca
 *   npx tsx scripts/idrx-redeem-bca.ts 0xe0f599423181d65e91d5464e344691505a8c8c27d2c7fe329052411eeb6bdd7b
 */
import "dotenv/config";
import {
  idrxBaseRecipientAddress,
  idrxBcaBankCode,
  idrxBcaBankName,
  idrxBurnAmountIdr,
} from "../src/idrxConfig.js";
import { postIdrxRedeemRequest } from "../src/idrxRedeem.js";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

async function main() {
  const txHash =
    process.argv[2]?.trim() || env("IDRX_REDEEM_BURN_TX_HASH");
  if (!txHash) {
    throw new Error(
      "Set IDRX_REDEEM_BURN_TX_HASH or pass bundle tx hash as first argv",
    );
  }

  const digits =
    env("IDRX_BURN_BANK_DIGITS") ||
    (() => {
      throw new Error("Set IDRX_BURN_BANK_DIGITS (BCA account digits)");
    })();

  const holder = idrxBaseRecipientAddress();
  const amountTransfer = String(idrxBurnAmountIdr());
  const bankAccountName =
    env("IDRX_DEFAULT_BANK_ACCOUNT_NAME") || "Paysats user";

  const body = {
    txHash,
    networkChainId: "8453",
    amountTransfer,
    bankAccount: digits,
    bankCode: idrxBcaBankCode(),
    bankName: idrxBcaBankName(),
    bankAccountName,
    walletAddress: holder,
  };

  const res = await postIdrxRedeemRequest(body);
  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
