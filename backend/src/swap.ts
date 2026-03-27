const USDC_ORDER_CAP = 100;

export async function executeUsdtToUsdcSwap(params: {
  usdtAmount: number;
  walletAddress: string;
}): Promise<{ usdcAmount: number; txHash: string }> {
  if (params.usdtAmount <= 0) {
    throw new Error("USDT amount must be greater than zero.");
  }
  if (params.usdtAmount > USDC_ORDER_CAP) {
    throw new Error("Hard cap exceeded: maximum 100 USDC per order.");
  }
  if (!params.walletAddress) {
    throw new Error("Missing wallet address for USDT -> USDC swap.");
  }
  return {
    usdcAmount: params.usdtAmount * 0.998,
    txHash: `0xswap_${Date.now().toString(16)}`
  };
}
