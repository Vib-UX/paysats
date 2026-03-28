/**
 * Frontend: receive addresses for EVM steps are resolved on the **backend**
 * (`GET /api/wallet/arbitrum-receive-address`) using Tether WDK + `WDK_SEED`
 * (ERC-4337 Safe on Arbitrum One for Boltz USDT).
 */
export type TwdkNetwork = "arbitrum-one";

export interface TwdkReceiveInfo {
  chainId: number;
  ownerAddress: string;
  safeAddress: string;
}
