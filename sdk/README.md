# @paysats/sdk

Official client SDK for **paysats** — Lightning → Indonesian Rupiah (IDR) off-ramp.

Add Bitcoin-to-bank payouts to any Node app in ~10 lines. Paysats runs the backend (custodial operator wallet, Boltz LN→USDT, LiFi USDT→IDRX, IDRX burn & bank redeem). You bring an API key and call the SDK.

**Deposit rails supported**

- Lightning (BOLT11 invoice) — instant
- cbBTC on Base — on-chain deposit
- BTCB on BNB Chain — on-chain deposit

**Payout rails**

- Any IDRX-supported Indonesian bank (BCA, Mandiri, BRI, BNI, …) via `bank_transfer`
- IDRX-supported e-wallets (GoPay, etc.) — treated the same as banks but `recipientDetails` is a mobile number

---

## Installation

```bash
npm install @paysats/sdk
# or
pnpm add @paysats/sdk
```

Requires **Node 18+** (uses global `fetch`).

## Getting an API key

Contact paysats to get onboarded — keys are currently issued manually. You'll receive a single string:

```
PAYSATS_API_KEY=pk_live_...
```

Keep this secret. It is a bearer credential with full access to your tenant's orders. **Never embed it in client-side code.**

## Quickstart

```ts
import { PaysatsClient } from "@paysats/sdk";

const paysats = new PaysatsClient({ apiKey: process.env.PAYSATS_API_KEY! });

const methods = await paysats.listPayoutMethods();
const bca = methods.find((m) => m.bankCode === "014")!; // BCA

const order = await paysats.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning",
  idrxBankCode: bca.bankCode,
  idrxBankName: bca.bankName,
  recipientDetails: "1234567890",
  bankAccountName: "Jane Doe",
});

console.log("Show user this BOLT11 to fund the off-ramp:", order.bolt11);

const done = await paysats.waitForOrder(order.orderId, {
  onUpdate: (o) => console.log("state:", o.state),
});

if (done.state === "COMPLETED") {
  console.log(`Settled ${done.idrAmount} IDR to BCA ${done.payoutRecipient}`);
} else {
  console.error("Order failed");
}
```

## On-chain deposit (cbBTC / BTCB)

```ts
const order = await paysats.createOfframpOrder({
  idrAmount: 500_000,
  depositChannel: "cbbtc", // or "btcb"
  idrxBankCode: bca.bankCode,
  idrxBankName: bca.bankName,
  recipientDetails: "1234567890",
  bankAccountName: "Jane Doe",
});

console.log(order.deposit);
// {
//   channel: "cbbtc",
//   chainId: 8453,
//   chainName: "Base",
//   tokenSymbol: "cbBTC",
//   tokenAddress: "0x...",
//   toAddress: "0x<paysats Safe>",
//   decimals: 8,
//   qrValue: "ethereum:0x...@8453",
// }

// Show `qrValue` as a QR code; tell the user to send cbBTC to `toAddress` on Base.
// paysats monitors the Safe and continues the pipeline automatically.
```

## API reference

### `new PaysatsClient(options)`

| Option       | Type                    | Default                     | Notes                                         |
| ------------ | ----------------------- | --------------------------- | --------------------------------------------- |
| `apiKey`     | `string` (required)     | —                           | Your `pk_live_...` key.                       |
| `baseUrl`    | `string`                | `https://api.paysats.io`    | Override for staging / local dev.             |
| `timeoutMs`  | `number`                | `30000`                     | Per-request timeout.                          |
| `fetch`      | `typeof fetch`          | global `fetch`              | Inject a polyfill for Node <18 / testing.     |

### `getBtcIdrQuote(): Promise<BtcIdrQuote>`

Current BTC/IDR and USDC/IDR rates used by the pricing engine. Cached for ~2 minutes server-side.

### `listPayoutMethods(): Promise<PayoutMethod[]>`

IDRX-supported destinations. Each row is one `{ bankCode, bankName, kind }`. Use the exact `bankCode` + `bankName` pair when creating orders.

### `getDepositRails(): Promise<DepositRails>`

Paysats-operated deposit addresses for the cbBTC (Base) and BTCB (BNB) rails. You rarely need to call this directly — `createOfframpOrder({ depositChannel })` returns a per-order `deposit` payload already.

### `createOfframpOrder(input): Promise<OfframpCreateResponse>`

Creates an order and returns either a Lightning BOLT11 invoice or EVM deposit instructions.

| Field             | Required | Notes                                                                  |
| ----------------- | -------- | ---------------------------------------------------------------------- |
| `satAmount`       | one of   | Exact sats to off-ramp.                                                |
| `idrAmount`       | one of   | Target IDR; sats are computed from the live quote.                     |
| `depositChannel`  | no       | `"lightning"` (default), `"cbbtc"`, or `"btcb"`.                       |
| `idrxBankCode`    | yes      | From `listPayoutMethods()`.                                            |
| `idrxBankName`    | yes      | Must match `bankCode`.                                                 |
| `recipientDetails`| yes      | Bank account digits, or `+62-8123...` / 10–15 digit mobile (e-wallet). |
| `bankAccountName` | no       | Legal holder name.                                                     |

### `getOrder(id): Promise<OfframpOrder>`

Read an order by id. Scoped to your tenant — `404` if it belongs to someone else.

### `listOrders({ limit? }): Promise<OfframpOrder[]>`

Recent orders for your tenant, newest first. Default `limit=50`, max `100`.

### `waitForOrder(id, options): Promise<OfframpOrder>`

Polls `getOrder` until the order reaches a terminal state (`COMPLETED` or `FAILED`).

| Option      | Default   | Notes                                                |
| ----------- | --------- | ---------------------------------------------------- |
| `pollMs`    | `5000`    | Minimum `500`.                                       |
| `timeoutMs` | `1800000` | 30 min. Throws `PaysatsApiError` (status 408).       |
| `onUpdate`  | —         | Called on every poll; good for UI state streaming.   |
| `signal`    | —         | `AbortSignal` to cancel early.                       |

### Order lifecycle

```
ROUTE_SHOWN
  → LN_INVOICE_PAID           (Lightning rail only, after user pays the BOLT11)
  → BOLTZ_SWAP_PENDING        (LN → USDT on Arbitrum via Boltz)
  → USDT_RECEIVED
  → USDC_SWAPPED              (LiFi USDT(Arb) → IDRX(Base))
  → P2PM_ORDER_PLACED         (IDRX burn on Base + redeem request to IDRX)
  → P2PM_ORDER_CONFIRMED
  → IDR_SETTLED
  → COMPLETED                 (IDR credited to the recipient's bank)
```

Any step can transition to `FAILED`.

### Error handling

All non-2xx responses throw `PaysatsApiError`:

```ts
import { PaysatsApiError } from "@paysats/sdk";

try {
  await paysats.createOfframpOrder({ /* ... */ });
} catch (e) {
  if (e instanceof PaysatsApiError) {
    console.error(e.status, e.message, e.body);
  } else {
    throw e;
  }
}
```

## TypeScript

Fully typed; ships `.d.ts`. Both ESM (`import`) and CJS (`require`) entry points are exported.

## License

MIT
