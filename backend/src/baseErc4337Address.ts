/**
 * Derive the ERC-4337 Safe receive address on Base from `WDK_SEED`
 * (same owner + path as Arbitrum; chain-specific Safe deployment).
 * @see https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm-erc-4337
 */
import { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { WalletAccountReadOnlyEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";
import { DEFAULT_WDK_EVM_PATH_SUFFIX } from "./arbitrumErc4337Address.js";

export const BASE_MAINNET_CHAIN_ID = 8453;

const SAFE_MODULES_VERSION = "0.3.0" as const;

export function deriveBaseErc4337ReceiveAddress(
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
    chainId: BASE_MAINNET_CHAIN_ID,
    safeModulesVersion: SAFE_MODULES_VERSION,
  });

  return {
    ownerAddress,
    safeAddress,
    chainId: BASE_MAINNET_CHAIN_ID,
  };
}

export function requireBaseErc4337ReceiveAddress(): string {
  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    throw new Error("WDK_SEED is not set; cannot derive Base ERC-4337 receive address.");
  }
  return deriveBaseErc4337ReceiveAddress(seed).safeAddress;
}
