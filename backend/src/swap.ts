/**
 * EVM token → Base destination token via LiFi + Tether WDK ERC-4337.
 * Paths: Arbitrum USDT, Base cbBTC, BNB Chain BTCB → Base IDRX (then IDRX burn / redeem).
 */
import { WalletAccountEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";
import type { EvmErc4337WalletConfig } from "@tetherto/wdk-wallet-evm-erc-4337";
import {
  DEFAULT_WDK_EVM_PATH_SUFFIX,
  deriveArbitrumErc4337ReceiveAddress,
} from "./arbitrumErc4337Address.js";
import { deriveBaseErc4337ReceiveAddress } from "./baseErc4337Address.js";
import { deriveBscErc4337ReceiveAddress } from "./bscErc4337Address.js";
import {
  fetchLifiQuoteCrossChain,
  LIFI_BTCB_BSC,
  LIFI_CBTC_BASE,
  LIFI_CHAIN_ARBITRUM,
  LIFI_CHAIN_BASE,
  LIFI_CHAIN_BSC,
  LIFI_IDRX_BASE,
  LIFI_USDC_BASE,
  LIFI_USDT_ARBITRUM,
  LIFI_USDT_BSC,
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

function buildArbitrum4337Config(): EvmErc4337WalletConfig {
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

function resolveBaseBundlerUrl(): string {
  const explicit = process.env.BASE_BUNDLER_URL?.trim();
  if (explicit) return explicit;
  const pimlico = process.env.PIMLICO_API_KEY?.trim();
  if (pimlico) {
    return `https://api.pimlico.io/v2/8453/rpc?apikey=${encodeURIComponent(pimlico)}`;
  }
  throw new Error(
    "Set BASE_BUNDLER_URL or PIMLICO_API_KEY for Base ERC-4337 LiFi swap",
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

function buildBase4337Config(): EvmErc4337WalletConfig {
  const provider = process.env.BASE_RPC_URL?.trim();
  if (!provider) {
    throw new Error("BASE_RPC_URL is required for Base ERC-4337 LiFi swap.");
  }

  const bundlerUrl = resolveBaseBundlerUrl();
  const paymasterUrl = resolveBasePaymasterUrl();
  const paymasterAddress = resolveBasePaymasterAddress();
  const paymasterTokenAddress =
    process.env.BASE_PAYMASTER_TOKEN_ADDRESS?.trim() || LIFI_USDC_BASE;
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

function resolveBscBundlerUrl(): string {
  const explicit = process.env.BSC_BUNDLER_URL?.trim();
  if (explicit) return explicit;
  const pimlico = process.env.PIMLICO_API_KEY?.trim();
  if (pimlico) {
    return `https://api.pimlico.io/v2/56/rpc?apikey=${encodeURIComponent(pimlico)}`;
  }
  throw new Error(
    "Set BSC_BUNDLER_URL or PIMLICO_API_KEY for BNB Chain ERC-4337 LiFi swap",
  );
}

function resolveBscPaymasterUrl(): string {
  const explicit = process.env.BSC_PAYMASTER_URL?.trim();
  if (explicit) return explicit;
  return resolveBscBundlerUrl();
}

function resolveBscPaymasterAddress(): string {
  return (
    process.env.BSC_PAYMASTER_ADDRESS?.trim() || PIMLICO_ERC20_PAYMASTER_V07
  );
}

function buildBsc4337Config(): EvmErc4337WalletConfig {
  const provider =
    process.env.BNB_RPC_URL?.trim() || process.env.BSC_RPC_URL?.trim();
  if (!provider) {
    throw new Error(
      "BNB_RPC_URL or BSC_RPC_URL is required for BNB Chain ERC-4337 LiFi swap.",
    );
  }

  const bundlerUrl = resolveBscBundlerUrl();
  const paymasterUrl = resolveBscPaymasterUrl();
  const paymasterAddress = resolveBscPaymasterAddress();
  const paymasterTokenAddress =
    process.env.BSC_PAYMASTER_TOKEN_ADDRESS?.trim() || LIFI_USDT_BSC;
  const entryPointAddress = resolveEntryPointContractAddress();

  const base = {
    chainId: 56,
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

/**
 * Generic LiFi: source chain ERC-20 → Base `toToken` (e.g. IDRX), executed on the source-chain Safe.
 */
async function runLifiEvmToBaseToken(params: {
  lifiFromChain: string;
  fromToken: string;
  fromAmountMinUnits: string;
  walletAddress: string;
  toToken: string;
  toAddress: string;
  destDecimals: number;
  maxDestHuman: number;
  minDestHuman?: number;
  logLabel: string;
  build4337Config: () => EvmErc4337WalletConfig;
  expectedSafeFromSeed: (seed: string) => string;
}): Promise<{
  destAmountHuman: number;
  destAmountMinRaw: string;
  txHash: string;
}> {
  if (!params.walletAddress?.trim()) {
    throw new Error("Missing wallet address for LiFi swap.");
  }

  const apiKey = process.env.LIFI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("LIFI_API_KEY is not set; cannot execute LiFi swap.");
  }

  const seed = process.env.WDK_SEED?.trim();
  if (!seed) {
    throw new Error("WDK_SEED is not set; cannot execute ERC-4337 swap.");
  }

  const safeAddress = params.expectedSafeFromSeed(seed);
  if (safeAddress.toLowerCase() !== params.walletAddress.trim().toLowerCase()) {
    throw new Error(
      `walletAddress must match WDK Safe for this chain (expected ${safeAddress}, got ${params.walletAddress})`,
    );
  }

  const fromAmount = params.fromAmountMinUnits.trim();
  if (!fromAmount || BigInt(fromAmount) <= 0n) {
    throw new Error("fromAmountMinUnits must be a positive integer string.");
  }

  const quote = await fetchLifiQuoteCrossChain({
    apiKey,
    fromChain: params.lifiFromChain,
    toChain: LIFI_CHAIN_BASE,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAddress: safeAddress,
    toAddress: params.toAddress,
    fromAmount,
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
    params.build4337Config(),
  );

  const safeFromWallet = await wallet.getAddress();
  if (safeFromWallet.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error(
      `Safe mismatch: derived ${safeAddress} vs wallet ${safeFromWallet}`,
    );
  }

  const need = BigInt(fromAmount);
  const balanceRaw = await wallet.getTokenBalance(params.fromToken);
  if (BigInt(balanceRaw) < need) {
    throw new Error(
      `Insufficient token on Safe: have ${balanceRaw}, need at least ${need} (min units ${fromAmount}); keep extra for paymaster gas`,
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
    params.fromToken,
    approvalAddress,
  );
  const needForSwap = BigInt(fromAmt ?? fromAmount);

  if (allowance < needForSwap) {
    log.info("swap", "approving token for LiFi spender", {
      current: allowance.toString(),
      need: needForSwap.toString(),
    });
    const { hash } = await wallet.approve({
      token: params.fromToken,
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

  const fromAmount =
    params.fromAmountMinUnits?.trim() ||
    String(Math.max(1, Math.floor(params.usdtAmount * 1e6)));

  return runLifiEvmToBaseToken({
    lifiFromChain: LIFI_CHAIN_ARBITRUM,
    fromToken: LIFI_USDT_ARBITRUM,
    fromAmountMinUnits: fromAmount,
    walletAddress: params.walletAddress,
    toToken: params.toToken,
    toAddress: params.toAddress,
    destDecimals: params.destDecimals,
    maxDestHuman: params.maxDestHuman,
    minDestHuman: params.minDestHuman,
    logLabel: params.logLabel,
    build4337Config: buildArbitrum4337Config,
    expectedSafeFromSeed: (s) => deriveArbitrumErc4337ReceiveAddress(s).safeAddress,
  });
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

/** cbBTC on Base → Base IDRX via LiFi (same-chain or routed); Safe must hold cbBTC + USDC for gas. */
export async function executeCbbtcToIdrxOnBase(params: {
  walletAddress: string;
  /** Whole BTC units (cbBTC, 8 decimals). */
  cbbtcAmount?: number;
  /** Raw amount in smallest units (8 decimals); overrides cbbtcAmount when set. */
  fromAmountMinUnits?: string;
}): Promise<{
  idrxAmountIdr: number;
  idrxAmountMinRaw: string;
  txHash: string;
}> {
  const decimals = await readIdrxDecimalsOnBase();
  const toAddress = idrxBaseRecipientAddress();

  const fromAmount =
    params.fromAmountMinUnits?.trim() ||
    (params.cbbtcAmount != null && params.cbbtcAmount > 0
      ? String(Math.max(1, Math.floor(params.cbbtcAmount * 1e8)))
      : "");
  if (!fromAmount) {
    throw new Error("Set cbbtcAmount or fromAmountMinUnits (cbBTC, 8 decimals).");
  }

  const r = await runLifiEvmToBaseToken({
    lifiFromChain: LIFI_CHAIN_BASE,
    fromToken: LIFI_CBTC_BASE,
    fromAmountMinUnits: fromAmount,
    walletAddress: params.walletAddress,
    toToken: LIFI_IDRX_BASE,
    toAddress,
    destDecimals: decimals,
    maxDestHuman: IDRX_MAX_ORDER_IDR,
    minDestHuman: IDRX_MIN_REDEEM_IDR,
    logLabel: "cbBTC→IDRX(Base)",
    build4337Config: buildBase4337Config,
    expectedSafeFromSeed: (s) => deriveBaseErc4337ReceiveAddress(s).safeAddress,
  });

  return {
    idrxAmountIdr: r.destAmountHuman,
    idrxAmountMinRaw: r.destAmountMinRaw,
    txHash: r.txHash,
  };
}

/** BTCB on BNB Chain → Base IDRX via LiFi; Safe must hold BTCB + BSC USDT for gas. */
export async function executeBtcbToIdrxFromBsc(params: {
  walletAddress: string;
  /** Whole BTC units (BTCB uses 18 decimals on BSC). */
  btcbAmount?: number;
  fromAmountMinUnits?: string;
}): Promise<{
  idrxAmountIdr: number;
  idrxAmountMinRaw: string;
  txHash: string;
}> {
  const decimals = await readIdrxDecimalsOnBase();
  const toAddress = idrxBaseRecipientAddress();

  const fromAmount =
    params.fromAmountMinUnits?.trim() ||
    (params.btcbAmount != null && params.btcbAmount > 0
      ? (() => {
          const raw = BigInt(Math.floor(params.btcbAmount * 1e18));
          return (raw < 1n ? "1" : raw.toString());
        })()
      : "");
  if (!fromAmount) {
    throw new Error("Set btcbAmount or fromAmountMinUnits (BTCB, 18 decimals).");
  }

  const r = await runLifiEvmToBaseToken({
    lifiFromChain: LIFI_CHAIN_BSC,
    fromToken: LIFI_BTCB_BSC,
    fromAmountMinUnits: fromAmount,
    walletAddress: params.walletAddress,
    toToken: LIFI_IDRX_BASE,
    toAddress,
    destDecimals: decimals,
    maxDestHuman: IDRX_MAX_ORDER_IDR,
    minDestHuman: IDRX_MIN_REDEEM_IDR,
    logLabel: "BTCB→IDRX(BSC→Base)",
    build4337Config: buildBsc4337Config,
    expectedSafeFromSeed: (s) => deriveBscErc4337ReceiveAddress(s).safeAddress,
  });

  return {
    idrxAmountIdr: r.destAmountHuman,
    idrxAmountMinRaw: r.destAmountMinRaw,
    txHash: r.txHash,
  };
}
