"use client";

import { useCallback, useEffect, useState } from "react";
import { backendFetch } from "@/lib/backend-fetch";

type PlatformStats = {
  totalOrders: number;
  totalVolumeIdr: number;
  totalVolumeSats: number;
  tagline: string;
  updatedAt: string;
};

function formatMillionIdrPlus(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    const s = m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "");
    return `${s} Million IDR+`;
  }
  return `${Math.round(n).toLocaleString("id-ID")} IDR+`;
}

function formatSats(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(n).toLocaleString("id-ID")} sats`;
}

function formatOrders(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(Math.round(n));
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function LiquidityPlatformBanner({ className = "" }: { className?: string }) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await backendFetch("/api/liquidity/platform-stats");
      const body = (await res.json()) as { error?: string } & Partial<PlatformStats>;
      if (!res.ok) throw new Error(body.error || "Failed to load stats");
      if (
        typeof body.totalOrders !== "number" ||
        typeof body.totalVolumeIdr !== "number" ||
        typeof body.totalVolumeSats !== "number"
      ) {
        throw new Error("Invalid stats payload");
      }
      setStats({
        totalOrders: body.totalOrders,
        totalVolumeIdr: body.totalVolumeIdr,
        totalVolumeSats: body.totalVolumeSats,
        tagline: typeof body.tagline === "string" ? body.tagline : "",
        updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : "",
      });
    } catch (e) {
      setStats(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !stats) {
    return (
      <div
        className={`rounded-2xl border border-border bg-zinc-900/80 px-4 py-3 text-center text-xs text-zinc-500 ${className}`}
      >
        {error}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-2 font-bold text-gold underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div
        className={`rounded-2xl border border-border bg-zinc-900/60 px-4 py-8 text-center text-sm text-zinc-500 ${className}`}
      >
        Loading platform volume…
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-zinc-800/95 via-zinc-900/90 to-violet-950/30 ${className}`}
    >
      <div className="flex flex-col gap-6 px-5 py-5 md:flex-row md:items-stretch md:justify-between md:gap-4 md:px-8 md:py-6">
        <div className="flex max-w-md flex-1 items-center">
          <p className="text-sm font-semibold leading-snug tracking-tight text-zinc-300 md:text-base">
            {stats.tagline || "From sats to settled"}
          </p>
        </div>

        <div className="hidden w-px shrink-0 bg-zinc-600/50 md:block" aria-hidden />

        <div className="flex flex-1 flex-col items-center justify-center text-center md:min-w-[10rem]">
          <p className="text-2xl font-black tracking-tight text-violet-300 md:text-3xl">
            {formatMillionIdrPlus(stats.totalVolumeIdr)}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-zinc-400 md:text-sm">
            {formatSats(stats.totalVolumeSats)}
          </p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Total volume
          </p>
        </div>

        <div className="hidden w-px shrink-0 border-l border-dotted border-zinc-600/60 md:block" aria-hidden />

        <div className="flex flex-1 flex-col items-center justify-center text-center md:min-w-[8rem]">
          <p className="text-2xl font-black tracking-tight text-violet-300 md:text-3xl">
            {formatOrders(stats.totalOrders)}
          </p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Total orders
          </p>
        </div>
      </div>
    </div>
  );
}
