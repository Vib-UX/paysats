/**
 * Tether WDK ERC-4337 on Base — IDRX `burnWithAccountNumber` userOp, gas paid via Pimlico ERC-20 paymaster
 * (default gas token: Base USDC; override with BASE_PAYMASTER_TOKEN_ADDRESS).
 */
import { Interface } from "ethers";
import { WalletAccountEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";
import type { EvmErc4337WalletConfig } from "@tetherto/wdk-wallet-evm-erc-4337";
import { DEFAULT_WDK_EVM_PATH_SUFFIX } from "./arbitrumErc4337Address.js";
import { deriveBaseErc4337ReceiveAddress } from "./baseErc4337Address.js";
import { idrxBaseContractAddress } from "./idrxConfig.js";
import { LIFI_USDC_BASE } from "./lifiQuote.js";
import { log } from "./logger.js";

const PIMLICO_ERC20_PAYMASTER_V07 =
  "0x777777777777AeC03fd955926DbF81597e66834C";
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const BURN_IFACE = new Interface([
  "function burnWithAccountNumber(uint256 amount, string accountNumber) external",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForUserOpSuccess(
  wallet: WalletAccountEvmErc4337,
  userOpHash: string,
): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const r = await wallet.getUserOperationReceipt(userOpHash);
    if (r) {
      if (r.success) return;
      throw new Error(`UserOp reverted or failed: ${JSON.stringify(r)}`);
    }
    await sleep(2000);
  }
  throw new Error("Timeout waiting for user operation receipt (Base)");
}

/**
 * ERC-4337 burn returns a userOp hash; IDRX redeem expects the **bundle** L2 tx hash (EntryPoint tx).
 */
async function getBundleTxHashFromUserOp(
  bundlerUrl: string,
  userOpHash: string,
): Promise<string | null> {
  const res = await fetch(bundlerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getUserOperationReceipt",
      params: [userOpHash],
    }),
  });
  const j = (await res.json()) as {
    result?: {
      receipt?: { transactionHash?: string };
      transactionHash?: string;
    };
  };
  const txh =
    j?.result?.receipt?.transactionHash ?? j?.result?.transactionHash ?? null;
  return typeof txh === "string" && txh.startsWith("0x") ? txh : null;
}

function resolveBaseBundlerUrl(): string {
  const explicit = process.env.BASE_BUNDLER_URL?.trim();
  if (explicit) return explicit;
  const pimlico = process.env.PIMLICO_API_KEY?.trim();
  if (pimlico) {
    return `https://api.pimlico.io/v2/8453/rpc?apikey=${encodeURIComponent(pimlico)}`;
  }
  throw new Error(
    "Set BASE_BUNDLER_URL or PIMLICO_API_KEY for Base ERC-4337 (IDRX burn).",
  );
}

function resolveBasePaymasterUrl(): string {
  const explicit = process.env.BASE_PAYMASTER_URL?.trim();
  if (explicit) return explicit;
  return resolveBaseBundlerUrl();
}

function resolveBasePaymasterAddress(): string {
  return (
    process.env.BASE_PAYMASTER_ADDRESS?.trim() || PIMLICO_ERC20_PAYMASTER_V07
  );
}

function resolveBasePaymasterTokenAddress(): string {
  return process.env.BASE_PAYMASTER_TOKEN_ADDRESS?.trim() || LIFI_USDC_BASE;
}

function resolveEntryPointContractAddress(): string {
  return process.env.ENTRY_POINT_ADDRESS?.trim() || ENTRY_POINT_V07;
}

function buildBase4337Config(): EvmErc4337WalletConfig {
  const provider = process.env.BASE_RPC_URL?.trim();
  if (!provider) {
    throw new Error("BASE_RPC_URL is required for Base ERC-4337 operations.");
  }

  const bundlerUrl = resolveBaseBundlerUrl();
  const paymasterUrl = resolveBasePaymasterUrl();
  const paymasterAddress = resolveBasePaymasterAddress();
  const paymasterTokenAddress = resolveBasePaymasterTokenAddress();
  const entryPointAddress = resolveEntryPointContractAddress();

  const base = {
    chainId: 8453,
    provider,
    bundlerUrl,
    safeModulesVersion: "0.3.0",
    useNativeCoins: false as const,
    paymasterUrl,
    paymasterAddress,
    paymasterToken: { address: paymasterTokenAddress },
    entryPointAddress,
  };
  return base as EvmErc4337WalletConfig;
}

/**
 * Pimlico ERC-20 paymaster pulls the configured gas token (default USDC) from the Safe; approve if needed.
 */
async function ensurePaymasterTokenAllowance(
  wallet: WalletAccountEvmErc4337,
  paymasterAddress: string,
  gasTokenAddress: string,
): Promise<void> {
  const maxUint = (1n << 256n) - 1n;
  const allowance = await wallet.getAllowance(gasTokenAddress, paymasterAddress);
  if (allowance >= maxUint / 2n) return;

  log.info("idrx", "approving Base paymaster gas token", {
    paymasterPrefix: `${paymasterAddress.slice(0, 10)}…`,
    tokenPrefix: `${gasTokenAddress.slice(0, 10)}…`,
  });
  const { hash } = await wallet.approve({
    token: gasTokenAddress,
    spender: paymasterAddress,
    amount: maxUint,
  });
  await waitForUserOpSuccess(wallet, hash);
}

export async function burnIdrxWithBaseWdk(params: {
  seed: string;
  expectedSafeAddress: string;
  amountRaw: bigint;
  hashedAccountNumberHex: string;
}): Promise<{ txHash: string; userOpHash: string }> {
  const trimmed = params.seed.trim();
  const { safeAddress } = deriveBaseErc4337ReceiveAddress(trimmed);
  if (safeAddress.toLowerCase() !== params.expectedSafeAddress.toLowerCase()) {
    throw new Error(
      `Base Safe mismatch: derived ${safeAddress}, expected ${params.expectedSafeAddress}`,
    );
  }

  const config = buildBase4337Config();
  const wallet = new WalletAccountEvmErc4337(
    trimmed,
    DEFAULT_WDK_EVM_PATH_SUFFIX,
    config,
  );

  const addr = await wallet.getAddress();
  if (addr.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error(`WDK Base Safe address mismatch: wallet ${addr} vs ${safeAddress}`);
  }

  const paymasterAddress = resolveBasePaymasterAddress();
  const gasToken = resolveBasePaymasterTokenAddress();
  const idrx = idrxBaseContractAddress();
  await ensurePaymasterTokenAllowance(wallet, paymasterAddress, gasToken);

  const data = BURN_IFACE.encodeFunctionData("burnWithAccountNumber", [
    params.amountRaw,
    params.hashedAccountNumberHex,
  ]);

  log.info("idrx", "burnWithAccountNumber via Base WDK userOp", {
    safePrefix: `${addr.slice(0, 10)}…`,
    amountRaw: params.amountRaw.toString(),
  });

  const { hash } = await wallet.sendTransaction({
    to: idrx,
    value: 0n,
    data,
  });
  await waitForUserOpSuccess(wallet, hash);
  const bundlerUrl = resolveBaseBundlerUrl();
  const bundleTxHash = await getBundleTxHashFromUserOp(bundlerUrl, hash);
  const redeemTxHash = bundleTxHash ?? hash;
  if (!bundleTxHash) {
    log.warn("idrx", "could not resolve bundle tx hash from bundler; redeem may need manual txHash", {
      userOpHashPrefix: hash.slice(0, 18),
    });
  }
  log.info("idrx", "Base WDK burn userOp included", {
    userOpHashPrefix: hash.slice(0, 18),
    bundleTxPrefix: redeemTxHash.slice(0, 18),
  });

  return { txHash: redeemTxHash, userOpHash: hash };
}
