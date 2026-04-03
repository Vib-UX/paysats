"use client";

import { useCallback, useEffect, useState } from "react";
import { IdrxMark } from "@/components/idrx-mark";

type IdrxPoolRow = {
  dexId: string;
  pairLabel: string;
  liquidityUsd: number;
  volumeH24Usd: number;
  url: string;
};

type IdrxChainSnapshot = {
  chainId: string;
  label: string;
  totalLiquidityUsd: number;
  totalVolumeH24Usd: number;
  pools: IdrxPoolRow[];
};

type DashboardPayload = {
  chains: IdrxChainSnapshot[];
  fetchedAt: string;
  source: string;
};

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 1 ? 4 : n < 100 ? 2 : 0
  }).format(n);
}

function formatFetchedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch {
    return iso;
  }
}

export function IdrxLiquiditySection({ className = "" }: { className?: string }) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/idrx/pools");
      const body = (await res.json()) as { error?: string } & Partial<DashboardPayload>;
      if (!res.ok) throw new Error(body.error || "Failed to load pools");
      if (!body.chains || !body.fetchedAt) throw new Error("Invalid response");
      setData(body as DashboardPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={`space-y-5 ${className}`}>
      <div>
        <h2 className="text-lg font-black text-white">IDRX liquidity & volume</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Aggregated DEX pools where{" "}
          <span className="inline-flex items-center gap-1 align-middle font-semibold text-zinc-300">
            <IdrxMark size={18} alt="" />
            IDRX
          </span>{" "}
          trades on Base, Polygon, BNB Chain, and Solana — liquidity depth and 24h volume (USD) from
          indexed pairs.
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card/60 px-4 py-10 text-center text-sm text-zinc-400">
          Loading pool data…
        </div>
      ) : null}

      {error && !loading ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/30 px-4 py-4 text-sm text-red-300">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-3 font-bold text-gold underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}

      {data && !loading ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">
              Updated {formatFetchedAt(data.fetchedAt)}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="tap-target rounded-lg border border-border bg-black/20 px-3 py-2 text-xs font-bold text-zinc-300 hover:border-gold/50 hover:text-zinc-100"
            >
              Refresh
            </button>
          </div>

          <div className="space-y-4">
            {data.chains.map((ch) => (
              <div
                key={ch.chainId}
                className="overflow-hidden rounded-2xl border border-border bg-card/80"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border bg-black/20 px-4 py-3">
                  <p className="text-base font-black text-zinc-100">{ch.label}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                    <span>
                      <span className="text-zinc-500">Liquidity </span>
                      <span className="font-bold text-zinc-200">
                        {formatUsd(ch.totalLiquidityUsd)}
                      </span>
                    </span>
                    <span>
                      <span className="text-zinc-500">24h vol </span>
                      <span className="font-bold text-zinc-200">
                        {formatUsd(ch.totalVolumeH24Usd)}
                      </span>
                    </span>
                  </div>
                </div>
                {ch.pools.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-zinc-500">No indexed pools for this network.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {ch.pools.map((p, i) => (
                      <li key={`${ch.chainId}-${p.dexId}-${i}`} className="px-4 py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-bold capitalize text-zinc-200">{p.dexId}</p>
                            <p className="text-xs text-zinc-500">{p.pairLabel}</p>
                          </div>
                          <div className="flex flex-wrap gap-x-4 text-xs">
                            <span className="text-zinc-500">
                              Liq{" "}
                              <span className="font-semibold text-zinc-300">{formatUsd(p.liquidityUsd)}</span>
                            </span>
                            <span className="text-zinc-500">
                              24h{" "}
                              <span className="font-semibold text-zinc-300">{formatUsd(p.volumeH24Usd)}</span>
                            </span>
                            {p.url ? (
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-bold text-gold underline underline-offset-2"
                              >
                                Chart
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <p className="text-[11px] leading-relaxed text-zinc-600">
            Pool figures are third-party estimates (DexScreener). They reflect indexed pairs only and
            can differ from on-chain reserves.
          </p>
        </>
      ) : null}
    </div>
  );
}
