"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GiftCardsSection } from "@/components/gift-cards-section";
import { HowItWorks } from "@/components/how-it-works";
import { MerchantCta } from "@/components/merchant-cta";
import {
  hashForSection,
  OfframpSectionTabs,
  sectionFromHash,
  type OfframpSection,
} from "@/components/offramp-section-tabs";
import { IdrxLiquiditySection } from "@/components/idrx-liquidity-section";
import { IdrxMark } from "@/components/idrx-mark";
import { TetherMark } from "@/components/tether-mark";
import { backendFetch } from "@/lib/backend-fetch";
import { formatSatsAsBtc } from "@/lib/format-sats-btc";
import { isIdrxEwalletBankCode } from "@/lib/idrx-payout-classify";

type IdrxMethodRow = {
  bankCode: string;
  bankName: string;
  maxAmountTransfer?: string;
  kind: "bank" | "ewallet";
};

/** Same rails as backend `isIdrxEwalletBankCode`; display order matches product list. */
const EWALLET_CODE_ORDER = [
  "911",
  "789",
  "1010",
  "1011",
  "1012",
  "1013",
  "1014",
] as const;

const GOPAY_BANK_CODE = "1011";

function defaultEwalletBankCode(methods: IdrxMethodRow[]): string {
  const goPay = methods.find((m) => m.bankCode === GOPAY_BANK_CODE);
  return goPay?.bankCode ?? methods[0]!.bankCode;
}

/** Single control for POST /api/offramp/create `depositChannel`. */
type FundingSource = "lightning" | "cbbtc" | "btcb";
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

export default function OfframpPage() {
  const router = useRouter();

  const [idrxMethods, setIdrxMethods] = useState<IdrxMethodRow[]>([]);
  const [idrxMethodsError, setIdrxMethodsError] = useState("");
  const [idrxBankCode, setIdrxBankCode] = useState("");
  const [payoutRailTab, setPayoutRailTab] = useState<"bank" | "ewallet">(
    "bank",
  );
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
  const [fundingSource, setFundingSource] = useState<FundingSource>("lightning");

  const [section, setSection] = useState<OfframpSection>("pay");

  const idrNum = useMemo(() => Number(digitsOnly(idr) || "0"), [idr]);
  const satsNum = useMemo(() => Number(digitsOnly(sats) || "0"), [sats]);

  const bankMethods = useMemo(() => {
    const banks = idrxMethods.filter((m) => !isIdrxEwalletBankCode(m.bankCode));
    return [...banks].sort((a, b) => {
      if (a.bankCode === "014" && b.bankCode !== "014") return -1;
      if (b.bankCode === "014" && a.bankCode !== "014") return 1;
      return a.bankName.localeCompare(b.bankName, "id-ID");
    });
  }, [idrxMethods]);

  const ewalletMethods = useMemo(() => {
    const ew = idrxMethods.filter((m) => isIdrxEwalletBankCode(m.bankCode));
    const rank = new Map<string, number>(
      EWALLET_CODE_ORDER.map((c, i) => [c, i]),
    );
    return [...ew].sort(
      (a, b) =>
        (rank.get(a.bankCode) ?? 99) - (rank.get(b.bankCode) ?? 99),
    );
  }, [idrxMethods]);

  const selectedIdrxMethod = useMemo(
    () => idrxMethods.find((m) => m.bankCode === idrxBankCode),
    [idrxMethods, idrxBankCode],
  );

  const payoutIsEwallet = payoutRailTab === "ewallet";

  const recipientNormalized = useMemo(() => {
    if (payoutIsEwallet) return normalizeGopayMsisdn(recipient);
    return digitsOnly(recipient);
  }, [recipient, payoutIsEwallet]);

  const recipientValid = useMemo(() => {
    const d = recipientNormalized;
    if (payoutIsEwallet) {
      if (/^\+\d{1,3}-\d{6,14}$/.test(d)) return true;
      const bare = digitsOnly(d);
      return /^\d{10,15}$/.test(bare);
    }
    return d.length >= 8 && d.length <= 16;
  }, [payoutIsEwallet, recipientNormalized]);

  const amountValid = useMemo(() => {
    if (lastEdited === "idr") return Number.isFinite(idrNum) && idrNum > 0;
    return Number.isFinite(satsNum) && satsNum > 0;
  }, [idrNum, satsNum, lastEdited]);

  const canPay = useMemo(
    () =>
      amountValid &&
      recipientValid &&
      !loadingPay &&
      Boolean(idrxBankCode) &&
      idrxMethods.length > 0 &&
      !idrxMethodsError &&
      (payoutRailTab === "bank"
        ? bankMethods.length > 0
        : ewalletMethods.length > 0),
    [
      amountValid,
      recipientValid,
      loadingPay,
      idrxBankCode,
      idrxMethods.length,
      idrxMethodsError,
      payoutRailTab,
      bankMethods.length,
      ewalletMethods.length,
    ],
  );

  useEffect(() => {
    if (!idrxMethods.length) return;
    if (payoutRailTab === "bank") {
      if (!bankMethods.length) return;
      if (!bankMethods.some((m) => m.bankCode === idrxBankCode)) {
        setIdrxBankCode(bankMethods[0]!.bankCode);
      }
    } else {
      if (!ewalletMethods.length) return;
      if (!ewalletMethods.some((m) => m.bankCode === idrxBankCode)) {
        setIdrxBankCode(defaultEwalletBankCode(ewalletMethods));
      }
    }
  }, [payoutRailTab, idrxMethods, bankMethods, ewalletMethods, idrxBankCode]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setIdrxMethodsError("");
        const res = await backendFetch("/api/idrx/transaction-methods");
        const body = (await res.json()) as {
          error?: string;
          data?: IdrxMethodRow[];
        };
        if (!res.ok) throw new Error(body.error || "Failed to load payout methods");
        const rows = Array.isArray(body.data) ? body.data : [];
        if (!mounted) return;
        setIdrxMethods(rows);
        setIdrxBankCode((prev) => {
          const banks = rows.filter((r) => !isIdrxEwalletBankCode(r.bankCode));
          const bcaFirst = [...banks].sort((a, b) => {
            if (a.bankCode === "014" && b.bankCode !== "014") return -1;
            if (b.bankCode === "014" && a.bankCode !== "014") return 1;
            return a.bankName.localeCompare(b.bankName, "id-ID");
          });
          const defaultBank = bcaFirst[0]?.bankCode ?? rows[0]?.bankCode ?? "";
          if (
            prev &&
            rows.some((r) => r.bankCode === prev) &&
            !isIdrxEwalletBankCode(prev)
          ) {
            return prev;
          }
          return defaultBank;
        });
        setPayoutRailTab("bank");
      } catch (e) {
        if (!mounted) return;
        setIdrxMethods([]);
        setIdrxMethodsError(
          e instanceof Error ? e.message : "Failed to load payout methods",
        );
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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

    if (lastEdited === "idr") {
      const nextSats = Math.max(1, Math.ceil((idrNum / btcIdr) * 1e8));
      setSats(String(nextSats));
    } else {
      const nextIdr = Math.max(0, Math.floor((satsNum / 1e8) * btcIdr));
      setIdr(String(nextIdr));
    }
  }, [btcIdr, idrNum, satsNum, lastEdited]);

  const onPay = async () => {
    setError("");
    setLoadingPay(true);
    try {
      const idrxBankName = selectedIdrxMethod?.bankName?.trim() ?? "";
      if (!idrxBankCode || !idrxBankName) {
        throw new Error("Select a payout bank or e-wallet.");
      }
      const body =
        lastEdited === "idr"
          ? {
              idrAmount: idrNum,
              payoutMethod: "bank_transfer" as const,
              idrxBankCode,
              idrxBankName,
              recipientDetails: recipientNormalized,
              depositChannel: fundingSource,
            }
          : {
              satAmount: satsNum,
              payoutMethod: "bank_transfer" as const,
              idrxBankCode,
              idrxBankName,
              recipientDetails: recipientNormalized,
              depositChannel: fundingSource,
            };

      const res = await backendFetch("/api/offramp/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create invoice.");
      router.push(`/order/${encodeURIComponent(String(data.orderId))}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invoice.");
    } finally {
      setLoadingPay(false);
    }
  };

  const primaryCurrency = activeCurrency;
  const primaryValue =
    primaryCurrency === "idr" ? formatIdrDotsFromDigits(idr) : sats;
  const primaryLabel = primaryCurrency === "idr" ? "IDR" : "SATS";
  const secondaryPreview = useMemo(() => {
    if (!btcIdr) return null;
    const wrappedOnchain =
      fundingSource === "cbbtc" || fundingSource === "btcb";
    if (primaryCurrency === "idr") {
      const satsIn = Math.max(1, Math.ceil((idrNum / btcIdr) * 1e8));
      const btcBit =
        wrappedOnchain && satsIn > 0 ? ` · ≈ ${formatSatsAsBtc(satsIn)} BTC` : "";
      return `≈ ${formatIdr(satsIn)} sats in${btcBit}`;
    }
    const rpOut = Math.max(0, Math.floor((satsNum / 1e8) * btcIdr));
    const btcBit =
      wrappedOnchain && satsNum > 0 ? ` · ≈ ${formatSatsAsBtc(satsNum)} BTC` : "";
    return `≈ ${formatIdr(rpOut)} rupiah out${btcBit}`;
  }, [btcIdr, idrNum, satsNum, primaryCurrency, fundingSource]);

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-2">
      <div className="mb-6">
        <h1 className="text-2xl font-black leading-tight text-white">
          Sats in. Rupiah out.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Settle BTC over Lightning: sats in on the invoice, rupiah out to your
          rail. Pay the LN invoice; we route
          liquidity via stablecoins, then{" "}
          <span className="mx-0.5 inline-flex items-center gap-1 align-middle font-semibold text-zinc-300">
            <IdrxMark size={22} alt="" />
            IDRX
          </span>{" "}
          burn and redeem to the bank or e-wallet you pick below.
        </p>
        <div className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-zinc-500">
          <TetherMark size={24} className="mt-0.5" />
          <p>
            <span className="font-semibold text-zinc-400">
              Powered by Tether.
            </span>{" "}
            Merchant-side settlement uses Tether WDK with USDT on-chain; agent
            routing runs Boltz (LN→USDT), LiFi (USDT→IDRX on Base), then
            rupiah out on your payout rail.{" "}
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 align-middle">
              Your order route shows{" "}
              <span className="inline-flex items-center gap-1">
                <IdrxMark size={16} alt="" className="translate-y-px" />
                <span className="font-semibold text-zinc-400">IDRX</span>
              </span>{" "}
              → Rupiah on your selected rail.
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
                Sats in / Rupiah out
              </p>
              <div className="flex items-center gap-2">
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
                    SATS
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="Swap between IDR and SATS entry"
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

            <div className="mt-5 rounded-xl border border-border bg-black/15 p-3">
              <label
                htmlFor="offramp-funding-source"
                className="text-xs font-medium text-zinc-500"
              >
                Pay with
              </label>
              <select
                id="offramp-funding-source"
                value={fundingSource}
                onChange={(e) =>
                  setFundingSource(e.target.value as FundingSource)
                }
                className="tap-target mt-2 w-full appearance-none rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-white outline-none focus:border-gold"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23a1a1aa'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 0.75rem center",
                  backgroundSize: "1.25rem",
                  paddingRight: "2.5rem",
                }}
              >
                <option value="lightning">
                  Bitcoin / Lightning — LN invoice (Boltz → USDT)
                </option>
                <option value="cbbtc">cbBTC on Base — send to WDK Safe</option>
                <option value="btcb">BTCB on BNB Chain — send to WDK Safe</option>
              </select>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                {fundingSource === "lightning"
                  ? "LN invoice QR on the next step."
                  : fundingSource === "cbbtc"
                    ? "On-chain QR (Base cbBTC → Safe)."
                    : "On-chain QR (BNB BTCB → Safe)."}
              </p>
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
                  aria-label={`${primaryCurrency === "idr" ? "IDR" : "SATS"} amount`}
                />
                <span className="hidden text-xl font-extrabold tracking-wide text-zinc-300 md:inline">
                  {primaryLabel}
                </span>
              </div>
              <div className="text-sm text-zinc-400">
                {secondaryPreview ? (
                  <span>{secondaryPreview}</span>
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
                      sats in
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
                    {formatIdr(Math.round(btcIdr))} rupiah out (spot)
                  </span>
                </p>
              ) : null}
              {quoteError ? (
                <p className="mt-1 text-red-400">{quoteError}</p>
              ) : null}
              <p className="mt-1">
                Rupiah out is covered by rounding sats in up on the invoice so
                the Lightning payment always meets the rupiah out you entered.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 text-xs uppercase tracking-wide text-zinc-400">
              Rupiah out — destination
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPayoutRailTab("bank")}
                className={`tap-target rounded-xl border px-3 py-2 text-sm font-bold ${
                  payoutRailTab === "bank"
                    ? "border-gold text-gold"
                    : "border-border text-zinc-300"
                }`}
              >
                BANK
              </button>
              <button
                type="button"
                onClick={() => setPayoutRailTab("ewallet")}
                className={`tap-target rounded-xl border px-3 py-2 text-sm font-bold ${
                  payoutRailTab === "ewallet"
                    ? "border-gold text-gold"
                    : "border-border text-zinc-300"
                }`}
              >
                E-Wallets
              </button>
            </div>

            <label
              htmlFor={
                payoutRailTab === "bank"
                  ? "offramp-bank-rail"
                  : "offramp-ewallet-rail"
              }
              className="mt-4 block text-xs font-medium text-zinc-500"
            >
              {payoutRailTab === "bank"
                ? "Bank (IDRX list)"
                : "E-wallet (IDRX redeem)"}
            </label>
            <select
              key={payoutRailTab}
              id={
                payoutRailTab === "bank"
                  ? "offramp-bank-rail"
                  : "offramp-ewallet-rail"
              }
              value={idrxBankCode}
              onChange={(e) => setIdrxBankCode(e.target.value)}
              disabled={
                !idrxMethods.length ||
                (payoutRailTab === "bank"
                  ? !bankMethods.length
                  : !ewalletMethods.length)
              }
              className="tap-target mt-2 w-full appearance-none rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-white outline-none focus:border-gold disabled:opacity-50"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23a1a1aa'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 0.75rem center",
                backgroundSize: "1.25rem",
                paddingRight: "2.5rem",
              }}
            >
              {(payoutRailTab === "bank" ? bankMethods : ewalletMethods).map(
                (m) => (
                  <option key={m.bankCode} value={m.bankCode}>
                    {m.bankName}
                  </option>
                ),
              )}
            </select>
            {payoutRailTab === "ewallet" && !ewalletMethods.length ? (
              <p className="mt-2 text-xs text-amber-400">
                No supported e-wallets returned from IDRX for this environment.
              </p>
            ) : null}
            {idrxMethodsError ? (
              <p className="mt-2 text-xs text-red-400">{idrxMethodsError}</p>
            ) : null}

            <div className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-zinc-500">
              <IdrxMark size={20} alt="" className="mt-0.5 shrink-0" />
              <p>
                <span className="font-semibold text-zinc-400">IDRX</span> —
                {payoutIsEwallet
                  ? " LinkAja, IMKAS, OVO, GoPay, DANA, ShopeePay, and LinkAja Direct — enter the mobile number registered on that wallet (+CC-NNN…)."
                  : " Pick your bank (BCA first in the list). Settlement is IDRX liquidation to Rupiah on your account number."}
              </p>
            </div>

            <label className="mt-4 block text-sm font-semibold text-zinc-300">
              {payoutIsEwallet
                ? "E-wallet mobile number"
                : "Bank account number"}
            </label>
            <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
              <input
                type={payoutIsEwallet ? "tel" : "text"}
                inputMode={payoutIsEwallet ? "tel" : "numeric"}
                autoComplete={payoutIsEwallet ? "tel" : "off"}
                enterKeyHint="done"
                placeholder={
                  payoutIsEwallet ? "+CC-NNN…" : "xxxxxxxxxx"
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
                {payoutIsEwallet
                  ? "Enter your e-wallet number in +CC-NNN… format."
                  : "Enter a valid bank account number (digits)."}
              </p>
            ) : null}

            <p className="mt-2 text-xs text-zinc-500">
              Need to read a merchant QRIS first? Use Scan — your payout rail
              is still the BANK or E-Wallet you selected above.
            </p>
          </div>

          <Button
            type="button"
            onClick={onPay}
            loading={loadingPay}
            disabled={!canPay}
            className="gold-gradient"
          >
            {selectedIdrxMethod
              ? `Pay (${selectedIdrxMethod.bankName})`
              : "Pay"}
          </Button>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>
      ) : null}

      {section === "liquidity" ? <IdrxLiquiditySection className="mt-0" /> : null}
      {section === "how" ? <HowItWorks className="mt-0" /> : null}
      {section === "gifts" ? <GiftCardsSection className="mt-0" /> : null}
      {section === "merchant" ? (
        <MerchantCta className="mt-0 scroll-mt-24" />
      ) : null}

      {section === "pay" || section === "liquidity" ? (
        <footer className="mt-12 border-t border-border pt-6 text-center text-xs leading-relaxed text-zinc-600">
          Paysats — Lightning settlement for Indonesia
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-zinc-500">
            <TetherMark size={18} />
            <span>Powered by Tether · WDK · Boltz · LiFi</span>
          </div>
        </footer>
      ) : null}

    </main>
  );
}
