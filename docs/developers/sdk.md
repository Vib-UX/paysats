---
description: >-
  "@paysats/sdk" is a typed Node client for the PaySats API. Quotes, payout
  methods, off-ramp orders, and order polling.
icon: js
---

# SDK: @paysats/sdk

Typed Node client for the PaySats API. Handles auth, request/response shapes, and terminal-state polling.

{% hint style="info" %}
**Requirements:** Node 18+ (native `fetch`) and a server-side tenant API key. Never expose the key in a browser bundle.
{% endhint %}

## Install

```bash
npm install @paysats/sdk
```

## Create a client

```ts
import { PaysatsClient } from "@paysats/sdk";

const client = new PaysatsClient({
  apiKey: process.env.PAYSATS_API_KEY!,
  // baseUrl: "http://localhost:8080", // optional, defaults to https://api.paysats.io
  // timeoutMs: 30_000,                 // optional per-request timeout
  // fetch: customFetch,                // optional fetch override for tests / polyfills
});
```

### `PaysatsClientOptions`

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `apiKey` | `string` | (required) | **Required.** Tenant API key. |
| `baseUrl` | `string` | `https://api.paysats.io` | Point at a self-hosted backend. |
| `timeoutMs` | `number` | `30000` | Per-request timeout. |
| `fetch` | `typeof fetch` | global `fetch` | Override for Node <18 or testing. |

## Methods

### `getBtcIdrQuote()`

Returns the latest BTC/IDR (and USDC/IDR) quote.

```ts
const q = await client.getBtcIdrQuote();
// { btcIdr: 1_700_000_000, usdcIdr: 16_200, fetchedAt: "2025-...", source: "coingecko" }
```

### `listPayoutMethods()`

Returns the live list of supported banks and e-wallets. Always call this before `createOfframpOrder`, **never hard-code** bank codes.

```ts
const methods = await client.listPayoutMethods();
const bca = methods.find((m) => m.bankCode === "014")!;
```

Each entry:

```ts
type PayoutMethod = {
  bankCode: string;
  bankName: string;
  maxAmountTransfer?: number | string | null;
  kind: "bank" | "ewallet";
};
```

See [Payout methods](payout-methods.md) for bank vs e-wallet rules.

### `getDepositRails()`

Returns the operator's configured deposit targets: Lightning availability and the per-chain ERC-4337 safe addresses for `cbbtc` / `btcb` deposits.

```ts
const rails = await client.getDepositRails();
if (rails.configured && rails.baseCbbtc) {
  console.log("Send cbBTC to", rails.baseCbbtc.safeAddress, "on chainId", rails.baseCbbtc.chainId);
}
```

See [Deposit rails](deposit-rails.md) for the full shape.

### `getPlatformStats()`

Returns display-oriented liquidity / volume stats plus a `fetchedAt` timestamp.

```ts
const stats = await client.getPlatformStats();
```

### `createOfframpOrder(input)`

Creates an off-ramp order. Pass **either** `satAmount` **or** `idrAmount`.

```ts
const order = await client.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning", // "lightning" | "cbbtc" | "btcb"
  idrxBankCode: bca.bankCode,
  idrxBankName: bca.bankName,
  recipientDetails: "1234567890",
  bankAccountName: "Jane Doe",
});
```

Response:

```ts
type OfframpCreateResponse = {
  orderId: string;
  bolt11: string | null;       // null for cbBTC / BTCB, use `deposit` instead
  satAmount: number;
  idrAmount: number;
  btcIdr: number;
  fetchedAt: string;
  invoiceExpiresAt: string | null;
  deposit?: {
    channel: "cbbtc" | "btcb";
    chainId: number;
    chainName: string;
    tokenSymbol: string;
    tokenAddress: string;
    toAddress: string;
    decimals: number;
    qrValue: string;
  };
};
```

{% hint style="warning" %}
`idrxBankCode` and `idrxBankName` **must come from `listPayoutMethods()`**, they're validated server-side and must match as a pair. Invalid combinations return HTTP 400.
{% endhint %}

### `getOrder(orderId)`

Returns the full server-side order record. Field set is a loose superset (the server evolves); drive UI off `state`.

```ts
const order = await client.getOrder(orderId);
console.log(order.state, order.idrxRedeemId);
```

### `listOrders({ limit? })`

Returns recent orders for the authenticated tenant (default `limit: 50`, max `100`).

```ts
const recent = await client.listOrders({ limit: 20 });
```

### `waitForOrder(orderId, options?)`

Polls `getOrder` until the order is **terminal** (`COMPLETED` or `FAILED`) or the timeout elapses.

```ts
const final = await client.waitForOrder(order.orderId, {
  pollMs: 5_000,                // default 5000, min 500
  timeoutMs: 30 * 60 * 1000,    // default 30 minutes, min 1000
  onUpdate: (o) => console.log("state:", o.state),
  signal: abortController.signal,
});
```

Options:

| Option | Type | Default |
|--------|------|---------|
| `pollMs` | `number` | `5000` |
| `timeoutMs` | `number` | `1_800_000` (30 min) |
| `onUpdate` | `(order) => void` | (none) (fires on every poll, including first hit) |
| `signal` | `AbortSignal` | (none) |

Behaviour:

* Resolves with the order on `COMPLETED` or `FAILED`.
* Rejects with `PaysatsApiError` (status `408`) on timeout; the `body` is the last snapshot.
* Rejects with an `AbortError` if the `signal` fires.

See [Order lifecycle](order-lifecycle.md) for all `OrderState` values.

## Types

All public types are re-exported from the package root:

```ts
import type {
  PaysatsClientOptions,
  BtcIdrQuote,
  PayoutMethod,
  PayoutMethodsResponse,
  DepositChannel,
  DepositRails,
  EvmDepositInstructions,
  PlatformStats,
  OfframpCreateInput,
  OfframpCreateResponse,
  OfframpOrder,
  OrderState,
  WaitForOrderOptions,
} from "@paysats/sdk";
```

### `OrderState`

```ts
type OrderState =
  | "IDLE"
  | "NWC_CONNECTED"
  | "QR_SCANNED"
  | "ROUTE_SHOWN"
  | "LN_INVOICE_PAID"
  | "BOLTZ_SWAP_PENDING"
  | "USDT_RECEIVED"
  | "USDC_SWAPPED"
  | "P2PM_ORDER_PLACED"
  | "P2PM_ORDER_CONFIRMED"
  | "IDR_SETTLED"
  | "COMPLETED"
  | "FAILED";
```

Helper exports:

```ts
import { TERMINAL_ORDER_STATES, isTerminalState } from "@paysats/sdk";
```

## Errors

Every non-2xx response raises `PaysatsApiError`:

```ts
import { PaysatsApiError } from "@paysats/sdk";

try {
  await client.createOfframpOrder({ /* ... */ });
} catch (err) {
  if (err instanceof PaysatsApiError) {
    console.error(err.status, err.message, err.body);
  } else {
    throw err;
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `status` | `number` | HTTP status (e.g. `400`, `401`, `404`, `408`, `500`, `503`) |
| `body` | `unknown` | Parsed JSON body when available; otherwise the raw text |
| `message` | `string` | Server-provided `error` string or a default |

Common statuses:

* **400**: validation (e.g. missing `idrxBankCode`, unsupported `depositChannel`, bad `recipientDetails`)
* **401**: missing or invalid API key
* **404**: `getOrder` on an ID that doesn't belong to this tenant
* **408**: `waitForOrder` timeout
* **503**: database unavailable (transient)

## Idiomatic patterns

{% tabs %}
{% tab title="Fire-and-forget" %}
Let the SDK block until settlement:

```ts
const order = await client.createOfframpOrder({ /* ... */ });
showInvoice(order.bolt11);
const final = await client.waitForOrder(order.orderId);
```
{% endtab %}

{% tab title="UI-driven polling" %}
Drive a UI off each state transition:

```ts
const order = await client.createOfframpOrder({ /* ... */ });
showInvoice(order.bolt11);

await client.waitForOrder(order.orderId, {
  onUpdate: (o) => ui.setState(o.state),
});
```
{% endtab %}

{% tab title="Abortable" %}
Cancel if the user navigates away:

```ts
const ac = new AbortController();
window.addEventListener("beforeunload", () => ac.abort());

try {
  await client.waitForOrder(order.orderId, { signal: ac.signal });
} catch (err) {
  if ((err as Error).name === "AbortError") return;
  throw err;
}
```
{% endtab %}
{% endtabs %}

<details>

<summary>Why the SDK uses <code>x-api-key</code> instead of <code>Authorization: Bearer</code></summary>

Both headers are accepted by the API (<code class="expression">space.vars.api_base_url</code>). The SDK sends `x-api-key` by default because it survives more proxy / CDN middlewares unchanged, and it's unambiguous: no risk of accidentally mixing with an OAuth bearer token from another provider in the same process. The backend normalises both internally.

</details>

Next: [MCP server](mcp-server.md) · [HTTP API /v1](http-api.md) · [Order lifecycle](order-lifecycle.md)
