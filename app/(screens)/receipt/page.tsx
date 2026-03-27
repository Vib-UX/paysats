"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReceiptCard } from "@/components/order/receipt-card";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

export default function ReceiptPage() {
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<any>(null);
  const orderId = searchParams.get("orderId") || "";

  useEffect(() => {
    if (!orderId) return;

    fetch(`${API_BASE}/api/order/${orderId}/status`)
      .then((response) => response.json())
      .then((data) => setOrder(data));
  }, [orderId]);

  if (!order) {
    return <main className="app-shell">Loading receipt...</main>;
  }

  return (
    <main className="app-shell">
      <h1 className="mb-4 text-2xl font-black text-gold">Completed</h1>
      <ReceiptCard
        sats={order.satAmount || 0}
        usdt={order.usdtAmount || 0}
        usdc={order.usdcAmount || 0}
        idr={order.idrAmount || 0}
        merchant={order.merchantName || "Unknown"}
        boltzTxHash={order.boltzTxHash || undefined}
        swapTxHash={order.swapTxHash || undefined}
        p2pmOrderId={order.p2pmOrderId || undefined}
      />
    </main>
  );
}
