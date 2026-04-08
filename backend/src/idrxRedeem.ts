import axios from "axios";
import { createIdrxSignature } from "./idrxSignature.js";
import { log } from "./logger.js";

export const IDRX_REDEEM_URL = "https://idrx.co/api/transaction/redeem-request";
export const IDRX_TRANSACTION_METHOD_URL =
  "https://idrx.co/api/transaction/method";

export type IdrxTransactionMethod = {
  bankCode: string;
  bankName: string;
  maxAmountTransfer: string;
};

export type IdrxMethodsResponse = {
  statusCode?: number;
  message?: string;
  data?: IdrxTransactionMethod[];
};

export type IdrxRedeemRequestBody = {
  txHash: string;
  networkChainId: string;
  amountTransfer: string;
  bankAccount: string;
  bankCode: string;
  bankName: string;
  bankAccountName: string;
  walletAddress: string;
};

export type IdrxRedeemResponse = {
  statusCode?: number;
  message?: string;
  data?: { id?: number; txHash?: string; amount?: string; [k: string]: unknown };
};

export async function postIdrxRedeemRequest(
  body: IdrxRedeemRequestBody,
): Promise<IdrxRedeemResponse> {
  const apiKey = process.env.IDRX_API_KEY?.trim();
  const secret = process.env.IDRX_API_SECRET?.trim();
  if (!apiKey) throw new Error("IDRX_API_KEY is not set");
  if (!secret) throw new Error("IDRX_API_SECRET is not set");

  const timestamp = Math.round(Date.now()).toString();
  const sig = createIdrxSignature("POST", IDRX_REDEEM_URL, body, timestamp, secret);

  log.info("idrx", "POST redeem-request", {
    networkChainId: body.networkChainId,
    amountTransfer: body.amountTransfer,
    bankAccountSuffix: body.bankAccount.slice(-4),
  });

  const res = await axios.post<IdrxRedeemResponse>(IDRX_REDEEM_URL, body, {
    headers: {
      "Content-Type": "application/json",
      "idrx-api-key": apiKey,
      "idrx-api-sig": sig,
      "idrx-api-ts": timestamp,
    },
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `IDRX redeem-request failed HTTP ${res.status}: ${JSON.stringify(res.data)}`,
    );
  }

  return res.data;
}

/** GET /api/transaction/method — banks + e-wallets (GoPay, OVO, DANA, …). */
export async function getIdrxTransactionMethods(): Promise<IdrxMethodsResponse> {
  const apiKey = process.env.IDRX_API_KEY?.trim();
  const secret = process.env.IDRX_API_SECRET?.trim();
  if (!apiKey) throw new Error("IDRX_API_KEY is not set");
  if (!secret) throw new Error("IDRX_API_SECRET is not set");

  const timestamp = Math.round(Date.now()).toString();
  const sig = createIdrxSignature(
    "GET",
    IDRX_TRANSACTION_METHOD_URL,
    {},
    timestamp,
    secret,
  );

  const res = await axios.get<IdrxMethodsResponse>(IDRX_TRANSACTION_METHOD_URL, {
    headers: {
      "idrx-api-key": apiKey,
      "idrx-api-sig": sig,
      "idrx-api-ts": timestamp,
    },
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `IDRX transaction/method failed HTTP ${res.status}: ${JSON.stringify(res.data)}`,
    );
  }

  return res.data;
}
