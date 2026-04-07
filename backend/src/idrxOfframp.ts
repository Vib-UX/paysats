import { Contract, JsonRpcProvider } from "ethers";
import { hashBankAccountForIdrxBurn } from "./bankIdrx.js";
import {
  burnIdrxWithAccountNumber,
  rawToIdrxHuman,
  readIdrxDecimalsOnBase,
  waitForIdrxBalance,
} from "./idrxBurn.js";
import {
  idrxBaseContractAddress,
  idrxBaseRecipientAddress,
  idrxBcaBankCode,
  idrxBcaBankName,
  requireBaseRpcUrl,
  requireIdrxBurnPrivateKey,
} from "./idrxConfig.js";
import { postIdrxRedeemRequest } from "./idrxRedeem.js";
import { log } from "./logger.js";

const IDRX_MIN_REDEEM_IDR =
  Number(process.env.IDRX_MIN_REDEEM_IDR?.trim() || "20000") || 20_000;

async function readIdrxBalanceRaw(holder: string): Promise<bigint> {
  const provider = new JsonRpcProvider(requireBaseRpcUrl());
  const c = new Contract(
    idrxBaseContractAddress(),
    ["function balanceOf(address account) view returns (uint256)"],
    provider,
  );
  return BigInt(await c.balanceOf(holder));
}

export type BankIdrxBurnResult = {
  burnTxHash: string;
  amountTransfer: string;
  holderAddress: string;
};

/**
 * After LiFi delivers IDRX on Base: wait for balance, burn full balance with bank hash.
 */
export async function runBankIdrxBurnOnly(params: {
  orderId: string;
  recipientDigits: string;
  idrxAmountMinRaw: string;
}): Promise<BankIdrxBurnResult> {
  const holder = idrxBaseRecipientAddress();
  const pk = requireIdrxBurnPrivateKey();
  const decimals = await readIdrxDecimalsOnBase();

  const minRedeemRaw =
    BigInt(IDRX_MIN_REDEEM_IDR) * 10n ** BigInt(decimals);
  let minRaw: bigint;
  try {
    const qmin = BigInt(params.idrxAmountMinRaw || "0");
    minRaw = qmin > 0n ? (qmin * 98n) / 100n : minRedeemRaw;
  } catch {
    minRaw = minRedeemRaw;
  }

  const maxWaitMs =
    Number(process.env.IDRX_BRIDGE_MAX_WAIT_MS?.trim() || "1800000") || 1_800_000;
  const pollMs = Number(process.env.IDRX_BALANCE_POLL_MS?.trim() || "8000") || 8000;

  log.info("idrx", "waiting for IDRX on Base after LiFi", {
    orderId: params.orderId,
    minRaw: minRaw.toString(),
    maxWaitMs,
  });

  await waitForIdrxBalance({
    holderAddress: holder,
    minRaw,
    maxWaitMs,
    pollMs,
  });

  const bal = await readIdrxBalanceRaw(holder);
  if (bal <= 0n) {
    throw new Error("IDRX balance on Base is zero after wait");
  }

  const hashBinding = hashBankAccountForIdrxBurn(params.recipientDigits);
  const { txHash } = await burnIdrxWithAccountNumber({
    privateKey: pk,
    amountRaw: bal,
    hashedAccountNumberHex: hashBinding,
  });

  const humanTransfer = Math.floor(rawToIdrxHuman(bal, decimals));
  if (humanTransfer < IDRX_MIN_REDEEM_IDR) {
    log.warn("idrx", "burn human amount below IDRX minimum (redeem may fail)", {
      orderId: params.orderId,
      humanTransfer,
      min: IDRX_MIN_REDEEM_IDR,
    });
  }

  return {
    burnTxHash: txHash,
    amountTransfer: String(humanTransfer),
    holderAddress: holder,
  };
}

/** Submit IDRX redeem-request (after burn is confirmed on-chain). */
export async function runBankIdrxRedeemOnly(params: {
  orderId: string;
  burnTxHash: string;
  amountTransfer: string;
  recipientDigits: string;
  bankAccountName: string;
  holderAddress: string;
}): Promise<string | null> {
  const redeemBody = {
    txHash: params.burnTxHash,
    networkChainId: "8453",
    amountTransfer: params.amountTransfer,
    bankAccount: params.recipientDigits,
    bankCode: idrxBcaBankCode(),
    bankName: idrxBcaBankName(),
    bankAccountName: params.bankAccountName.trim() || "Paysats user",
    walletAddress: params.holderAddress,
  };

  const res = await postIdrxRedeemRequest(redeemBody);
  const redeemId =
    res?.data && typeof (res.data as { id?: unknown }).id !== "undefined"
      ? String((res.data as { id: number | string }).id)
      : null;

  log.info("idrx", "redeem-request submitted", {
    orderId: params.orderId,
    redeemId,
    burnTxHash: params.burnTxHash,
  });

  return redeemId;
}
