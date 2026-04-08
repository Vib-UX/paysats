/**
 * Arbitrum USDT → Base destination token via LiFi + Tether WDK ERC-4337.
 */
import { WalletAccountEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";
import type { EvmErc4337WalletConfig } from "@tetherto/wdk-wallet-evm-erc-4337";
import {
  DEFAULT_WDK_EVM_PATH_SUFFIX,
  deriveArbitrumErc4337ReceiveAddress,
} from "./arbitrumErc4337Address.js";
import {
  fetchLifiQuote,
  LIFI_IDRX_BASE,
  LIFI_USDT_ARBITRUM,
  LIFI_USDC_BASE,
} from "./lifiQuote.js";
import { readIdrxDecimalsOnBase } from "./idrxBurn.js";
import { idrxBaseRecipientAddress } from "./idrxConfig.js";
import { log } from "./logger.js";

const USDC_ORDER_CAP = 100;

const IDRX_MIN_REDEEM_IDR =
  Number(process.env.IDRX_MIN_REDEEM_IDR?.trim() || "20000") || 20_000;
const IDRX_MAX_ORDER_IDR =
  Number(process.env.IDRX_MAX_ORDER_IDR?.trim() || "1000000000") || 1_000_000_000;

/** Pimlico ERC-20 paymaster (EntryPoint v0.7) */
const PIMLICO_ERC20_PAYMASTER_V07 =
  "0x777777777777AeC03fd955926DbF81597e66834C";
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/** Default Base USDC recipient when `LIFI_TO_ADDRESS` is unset. */
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

function rawToHuman(
  estimateToAmount: string | undefined,
  decimals: number,
): number {
  if (!estimateToAmount) return 0;
  const raw = BigInt(estimateToAmount);
  return Number(raw) / 10 ** decimals;
}

async function runLifiArbUsdtToBaseToken(params: {
  usdtAmount: number;
  /** Raw USDT amount in 6 decimals; overrides floor(usdtAmount * 1e6) when set. */
  fromAmountMinUnits?: string;
  walletAddress: string;
  toToken: string;
  toAddress: string;
  destDecimals: number;
  maxDestHuman: number;
  minDestHuman?: number;
  logLabel: string;
}): Promise<{
  destAmountHuman: number;
  destAmountMinRaw: string;
  txHash: string;
}> {
  if (params.usdtAmount <= 0) {
    throw new Error("USDT amount must be greater than zero.");
  }
  if (!params.walletAddress?.trim()) {
    throw new Error("Missing wallet address for USDT -> destination swap.");
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

  const quote = await fetchLifiQuote({
    apiKey,
    fromAddress: safeAddress,
    toAddress: params.toAddress,
    fromAmount,
    toToken: params.toToken,
    slippage: process.env.LIFI_SLIPPAGE?.trim() || "0.03",
  });

  const humanMin = rawToHuman(quote.estimate?.toAmountMin, params.destDecimals);
  const humanEst = rawToHuman(quote.estimate?.toAmount, params.destDecimals);

  if (params.minDestHuman != null && humanMin + 1e-12 < params.minDestHuman) {
    throw new Error(
      `LiFi ${params.logLabel} toAmountMin (${humanMin}) is below minimum (${params.minDestHuman} IDR).`,
    );
  }
  if (humanEst > params.maxDestHuman + 1e-9) {
    throw new Error(
      `LiFi ${params.logLabel} estimate (${humanEst}) exceeds cap (${params.maxDestHuman}).`,
    );
  }

  log.info("swap", `WDK+LiFi swap start (${params.logLabel})`, {
    safePrefix: `${safeAddress.slice(0, 10)}…${safeAddress.slice(-6)}`,
    toPrefix: `${params.toAddress.slice(0, 10)}…${params.toAddress.slice(-6)}`,
    fromAmountMinUnits: fromAmount,
    humanMin,
    humanEst,
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

  const approvalAddress = quote.estimate?.approvalAddress;
  const tr = quote.transactionRequest;
  const fromAmt = quote.action?.fromAmount;

  if (!approvalAddress || !tr?.to || !tr.data) {
    throw new Error(
      "Invalid LiFi quote: missing approvalAddress or transactionRequest",
    );
  }

  log.info("swap", "LiFi quote ok", {
    label: params.logLabel,
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

  log.info("swap", "executing LiFi transactionRequest", {
    label: params.logLabel,
  });
  const { hash: swapHash } = await wallet.sendTransaction({
    to: tr.to,
    value: BigInt(tr.value ?? "0"),
    data: tr.data,
  });
  await waitForUserOpSuccess(wallet, swapHash);
  log.info("swap", "swap userOp included", {
    userOpHashPrefix: swapHash.slice(0, 18),
  });

  const destAmountHuman =
    rawToHuman(quote.estimate?.toAmount, params.destDecimals) ||
    rawToHuman(quote.estimate?.toAmountMin, params.destDecimals);

  const destAmountMinRaw = quote.estimate?.toAmountMin ?? "0";

  return {
    destAmountHuman,
    destAmountMinRaw,
    txHash: swapHash,
  };
}

export async function executeUsdtToUsdcSwap(params: {
  usdtAmount: number;
  walletAddress: string;
  fromAmountMinUnits?: string;
  toAddress?: string;
}): Promise<{ usdcAmount: number; txHash: string }> {
  if (params.usdtAmount > USDC_ORDER_CAP) {
    throw new Error("Hard cap exceeded: maximum 100 USDC per order.");
  }

  const toAddress =
    params.toAddress?.trim() ||
    process.env.LIFI_TO_ADDRESS?.trim() ||
    LIFI_DEFAULT_TO_ADDRESS;

  const fromAmtStr =
    params.fromAmountMinUnits?.trim() ||
    String(Math.max(1, Math.floor(params.usdtAmount * 1e6)));
  const usdtEff = Number(fromAmtStr) / 1e6;
  if (!Number.isFinite(usdtEff) || usdtEff > USDC_ORDER_CAP) {
    throw new Error("Hard cap exceeded: maximum 100 USDC per order.");
  }

  const r = await runLifiArbUsdtToBaseToken({
    usdtAmount: params.usdtAmount,
    fromAmountMinUnits: params.fromAmountMinUnits,
    walletAddress: params.walletAddress,
    toToken: LIFI_USDC_BASE,
    toAddress,
    destDecimals: 6,
    maxDestHuman: USDC_ORDER_CAP,
    logLabel: "USDT→USDC",
  });

  return { usdcAmount: r.destAmountHuman, txHash: r.txHash };
}

export async function executeUsdtToIdrxOnBase(params: {
  usdtAmount: number;
  walletAddress: string;
}): Promise<{
  idrxAmountIdr: number;
  idrxAmountMinRaw: string;
  txHash: string;
}> {
  const decimals = await readIdrxDecimalsOnBase();
  const toAddress = idrxBaseRecipientAddress();

  const r = await runLifiArbUsdtToBaseToken({
    usdtAmount: params.usdtAmount,
    walletAddress: params.walletAddress,
    toToken: LIFI_IDRX_BASE,
    toAddress,
    destDecimals: decimals,
    maxDestHuman: IDRX_MAX_ORDER_IDR,
    minDestHuman: IDRX_MIN_REDEEM_IDR,
    logLabel: "USDT→IDRX(Base)",
  });

  return {
    idrxAmountIdr: r.destAmountHuman,
    idrxAmountMinRaw: r.destAmountMinRaw,
    txHash: r.txHash,
  };
}
