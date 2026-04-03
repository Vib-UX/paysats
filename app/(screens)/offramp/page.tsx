"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InvoiceQrDisplay } from "@/components/wallet/invoice-qr-display";
import { OfframpRouteExpandable } from "@/components/order/offramp-route-expandable";
import { GiftCardsSection } from "@/components/gift-cards-section";
import { HowItWorks } from "@/components/how-it-works";
import { MerchantCta } from "@/components/merchant-cta";
import {
  hashForSection,
  OfframpSectionTabs,
  sectionFromHash,
  type OfframpSection,
} from "@/components/offramp-section-tabs";
import { IdrxMark } from "@/components/idrx-mark";
import { TetherMark } from "@/components/tether-mark";
import { backendFetch } from "@/lib/backend-fetch";
import type { OfframpOrderFields } from "@/lib/offramp-route";
import { ORDER_STATES, type OrderState } from "@/lib/state";

/** After USDT→USDC completes (swap tx link available), wait this long before showing the success checkmark. */
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

/** Third-party Lightning payment verifier (invoice + preimage). @see https://validate-payment.com/ */
function buildValidatePaymentProofUrl(
  invoice: string,
  preimage: string,
): string {
  const pre = preimage.replace(/^0x/i, "").trim();
  const q = new URLSearchParams({ invoice, preimage: pre });
  return `https://validate-payment.com/?${q.toString()}`;
}

type PayoutMethod = "bank_transfer" | "gopay";
type WebLnProvider = {
  enable: () => Promise<void>;
  sendPayment: (bolt11: string) => Promise<{ preimage?: string }>;
};

function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, "");
}

function normalizeGopayMsisdn(input: string): string {
  const trimmed = input.trim();
  // Accept strict +CC-NNN format, otherwise attempt to coerce:
  // - "+91 9650..." -> "+91-9650..."
  // - "+919650..."  -> "+91-9650..." (best-effort: assumes country code is 1–3 digits)
  if (/^\+\d{1,3}-\d{6,14}$/.test(trimmed)) return trimmed;
  const m1 = trimmed.match(/^\+(\d{1,3})[\s-]?(\d{6,14})$/);
  if (m1) return `+${m1[1]}-${m1[2]}`;
  return trimmed;
}

function formatIdr(n: number): string {
  try {
    return n.toLocaleString("id-ID");
  } catch {
    return String(n);
  }
}

function formatIdrDotsFromDigits(digits: string): string {
  const d = digitsOnly(digits);
  if (!d) return "";
  // Indonesian style: 100000 -> 100.000
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function indexOfOrderState(state: string): number {
  const i = ORDER_STATES.indexOf(state as OrderState);
  return i;
}

/** Funding Lightning invoice is settled; agent pipeline is running or finished. */
function isFundingInvoiceSettled(order: OfframpOrderFields | null): boolean {
  if (!order) return false;
  if (order.invoicePaidAt) return true;
  const i = indexOfOrderState(String(order.state || "ROUTE_SHOWN"));
  const routeShown = ORDER_STATES.indexOf("ROUTE_SHOWN");
  return i > routeShown;
}

export default function OfframpPage() {
  const router = useRouter();

  const [payoutMethod, setPayoutMethod] =
    useState<PayoutMethod>("bank_transfer");
  const [recipient, setRecipient] = useState("");

  const [btcIdr, setBtcIdr] = useState<number | null>(null);
  const [usdcIdr, setUsdcIdr] = useState<number | null>(null);
  const [quoteError, setQuoteError] = useState("");

  const [idr, setIdr] = useState<string>("100000");
  const [sats, setSats] = useState<string>("");
  const [activeCurrency, setActiveCurrency] = useState<"idr" | "sats">("idr");
  const [lastEdited, setLastEdited] = useState<"idr" | "sats">("idr");

  const [loadingPay, setLoadingPay] = useState(false);
  const [error, setError] = useState("");
  const [bolt11, setBolt11] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoicePaying, setInvoicePaying] = useState(false);
  const [orderDetail, setOrderDetail] = useState<OfframpOrderFields | null>(
    null,
  );
  /** Set when WebLN returns a preimage — used for validate-payment.com proof link. */
  const [lightningPaymentPreimage, setLightningPaymentPreimage] = useState<
    string | null
  >(null);
  /** Shown after POST_SWAP_SUCCESS_DELAY_MS once swap tx is available (see poll). */
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);

  const [section, setSection] = useState<OfframpSection>("pay");

  const paymentSuccessDelayStartedRef = useRef(false);
  const paymentSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const idrNum = useMemo(() => Number(digitsOnly(idr) || "0"), [idr]);
  const satsNum = useMemo(() => Number(digitsOnly(sats) || "0"), [sats]);

  const recipientNormalized = useMemo(() => {
    if (payoutMethod === "gopay") return normalizeGopayMsisdn(recipient);
    return digitsOnly(recipient);
  }, [recipient, payoutMethod]);

  const recipientValid = useMemo(() => {
    const d = recipientNormalized;
    if (payoutMethod === "gopay") {
      // Require explicit country code format: +CC-NNN...
      return /^\+\d{1,3}-\d{6,14}$/.test(d);
    }
    // BCA account numbers are commonly 10 digits; allow 8–16 to reduce false negatives.
    return d.length >= 8 && d.length <= 16;
  }, [payoutMethod, recipientNormalized]);

  const amountValid = useMemo(() => {
    if (lastEdited === "idr") return Number.isFinite(idrNum) && idrNum > 0;
    return Number.isFinite(satsNum) && satsNum > 0;
  }, [idrNum, satsNum, lastEdited]);

  const canPay = useMemo(
    () => amountValid && recipientValid && !loadingPay,
    [amountValid, recipientValid, loadingPay],
  );

  useEffect(() => {
    let mounted = true;

    async function loadQuote() {
      try {
        setQuoteError("");
        const res = await backendFetch("/api/quote/btc-idr");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Quote failed");
        const next = Number(data.btcIdr);
        if (!Number.isFinite(next) || next <= 0)
          throw new Error("Invalid quote");
        if (!mounted) return;
        setBtcIdr(next);
        const nextUsdc = Number(data.usdcIdr);
        setUsdcIdr(Number.isFinite(nextUsdc) && nextUsdc > 0 ? nextUsdc : null);
      } catch (e) {
        if (!mounted) return;
        setQuoteError(e instanceof Error ? e.message : "Quote failed");
      }
    }

    loadQuote();
    const interval = setInterval(loadQuote, 120_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const syncFromHash = () => {
      setSection(sectionFromHash(window.location.hash));
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const goToSection = useCallback((next: OfframpSection) => {
    setSection(next);
    const h = hashForSection(next);
    window.history.replaceState(null, "", h ? `/offramp#${h}` : "/offramp");
  }, []);

  useEffect(() => {
    if (!btcIdr) return;
    if (bolt11) return;

    if (lastEdited === "idr") {
      const nextSats = Math.max(1, Math.ceil((idrNum / btcIdr) * 1e8));
      setSats(String(nextSats));
    } else {
      const nextIdr = Math.max(0, Math.floor((satsNum / 1e8) * btcIdr));
      setIdr(String(nextIdr));
    }
  }, [btcIdr, idrNum, satsNum, bolt11, lastEdited]);

  async function payViaWebln(invoice: string): Promise<{ preimage?: string }> {
    const provider = (window as unknown as { webln?: WebLnProvider }).webln;
    if (!provider) {
      throw new Error(
        "WebLN not available. Install/enable Alby or pay using the QR in another wallet.",
      );
    }
    await provider.enable();
    return provider.sendPayment(invoice);
  }

  const onPay = async () => {
    setError("");
    setLoadingPay(true);
    setBolt11(null);
    setOrderId(null);
    setOrderDetail(null);
    setLightningPaymentPreimage(null);
    setShowPaymentSuccess(false);
    paymentSuccessDelayStartedRef.current = false;
    if (paymentSuccessTimerRef.current) {
      clearTimeout(paymentSuccessTimerRef.current);
      paymentSuccessTimerRef.current = null;
    }
    setInvoiceOpen(false);
    try {
      const body =
        lastEdited === "idr"
          ? {
              idrAmount: idrNum,
              payoutMethod,
              recipientDetails: recipientNormalized,
            }
          : {
              satAmount: satsNum,
              payoutMethod,
              recipientDetails: recipientNormalized,
            };

      const res = await backendFetch("/api/offramp/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create invoice.");
      setBolt11(String(data.bolt11));
      setOrderId(String(data.orderId));
      setInvoiceOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invoice.");
    } finally {
      setLoadingPay(false);
    }
  };

  useEffect(() => {
    if (!invoiceOpen) {
      setShowPaymentSuccess(false);
      paymentSuccessDelayStartedRef.current = false;
      if (paymentSuccessTimerRef.current) {
        clearTimeout(paymentSuccessTimerRef.current);
        paymentSuccessTimerRef.current = null;
      }
    }
  }, [invoiceOpen]);

  useEffect(() => {
    if (!orderId || !invoiceOpen) return;
    const oid = orderId;

    let cancelled = false;

    async function poll() {
      try {
        const res = await backendFetch(
          `/api/order/${encodeURIComponent(oid)}/status`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const snapshot = data as OfframpOrderFields;
        setOrderDetail(snapshot);

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
        /* ignore transient network errors */
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
  }, [orderId, invoiceOpen, router]);

  useEffect(() => {
    if (!showPaymentSuccess || orderDetail?.state !== "COMPLETED" || !orderId)
      return;
    const oid = orderId;
    const t = setTimeout(() => {
      router.push(`/receipt?orderId=${encodeURIComponent(oid)}`);
    }, RECEIPT_REDIRECT_AFTER_TICK_MS);
    return () => clearTimeout(t);
  }, [showPaymentSuccess, orderDetail?.state, orderId, router]);

  const fundingSettled =
    orderDetail &&
    isFundingInvoiceSettled(orderDetail) &&
    orderDetail.state !== "FAILED" &&
    orderDetail.state !== "COMPLETED";
  const pipelineFailed = orderDetail?.state === "FAILED";

  /** Merge live bolt11, WebLN preimage, and form payout hints until API snapshot catches up. */
  const routeOrder: OfframpOrderFields | null = useMemo(() => {
    if (!orderDetail && !bolt11) return null;
    const base =
      orderDetail ?? ({ state: "ROUTE_SHOWN" } as OfframpOrderFields);
    return {
      ...base,
      invoiceBolt11: base.invoiceBolt11 || bolt11 || undefined,
      invoiceLnPreimage:
        lightningPaymentPreimage?.trim() || base.invoiceLnPreimage || undefined,
      p2pmPayoutMethod: base.p2pmPayoutMethod || payoutMethod,
      payoutRecipient: base.payoutRecipient || recipientNormalized || undefined,
    };
  }, [
    orderDetail,
    bolt11,
    lightningPaymentPreimage,
    payoutMethod,
    recipientNormalized,
  ]);

  const paymentProofHref =
    bolt11 && lightningPaymentPreimage
      ? buildValidatePaymentProofUrl(bolt11, lightningPaymentPreimage)
      : null;

  const primaryCurrency = activeCurrency;
  const primaryValue =
    primaryCurrency === "idr" ? formatIdrDotsFromDigits(idr) : sats;
  const primaryLabel = primaryCurrency === "idr" ? "IDR" : "sats";
  const secondaryPreview = useMemo(() => {
    if (!btcIdr) return null;
    if (primaryCurrency === "idr") {
      return `${formatIdr(Math.max(1, Math.ceil((idrNum / btcIdr) * 1e8)))} sats`;
    }
    return `IDR ${formatIdr(Math.max(0, Math.floor((satsNum / 1e8) * btcIdr)))}`;
  }, [btcIdr, idrNum, satsNum, primaryCurrency]);

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-2">
      <div className="mb-6">
        <h1 className="text-2xl font-black leading-tight text-white">
          Lightning in. Rupiah out.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Settle BTC over Lightning into IDR. Pay the LN invoice; we route
          liquidity via stablecoins to BCA or GoPay.{" "}
          <span className="text-zinc-300">
            We are the first platform to leverage{" "}
            <span className="mx-0.5 inline-flex items-center gap-1 align-middle">
              <IdrxMark size={22} alt="" />
              <span className="font-semibold text-zinc-200">IDRX</span>
            </span>{" "}
            to liquidate to IDR for your BCA account.
          </span>
        </p>
        <div className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-zinc-500">
          <TetherMark size={24} className="mt-0.5" />
          <p>
            <span className="font-semibold text-zinc-400">
              Powered by Tether.
            </span>{" "}
            Merchant-side settlement uses Tether WDK with USDT on-chain; agent
            routing runs Boltz (LN→USDT), LiFi (USDT→USDC), then local IDR
            rails.{" "}
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 align-middle">
              For BCA bank payouts, your order route shows{" "}
              <span className="inline-flex items-center gap-1">
                <IdrxMark size={16} alt="" className="translate-y-px" />
                <span className="font-semibold text-zinc-400">IDRX</span>
              </span>{" "}
              → IDR.
            </span>
          </p>
        </div>
      </div>

      <OfframpSectionTabs
        value={section}
        onChange={goToSection}
        className="mb-6"
      />

      {section === "pay" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-zinc-400">
                Amount to settle
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveCurrency("idr");
                    setLastEdited("idr");
                  }}
                  className={`tap-target rounded-full border px-4 py-3 text-sm font-extrabold uppercase tracking-wide ${
                    primaryCurrency === "idr"
                      ? "border-gold text-gold"
                      : "border-border text-zinc-300"
                  }`}
                >
                  IDR
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveCurrency("sats");
                    setLastEdited("sats");
                  }}
                  className={`tap-target rounded-full border px-4 py-3 text-sm font-extrabold uppercase tracking-wide ${
                    primaryCurrency === "sats"
                      ? "border-gold text-gold"
                      : "border-border text-zinc-300"
                  }`}
                >
                  sats
                </button>
                <button
                  type="button"
                  aria-label="Swap IDR/sats input"
                  onClick={() => {
                    const next = activeCurrency === "idr" ? "sats" : "idr";
                    setActiveCurrency(next);
                    setLastEdited(next);
                  }}
                  className="tap-target grid place-items-center rounded-full border border-border bg-transparent px-4 py-3 text-zinc-200"
                >
                  {/* up/down swap icon */}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M8 7h10m0 0-3-3m3 3-3 3"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M16 17H6m0 0 3 3m-3-3 3-3"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-center justify-center gap-2">
              <div className="flex items-baseline gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={primaryValue}
                  onChange={(e) => {
                    const v = digitsOnly(e.target.value);
                    setLastEdited(primaryCurrency);
                    if (primaryCurrency === "idr") setIdr(v);
                    else setSats(v);
                  }}
                  className="w-[12ch] bg-transparent text-center text-6xl font-black tracking-tight text-zinc-100 outline-none"
                  aria-label={`${primaryLabel} amount`}
                />
                <span className="text-xl font-extrabold tracking-wide text-zinc-300">
                  {primaryLabel}
                </span>
              </div>
              <div className="text-sm text-zinc-400">
                {secondaryPreview ? (
                  <span>≈ {secondaryPreview}</span>
                ) : (
                  <span>Loading quote…</span>
                )}
              </div>
            </div>

            <button
              type="button"
              className="tap-target mt-6 flex w-full items-center justify-between rounded-2xl border border-border bg-black/20 px-4 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                {/* wallet icon */}
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-black/30 text-zinc-200">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 7.5A3.5 3.5 0 0 1 6.5 4h11A3.5 3.5 0 0 1 21 7.5v9A3.5 3.5 0 0 1 17.5 20h-11A3.5 3.5 0 0 1 3 16.5v-9Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M21 9h-5a2 2 0 0 0 0 4h5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M16.5 11h.01"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-zinc-300">
                    Per-order limit
                  </p>
                  <p className="text-sm font-black text-zinc-100">
                    <span className="text-gold">100</span> USDC
                  </p>
                  {btcIdr && usdcIdr ? (
                    <p className="mt-0.5 text-xs text-zinc-400">
                      ≈ {formatIdr(Math.ceil(((100 * usdcIdr) / btcIdr) * 1e8))}{" "}
                      sats
                    </p>
                  ) : null}
                </div>
              </div>
              <span className="text-xl font-black text-zinc-400">{">"}</span>
            </button>

            <div className="mt-6 text-center text-xs text-zinc-500">
              {btcIdr ? (
                <p>
                  1 BTC ≈{" "}
                  <span className="text-zinc-300">
                    IDR {formatIdr(Math.round(btcIdr))}
                  </span>
                </p>
              ) : null}
              {quoteError ? (
                <p className="mt-1 text-red-400">{quoteError}</p>
              ) : null}
              <p className="mt-1">
                IDR amounts round up to the next sat so the invoice always
                covers the IDR you entered.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 text-xs uppercase tracking-wide text-zinc-400">
              Where to send IDR
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPayoutMethod("bank_transfer")}
                className={`tap-target rounded-xl border px-3 py-2 text-sm font-bold ${
                  payoutMethod === "bank_transfer"
                    ? "border-gold text-gold"
                    : "border-border text-zinc-300"
                }`}
              >
                BCA
              </button>
              <button
                type="button"
                onClick={() => setPayoutMethod("gopay")}
                className={`tap-target rounded-xl border px-3 py-2 text-sm font-bold ${
                  payoutMethod === "gopay"
                    ? "border-gold text-gold"
                    : "border-border text-zinc-300"
                }`}
              >
                GoPay
              </button>
            </div>

            {payoutMethod === "bank_transfer" ? (
              <div className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-zinc-500">
                <IdrxMark size={20} alt="" className="mt-0.5 shrink-0" />
                <p>
                  <span className="font-semibold text-zinc-400">IDRX</span> —
                  BCA bank accounts settle with liquidation to IDR — follow the
                  route steps after you pay.
                </p>
              </div>
            ) : null}

            <label className="mt-4 block text-sm font-semibold text-zinc-300">
              {payoutMethod === "gopay"
                ? "GoPay mobile number"
                : "BCA account number"}
            </label>
            <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
              <input
                type={payoutMethod === "gopay" ? "tel" : "text"}
                inputMode={payoutMethod === "gopay" ? "tel" : "numeric"}
                autoComplete={payoutMethod === "gopay" ? "tel" : "off"}
                enterKeyHint="done"
                placeholder={
                  payoutMethod === "gopay" ? "+CC-NNN…" : "xxxxxxxxxx"
                }
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="tap-target w-full rounded-xl border border-border bg-card px-4 py-3 text-lg font-bold text-white outline-none focus:border-gold"
              />
              <button
                type="button"
                onClick={() => router.push("/scan")}
                className="tap-target whitespace-nowrap rounded-xl border border-border bg-transparent px-3 py-3 text-sm font-bold text-zinc-200"
              >
                Scan QR
              </button>
            </div>
            {!recipientValid && recipient ? (
              <p className="mt-2 text-xs text-red-400">
                {payoutMethod === "gopay"
                  ? "Enter GoPay number in +CC-NNN… format."
                  : "Enter a valid BCA account number."}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-zinc-500">
              Need to read a merchant QRIS first? Use Scan — your payout details
              here are still BCA or GoPay.
            </p>
          </div>

          <Button
            type="button"
            onClick={onPay}
            loading={loadingPay}
            disabled={!canPay}
            className="gold-gradient"
          >
            {payoutMethod === "gopay"
              ? "Pay (GoPay payout)"
              : "Pay (BCA payout)"}
          </Button>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>
      ) : null}

      {section === "how" ? <HowItWorks className="mt-0" /> : null}
      {section === "gifts" ? <GiftCardsSection className="mt-0" /> : null}
      {section === "merchant" ? (
        <MerchantCta className="mt-0 scroll-mt-24" />
      ) : null}

      {section === "pay" ? (
        <footer className="mt-12 border-t border-border pt-6 text-center text-xs leading-relaxed text-zinc-600">
          Paysats — Lightning settlement for Indonesia
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-zinc-500">
            <TetherMark size={18} />
            <span>Powered by Tether · WDK · Boltz · LiFi</span>
          </div>
        </footer>
      ) : null}

      {invoiceOpen && bolt11 ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur sm:items-center"
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-zinc-950 p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-zinc-200">
                Pay with Lightning
              </p>
              <button
                type="button"
                onClick={() => setInvoiceOpen(false)}
                className="tap-target rounded-lg px-3 py-2 text-sm font-bold text-zinc-300 hover:text-white"
              >
                Close
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
                {orderId ? (
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
                ) : null}
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
            ) : fundingSettled ? (
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
                    <OfframpRouteExpandable order={routeOrder} defaultOpen />
                  ) : null}
                  {orderId ? (
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
                  ) : null}
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
                      Your Lightning payment is in. Routing to IDR usually takes{" "}
                      <span className="font-semibold text-zinc-300">
                        about one to two minutes
                      </span>
                      .
                    </p>
                    <p className="text-xs text-zinc-500">
                      Funds move through automated swaps and payout partners
                      (Boltz, LiFi, and your chosen rail) in the background.
                      {orderDetail?.p2pmPayoutMethod === "bank_transfer"
                        ? " For BCA, the route reflects IDRX → IDR on your bank payout."
                        : null}
                      {isSwapSuccessMilestone(orderDetail)
                        ? ` USDC swap is in — success screen in ~${Math.ceil(POST_SWAP_SUCCESS_DELAY_MS / 1000)}s…`
                        : null}
                    </p>
                  </div>
                  {orderId ? (
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
                  ) : null}
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
                    <OfframpRouteExpandable order={routeOrder} defaultOpen />
                  ) : null}
                </div>
              )
            ) : (
              <>
                <InvoiceQrDisplay
                  bolt11={bolt11}
                  amountSats={Number(digitsOnly(sats) || "0") || undefined}
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
                  {orderId ? (
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
                  ) : null}
                  <p className="text-center text-xs text-zinc-500">
                    After the invoice is paid, settlement runs automatically:
                    Lightning → stablecoins → IDR to your account.
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
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
