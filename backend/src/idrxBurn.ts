import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { idrxBaseContractAddress, requireBaseRpcUrl } from "./idrxConfig.js";
import { log } from "./logger.js";

const IDRX_MIN_ABI = [
  "function burnWithAccountNumber(uint256 amount, string accountNumber) external",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
] as const;

let cachedDecimals: number | null = null;

export async function readIdrxDecimalsOnBase(): Promise<number> {
  if (cachedDecimals != null) return cachedDecimals;
  const explicit = process.env.IDRX_DECIMALS?.trim();
  if (explicit) {
    const n = Number(explicit);
    if (Number.isFinite(n) && n >= 0 && n <= 36) {
      cachedDecimals = n;
      return n;
    }
  }
  const provider = new JsonRpcProvider(requireBaseRpcUrl());
  const c = new Contract(idrxBaseContractAddress(), IDRX_MIN_ABI, provider);
  const d = Number(await c.decimals());
  if (!Number.isFinite(d) || d < 0 || d > 36) {
    throw new Error(`Invalid IDRX decimals() on Base: ${d}`);
  }
  cachedDecimals = d;
  return d;
}

export function rawToIdrxHuman(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

export async function waitForIdrxBalance(params: {
  holderAddress: string;
  minRaw: bigint;
  maxWaitMs: number;
  pollMs: number;
}): Promise<bigint> {
  const provider = new JsonRpcProvider(requireBaseRpcUrl());
  const c = new Contract(idrxBaseContractAddress(), IDRX_MIN_ABI, provider);
  const deadline = Date.now() + params.maxWaitMs;
  let last = 0n;
  while (Date.now() < deadline) {
    const bal = BigInt(await c.balanceOf(params.holderAddress));
    last = bal;
    if (bal >= params.minRaw) {
      log.info("idrx", "Base IDRX balance ready", {
        holderPrefix: `${params.holderAddress.slice(0, 10)}…`,
        raw: bal.toString(),
      });
      return bal;
    }
    await new Promise((r) => setTimeout(r, params.pollMs));
  }
  throw new Error(
    `Timeout waiting for IDRX on Base: have ${last.toString()} min ${params.minRaw.toString()}`,
  );
}

export async function burnIdrxWithAccountNumber(params: {
  privateKey: string;
  amountRaw: bigint;
  /** sha256 hex string passed to the contract (UTF-8 hash of bank binding string). */
  hashedAccountNumberHex: string;
}): Promise<{ txHash: string }> {
  const provider = new JsonRpcProvider(requireBaseRpcUrl());
  const wallet = new Wallet(params.privateKey, provider);
  const c = new Contract(idrxBaseContractAddress(), IDRX_MIN_ABI, wallet);

  log.info("idrx", "burnWithAccountNumber", {
    from: `${wallet.address.slice(0, 10)}…`,
    amountRaw: params.amountRaw.toString(),
  });

  const tx = await c.burnWithAccountNumber(params.amountRaw, params.hashedAccountNumberHex);
  const receipt = await tx.wait();
  const hash = receipt?.hash ?? tx.hash;
  if (!hash) throw new Error("Burn transaction has no hash");
  log.info("idrx", "burn confirmed", { txHash: hash });
  return { txHash: hash };
}
