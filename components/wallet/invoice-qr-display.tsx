"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";

type Props = {
  bolt11: string;
  amountSats?: number;
  /** Lightning balance of the server NWC wallet (from `get_balance`, shown in sats). */
  balanceSats?: number | null;
  balanceMsat?: number | null;
  walletAlias?: string | null;
};

export function InvoiceQrDisplay({ bolt11, amountSats, balanceSats, balanceMsat, walletAlias }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(bolt11);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-4">
      <p className="text-center text-xs uppercase tracking-wide text-zinc-400">Pay this invoice</p>
      {amountSats != null ? (
        <p className="text-lg font-bold text-gold">{amountSats.toLocaleString()} sats</p>
      ) : null}
      <div className="rounded-xl bg-white p-3">
        <QRCode value={bolt11} size={220} level="M" />
      </div>
      <Button type="button" onClick={copy} className="border border-gold bg-transparent text-gold hover:bg-gold/10">
        {copied ? "Copied" : "Copy invoice"}
      </Button>
      <p className="max-h-24 w-full overflow-y-auto break-all text-center text-[10px] leading-relaxed text-zinc-500">
        {bolt11}
      </p>
      {balanceSats != null ? (
        <div className="text-center text-xs text-zinc-400">
          <p className="font-medium text-zinc-300">Operator wallet (NWC_URL)</p>
          {walletAlias ? <p className="text-zinc-500">{walletAlias}</p> : null}
          <p>
            Balance: {balanceSats.toLocaleString()} sats
            {balanceMsat != null ? (
              <span className="text-zinc-500"> ({balanceMsat.toLocaleString()} msat raw)</span>
            ) : null}
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">
            Same wallet that creates invoices and pays Boltz — read from NWC after connect.
          </p>
        </div>
      ) : null}
    </div>
  );
}
