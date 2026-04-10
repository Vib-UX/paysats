/**
 * Frontend: receive addresses for EVM steps are resolved on the **backend**
 * using Tether WDK + `WDK_SEED` (ERC-4337 Safes). See also `GET /api/wallet/deposit-rails`
 * (Arbitrum USDT, Base cbBTC, BNB BTCB, Bitcoin on-chain via WDK Spark docs).
 */
export type TwdkNetwork = "arbitrum-one" | "base" | "bnb";

export interface TwdkReceiveInfo {
  chainId: number;
  ownerAddress: string;
  safeAddress: string;
}
