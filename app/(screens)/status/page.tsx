"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrderState } from "@/lib/state";
import type { OfframpOrderFields } from "@/lib/offramp-route";
import { ProgressBar } from "@/components/ui/progress-bar";
import { OrderTimeline } from "@/components/order/order-timeline";
import { OfframpRouteExpandable } from "@/components/order/offramp-route-expandable";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

function StatusPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<OrderState>("IDLE");
  const [order, setOrder] = useState<OfframpOrderFields | null>(null);
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
      setOrder(data as OfframpOrderFields);
      if (data.state === "COMPLETED") {
        router.push(`/receipt?orderId=${orderId}`);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [orderId, router]);

  return (
    <main className="app-shell space-y-4">
      <h1 className="mb-3 text-2xl font-black text-gold">Order Status</h1>
      <ProgressBar state={state} />
      <OfframpRouteExpandable order={order} defaultOpen />
      <OrderTimeline state={state} />
    </main>
  );
}

export default function StatusPageWithSuspense() {
  return (
    <Suspense fallback={<main className="app-shell">Loading…</main>}>
      <StatusPage />
    </Suspense>
  );
}
