/**
 * Build expandable “route” hops for the offramp pipeline.
 * Bank: LN → Boltz → LiFi (USDT→IDRX Base) → burn/redeem → IDR.
 * GoPay: LN → Boltz → LiFi (USDT→USDC) → p2p.me → IDR.
 */
import { ORDER_STATES, type OrderState } from "@/lib/state";

export type OfframpOrderFields = {
  state?: OrderState | string | null;
  satAmount?: number | null;
  merchantName?: string | null;
  invoicePaidAt?: string | null;
  invoicePaymentHash?: string | null;
  invoiceBolt11?: string | null;
  /** User funding invoice preimage when known (e.g. WebLN on client — not always on server). */
  invoiceLnPreimage?: string | null;
  boltzSwapId?: string | null;
  /** BOLT11 for the Boltz swap (paid by agent). */
  boltzLnInvoice?: string | null;
  /** Preimage after NWC pays the Boltz invoice — pairs with boltzLnInvoice on validate-payment.com. */
  boltzLnPreimage?: string | null;
  boltzTxHash?: string | null;
  swapTxHash?: string | null;
  p2pmOrderId?: string | null;
  p2pmPayoutMethod?: string | null;
  payoutRecipient?: string | null;
  idrAmount?: number | null;
  usdtAmount?: number | null;
  usdcAmount?: number | null;
  idrxAmountIdr?: number | null;
  idrxBurnTxHash?: string | null;
  idrxRedeemId?: string | null;
};

export type RouteHopLink = { label: string; href: string };

export type RouteHop = {
  id: string;
  title: string;
  description: string;
  status: "pending" | "active" | "done";
  links: RouteHopLink[];
};

const VALIDATE_PAYMENT_ORIGIN = "https://validate-payment.com/";
/** Swap + claim UI (automation waits for “OPEN CLAIM TRANSACTION” on this page). */
const BOLTZ_BETA_SWAP_BASE = "https://beta.boltz.exchange/swap/";
const ARBISCAN_TX = "https://arbiscan.io/tx/";
const BASESCAN_TX = "https://basescan.org/tx/";
const P2P_APP = "https://app.p2p.me";
const IDRX_DOCS = "https://docs.idrx.co/integration/processing-redeem-idrx-requests";

/** @see https://validate-payment.com/ — invoice + preimage proof (same pattern as user funding proof). */
function buildValidatePaymentProofHref(invoice: string, preimage: string): string {
  const pre = preimage.replace(/^0x/i, "").trim();
  return `${VALIDATE_PAYMENT_ORIGIN}?${new URLSearchParams({ invoice, preimage: pre }).toString()}`;
}

/** Invoice-only validation URL (preimage added on proof link once NWC returns it). */
function buildValidatePaymentInvoiceHref(invoice: string): string {
  return `${VALIDATE_PAYMENT_ORIGIN}?${new URLSearchParams({ invoice }).toString()}`;
}

function boltzBetaSwapPageHref(swapId: string): string {
  return `${BOLTZ_BETA_SWAP_BASE}${encodeURIComponent(swapId)}`;
}

function idx(state: string): number {
  const i = ORDER_STATES.indexOf(state as OrderState);
  return i >= 0 ? i : 0;
}

/**
 * When `state === FAILED`, the enum index is after every success state, so naive `si >= step`
 * marks every hop as done. Infer real progress from persisted order fields instead.
 */
function progressIndexWhenFailed(order: OfframpOrderFields): number {
  if (order.idrxRedeemId?.trim()) return idx("P2PM_ORDER_CONFIRMED");
  if (order.idrxBurnTxHash?.trim()) return idx("P2PM_ORDER_PLACED");
  if (order.swapTxHash) return idx("USDC_SWAPPED");
  if (order.p2pmOrderId) return idx("P2PM_ORDER_PLACED");
  if (order.usdtAmount != null && order.usdtAmount > 0) return idx("USDT_RECEIVED");
  if (order.boltzSwapId) return idx("BOLTZ_SWAP_PENDING");
  if (order.invoicePaidAt) return idx("LN_INVOICE_PAID");
  return idx("ROUTE_SHOWN");
}

/** Index used for linear hop progress. For FAILED orders, capped by on-chain / persisted evidence. */
function effectiveStateIndex(order: OfframpOrderFields, stateStr: string): number {
  const raw = idx(stateStr);
  if (stateStr !== "FAILED") return raw;
  return progressIndexWhenFailed(order);
}

export function maskPayoutRecipient(
  method: string | null | undefined,
  raw: string | null | undefined,
): string {
  if (!raw) return "—";
  const mth = (method || "").toLowerCase();
  if (mth === "gopay") {
    const m = raw.trim().match(/^(\+\d{1,3}-)(\d+)$/);
    if (m && m[2].length >= 4) return `${m[1]}···${m[2].slice(-4)}`;
    return "···";
  }
  const d = raw.replace(/\D/g, "");
  if (d.length <= 4) return "····";
  return `···${d.slice(-4)}`;
}

function payoutLabel(method: string | null | undefined): string {
  const m = (method || "").toLowerCase();
  if (m === "gopay") return "GoPay";
  if (m === "bank_transfer") return "BCA";
  return "Bank / wallet";
}

export function buildOfframpRouteHops(order: OfframpOrderFields | null | undefined): RouteHop[] {
  if (!order) return [];

  const bankBca =
    String(order.p2pmPayoutMethod || "").toLowerCase() === "bank_transfer";

  const stateStr = String(order.state || "ROUTE_SHOWN");
  const si = effectiveStateIndex(order, stateStr);
  const routeShown = idx("ROUTE_SHOWN");
  const lnPaid = idx("LN_INVOICE_PAID");
  const usdtRecv = idx("USDT_RECEIVED");
  const usdcSwapped = idx("USDC_SWAPPED");
  const failed = stateStr === "FAILED";

  const hopStatus = (done: boolean, active: boolean): RouteHop["status"] => {
    if (failed && !done) return "pending";
    if (done) return "done";
    if (active) return "active";
    return "pending";
  };

  const swapTxReady = Boolean(order.swapTxHash?.trim());
  const idrxBurnReady = Boolean(order.idrxBurnTxHash?.trim());
  const idrxRedeemReady = Boolean(order.idrxRedeemId?.trim());

  /** GoPay: after LiFi, treat tail as done once swap tx known (p2p off-chain). Bank: after redeem id. */
  const tailMilestonesDone = !failed && (bankBca ? idrxRedeemReady : swapTxReady);
  const tailMilestonesActive =
    !failed &&
    !tailMilestonesDone &&
    (stateStr === "USDC_SWAPPED" ||
      stateStr === "P2PM_ORDER_PLACED" ||
      stateStr === "P2PM_ORDER_CONFIRMED" ||
      stateStr === "IDR_SETTLED");

  const fundingDone = Boolean(order.invoicePaidAt) || si > routeShown;
  const boltzAgentDone = si >= usdtRecv;
  const boltzAgentActive = si >= lnPaid && si < usdtRecv;

  const liFiDone = si >= usdcSwapped;
  const liFiActive = si >= usdtRecv && si < usdcSwapped;

  const hops: RouteHop[] = [];

  // 1. User’s Lightning invoice
  const fundingLinks: RouteHopLink[] = [];
  const fundInv = order.invoiceBolt11?.trim();
  const fundPre = order.invoiceLnPreimage?.trim();
  if (fundInv?.startsWith("ln") && fundPre) {
    fundingLinks.push({
      label: "Lightning payment proof (funding)",
      href: buildValidatePaymentProofHref(fundInv, fundPre),
    });
  } else if (fundInv?.startsWith("ln")) {
    fundingLinks.push({
      label: "Lightning invoice (validate-payment.com)",
      href: buildValidatePaymentInvoiceHref(fundInv),
    });
  }

  const fundingDesc = fundingDone
    ? `Funding invoice settled on Lightning.${
        order.invoicePaymentHash
          ? ` Payment hash: ${order.invoicePaymentHash.slice(0, 18)}…`
          : ""
      }`
    : "Pay the QR invoice (or WebLN) to start the route.";

  hops.push({
    id: "funding-ln",
    title: "Your Lightning payment",
    description: fundingDesc,
    status: hopStatus(fundingDone, !fundingDone && si <= routeShown),
    links: fundingLinks,
  });

  // 2. Agent pays Boltz swap invoice (LN → USDT Arbitrum)
  const boltzLinks: RouteHopLink[] = [];
  const boltzInv = order.boltzLnInvoice?.trim();
  const boltzPre = order.boltzLnPreimage?.trim();
  if (boltzInv?.startsWith("ln") && boltzPre) {
    boltzLinks.push({
      label: "Lightning payment proof (Boltz invoice)",
      href: buildValidatePaymentProofHref(boltzInv, boltzPre),
    });
  } else if (boltzInv?.startsWith("ln")) {
    boltzLinks.push({
      label: "Lightning invoice (validate-payment.com)",
      href: buildValidatePaymentInvoiceHref(boltzInv),
    });
  }
  const boltzSid = order.boltzSwapId?.trim();
  if (boltzSid) {
    boltzLinks.push({
      label: "View swap on Boltz",
      href: boltzBetaSwapPageHref(boltzSid),
    });
  }
  if (order.boltzTxHash) {
    boltzLinks.push({
      label: "Open claim transaction (Arbiscan)",
      href: `${ARBISCAN_TX}${order.boltzTxHash}`,
    });
  }

  hops.push({
    id: "agent-boltz",
    title: "Agent pays Boltz swap invoice",
    description: boltzAgentDone
      ? "Operator wallet paid the Boltz Lightning invoice; USDT routes to the agent address on Arbitrum."
      : boltzAgentActive
        ? "Paying Boltz invoice and confirming USDT on Arbitrum…"
        : "Waiting for your Lightning payment first.",
    status: hopStatus(boltzAgentDone, boltzAgentActive),
    links: boltzLinks,
  });

  // 3. LiFi — USDC (GoPay) or IDRX (BCA bank)
  const swapLinks: RouteHopLink[] = [];
  if (order.swapTxHash) {
    swapLinks.push({
      label: bankBca
        ? "USDT → IDRX (Arbitrum userOp / tx)"
        : "USDT → USDC (Arbitrum userOp / tx)",
      href: `${ARBISCAN_TX}${order.swapTxHash}`,
    });
  }

  const lifiTitle = bankBca
    ? "LiFi: USDT → IDRX (Arbitrum → Base)"
    : "LiFi: USDT → USDC (Arbitrum → Base)";
  const lifiDescDone = bankBca
    ? "Cross-chain swap submitted; IDRX lands on the Base custody wallet for burn & redeem."
    : "Cross-chain swap submitted; USDC targets your Base recipient.";
  const lifiDescActive = bankBca
    ? "Quoting LiFi, approving USDT, bridging to Base IDRX…"
    : "Quoting LiFi, approving USDT, executing bridge/swap…";

  hops.push({
    id: "lifi",
    title: lifiTitle,
    description: liFiDone
      ? lifiDescDone
      : liFiActive
        ? lifiDescActive
        : "Runs after USDT is available on the agent Safe.",
    status: hopStatus(liFiDone, liFiActive),
    links: swapLinks,
  });

  // 4. BCA: IDRX burn + redeem API — GoPay: p2p.me
  if (bankBca) {
    const idrxLinks: RouteHopLink[] = [{ label: "IDRX redeem docs", href: IDRX_DOCS }];
    if (order.idrxBurnTxHash?.trim()) {
      idrxLinks.unshift({
        label: "IDRX burn (Base)",
        href: `${BASESCAN_TX}${order.idrxBurnTxHash.trim()}`,
      });
    }

    hops.push({
      id: "idrx-burn-redeem",
      title: "IDRX burn & redeem (Base)",
      description: idrxRedeemReady
        ? `Burn confirmed on Base; redeem request submitted (ref ${order.idrxRedeemId?.slice(0, 12) ?? "—"}…).`
        : idrxBurnReady
          ? "Burn on Base confirmed; submitting signed redeem-request to IDRX…"
          : swapTxReady
            ? "Waiting for IDRX on Base, then burn with hashed bank binding and redeem to your BCA account."
            : failed && idrxBurnReady
              ? "Burn step did not complete redeem; check IDRX dashboard or support with burn tx."
              : "Starts after IDRX arrives on Base from the LiFi step.",
      status: hopStatus(idrxRedeemReady, swapTxReady && !idrxRedeemReady),
      links: idrxLinks,
    });
  } else {
    const p2pLinks: RouteHopLink[] = [{ label: "p2p.me app", href: P2P_APP }];
    if (order.p2pmOrderId) {
      p2pLinks.unshift({
        label: `Order ref · ${order.p2pmOrderId.slice(0, 14)}…`,
        href: `${P2P_APP}/sell`,
      });
    }

    hops.push({
      id: "p2p",
      title: "p2p.me merchant (USDC → IDR)",
      description: tailMilestonesDone
        ? "USDC is in place after the LiFi swap (see link above). Merchant / IDR flow is wired from here."
        : tailMilestonesActive
          ? "Waiting for the USDT→USDC swap transaction link…"
          : failed && order.p2pmOrderId
            ? "p2p.me step did not finish; check the app or support with your order ref."
            : "Starts after USDC is available for the offramp.",
      status: hopStatus(tailMilestonesDone, tailMilestonesActive),
      links: p2pLinks,
    });
  }

  // 5. Final IDR to BCA / GoPay
  const mask = maskPayoutRecipient(order.p2pmPayoutMethod, order.payoutRecipient);
  const pl = payoutLabel(order.p2pmPayoutMethod);
  const idrN = order.idrAmount != null ? `Rp ${Number(order.idrAmount).toLocaleString("id-ID")}` : "IDR";
  const fiatTitle = bankBca ? `IDR settled · ${pl} (IDRX → IDR)` : `IDR settled · ${pl}`;
  const fiatDescDoneCompleted = bankBca
    ? `Final payout complete. ${idrN} to ${pl} ${mask} via IDRX liquidation to IDR.`
    : `Final payout complete. ${idrN} to ${pl} ${mask}.`;
  const fiatDescDoneInProgress = bankBca
    ? `Payout path to ${pl} ${mask} — IDRX → IDR after redeem is accepted (see burn/redeem step).`
    : `Payout path to ${pl} ${mask} — proceeds after USDC from the swap (LiFi link above).`;
  const fiatDescDest = bankBca
    ? `Destination: ${pl} ${mask}; IDRX burn and redeem route your IDR.`
    : `Destination: ${pl} ${mask}.`;

  hops.push({
    id: "fiat-settled",
    title: fiatTitle,
    description: tailMilestonesDone
      ? stateStr === "COMPLETED"
        ? fiatDescDoneCompleted
        : fiatDescDoneInProgress
      : tailMilestonesActive
        ? bankBca
          ? `IDRX burn and bank redeem in progress for ${pl} ${mask}.`
          : `Waiting for swap confirmation and explorer link before marking ${pl} ${mask} ready.`
        : failed
          ? `Payout to ${pl} ${mask} was not completed. Check status or support.`
          : fiatDescDest,
    status: hopStatus(tailMilestonesDone, tailMilestonesActive),
    links: [],
  });

  return hops;
}
