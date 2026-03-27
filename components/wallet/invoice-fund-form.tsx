"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InvoiceQrDisplay } from "@/components/wallet/invoice-qr-display";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

export function InvoiceFundForm() {
  const router = useRouter();
  const [amountSats, setAmountSats] = useState<string>("1000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bolt11, setBolt11] = useState<string | null>(null);
  const [balanceSats, setBalanceSats] = useState<number | null>(null);
  const [balanceMsat, setBalanceMsat] = useState<number | null>(null);
  const [walletAlias, setWalletAlias] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const n = Number(amountSats);
    if (!Number.isFinite(n) || n < 1) {
      setError("Enter a sat amount (positive integer).");
      return;
    }

    setLoading(true);
    setBolt11(null);
    try {
      const response = await fetch(`${API_BASE}/api/nwc/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountSats: Math.floor(n),
          description: "paysats topup"
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create invoice.");
      }
      setBolt11(data.bolt11);
      setBalanceSats(typeof data.balanceSats === "number" ? data.balanceSats : null);
      setBalanceMsat(typeof data.balanceMsat === "number" ? data.balanceMsat : null);
      setWalletAlias(typeof data.walletAlias === "string" ? data.walletAlias : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block text-sm font-semibold text-zinc-300">Amount (sats)</label>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={amountSats}
          onChange={(e) => setAmountSats(e.target.value)}
          className="tap-target w-full rounded-xl border border-border bg-card px-4 py-3 text-lg font-bold text-white outline-none focus:border-gold"
        />
        <Button type="submit" loading={loading} className="gold-gradient">
          Create invoice
        </Button>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </form>

      {bolt11 ? (
        <>
          <InvoiceQrDisplay
            bolt11={bolt11}
            amountSats={Number(amountSats)}
            balanceSats={balanceSats}
            balanceMsat={balanceMsat}
            walletAlias={walletAlias}
          />
          <Button
            type="button"
            onClick={() => router.push("/scan")}
            className="border border-zinc-600 bg-transparent text-white"
          >
            Continue to QRIS scan
          </Button>
        </>
      ) : null}
    </div>
  );
}
