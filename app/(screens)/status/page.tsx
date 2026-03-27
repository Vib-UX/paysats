"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrderState } from "@/lib/state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { OrderTimeline } from "@/components/order/order-timeline";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

export default function StatusPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<OrderState>("IDLE");
  const orderId = searchParams.get("orderId") || "";

  useEffect(() => {
    if (!orderId) return;

    const interval = setInterval(async () => {
      const response = await fetch(`${API_BASE}/api/order/${orderId}/status`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      setState(data.state as OrderState);
      if (data.state === "COMPLETED") {
        router.push(`/receipt?orderId=${orderId}`);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [orderId, router]);

  return (
    <main className="app-shell">
      <h1 className="mb-3 text-2xl font-black text-gold">Order Status</h1>
      <ProgressBar state={state} />
      <OrderTimeline state={state} />
    </main>
  );
}
