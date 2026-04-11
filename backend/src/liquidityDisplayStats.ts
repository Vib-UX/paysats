import fs from "node:fs";
import path from "node:path";

export type LiquidityDisplayStats = {
  totalOrders: number;
  totalVolumeIdr: number;
  totalVolumeSats: number;
  tagline: string;
  updatedAt: string;
};

const DEFAULT_TAGLINE = "From sats to settled";

function statsFilePath(): string {
  return path.join(process.cwd(), "data", "liquidity-display-stats.json");
}

function defaultStats(): LiquidityDisplayStats {
  return {
    totalOrders: 11,
    totalVolumeIdr: 1_200_000,
    totalVolumeSats: 100_000,
    tagline: DEFAULT_TAGLINE,
    updatedAt: new Date().toISOString(),
  };
}

export function readLiquidityDisplayStats(): LiquidityDisplayStats {
  const p = statsFilePath();
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw) as Partial<LiquidityDisplayStats>;
    if (
      typeof j.totalOrders !== "number" ||
      typeof j.totalVolumeIdr !== "number" ||
      typeof j.totalVolumeSats !== "number"
    ) {
      return defaultStats();
    }
    return {
      totalOrders: Math.max(0, Math.floor(j.totalOrders)),
      totalVolumeIdr: Math.max(0, j.totalVolumeIdr),
      totalVolumeSats: Math.max(0, Math.floor(j.totalVolumeSats)),
      tagline: typeof j.tagline === "string" && j.tagline.trim() ? j.tagline : DEFAULT_TAGLINE,
      updatedAt: typeof j.updatedAt === "string" ? j.updatedAt : new Date().toISOString(),
    };
  } catch {
    return defaultStats();
  }
}

export function writeLiquidityDisplayStats(s: LiquidityDisplayStats): void {
  const p = statsFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2), "utf8");
}

/** Cron: add 3–4 synthetic orders and matching IDR + sats using current BTC/IDR. */
export function appendSyntheticDailyBump(btcIdr: number): LiquidityDisplayStats {
  if (!Number.isFinite(btcIdr) || btcIdr <= 0) {
    throw new Error("btcIdr must be a positive finite number");
  }
  const deltaOrders = Math.random() < 0.5 ? 3 : 4;
  const prev = readLiquidityDisplayStats();
  const avgIdrPerNewOrder = 220_000 + Math.floor(Math.random() * 280_001);
  const addIdr = deltaOrders * avgIdrPerNewOrder;
  const addSats = Math.max(1, Math.ceil((addIdr / btcIdr) * 1e8));
  const next: LiquidityDisplayStats = {
    ...prev,
    totalOrders: prev.totalOrders + deltaOrders,
    totalVolumeIdr: Math.round(prev.totalVolumeIdr + addIdr),
    totalVolumeSats: prev.totalVolumeSats + addSats,
    updatedAt: new Date().toISOString(),
  };
  writeLiquidityDisplayStats(next);
  return next;
}

/** Real offramp completion: +1 order and actual sat / IDR amounts. */
export function recordOfframpCompletionVolume(input: {
  satAmount: number;
  idrAmount: number;
}): LiquidityDisplayStats | null {
  const sat = Math.round(input.satAmount);
  const idr = Math.round(input.idrAmount);
  if (!Number.isFinite(sat) || sat <= 0) return null;
  if (!Number.isFinite(idr) || idr <= 0) return null;
  const prev = readLiquidityDisplayStats();
  const next: LiquidityDisplayStats = {
    ...prev,
    totalOrders: prev.totalOrders + 1,
    totalVolumeIdr: prev.totalVolumeIdr + idr,
    totalVolumeSats: prev.totalVolumeSats + sat,
    updatedAt: new Date().toISOString(),
  };
  writeLiquidityDisplayStats(next);
  return next;
}
