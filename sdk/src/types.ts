/**
 * Full lifecycle of an offramp order. Terminal states are `COMPLETED` and `FAILED`.
 */
export type OrderState =
  | "IDLE"
  | "NWC_CONNECTED"
  | "QR_SCANNED"
  | "ROUTE_SHOWN"
  | "LN_INVOICE_PAID"
  | "BOLTZ_SWAP_PENDING"
  | "USDT_RECEIVED"
  | "USDC_SWAPPED"
  | "P2PM_ORDER_PLACED"
  | "P2PM_ORDER_CONFIRMED"
  | "IDR_SETTLED"
  | "COMPLETED"
  | "FAILED";

export const TERMINAL_ORDER_STATES: ReadonlyArray<OrderState> = ["COMPLETED", "FAILED"];

export function isTerminalState(state: OrderState): boolean {
  return TERMINAL_ORDER_STATES.includes(state);
}

export type BtcIdrQuote = {
  btcIdr: number;
  usdcIdr: number;
  /** ISO 8601 timestamp of the source quote. */
  fetchedAt: string;
  source: "coingecko" | "coinmarketcap" | string;
};

export type PayoutMethod = {
  bankCode: string;
  bankName: string;
  maxAmountTransfer?: number | string | null;
  kind: "bank" | "ewallet";
};

export type PayoutMethodsResponse = {
  statusCode?: number;
  message?: string;
  data: PayoutMethod[];
};

export type DepositChannel = "lightning" | "cbbtc" | "btcb";

export type DepositRails = {
  configured: boolean;
  bitcoinOnchain: {
    label: string;
    summary: string;
  };
  lightning?: {
    label: string;
    summary: string;
  };
  arbitrumUsdt?: {
    chainId: number;
    safeAddress: string;
    token: "USDT";
    role?: string;
  };
  baseCbbtc?: {
    chainId: number;
    safeAddress: string;
    token: "cbBTC";
    contractAddress: string;
    decimals: number;
    depositChannel: "cbbtc";
  };
  bscBtcb?: {
    chainId: number;
    safeAddress: string;
    token: "BTCB";
    contractAddress: string;
    decimals: number;
    depositChannel: "btcb";
  };
  error?: string;
};

export type PlatformStats = {
  fetchedAt: string;
  [k: string]: unknown;
};

export type OfframpCreateInput = {
  /** Exact sat amount to off-ramp. Either this or `idrAmount` must be provided. */
  satAmount?: number;
  /** Target IDR amount; sats will be computed from the live BTC/IDR quote. */
  idrAmount?: number;
  /** Deposit rail. Defaults to "lightning". */
  depositChannel?: DepositChannel;
  /** IDRX `bankCode` — must come from `listPayoutMethods()`. */
  idrxBankCode: string;
  /** IDRX `bankName` — must come from `listPayoutMethods()` and match bankCode. */
  idrxBankName: string;
  /**
   * Recipient account details:
   *   - bank: digits-only bank account number
   *   - ewallet: E.164-style `+62-8123...` or 10–15 digit mobile
   */
  recipientDetails: string;
  /** Legal holder name for the bank / e-wallet. Optional; server provides a default. */
  bankAccountName?: string;
  /** Reserved for future payout rails — only `bank_transfer` is supported today. */
  payoutMethod?: "bank_transfer";
};

export type EvmDepositInstructions = {
  channel: "cbbtc" | "btcb";
  chainId: number;
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  toAddress: string;
  decimals: number;
  qrValue: string;
};

export type OfframpCreateResponse = {
  orderId: string;
  /** BOLT11 invoice. `null` for cbBTC/BTCB rails — fund via `deposit` instructions instead. */
  bolt11: string | null;
  satAmount: number;
  idrAmount: number;
  btcIdr: number;
  fetchedAt: string;
  invoiceExpiresAt: string | null;
  deposit?: EvmDepositInstructions;
};

/**
 * Full server-side order record (shape of `GET /v1/offramp/orders/:id`).
 * Fields are a loose superset because the server evolves over time; always
 * branch on `state` when driving UI.
 */
export type OfframpOrder = {
  id: string;
  tenantId?: string | null;
  state: OrderState;
  satAmount: number;
  idrAmount: number;
  idrxAmountIdr?: number | null;
  btcIdr?: number | null;
  btcIdrFetchedAt?: string | Date | null;
  invoiceBolt11?: string | null;
  invoiceLnId?: string | null;
  invoiceExpiresAt?: string | Date | null;
  invoicePaidAt?: string | Date | null;
  boltzSwapId?: string | null;
  boltzLnInvoice?: string | null;
  boltzTxHash?: string | null;
  swapTxHash?: string | null;
  idrxBurnTxHash?: string | null;
  idrxRedeemId?: string | null;
  idrxPayoutBankCode?: string | null;
  idrxPayoutBankName?: string | null;
  payoutRecipient?: string | null;
  bankAccountName?: string | null;
  depositChannel?: DepositChannel | string | null;
  depositChainId?: number | null;
  depositTokenAddress?: string | null;
  depositToAddress?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt?: string | Date | null;
  merchantName?: string | null;
  [k: string]: unknown;
};

export type WaitForOrderOptions = {
  /** Poll interval in ms. Default: 5000. */
  pollMs?: number;
  /** Hard timeout in ms. Default: 30 minutes. */
  timeoutMs?: number;
  /** Called once per poll with the latest order snapshot (including the first hit). */
  onUpdate?: (order: OfframpOrder) => void;
  /** Abort signal; if it fires, waitForOrder rejects with an AbortError. */
  signal?: AbortSignal;
};

export type PaysatsClientOptions = {
  apiKey: string;
  /** Defaults to https://api.paysats.io */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to 30000. */
  timeoutMs?: number;
  /** Optional fetch override (for Node <18 polyfills or testing). */
  fetch?: typeof fetch;
};

export class PaysatsApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "PaysatsApiError";
    this.status = status;
    this.body = body;
  }
}
