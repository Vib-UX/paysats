/**
 * LiFi quote helper (Arbitrum USDT → Base destination token).
 * @see https://docs.li.fi/li.fi-api/li.fi-api/requesting-a-quote
 */

export const LIFI_USDT_ARBITRUM = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
export const LIFI_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Official IDRX on Base — https://docs.idrx.co/introduction/supported-chain-and-contract-address */
export const LIFI_IDRX_BASE =
  process.env.LIFI_IDRX_BASE_TOKEN?.trim() ||
  "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22";
export const LIFI_CHAIN_ARBITRUM = "42161";
export const LIFI_CHAIN_BASE = "8453";

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

export async function fetchLifiQuote(params: {
  apiKey: string;
  fromAddress: string;
  toAddress: string;
  fromAmount: string;
  /** Base (8453) ERC-20 contract address */
  toToken: string;
  slippage?: string;
}): Promise<LifiQuoteResponse> {
  const q = new URLSearchParams({
    fromChain: LIFI_CHAIN_ARBITRUM,
    toChain: LIFI_CHAIN_BASE,
    fromToken: LIFI_USDT_ARBITRUM,
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
