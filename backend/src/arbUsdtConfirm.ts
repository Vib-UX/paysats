import { WalletAccountEvmErc4337 } from "@tetherto/wdk-wallet-evm-erc-4337";
import type { EvmErc4337WalletConfig } from "@tetherto/wdk-wallet-evm-erc-4337";
import { DEFAULT_WDK_EVM_PATH_SUFFIX } from "./arbitrumErc4337Address.js";
import { LIFI_USDT_ARBITRUM } from "./lifiQuote.js";
import { log } from "./logger.js";

/** Pimlico ERC-20 paymaster (EntryPoint v0.7) — see https://docs.pimlico.io/references/paymaster/erc20-paymaster/contract-addresses */
const PIMLICO_ERC20_PAYMASTER_V07 = "0x777777777777AeC03fd955926DbF81597e66834C";
/** Standard EntryPoint v0.7 (pairs with paymaster above; not the same as paymaster address). */
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveArbitrumBundlerUrl(): string {
  const explicit = process.env.ARBITRUM_BUNDLER_URL?.trim();
  if (explicit) return explicit;
  const pimlico = process.env.PIMLICO_API_KEY?.trim();
  if (pimlico) {
    return `https://api.pimlico.io/v2/42161/rpc?apikey=${encodeURIComponent(pimlico)}`;
  }
  // For read-only balance checks, bundler isn't strictly needed, but WDK config requires it.
  // Fall back to RPC URL if present.
  const rpc = process.env.ARBITRUM_RPC_URL?.trim();
  if (rpc) return rpc;
  throw new Error("Set ARBITRUM_BUNDLER_URL or PIMLICO_API_KEY (or ARBITRUM_RPC_URL) to confirm Arbitrum USDT balance");
}

function resolvePaymasterUrl(): string {
  const explicit = process.env.ARBITRUM_PAYMASTER_URL?.trim();
  if (explicit) return explicit;
  return resolveArbitrumBundlerUrl();
}

function build4337Config(): EvmErc4337WalletConfig {
  const provider = process.env.ARBITRUM_RPC_URL?.trim();
  if (!provider) throw new Error("ARBITRUM_RPC_URL is required to confirm Arbitrum USDT balance");

  const bundlerUrl = resolveArbitrumBundlerUrl();
  const paymasterUrl = resolvePaymasterUrl();
  const paymasterAddress = process.env.ARBITRUM_PAYMASTER_ADDRESS?.trim() || PIMLICO_ERC20_PAYMASTER_V07;
  const paymasterTokenAddress = process.env.ARBITRUM_PAYMASTER_TOKEN_ADDRESS?.trim() || LIFI_USDT_ARBITRUM;
  const entryPointAddress = process.env.ENTRY_POINT_ADDRESS?.trim() || ENTRY_POINT_V07;

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

export async function getArbitrumSafeUsdtBalanceRaw(params: { seed: string; usdtTokenAddress?: string }): Promise<bigint> {
  const wallet = new WalletAccountEvmErc4337(params.seed, DEFAULT_WDK_EVM_PATH_SUFFIX, build4337Config());
  const token = params.usdtTokenAddress?.trim() || LIFI_USDT_ARBITRUM;
  const bal = await wallet.getTokenBalance(token);
  return BigInt(bal);
}

export async function waitForArbitrumUsdtBalance(params: {
  orderId: string;
  seed: string;
  /** initial balance raw (6 decimals). If provided, we require balance > initial. */
  startBalanceRaw?: bigint;
  /** If provided, we require balance >= this target. */
  targetMinRaw?: bigint;
  maxWaitMs?: number;
  pollMs?: number;
}): Promise<{ balanceRaw: bigint; satisfied: boolean }> {
  const maxWaitMs = Math.max(0, params.maxWaitMs ?? 180_000);
  const pollMs = Math.max(500, params.pollMs ?? 5_000);
  const deadline = Date.now() + maxWaitMs;

  let last: bigint = -1n;
  while (Date.now() <= deadline) {
    try {
      const bal = await getArbitrumSafeUsdtBalanceRaw({ seed: params.seed });
      last = bal;
      const gtStart = params.startBalanceRaw !== undefined ? bal > params.startBalanceRaw : true;
      const meetsTarget = params.targetMinRaw !== undefined ? bal >= params.targetMinRaw : true;
      const satisfied = gtStart && meetsTarget;

      log.info("pipeline", "Arbitrum USDT balance poll", {
        orderId: params.orderId,
        balanceRaw: bal.toString(),
        startBalanceRaw: params.startBalanceRaw?.toString() ?? null,
        targetMinRaw: params.targetMinRaw?.toString() ?? null,
        satisfied
      });

      if (satisfied) return { balanceRaw: bal, satisfied: true };
    } catch (e) {
      log.warn("pipeline", "Arbitrum USDT balance poll failed (retrying)", {
        orderId: params.orderId,
        error: e instanceof Error ? e.message : String(e)
      });
    }
    await sleep(pollMs);
  }

  if (last >= 0n) {
    return { balanceRaw: last, satisfied: false };
  }
  return { balanceRaw: 0n, satisfied: false };
}

