"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RoutePreview } from "@/components/swap/route-preview";
import { InvoiceQrDisplay } from "@/components/wallet/invoice-qr-display";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

type WebLnProvider = {
  enable: () => Promise<void>;
  sendPayment: (bolt11: string) => Promise<{ preimage?: string }>;
};

export default function RoutePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [loadingSwap, setLoadingSwap] = useState(false);
  const [flowError, setFlowError] = useState("");
  const [fundingBolt11, setFundingBolt11] = useState("");
  const [balanceSats, setBalanceSats] = useState<number | null>(null);
  const [balanceMsat, setBalanceMsat] = useState<number | null>(null);
  const [walletAlias, setWalletAlias] = useState<string | null>(null);
  const [arbitrumSafe, setArbitrumSafe] = useState<string | null>(null);

  const merchant = searchParams.get("merchant") || "Unknown Merchant";
  const idrAmount = Number(searchParams.get("amount") || 0);

  const satsAmount = useMemo(() => Math.max(1, Math.ceil(idrAmount / 2)), [idrAmount]);

  useEffect(() => {
    fetch(`${API_BASE}/api/wallet/arbitrum-receive-address`)
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.safeAddress === "string") setArbitrumSafe(data.safeAddress);
      })
      .catch(() => {});
  }, []);

  async function fundViaWebln(invoice: string): Promise<void> {
    const provider = (window as unknown as { webln?: WebLnProvider }).webln;
    if (!provider) {
      throw new Error("WebLN not available. Pay using the QR in another wallet.");
    }
    await provider.enable();
    await provider.sendPayment(invoice);
  }

  const createFundingInvoice = async () => {
    setLoadingInvoice(true);
    setFlowError("");
    setFundingBolt11("");
    setBalanceSats(null);
    setBalanceMsat(null);
    setWalletAlias(null);
    try {
      const topupResponse = await fetch(`${API_BASE}/api/nwc/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountSats: satsAmount,
          description: `paysats topup for ${merchant}`
        })
      });

      const topupData = await topupResponse.json();
      if (!topupResponse.ok) {
        throw new Error(topupData.error || "Failed to create invoice.");
      }

      setFundingBolt11(topupData.bolt11);
      setBalanceSats(typeof topupData.balanceSats === "number" ? topupData.balanceSats : null);
      setBalanceMsat(typeof topupData.balanceMsat === "number" ? topupData.balanceMsat : null);
      setWalletAlias(typeof topupData.walletAlias === "string" ? topupData.walletAlias : null);
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "Failed to create invoice.");
    } finally {
      setLoadingInvoice(false);
    }
  };

  const startBoltzSwap = async () => {
    setLoadingSwap(true);
    setFlowError("");
    try {
      const response = await fetch(`${API_BASE}/api/boltz/create-swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          satAmount: satsAmount,
          merchant,
          qrisPayload: searchParams.get("payload") || "",
          idrAmount
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to start order.");
      }

      router.push(`/status?orderId=${data.orderId}`);
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "Swap failed.");
    } finally {
      setLoadingSwap(false);
    }
  };

  return (
    <main className="app-shell">
      <h1 className="mb-2 text-2xl font-black text-gold">Review Route</h1>
      <p className="mb-6 text-sm text-zinc-300">Confirm fees, fund the route wallet, then start the swap.</p>
      {arbitrumSafe ? (
        <p className="mb-4 break-all text-xs text-zinc-500">
          Boltz USDT receive (Arbitrum, WDK ERC-4337 Safe): {arbitrumSafe}
        </p>
      ) : null}
      <RoutePreview
        satsAmount={satsAmount}
        idrAmount={idrAmount}
        merchant={merchant}
        onConfirm={createFundingInvoice}
        loading={loadingInvoice}
        confirmLabel="Create funding invoice"
      />
      {flowError ? <p className="mt-3 text-sm text-red-400">{flowError}</p> : null}

      {fundingBolt11 ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-zinc-300">Pay this invoice to fund the backend wallet, then continue.</p>
          <InvoiceQrDisplay
            bolt11={fundingBolt11}
            amountSats={satsAmount}
            balanceSats={balanceSats}
            balanceMsat={balanceMsat}
            walletAlias={walletAlias}
          />
          <Button
            type="button"
            onClick={() => fundViaWebln(fundingBolt11).catch((e) => setFlowError(String(e)))}
            className="border border-gold bg-transparent text-gold"
          >
            Pay with WebLN
          </Button>
          <Button type="button" loading={loadingSwap} onClick={startBoltzSwap} className="gold-gradient">
            I paid — start Boltz swap
          </Button>
        </div>
      ) : null}
    </main>
  );
}
