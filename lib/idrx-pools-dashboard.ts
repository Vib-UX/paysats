/**
 * IDRX DEX pool snapshots via DexScreener (public API).
 * Shared by Next.js route handler; Base / shared EVM / Solana mints as documented by IDRX.
 */

const DEX_SCREENER = "https://api.dexscreener.com/latest/dex/tokens";

const IDRX_BASE = "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22";
const IDRX_EVM_SHARED = "0x649a2DA7B28E0D54c13D5eFf95d3A660652742cC";
const IDRX_SOLANA = "idrxZcP8xiKkYk6XGD4uz1dxEYCWSgKDHqgjsBbwDur";

const TARGET_CHAINS = new Set(["base", "polygon", "bsc", "solana"]);

export type IdrxPoolRow = {
  dexId: string;
  pairLabel: string;
  liquidityUsd: number;
  volumeH24Usd: number;
  url: string;
};

export type IdrxChainSnapshot = {
  chainId: string;
  label: string;
  totalLiquidityUsd: number;
  totalVolumeH24Usd: number;
  pools: IdrxPoolRow[];
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  baseToken?: { symbol?: string; name?: string };
  quoteToken?: { symbol?: string; name?: string };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
};

function pairLabel(p: DexPair): string {
  const b = p.baseToken?.symbol || p.baseToken?.name || "?";
  const q = p.quoteToken?.symbol || p.quoteToken?.name || "?";
  return `${b} / ${q}`;
}

async function fetchPairs(token: string): Promise<DexPair[]> {
  const url = `${DEX_SCREENER}/${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`DexScreener ${res.status} for ${token.slice(0, 12)}…`);
  }
  const body = (await res.json()) as { pairs?: DexPair[] };
  return Array.isArray(body.pairs) ? body.pairs : [];
}

function aggregateByChain(pairs: DexPair[]): Map<string, DexPair[]> {
  const by = new Map<string, DexPair[]>();
  for (const p of pairs) {
    const cid = String(p.chainId || "").toLowerCase();
    if (!TARGET_CHAINS.has(cid)) continue;
    const list = by.get(cid) ?? [];
    list.push(p);
    by.set(cid, list);
  }
  return by;
}

function toSnapshot(chainId: string, pairs: DexPair[]): IdrxChainSnapshot {
  const label =
    chainId === "base"
      ? "Base"
      : chainId === "polygon"
        ? "Polygon"
        : chainId === "bsc"
          ? "BNB Chain"
          : chainId === "solana"
            ? "Solana"
            : chainId;

  const rows: IdrxPoolRow[] = pairs.map((p) => ({
    dexId: String(p.dexId || "unknown"),
    pairLabel: pairLabel(p),
    liquidityUsd: Math.max(0, Number(p.liquidity?.usd) || 0),
    volumeH24Usd: Math.max(0, Number(p.volume?.h24) || 0),
    url: String(p.url || "")
  }));

  rows.sort((a, b) => b.liquidityUsd - a.liquidityUsd);

  const totalLiquidityUsd = rows.reduce((s, r) => s + r.liquidityUsd, 0);
  const totalVolumeH24Usd = rows.reduce((s, r) => s + r.volumeH24Usd, 0);

  return {
    chainId,
    label,
    totalLiquidityUsd,
    totalVolumeH24Usd,
    pools: rows
  };
}

const CHAIN_ORDER = ["base", "polygon", "bsc", "solana"] as const;

export async function fetchIdrxPoolDashboard(): Promise<{
  chains: IdrxChainSnapshot[];
  fetchedAt: string;
  source: string;
}> {
  const [basePairs, evmPairs, solPairs] = await Promise.all([
    fetchPairs(IDRX_BASE),
    fetchPairs(IDRX_EVM_SHARED),
    fetchPairs(IDRX_SOLANA)
  ]);

  const merged = [...basePairs, ...evmPairs, ...solPairs];
  const byChain = aggregateByChain(merged);

  const chains: IdrxChainSnapshot[] = [];
  for (const cid of CHAIN_ORDER) {
    const list = byChain.get(cid);
    if (list?.length) chains.push(toSnapshot(cid, list));
    else
      chains.push({
        chainId: cid,
        label:
          cid === "base"
            ? "Base"
            : cid === "polygon"
              ? "Polygon"
              : cid === "bsc"
                ? "BNB Chain"
                : "Solana",
        totalLiquidityUsd: 0,
        totalVolumeH24Usd: 0,
        pools: []
      });
  }

  return {
    chains,
    fetchedAt: new Date().toISOString(),
    source: "dexscreener"
  };
}
