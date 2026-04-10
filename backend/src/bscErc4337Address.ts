/**
 * Derive the ERC-4337 Safe receive address on BNB Chain (56) from `WDK_SEED`
 * (same owner + path as Arbitrum/Base; chain-specific Safe deployment).
 * @see https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm-erc-4337
 */
import { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { WalletAccountReadOnlyEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";
import { DEFAULT_WDK_EVM_PATH_SUFFIX } from "./arbitrumErc4337Address.js";

export const BSC_MAINNET_CHAIN_ID = 56;

const SAFE_MODULES_VERSION = "0.3.0" as const;

export function deriveBscErc4337ReceiveAddress(
  seedPhrase: string,
  pathSuffix: string = DEFAULT_WDK_EVM_PATH_SUFFIX,
): { ownerAddress: string; safeAddress: string; chainId: number } {
  const trimmed = seedPhrase.trim();
  if (!trimmed) {
    throw new Error("WDK_SEED is empty.");
  }

  const evm = new WalletAccountEvm(trimmed, pathSuffix, {});
  const ownerAddress = evm.address;

  const safeAddress = WalletAccountReadOnlyEvmErc4337.predictSafeAddress(ownerAddress, {
    chainId: BSC_MAINNET_CHAIN_ID,
    safeModulesVersion: SAFE_MODULES_VERSION,
  });

  return {
    ownerAddress,
    safeAddress,
    chainId: BSC_MAINNET_CHAIN_ID,
  };
}

export function requireBscErc4337ReceiveAddress(): string {
  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    throw new Error("WDK_SEED is not set; cannot derive BNB Chain ERC-4337 receive address.");
  }
  return deriveBscErc4337ReceiveAddress(seed).safeAddress;
}
