export const ORDER_STATES = [
  "IDLE",
  "NWC_CONNECTED",
  "QR_SCANNED",
  "ROUTE_SHOWN",
  "LN_INVOICE_PAID",
  "BOLTZ_SWAP_PENDING",
  "USDT_RECEIVED",
  "USDC_SWAPPED",
  "P2PM_ORDER_PLACED",
  "P2PM_ORDER_CONFIRMED",
  "IDR_SETTLED",
  "COMPLETED",
  "FAILED"
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

const allowedTransitions: Record<OrderState, OrderState[]> = {
  IDLE: ["NWC_CONNECTED", "FAILED"],
  NWC_CONNECTED: ["QR_SCANNED", "FAILED"],
  QR_SCANNED: ["ROUTE_SHOWN", "FAILED"],
  ROUTE_SHOWN: ["LN_INVOICE_PAID", "FAILED"],
  LN_INVOICE_PAID: ["BOLTZ_SWAP_PENDING", "FAILED"],
  BOLTZ_SWAP_PENDING: ["USDT_RECEIVED", "FAILED"],
  USDT_RECEIVED: ["USDC_SWAPPED", "FAILED"],
  USDC_SWAPPED: ["P2PM_ORDER_PLACED", "FAILED"],
  P2PM_ORDER_PLACED: ["P2PM_ORDER_CONFIRMED", "FAILED"],
  P2PM_ORDER_CONFIRMED: ["IDR_SETTLED", "FAILED"],
  IDR_SETTLED: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: []
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return allowedTransitions[from].includes(to);
}

export function requireTransition(from: OrderState, to: OrderState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition from ${from} to ${to}`);
  }
}

export const STATE_LABELS: Record<OrderState, string> = {
  IDLE: "Idle",
  NWC_CONNECTED: "NWC Connected",
  QR_SCANNED: "QR Scanned",
  ROUTE_SHOWN: "Route Shown",
  LN_INVOICE_PAID: "Lightning Invoice Paid",
  BOLTZ_SWAP_PENDING: "Boltz Swap Pending",
  USDT_RECEIVED: "USDT Received",
  USDC_SWAPPED: "USDC Swapped",
  P2PM_ORDER_PLACED: "p2p.me Order Placed",
  P2PM_ORDER_CONFIRMED: "p2p.me Order Confirmed",
  IDR_SETTLED: "IDR Settled",
  COMPLETED: "Completed",
  FAILED: "Failed"
};
