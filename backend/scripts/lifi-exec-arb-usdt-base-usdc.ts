/**
 * LiFi flow (matches docs: quote → allowance → approve → execute), one UserOp at a time via Tether WDK ERC-4337.
 *
 * Prerequisites:
 * - Safe on Arbitrum has enough USDT for the swap + paymaster gas (useNativeCoins: false, gas paid in USDT).
 * - ARBITRUM_RPC_URL; ARBITRUM_BUNDLER_URL or PIMLICO_API_KEY; ARBITRUM_PAYMASTER_ADDRESS (Pimlico verifying paymaster on Arbitrum).
 * - Optional ARBITRUM_PAYMASTER_URL (defaults to bundler URL); ARBITRUM_PAYMASTER_TOKEN_ADDRESS (defaults to Arbitrum USDT).
 * - Optional ARBITRUM_PAYMASTER_ADDRESS — defaults to Pimlico ERC-20 paymaster (0x7777…).
 * - Optional ENTRY_POINT_ADDRESS — defaults to EntryPoint v0.7 (not the paymaster contract).
 *
 * Usage: `npx tsx scripts/lifi-exec-arb-usdt-base-usdc.ts`
 */
import "dotenv/config";
import { WalletAccountEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";
import type { EvmErc4337WalletConfig } from "@tetherto/wdk-wallet-evm-erc-4337";
import {
  DEFAULT_WDK_EVM_PATH_SUFFIX,
  deriveArbitrumErc4337ReceiveAddress
} from "../src/arbitrumErc4337Address.js";
import { fetchLifiQuote, LIFI_USDT_ARBITRUM } from "../src/lifiQuote.js";

/** Pimlico ERC-20 paymaster (EntryPoint v0.7) — see https://docs.pimlico.io/references/paymaster/erc20-paymaster/contract-addresses */
const PIMLICO_ERC20_PAYMASTER_V07 =
  "0x777777777777AeC03fd955926DbF81597e66834C";
/** Standard EntryPoint v0.7 (pairs with paymaster above; not the same as paymaster address). */
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForUserOpSuccess(
  wallet: WalletAccountEvmErc4337,
  userOpHash: string
) {
  for (let i = 0; i < 90; i++) {
    const r = await wallet.getUserOperationReceipt(userOpHash);
    if (r) {
      if (r.success) return r;
      throw new Error(`UserOp reverted or failed: ${JSON.stringify(r)}`);
    }
    await sleep(2000);
  }
  throw new Error("Timeout waiting for user operation receipt");
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in backend/.env`);
  return v;
}

/** Pimlico chain RPC — same pattern as https://docs.pimlico.io */
function resolveArbitrumBundlerUrl(): string {
  const explicit = process.env.ARBITRUM_BUNDLER_URL?.trim();
  if (explicit) return explicit;
  const pimlico = process.env.PIMLICO_API_KEY?.trim();
  if (pimlico) {
    return `https://api.pimlico.io/v2/42161/rpc?apikey=${encodeURIComponent(pimlico)}`;
  }
  throw new Error(
    "Set ARBITRUM_BUNDLER_URL or PIMLICO_API_KEY in backend/.env"
  );
}

/** Defaults to bundler URL — Pimlico uses the same API host for gas sponsorship / token paymaster. */
function resolvePaymasterUrl(): string {
  const explicit = process.env.ARBITRUM_PAYMASTER_URL?.trim();
  if (explicit) return explicit;
  return resolveArbitrumBundlerUrl();
}

function resolvePaymasterContractAddress(): string {
  return process.env.ARBITRUM_PAYMASTER_ADDRESS?.trim() || PIMLICO_ERC20_PAYMASTER_V07;
}

function resolveEntryPointContractAddress(): string {
  return process.env.ENTRY_POINT_ADDRESS?.trim() || ENTRY_POINT_V07;
}

function build4337Config(): EvmErc4337WalletConfig {
  const provider = requireEnv("ARBITRUM_RPC_URL");
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
    entryPointAddress
  };
  return base as EvmErc4337WalletConfig;
}

async function main() {
  const apiKey = requireEnv("LIFI_API_KEY");
  const seed = requireEnv("WDK_SEED");

  const { safeAddress } = deriveArbitrumErc4337ReceiveAddress(seed);
  const fromAmount = process.env.LIFI_AMOUNT_MIN_UNITS?.trim() || "1000000";
  const need = BigInt(fromAmount);

  console.log(
    "   WDK: paymaster",
    resolvePaymasterContractAddress(),
    "| entryPoint",
    resolveEntryPointContractAddress()
  );

  const wallet = new WalletAccountEvmErc4337(
    seed,
    DEFAULT_WDK_EVM_PATH_SUFFIX,
    build4337Config()
  );

  const safeFromWallet = await wallet.getAddress();
  if (safeFromWallet.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error(`Safe mismatch: derived ${safeAddress} vs wallet ${safeFromWallet}`);
  }

  const ethWei = await wallet.getBalance();
  const usdtRaw = await wallet.getTokenBalance(LIFI_USDT_ARBITRUM);
  console.log("0) Safe balances (Arbitrum)");
  console.log("   address:", safeAddress);
  console.log("   ETH (wei, optional):", ethWei.toString());
  console.log(
    "   USDT (raw, 6 decimals) — swap + paymaster gas:",
    usdtRaw.toString()
  );
  if (usdtRaw < need) {
    throw new Error(
      `Insufficient USDT on Safe: have ${usdtRaw}, need at least ${need} for swap (${fromAmount} min units); keep extra for Pimlico gas in USDT`
    );
  }

  console.log("\n1) Quote (LiFi)…");
  const quote = await fetchLifiQuote({
    apiKey,
    safeAddress,
    fromAmount,
    slippage: process.env.LIFI_SLIPPAGE?.trim() || "0.03"
  });

  const approvalAddress = quote.estimate?.approvalAddress;
  const tr = quote.transactionRequest;
  const fromAmt = quote.action?.fromAmount;

  if (!approvalAddress || !tr?.to || !tr.data) {
    throw new Error(`Invalid quote: missing approvalAddress or transactionRequest`);
  }

  console.log("   route:", quote.tool, quote.toolDetails?.name);
  console.log("   → Base USDC (min):", quote.estimate?.toAmountMin);

  const allowance = await wallet.getAllowance(LIFI_USDT_ARBITRUM, approvalAddress);
  const needForSwap = BigInt(fromAmt ?? fromAmount);

  if (allowance < needForSwap) {
    console.log("2) Approve USDT for LiFi spender (allowance insufficient)…");
    console.log("   current:", allowance.toString(), "need:", needForSwap.toString());
    const { hash } = await wallet.approve({
      token: LIFI_USDT_ARBITRUM,
      spender: approvalAddress,
      amount: needForSwap
    });
    console.log("   userOp hash:", hash);
    await waitForUserOpSuccess(wallet, hash);
    console.log("   approve included.");
  } else {
    console.log("2) Skip approve — allowance OK:", allowance.toString());
  }

  console.log("3) Execute LiFi transactionRequest…");
  const { hash } = await wallet.sendTransaction({
    to: tr.to,
    value: BigInt(tr.value ?? "0"),
    data: tr.data
  });
  console.log("   userOp hash:", hash);
  await waitForUserOpSuccess(wallet, hash);
  console.log("   swap userOp included. Track Base USDC at the same Safe on Base.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
