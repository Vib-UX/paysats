/**
 * Arbitrum USDT → Base USDC via LiFi + Tether WDK ERC-4337 (same flow as scripts/lifi-exec-arb-usdt-base-usdc.ts).
 */
import { WalletAccountEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";
import type { EvmErc4337WalletConfig } from "@tetherto/wdk-wallet-evm-erc-4337";
import {
  DEFAULT_WDK_EVM_PATH_SUFFIX,
  deriveArbitrumErc4337ReceiveAddress,
} from "./arbitrumErc4337Address.js";
import { fetchLifiQuote, LIFI_USDT_ARBITRUM } from "./lifiQuote.js";
import { log } from "./logger.js";

const USDC_ORDER_CAP = 100;

/** Pimlico ERC-20 paymaster (EntryPoint v0.7) */
const PIMLICO_ERC20_PAYMASTER_V07 =
  "0x777777777777AeC03fd955926DbF81597e66834C";
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/** Default Base USDC recipient when `LIFI_TO_ADDRESS` is unset (matches offramp pipeline). */
const LIFI_DEFAULT_TO_ADDRESS = "0x8A42b6Ba4f44cA186fb9Fc748beBDB3270C9aCb7";

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
  throw new Error("Timeout waiting for user operation receipt");
}

function resolveArbitrumBundlerUrl(): string {
  const explicit = process.env.ARBITRUM_BUNDLER_URL?.trim();
  if (explicit) return explicit;
  const pimlico = process.env.PIMLICO_API_KEY?.trim();
  if (pimlico) {
    return `https://api.pimlico.io/v2/42161/rpc?apikey=${encodeURIComponent(pimlico)}`;
  }
  throw new Error(
    "Set ARBITRUM_BUNDLER_URL or PIMLICO_API_KEY for WDK+LiFi swap",
  );
}

function resolvePaymasterUrl(): string {
  const explicit = process.env.ARBITRUM_PAYMASTER_URL?.trim();
  if (explicit) return explicit;
  return resolveArbitrumBundlerUrl();
}

function resolvePaymasterContractAddress(): string {
  return (
    process.env.ARBITRUM_PAYMASTER_ADDRESS?.trim() ||
    PIMLICO_ERC20_PAYMASTER_V07
  );
}

function resolveEntryPointContractAddress(): string {
  return process.env.ENTRY_POINT_ADDRESS?.trim() || ENTRY_POINT_V07;
}

function build4337Config(): EvmErc4337WalletConfig {
  const provider = process.env.ARBITRUM_RPC_URL?.trim();
  if (!provider)
    throw new Error("ARBITRUM_RPC_URL is required for WDK+LiFi swap");

  const bundlerUrl = resolveArbitrumBundlerUrl();
  const paymasterUrl = resolvePaymasterUrl();
  const paymasterAddress = resolvePaymasterContractAddress();
  const paymasterTokenAddress =
    process.env.ARBITRUM_PAYMASTER_TOKEN_ADDRESS?.trim() || LIFI_USDT_ARBITRUM;
  const entryPointAddress = resolveEntryPointContractAddress();

  const base = {
    chainId: 42161,
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

function toUsdcHuman(estimateToAmount: string | undefined): number {
  if (!estimateToAmount) return 0;
  const raw = BigInt(estimateToAmount);
  return Number(raw) / 1e6;
}

export async function executeUsdtToUsdcSwap(params: {
  usdtAmount: number;
  walletAddress: string;
  /** Raw fromAmount for LiFi (6 decimals). Overrides floor(usdtAmount * 1e6) when set. */
  fromAmountMinUnits?: string;
  /** Quote recipient on Base; defaults to `LIFI_TO_ADDRESS` env or pipeline default. */
  toAddress?: string;
}): Promise<{ usdcAmount: number; txHash: string }> {
  if (params.usdtAmount <= 0) {
    throw new Error("USDT amount must be greater than zero.");
  }
  if (params.usdtAmount > USDC_ORDER_CAP) {
    throw new Error("Hard cap exceeded: maximum 100 USDC per order.");
  }
  if (!params.walletAddress?.trim()) {
    throw new Error("Missing wallet address for USDT -> USDC swap.");
  }

  const apiKey = process.env.LIFI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("LIFI_API_KEY is not set; cannot execute LiFi swap.");
  }

  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    throw new Error("WDK_SEED is not set; cannot execute ERC-4337 swap.");
  }

  const { safeAddress } = deriveArbitrumErc4337ReceiveAddress(seed);
  if (safeAddress.toLowerCase() !== params.walletAddress.trim().toLowerCase()) {
    throw new Error(
      `walletAddress must match WDK Safe on Arbitrum (expected ${safeAddress}, got ${params.walletAddress})`,
    );
  }

  const fromAmount =
    params.fromAmountMinUnits?.trim() ||
    String(Math.max(1, Math.floor(params.usdtAmount * 1e6)));

  const toAddress =
    params.toAddress?.trim() ||
    process.env.LIFI_TO_ADDRESS?.trim() ||
    LIFI_DEFAULT_TO_ADDRESS;

  log.info("swap", "WDK+LiFi swap start", {
    safePrefix: `${safeAddress.slice(0, 10)}…${safeAddress.slice(-6)}`,
    toPrefix: `${toAddress.slice(0, 10)}…${toAddress.slice(-6)}`,
    fromAmountMinUnits: fromAmount,
    paymaster: resolvePaymasterContractAddress(),
  });

  const wallet = new WalletAccountEvmErc4337(
    seed,
    DEFAULT_WDK_EVM_PATH_SUFFIX,
    build4337Config(),
  );

  const safeFromWallet = await wallet.getAddress();
  if (safeFromWallet.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error(
      `Safe mismatch: derived ${safeAddress} vs wallet ${safeFromWallet}`,
    );
  }

  const need = BigInt(fromAmount);
  const usdtRaw = await wallet.getTokenBalance(LIFI_USDT_ARBITRUM);
  if (BigInt(usdtRaw) < need) {
    throw new Error(
      `Insufficient USDT on Safe: have ${usdtRaw}, need at least ${need} (min units ${fromAmount}); keep extra for paymaster gas`,
    );
  }

  const quote = await fetchLifiQuote({
    apiKey,
    fromAddress: safeAddress,
    toAddress,
    fromAmount,
    slippage: process.env.LIFI_SLIPPAGE?.trim() || "0.03",
  });

  const approvalAddress = quote.estimate?.approvalAddress;
  const tr = quote.transactionRequest;
  const fromAmt = quote.action?.fromAmount;

  if (!approvalAddress || !tr?.to || !tr.data) {
    throw new Error(
      "Invalid LiFi quote: missing approvalAddress or transactionRequest",
    );
  }

  log.info("swap", "LiFi quote ok", {
    tool: quote.toolDetails?.name || quote.tool,
    toAmountMin: quote.estimate?.toAmountMin,
    toAmount: quote.estimate?.toAmount,
  });

  const allowance = await wallet.getAllowance(
    LIFI_USDT_ARBITRUM,
    approvalAddress,
  );
  const needForSwap = BigInt(fromAmt ?? fromAmount);

  if (allowance < needForSwap) {
    log.info("swap", "approving USDT for LiFi spender", {
      current: allowance.toString(),
      need: needForSwap.toString(),
    });
    const { hash } = await wallet.approve({
      token: LIFI_USDT_ARBITRUM,
      spender: approvalAddress,
      amount: needForSwap,
    });
    await waitForUserOpSuccess(wallet, hash);
    log.info("swap", "approve userOp included", {
      userOpHashPrefix: hash.slice(0, 18),
    });
  }

  log.info("swap", "executing LiFi transactionRequest");
  const { hash: swapHash } = await wallet.sendTransaction({
    to: tr.to,
    value: BigInt(tr.value ?? "0"),
    data: tr.data,
  });
  await waitForUserOpSuccess(wallet, swapHash);
  log.info("swap", "swap userOp included", {
    userOpHashPrefix: swapHash.slice(0, 18),
  });

  const usdcAmount =
    toUsdcHuman(quote.estimate?.toAmount) ||
    toUsdcHuman(quote.estimate?.toAmountMin);

  return {
    usdcAmount,
    txHash: swapHash,
  };
}
