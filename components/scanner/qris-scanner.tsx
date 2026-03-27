"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decodeQris } from "@/lib/qris";
import { Button } from "@/components/ui/button";

export function QrisScanner() {
  const router = useRouter();
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");

  const onDecode = () => {
    try {
      const decoded = decodeQris(payload);
      const search = new URLSearchParams({
        merchant: decoded.merchantName,
        amount: String(decoded.amountIdr),
        payload: decoded.payload
      });
      router.push(`/route?${search.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to decode QRIS payload.");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-300">Camera scanner can be mounted with @zxing/browser. Paste sample payload to test flow now.</p>
      <textarea
        className="h-40 w-full rounded-xl border border-border bg-card p-3 text-white"
        placeholder="Paste QRIS EMV payload"
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
      />
      <Button className="gold-gradient" onClick={onDecode}>Decode QRIS</Button>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
