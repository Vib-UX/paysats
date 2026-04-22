---
description: >-
  Raw HTTP /v1 API reference for PaySats. Quotes, payout methods, deposit
  rails, and the off-ramp order lifecycle. With curl, SDK, and TypeScript
  examples.
icon: server
---

# HTTP API /v1

The same API that backs `@paysats/sdk` and `@paysats/mcp`. Use this when you're integrating from a non-Node language, or when you need endpoint-level control.

## Base URL

```
<code class="expression">space.vars.api_base_url</code>
```

Self-hosted deployments use whatever you set as `PAYSATS_BASE_URL`.

## Authentication

Every `/v1/*` request requires a tenant API key. Both header forms are accepted:

```
x-api-key: pk_live_xxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```
Authorization: Bearer pk_live_xxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Missing or invalid keys return `401 { "error": "..." }`.

## Errors

Non-2xx responses use a uniform shape:

```json
{ "error": "Human readable message" }
```

| Status | Meaning |
|--------|---------|
| `400` | Validation error (`required`, `invalid`, `must match`, `unsupported`) |
| `401` | Missing / revoked / malformed API key |
| `404` | Order not found, **or** not owned by your tenant |
| `500` | Unhandled server error |
| `503` | Database unavailable (transient) |

{% hint style="info" %}
**OpenAPI:** a machine-readable spec is on the roadmap. When available it will be uploaded to GitBook via the GitBook API / CLI / UI (GitBook doesn't support embedding OpenAPI directly in markdown).
{% endhint %}

## Endpoints

### `GET /v1/quote/btc-idr`

Latest BTC/IDR and USDC/IDR rates (cached).

{% tabs %}
{% tab title="curl" %}
```bash
curl -s https://api.paysats.io/v1/quote/btc-idr \
  -H "x-api-key: $PAYSATS_API_KEY"
```
{% endtab %}

{% tab title="SDK" %}
```ts
const q = await client.getBtcIdrQuote();
```
{% endtab %}

{% tab title="Response" %}
```ts
type BtcIdrQuote = {
  btcIdr: number;
  usdcIdr: number;
  fetchedAt: string; // ISO 8601
  source: "coingecko" | "coinmarketcap" | string;
};
```
{% endtab %}
{% endtabs %}

### `GET /v1/payout/methods`

Live list of banks and e-wallets. **Call this before every `POST /v1/offramp/orders`**. Do not hard-code `bankCode`.

{% tabs %}
{% tab title="curl" %}
```bash
curl -s https://api.paysats.io/v1/payout/methods \
  -H "x-api-key: $PAYSATS_API_KEY"
```
{% endtab %}

{% tab title="SDK" %}
```ts
const methods = await client.listPayoutMethods();
```
{% endtab %}

{% tab title="Response" %}
```ts
type PayoutMethodsResponse = {
  statusCode?: number;
  message?: string;
  data: Array<{
    bankCode: string;
    bankName: string;
    maxAmountTransfer?: number | string | null;
    kind: "bank" | "ewallet";
  }>;
};
```

Example:

```json
{
  "statusCode": 200,
  "message": "ok",
  "data": [
    { "bankCode": "014", "bankName": "BCA", "kind": "bank", "maxAmountTransfer": 500000000 },
    { "bankCode": "gopay", "bankName": "GoPay", "kind": "ewallet", "maxAmountTransfer": 20000000 }
  ]
}
```
{% endtab %}
{% endtabs %}

### `GET /v1/deposit/rails`

Configured deposit targets. `configured: false` means the backend has no `WDK_SEED`; only Lightning is available in that mode.

{% tabs %}
{% tab title="curl" %}
```bash
curl -s https://api.paysats.io/v1/deposit/rails \
  -H "x-api-key: $PAYSATS_API_KEY"
```
{% endtab %}

{% tab title="SDK" %}
```ts
const rails = await client.getDepositRails();
```
{% endtab %}

{% tab title="Response" %}
```ts
type DepositRails = {
  configured: boolean;
  bitcoinOnchain: { label: string; summary: string };
  lightning?: { label: string; summary: string };
  arbitrumUsdt?: {
    chainId: number;
    safeAddress: string;
    token: "USDT";
    role?: string; // internal Boltz receive
  };
  baseCbbtc?: {
    chainId: number;
    safeAddress: string;
    token: "cbBTC";
    contractAddress: string;
    decimals: 8;
    depositChannel: "cbbtc";
  };
  bscBtcb?: {
    chainId: number;
    safeAddress: string;
    token: "BTCB";
    contractAddress: string;
    decimals: 18;
    depositChannel: "btcb";
  };
  error?: string;
};
```
{% endtab %}
{% endtabs %}

See [Deposit rails](deposit-rails.md) for how to use each channel.

### `GET /v1/platform/stats`

Liquidity / volume display stats.

{% tabs %}
{% tab title="curl" %}
```bash
curl -s https://api.paysats.io/v1/platform/stats \
  -H "x-api-key: $PAYSATS_API_KEY"
```
{% endtab %}

{% tab title="SDK" %}
```ts
const stats = await client.getPlatformStats();
```
{% endtab %}

{% tab title="Response" %}
```ts
type PlatformStats = {
  fetchedAt: string;
  [k: string]: unknown;
};
```

Shape is a loose superset. Additional metrics may appear. Always branch on the keys you care about.
{% endtab %}
{% endtabs %}

### `POST /v1/offramp/orders`

Create a new off-ramp order. Pass **either** `satAmount` **or** `idrAmount`.

{% tabs %}
{% tab title="curl" %}
```bash
curl -s -X POST https://api.paysats.io/v1/offramp/orders \
  -H "x-api-key: $PAYSATS_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "idrAmount": 50000,
    "depositChannel": "lightning",
    "idrxBankCode": "014",
    "idrxBankName": "BCA",
    "recipientDetails": "1234567890",
    "bankAccountName": "Jane Doe"
  }'
```
{% endtab %}

{% tab title="SDK" %}
```ts
const order = await client.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning",
  idrxBankCode: "014",
  idrxBankName: "BCA",
  recipientDetails: "1234567890",
  bankAccountName: "Jane Doe",
});
```
{% endtab %}

{% tab title="Request" %}
```ts
type OfframpCreateInput = {
  satAmount?: number;        // one of satAmount or idrAmount is required
  idrAmount?: number;
  depositChannel?: "lightning" | "cbbtc" | "btcb"; // default: "lightning"
  idrxBankCode: string;      // from GET /v1/payout/methods
  idrxBankName: string;      // must match bankCode
  recipientDetails: string;  // bank: digits; ewallet: +628... or 08...
  bankAccountName?: string;  // optional; server provides a default
  payoutMethod?: "bank_transfer"; // reserved
};
```
{% endtab %}

{% tab title="Response" %}
```ts
type OfframpCreateResponse = {
  orderId: string;
  bolt11: string | null;     // null for cbbtc / btcb rails
  satAmount: number;
  idrAmount: number;
  btcIdr: number;
  fetchedAt: string;
  invoiceExpiresAt: string | null;
  deposit?: {                // present for cbbtc / btcb
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
{% endtab %}
{% endtabs %}

{% hint style="warning" %}
Validation errors (missing `idrxBankCode`, bad `recipientDetails`, unsupported `depositChannel`, etc.) return **400** with a descriptive `error` string. Anything else is **500**.
{% endhint %}

### `GET /v1/offramp/orders/:id`

Full server-side order record for a specific order. 404 if the order doesn't belong to your tenant.

{% tabs %}
{% tab title="curl" %}
```bash
curl -s https://api.paysats.io/v1/offramp/orders/ord_01H... \
  -H "x-api-key: $PAYSATS_API_KEY"
```
{% endtab %}

{% tab title="SDK" %}
```ts
const order = await client.getOrder("ord_01H...");
```
{% endtab %}

{% tab title="Response" %}
```ts
type OfframpOrder = {
  id: string;
  tenantId?: string | null;
  state: OrderState; // see Order lifecycle
  satAmount: number;
  idrAmount: number;
  idrxAmountIdr?: number | null;
  btcIdr?: number | null;
  btcIdrFetchedAt?: string | Date | null;
  invoiceBolt11?: string | null;
  invoiceLnId?: string | null;
  invoiceExpiresAt?: string | Date | null;
  invoicePaidAt?: string | Date | null;
  boltzSwapId?: string | null;
  boltzLnInvoice?: string | null;
  boltzTxHash?: string | null;
  swapTxHash?: string | null;
  idrxBurnTxHash?: string | null;
  idrxRedeemId?: string | null;
  idrxPayoutBankCode?: string | null;
  idrxPayoutBankName?: string | null;
  payoutRecipient?: string | null;
  bankAccountName?: string | null;
  depositChannel?: "lightning" | "cbbtc" | "btcb" | string | null;
  depositChainId?: number | null;
  depositTokenAddress?: string | null;
  depositToAddress?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt?: string | Date | null;
  merchantName?: string | null;
};
```

Additional keys may appear over time; always branch on `state`.
{% endtab %}
{% endtabs %}

See [Order lifecycle](order-lifecycle.md) for `OrderState` values and terminal rules.

### `GET /v1/offramp/orders?limit=`

Recent orders for the authenticated tenant, newest first. `limit` defaults to `50`, capped at `100`.

{% tabs %}
{% tab title="curl" %}
```bash
curl -s "https://api.paysats.io/v1/offramp/orders?limit=20" \
  -H "x-api-key: $PAYSATS_API_KEY"
```
{% endtab %}

{% tab title="SDK" %}
```ts
const recent = await client.listOrders({ limit: 20 });
```
{% endtab %}

{% tab title="Response" %}
```json
{
  "orders": [ /* OfframpOrder[] */ ],
  "fetchedAt": "2025-..."
}
```

If the database is transiently unavailable, this endpoint returns `{ "orders": [], "fetchedAt": "..." }` rather than failing.
{% endtab %}
{% endtabs %}

## Idempotency

Order creation is **not** idempotency-keyed today. Don't retry `POST /v1/offramp/orders` blindly on network errors. Check `GET /v1/offramp/orders` with a tight `limit` to confirm whether your previous attempt succeeded.

Next: [Order lifecycle](order-lifecycle.md) · [Deposit rails](deposit-rails.md) · [Payout methods](payout-methods.md)
