"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";

export type EvmDepositInfo = {
  channel: string;
  chainId: number;
  chainName: string;
  tokenSymbol: string;
  tokenAddress: string;
  toAddress: string;
  decimals: number;
  qrValue: string;
};

type Props = {
  deposit: EvmDepositInfo;
  /** Sats equivalent from order (for reference). */
  satAmount?: number;
  idrAmount?: number;
};

export function EvmDepositQrDisplay({ deposit, satAmount, idrAmount }: Props) {
  const [copied, setCopied] = useState<"addr" | "token" | "qr" | null>(null);

  const copy = async (field: "addr" | "token" | "qr", text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const explorerBase =
    deposit.chainId === 8453
      ? "https://basescan.org"
      : deposit.chainId === 56
        ? "https://bscscan.com"
        : null;

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-4">
      <p className="text-center text-xs uppercase tracking-wide text-zinc-400">
        Send {deposit.tokenSymbol}
      </p>
      <p className="text-center text-sm text-zinc-300">
        {deposit.chainName} · chain {deposit.chainId}
      </p>
      {idrAmount != null && idrAmount > 0 ? (
        <p className="text-center text-sm text-zinc-300">
          Order ≈ Rp {idrAmount.toLocaleString("id-ID")}
          {satAmount != null ? ` · ${satAmount.toLocaleString()} sats` : null}
        </p>
      ) : null}
      <div className="rounded-xl bg-white p-3">
        <QRCode value={deposit.qrValue} size={220} level="M" />
      </div>
      <p className="text-center text-[11px] text-zinc-500">
        QR encodes <span className="font-mono text-zinc-400">{deposit.qrValue}</span> — wallet
        opens send to this Safe on the correct network.
      </p>
      <Button
        type="button"
        onClick={() => copy("qr", deposit.qrValue)}
        className="border border-gold bg-transparent text-gold hover:bg-gold/10"
      >
        {copied === "qr" ? "Copied" : "Copy QR payload"}
      </Button>

      <div className="w-full space-y-2 rounded-xl border border-border bg-black/20 p-3 text-left">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Safe (receive)</p>
        <p className="break-all font-mono text-[11px] text-zinc-300">{deposit.toAddress}</p>
        <Button
          type="button"
          onClick={() => copy("addr", deposit.toAddress)}
          className="w-full border border-border bg-transparent text-xs text-zinc-200"
        >
          {copied === "addr" ? "Copied" : "Copy address"}
        </Button>
        {explorerBase ? (
          <a
            href={`${explorerBase}/address/${deposit.toAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs font-semibold text-gold underline"
          >
            View on explorer
          </a>
        ) : null}
      </div>

      <div className="w-full space-y-2 rounded-xl border border-border bg-black/20 p-3 text-left">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Token contract</p>
        <p className="break-all font-mono text-[11px] text-zinc-300">{deposit.tokenAddress}</p>
        <Button
          type="button"
          onClick={() => copy("token", deposit.tokenAddress)}
          className="w-full border border-border bg-transparent text-xs text-zinc-200"
        >
          {copied === "token" ? "Copied" : "Copy token contract"}
        </Button>
        {explorerBase ? (
          <a
            href={`${explorerBase}/token/${deposit.tokenAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs font-semibold text-gold underline"
          >
            Token on explorer
          </a>
        ) : null}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-zinc-500">
        Send the token (not ETH/BNB for gas) to the Safe above. Keep a little USDC (Base) or USDT (BNB) in the
        Safe for ERC-4337 gas when the operator runs LiFi → Base IDRX.
      </p>
    </div>
  );
}
