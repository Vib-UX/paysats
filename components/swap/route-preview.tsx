"use client";

import { Button } from "@/components/ui/button";

interface Props {
  satsAmount: number;
  idrAmount: number;
  merchant: string;
  onConfirm: () => void;
  loading?: boolean;
  confirmLabel?: string;
}

export function RoutePreview({
  satsAmount,
  idrAmount,
  merchant,
  onConfirm,
  loading,
  confirmLabel = "Confirm and Start"
}: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-400">Route Preview</p>
        <ul className="mt-3 space-y-2 text-sm text-zinc-200">
          <li>1. Sats (LN) → USDT (Arbitrum) via Boltz UI</li>
          <li>2. USDT → USDC (e.g. Base) via 0x/Uniswap</li>
          <li>3. USDC → IDR via p2p.me</li>
        </ul>
        <div className="mt-4 text-sm">
          <p>Merchant: <span className="text-gold">{merchant}</span></p>
          <p>Estimated: <span className="text-gold">Rp {idrAmount.toLocaleString()}</span></p>
          <p>Sats debit: <span className="text-orange">{satsAmount.toLocaleString()} sats</span></p>
        </div>
      </div>
      <Button className="gold-gradient" loading={loading} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
}
