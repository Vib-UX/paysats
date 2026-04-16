"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InvoiceQrDisplay } from "@/components/wallet/invoice-qr-display";
import {
  EvmDepositQrDisplay,
  type EvmDepositInfo,
} from "@/components/wallet/evm-deposit-qr-display";
import { OfframpRouteExpandable } from "@/components/order/offramp-route-expandable";
import { backendFetch } from "@/lib/backend-fetch";
import type { OfframpOrderFields } from "@/lib/offramp-route";
import { ORDER_STATES, type OrderState } from "@/lib/state";

const POST_SWAP_SUCCESS_DELAY_MS =
  Number(process.env.NEXT_PUBLIC_OFFRAMP_SUCCESS_DELAY_MS || "20000") || 20_000;
const RECEIPT_REDIRECT_AFTER_TICK_MS = 2500;

const SWAP_SUCCESS_STATES = new Set<OrderState | string>([
  "USDC_SWAPPED",
  "P2PM_ORDER_PLACED",
  "P2PM_ORDER_CONFIRMED",
  "IDR_SETTLED",
  "COMPLETED",
]);

function isSwapSuccessMilestone(
  order: OfframpOrderFields | null | undefined,
): boolean {
  if (!order?.swapTxHash?.trim()) return false;
  const st = String(order.state || "");
  if (st === "FAILED") return false;
  return SWAP_SUCCESS_STATES.has(st);
}

function buildValidatePaymentProofUrl(
  invoice: string,
  preimage: string,
): string {
  const pre = preimage.replace(/^0x/i, "").trim();
  const q = new URLSearchParams({ invoice, preimage: pre });
  return `https://validate-payment.com/?${q.toString()}`;
}

function indexOfOrderState(state: string): number {
  return ORDER_STATES.indexOf(state as OrderState);
}

function isFundingInvoiceSettled(order: OfframpOrderFields | null): boolean {
  if (!order) return false;
  if (order.invoicePaidAt) return true;
  const i = indexOfOrderState(String(order.state || "ROUTE_SHOWN"));
  const routeShown = ORDER_STATES.indexOf("ROUTE_SHOWN");
  return i > routeShown;
}

function buildEvmDepositInfo(order: OfframpOrderFields): EvmDepositInfo | null {
  const channel = String(order.depositChannel || "").toLowerCase();
  const chainId = order.depositChainId;
  const toAddress = order.depositToAddress?.trim();
  const tokenAddress = order.depositTokenAddress?.trim();
  if (!toAddress || !tokenAddress || !chainId) return null;

  if (channel === "cbbtc") {
    return {
      channel,
      chainId,
      chainName: "Base",
      tokenSymbol: "cbBTC",
      tokenAddress,
      toAddress,
      decimals: 8,
      qrValue: `ethereum:${toAddress}@${chainId}`,
    };
  }
  if (channel === "btcb") {
    return {
      channel,
      chainId,
      chainName: "BNB Chain",
      tokenSymbol: "BTCB",
      tokenAddress,
      toAddress,
      decimals: 18,
      qrValue: `ethereum:${toAddress}@${chainId}`,
    };
  }
  return null;
}

type WebLnProvider = {
  enable: () => Promise<void>;
  sendPayment: (bolt11: string) => Promise<{ preimage?: string }>;
};

function OrderPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = typeof params.id === "string" ? params.id : "";

  const [orderDetail, setOrderDetail] = useState<OfframpOrderFields | null>(null);
  const [error, setError] = useState("");
  const [invoicePaying, setInvoicePaying] = useState(false);
  const [lightningPaymentPreimage, setLightningPaymentPreimage] = useState<string | null>(null);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [loading, setLoading] = useState(true);

  const paymentSuccessDelayStartedRef = useRef(false);
  const paymentSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bolt11 = orderDetail?.invoiceBolt11?.trim() || null;
  const depositInfo = useMemo(() => {
    if (!orderDetail) return null;
    return buildEvmDepositInfo(orderDetail);
  }, [orderDetail]);

  const isLightning = Boolean(bolt11?.startsWith("ln"));
  const isDeposit = Boolean(depositInfo);

  const fundingSettled =
    orderDetail &&
    isFundingInvoiceSettled(orderDetail) &&
    orderDetail.state !== "FAILED" &&
    orderDetail.state !== "COMPLETED";
  const pipelineFailed = orderDetail?.state === "FAILED";

  const routeOrder: OfframpOrderFields | null = useMemo(() => {
    if (!orderDetail) return null;
    return {
      ...orderDetail,
      invoiceLnPreimage:
        lightningPaymentPreimage?.trim() || orderDetail.invoiceLnPreimage || undefined,
    };
  }, [orderDetail, lightningPaymentPreimage]);

  const paymentProofHref =
    bolt11 && lightningPaymentPreimage
      ? buildValidatePaymentProofUrl(bolt11, lightningPaymentPreimage)
      : null;

  // Poll order status
  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await backendFetch(
          `/api/order/${encodeURIComponent(orderId)}/status`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const snapshot = data as OfframpOrderFields;
        setOrderDetail(snapshot);
        setLoading(false);

        if (
          isSwapSuccessMilestone(snapshot) &&
          !paymentSuccessDelayStartedRef.current
        ) {
          paymentSuccessDelayStartedRef.current = true;
          paymentSuccessTimerRef.current = setTimeout(() => {
            if (cancelled) return;
            setShowPaymentSuccess(true);
          }, POST_SWAP_SUCCESS_DELAY_MS);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    void poll();
    const id = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (paymentSuccessTimerRef.current) {
        clearTimeout(paymentSuccessTimerRef.current);
        paymentSuccessTimerRef.current = null;
      }
    };
  }, [orderId]);

  // Auto-redirect to receipt on completion
  useEffect(() => {
    if (!showPaymentSuccess || orderDetail?.state !== "COMPLETED" || !orderId)
      return;
    const oid = orderId;
    const t = setTimeout(() => {
      router.push(`/receipt?orderId=${encodeURIComponent(oid)}`);
    }, RECEIPT_REDIRECT_AFTER_TICK_MS);
    return () => clearTimeout(t);
  }, [showPaymentSuccess, orderDetail?.state, orderId, router]);

  const payViaWebln = useCallback(async (invoice: string): Promise<{ preimage?: string }> => {
    const provider = (window as unknown as { webln?: WebLnProvider }).webln;
    if (!provider) {
      throw new Error(
        "WebLN not available. Install/enable Alby or pay using the QR in another wallet.",
      );
    }
    await provider.enable();
    return provider.sendPayment(invoice);
  }, []);

  if (!orderId) {
    return (
      <main className="app-shell space-y-4">
        <p className="text-sm text-red-400">No order ID provided.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="app-shell space-y-4">
        <p className="text-sm text-zinc-400">Loading order…</p>
      </main>
    );
  }

  if (!orderDetail) {
    return (
      <main className="app-shell space-y-4">
        <p className="text-sm text-red-400">Order not found.</p>
      </main>
    );
  }

  const satAmount = orderDetail.satAmount ?? 0;
  const idrAmount = orderDetail.idrAmount ?? 0;

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-zinc-200">
            {isDeposit && depositInfo
              ? `Deposit ${depositInfo.tokenSymbol} (${depositInfo.chainName})`
              : "Pay with Lightning"}
          </p>
          <button
            type="button"
            onClick={() => router.push("/offramp")}
            className="tap-target rounded-lg px-3 py-2 text-sm font-bold text-zinc-300 hover:text-white"
          >
            Back
          </button>
        </div>

        {pipelineFailed ? (
          <div className="space-y-4 py-2 text-center">
            <p className="text-sm font-bold text-red-400">
              Something went wrong
            </p>
            <p className="text-sm text-zinc-400">
              The order did not complete. You can view details on the status
              page or contact support with your order ID.
            </p>
            <Button
              type="button"
              onClick={() =>
                router.push(
                  `/status?orderId=${encodeURIComponent(orderId)}`,
                )
              }
              className="gold-gradient"
            >
              View status
            </Button>
            {paymentProofHref ? (
              <a
                href={paymentProofHref}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-sm font-bold text-gold underline underline-offset-4"
              >
                Lightning payment proof
              </a>
            ) : null}
          </div>
        ) : fundingSettled && isLightning ? (
          showPaymentSuccess ? (
            <div className="space-y-5 py-6 text-center">
              <div
                className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gold/20 text-gold"
                aria-hidden
              >
                <svg
                  className="h-11 w-11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path
                    d="M20 6L9 17l-5-5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div>
                <p className="text-xl font-black text-zinc-100">
                  Payment successful
                </p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Lightning payment and on-chain swap are complete
                  {orderDetail?.state === "COMPLETED"
                    ? " — redirecting to receipt…"
                    : "."}
                </p>
              </div>
              {orderDetail?.swapTxHash ? (
                <a
                  href={`https://arbiscan.io/tx/${orderDetail.swapTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-sm font-bold text-gold underline underline-offset-4"
                >
                  View USDT → USDC transaction
                </a>
              ) : null}
              {paymentProofHref ? (
                <a
                  href={paymentProofHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm font-bold text-zinc-400 underline hover:text-gold"
                >
                  Lightning payment proof
                </a>
              ) : null}
              {routeOrder ? (
                <OfframpRouteExpandable order={routeOrder} />
              ) : null}
              <Button
                type="button"
                onClick={() =>
                  router.push(
                    `/status?orderId=${encodeURIComponent(orderId)}`,
                  )
                }
                className="border border-border bg-transparent text-zinc-200"
              >
                Order details
              </Button>
            </div>
          ) : (
            <div className="space-y-5 py-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center">
                <div
                  className="h-14 w-14 rounded-full border-4 border-zinc-700 border-t-gold animate-spin"
                  aria-hidden
                />
              </div>
              <div className="space-y-2">
                <p className="text-base font-black text-zinc-100">
                  Settling your payout
                </p>
                <p className="text-sm leading-relaxed text-zinc-400">
                  Your Lightning payment is in. Routing to rupiah out usually takes{" "}
                  <span className="font-semibold text-zinc-300">
                    about one to two minutes
                  </span>
                  .
                </p>
                <p className="text-xs text-zinc-500">
                  Funds move through automated swaps and payout partners
                  (Boltz, LiFi, IDRX) in the background.
                  {orderDetail?.idrxPayoutBankName
                    ? ` Your route shows IDRX → Rupiah on ${orderDetail.idrxPayoutBankName}.`
                    : " Your route shows IDRX → Rupiah on the rail you selected."}
                  {isSwapSuccessMilestone(orderDetail)
                    ? ` LiFi step is in — success screen in ~${Math.ceil(POST_SWAP_SUCCESS_DELAY_MS / 1000)}s…`
                    : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/status?orderId=${encodeURIComponent(orderId)}`,
                  )
                }
                className="tap-target w-full rounded-xl px-4 py-3 text-sm font-bold text-zinc-400 transition hover:text-zinc-200"
              >
                Detailed progress
              </button>
              {paymentProofHref ? (
                <a
                  href={paymentProofHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-sm font-bold text-gold underline decoration-gold/40 underline-offset-4 hover:decoration-gold"
                >
                  Lightning payment proof (validate-payment.com)
                </a>
              ) : (
                <p className="text-center text-[11px] text-zinc-500">
                  Paid with another wallet? Copy the preimage from your
                  wallet and verify at{" "}
                  <a
                    href="https://validate-payment.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-zinc-400 underline hover:text-gold"
                  >
                    validate-payment.com
                  </a>
                  .
                </p>
              )}
              {routeOrder ? (
                <OfframpRouteExpandable order={routeOrder} />
              ) : null}
            </div>
          )
        ) : isLightning && bolt11 ? (
          <>
            <InvoiceQrDisplay
              bolt11={bolt11}
              amountSats={satAmount > 0 ? satAmount : undefined}
            />

            <div className="space-y-2">
              <Button
                type="button"
                loading={invoicePaying}
                disabled={!bolt11.startsWith("ln")}
                onClick={() => {
                  setError("");
                  setInvoicePaying(true);
                  payViaWebln(bolt11)
                    .then((res) => {
                      const pre = res?.preimage?.trim();
                      if (pre) setLightningPaymentPreimage(pre);
                    })
                    .catch((e) =>
                      setError(e instanceof Error ? e.message : String(e)),
                    )
                    .finally(() => setInvoicePaying(false));
                }}
                className="border border-gold bg-transparent text-gold hover:bg-gold/10"
              >
                Pay with Alby (WebLN)
              </Button>
              {paymentProofHref ? (
                <a
                  href={paymentProofHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-target flex w-full items-center justify-center rounded-xl border border-gold/40 bg-black/20 px-4 py-3 text-sm font-bold text-gold"
                >
                  Open payment proof
                </a>
              ) : null}
              <Button
                type="button"
                onClick={() =>
                  router.push(
                    `/status?orderId=${encodeURIComponent(orderId)}`,
                  )
                }
                className="gold-gradient"
              >
                View status
              </Button>
              <p className="text-center text-xs text-zinc-500">
                After the invoice is paid, settlement runs automatically:
                Lightning → stablecoins → rupiah out to your account.
              </p>
              {!paymentProofHref ? (
                <p className="text-center text-[11px] text-zinc-500">
                  After paying in any wallet, you can prove the payment at{" "}
                  <a
                    href="https://validate-payment.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-zinc-400 underline hover:text-gold"
                  >
                    validate-payment.com
                  </a>{" "}
                  using your invoice and preimage.
                </p>
              ) : null}
              {routeOrder ? (
                <OfframpRouteExpandable order={routeOrder} />
              ) : null}
            </div>
          </>
        ) : isDeposit && depositInfo ? (
          <>
            <EvmDepositQrDisplay
              deposit={depositInfo}
              satAmount={satAmount > 0 ? satAmount : undefined}
              idrAmount={idrAmount > 0 ? idrAmount : undefined}
            />
            <div className="space-y-2">
              <Button
                type="button"
                onClick={() =>
                  router.push(
                    `/status?orderId=${encodeURIComponent(orderId)}`,
                  )
                }
                className="gold-gradient"
              >
                View status
              </Button>
              <p className="text-center text-xs text-zinc-500">
                After your on-chain deposit confirms, the operator route runs
                LiFi → Base IDRX, then burn/redeem to your payout destination.
              </p>
              {routeOrder ? (
                <OfframpRouteExpandable order={routeOrder} />
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-red-400">
            Missing deposit instructions. The order may still be initializing — it will appear shortly.
          </p>
        )}

        {error ? (
          <p className="text-center text-sm text-red-400">{error}</p>
        ) : null}
      </div>
    </main>
  );
}

export default function OrderPageWithSuspense() {
  return (
    <Suspense fallback={<main className="app-shell">Loading…</main>}>
      <OrderPage />
    </Suspense>
  );
}
