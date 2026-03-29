/**
 * Derive the ERC-4337 Safe (account-abstraction) receive address on Arbitrum One from `WDK_SEED`,
 * using Tether WDK: EOA from `WalletAccountEvm`, then `WalletAccountReadOnlyEvmErc4337.predictSafeAddress`.
 * @see https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm-erc-4337
 */
import { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { WalletAccountReadOnlyEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";

export const ARBITRUM_ONE_CHAIN_ID = 42161;

/** BIP-44 path segment after `m/44'/60'/` (default first account). */
export const DEFAULT_WDK_EVM_PATH_SUFFIX = "0'/0/0";

const DEFAULT_DERIVATION = DEFAULT_WDK_EVM_PATH_SUFFIX;

const SAFE_MODULES_VERSION = "0.3.0" as const;

export function deriveArbitrumErc4337ReceiveAddress(
  seedPhrase: string,
  pathSuffix: string = DEFAULT_DERIVATION
): { ownerAddress: string; safeAddress: string; chainId: number } {
  const trimmed = seedPhrase.trim();
  if (!trimmed) {
    throw new Error("WDK_SEED is empty.");
  }

  const evm = new WalletAccountEvm(trimmed, pathSuffix, {});
  const ownerAddress = evm.address;

  const safeAddress = WalletAccountReadOnlyEvmErc4337.predictSafeAddress(ownerAddress, {
    chainId: ARBITRUM_ONE_CHAIN_ID,
    safeModulesVersion: SAFE_MODULES_VERSION
  });

  return {
    ownerAddress,
    safeAddress,
    chainId: ARBITRUM_ONE_CHAIN_ID
  };
}

export function requireArbitrumReceiveAddress(): string {
  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    throw new Error("WDK_SEED is not set; cannot derive Arbitrum ERC-4337 receive address.");
  }
  return deriveArbitrumErc4337ReceiveAddress(seed).safeAddress;
}
