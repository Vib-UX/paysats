import { Contract, JsonRpcProvider } from "ethers";
import { hashBankAccountForIdrxBurn } from "./bankIdrx.js";
import { burnIdrxWithBaseWdk } from "./baseWdk4337.js";
import {
  idrxHumanIdrToRaw,
  rawToIdrxHuman,
  readIdrxDecimalsOnBase,
  waitForIdrxBalance,
} from "./idrxBurn.js";
import {
  idrxBaseContractAddress,
  idrxBaseRecipientAddress,
  idrxBcaBankCode,
  idrxBcaBankName,
  idrxBurnAmountIdr,
  requireBaseRpcUrl,
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
  /** L2 bundle tx hash for IDRX `redeem-request` `txHash` (not ERC-4337 userOp hash). */
  burnTxHash: string;
  burnUserOpHash?: string;
  amountTransfer: string;
  holderAddress: string;
};

/**
 * After LiFi delivers IDRX on Base: wait for balance, burn whole IDR for redeem.
 * Prefer `burnAmountIdr` from the order (UI idrAmount); else `IDRX_BURN_AMOUNT_IDR` env (default 21000).
 * Burns `min(requested, on-chain balance)` if the bridge delivers less than requested (logs a warning).
 */
export async function runBankIdrxBurnOnly(params: {
  orderId: string;
  recipientDigits: string;
  /** Must match redeem-request `bankName` (IDRX methods list). */
  payoutBankName?: string;
  idrxAmountMinRaw: string;
  /** Whole IDR from offramp order (`idrAmount`); optional for scripts / tests. */
  burnAmountIdr?: number;
}): Promise<BankIdrxBurnResult> {
  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    throw new Error("WDK_SEED is required for IDRX burn on Base (ERC-4337).");
  }

  const holder = idrxBaseRecipientAddress();
  const decimals = await readIdrxDecimalsOnBase();

  const fromOrder =
    params.burnAmountIdr != null &&
    Number.isFinite(params.burnAmountIdr) &&
    params.burnAmountIdr > 0
      ? Math.floor(params.burnAmountIdr)
      : null;
  const requestedHuman = fromOrder ?? idrxBurnAmountIdr();
  if (requestedHuman < IDRX_MIN_REDEEM_IDR) {
    throw new Error(
      `IDRX burn amount (${requestedHuman} IDR) is below IDRX_MIN_REDEEM_IDR (${IDRX_MIN_REDEEM_IDR})`,
    );
  }

  const minRedeemRaw =
    BigInt(IDRX_MIN_REDEEM_IDR) * 10n ** BigInt(decimals);
  let minRaw: bigint;
  try {
    const qmin = BigInt(params.idrxAmountMinRaw || "0");
    minRaw = qmin > 0n ? (qmin * 98n) / 100n : minRedeemRaw;
  } catch {
    minRaw = minRedeemRaw;
  }
  const requestedRaw = idrxHumanIdrToRaw(BigInt(requestedHuman), decimals);
  if (minRaw < requestedRaw) {
    minRaw = requestedRaw;
  }

  const maxWaitMs =
    Number(process.env.IDRX_BRIDGE_MAX_WAIT_MS?.trim() || "1800000") || 1_800_000;
  const pollMs = Number(process.env.IDRX_BALANCE_POLL_MS?.trim() || "8000") || 8000;

  log.info("idrx", "waiting for IDRX on Base after LiFi", {
    orderId: params.orderId,
    minRaw: minRaw.toString(),
    requestedHumanIdr: requestedHuman,
    maxWaitMs,
  });

  await waitForIdrxBalance({
    holderAddress: holder,
    minRaw,
    maxWaitMs,
    pollMs,
  });

  const bal = await readIdrxBalanceRaw(holder);
  const balHuman = Math.floor(rawToIdrxHuman(bal, decimals));
  const burnHumanIdr = Math.min(requestedHuman, balHuman);
  if (burnHumanIdr < IDRX_MIN_REDEEM_IDR) {
    throw new Error(
      `IDRX on Base is ${balHuman} IDR (raw ${bal.toString()}); need ≥ ${IDRX_MIN_REDEEM_IDR} IDR to burn (requested ${requestedHuman}).`,
    );
  }
  if (burnHumanIdr < requestedHuman) {
    log.warn("idrx", "burning less than order idrAmount — using on-chain balance", {
      orderId: params.orderId,
      requestedHuman,
      burnHumanIdr,
      balHuman,
    });
  }

  const burnRaw = idrxHumanIdrToRaw(BigInt(burnHumanIdr), decimals);
  const payoutName = params.payoutBankName?.trim() || undefined;
  const hashBinding = hashBankAccountForIdrxBurn(
    params.recipientDigits,
    payoutName,
  );
  const { txHash, userOpHash } = await burnIdrxWithBaseWdk({
    seed,
    expectedSafeAddress: holder,
    amountRaw: burnRaw,
    hashedAccountNumberHex: hashBinding,
  });

  return {
    burnTxHash: txHash,
    burnUserOpHash: userOpHash,
    amountTransfer: String(burnHumanIdr),
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
  bankCode?: string;
  bankName?: string;
}): Promise<string | null> {
  const bankAccount = params.recipientDigits.replace(/\D/g, "");
  if (!bankAccount) {
    throw new Error("recipientDigits must be a non-empty numeric string for IDRX redeem");
  }
  const redeemBody = {
    txHash: params.burnTxHash,
    networkChainId: "8453",
    amountTransfer: params.amountTransfer,
    bankAccount,
    bankCode: (params.bankCode && params.bankCode.trim()) || idrxBcaBankCode(),
    bankName: (params.bankName && params.bankName.trim()) || idrxBcaBankName(),
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
