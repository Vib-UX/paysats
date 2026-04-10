/**
 * LiFi quote helper (Arbitrum USDT → Base destination token).
 * @see https://docs.li.fi/li.fi-api/li.fi-api/requesting-a-quote
 */

export const LIFI_USDT_ARBITRUM = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
export const LIFI_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Coinbase Wrapped BTC on Base (8 decimals) — https://basescan.org/token/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf */
export const LIFI_CBTC_BASE =
  process.env.LIFI_CBTC_BASE_TOKEN?.trim() ||
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
/** Binance-Peg BTCB on BNB Chain (18 decimals) — https://bscscan.com/token/0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c */
export const LIFI_BTCB_BSC =
  process.env.LIFI_BTCB_BSC_TOKEN?.trim() ||
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c";
/** USDT on BNB Chain — Pimlico ERC-20 paymaster gas token default for BSC swaps */
export const LIFI_USDT_BSC =
  process.env.LIFI_USDT_BSC_TOKEN?.trim() ||
  "0x55d398326f99059fF775485246999027B3197955";
/** Official IDRX on Base — https://docs.idrx.co/introduction/supported-chain-and-contract-address */
export const LIFI_IDRX_BASE =
  process.env.LIFI_IDRX_BASE_TOKEN?.trim() ||
  "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22";
export const LIFI_CHAIN_ARBITRUM = "42161";
export const LIFI_CHAIN_BASE = "8453";
export const LIFI_CHAIN_BSC = "56";

export type LifiQuoteResponse = {
  tool?: string;
  toolDetails?: { name?: string };
  action?: { fromAmount?: string };
  estimate?: {
    approvalAddress?: string;
    toAmount?: string;
    toAmountMin?: string;
  };
  transactionRequest?: {
    to?: string;
    data?: string;
    value?: string;
    from?: string;
    chainId?: number;
  };
};

/**
 * LiFi quote for arbitrary source chain/token → destination (typically Base IDRX).
 * @see https://docs.li.fi/li.fi-api/li.fi-api/requesting-a-quote
 */
export async function fetchLifiQuoteCrossChain(params: {
  apiKey: string;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAddress: string;
  toAddress: string;
  fromAmount: string;
  slippage?: string;
}): Promise<LifiQuoteResponse> {
  const q = new URLSearchParams({
    fromChain: params.fromChain,
    toChain: params.toChain,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    slippage: params.slippage ?? "0.03",
  });

  const res = await fetch(`https://li.quest/v1/quote?${q.toString()}`, {
    headers: { "x-lifi-api-key": params.apiKey },
  });

  const body = (await res.json().catch(() => ({}))) as LifiQuoteResponse & {
    message?: string;
  };
  if (!res.ok) {
    throw new Error(`LiFi quote ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

/** Arbitrum USDT → Base `toToken` (default path: Boltz USDT leg then LiFi). */
export async function fetchLifiQuote(params: {
  apiKey: string;
  fromAddress: string;
  toAddress: string;
  fromAmount: string;
  /** Base (8453) ERC-20 contract address */
  toToken: string;
  slippage?: string;
}): Promise<LifiQuoteResponse> {
  return fetchLifiQuoteCrossChain({
    apiKey: params.apiKey,
    fromChain: LIFI_CHAIN_ARBITRUM,
    toChain: LIFI_CHAIN_BASE,
    fromToken: LIFI_USDT_ARBITRUM,
    toToken: params.toToken,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    fromAmount: params.fromAmount,
    slippage: params.slippage,
  });
}
