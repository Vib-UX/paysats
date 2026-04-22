---
description: >-
  Send your first sats and get IDR settled in five steps, using the
  @paysats/sdk Node client.
icon: rocket
---

# Quickstart

Go from nothing to "IDR landed in a BCA account" in five steps.

{% hint style="info" %}
All SDK calls happen **server-side**. Never expose `PAYSATS_API_KEY` in a browser bundle.
{% endhint %}

{% stepper %}
{% step %}
## Install the SDK

```bash
npm install @paysats/sdk
```

Requires **Node 18+** (for native `fetch`).
{% endstep %}

{% step %}
## Set your API key

Put your tenant key in an environment variable — don't commit it.

```bash
export PAYSATS_API_KEY="pk_live_xxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Need one? See [API keys](api-keys.md).
{% endstep %}

{% step %}
## List payout methods

Always pull the live list — bank codes and e-wallet availability change.

```ts
import { PaysatsClient } from "@paysats/sdk";

const client = new PaysatsClient({
  apiKey: process.env.PAYSATS_API_KEY!,
});

const methods = await client.listPayoutMethods();
const bca = methods.find((m) => m.bankCode === "014")!;
```

See [Payout methods](../developers/payout-methods.md) for the shape and how banks vs e-wallets differ.
{% endstep %}

{% step %}
## Create an off-ramp order

Pick **either** `satAmount` **or** `idrAmount` — the server computes the other side from the locked quote.

```ts
const order = await client.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning",
  idrxBankCode: bca.bankCode,
  idrxBankName: bca.bankName,
  recipientDetails: "1234567890",
  bankAccountName: "Jane Doe",
});

console.log(order.bolt11);      // BOLT11 invoice to show the payer
console.log(order.satAmount);   // Exact sats the payer must send
console.log(order.invoiceExpiresAt);
```

For on-chain rails (`cbbtc` / `btcb`), `order.bolt11` is `null` and `order.deposit` contains the EVM deposit instructions instead.
{% endstep %}

{% step %}
## Pay the invoice and wait for settlement

The payer pays the BOLT11 with any Lightning wallet. Your server blocks until the order reaches a terminal state, or polls it instead.

```ts
const final = await client.waitForOrder(order.orderId, {
  onUpdate: (o) => console.log("state:", o.state),
});

if (final.state === "COMPLETED") {
  console.log("IDR settled", final.idrxRedeemId);
} else {
  console.error("Order failed", final);
}
```

`waitForOrder` polls every 5 s by default with a 30-minute timeout — see [Order lifecycle](../developers/order-lifecycle.md) for the full state list.
{% endstep %}
{% endstepper %}

## The whole thing, end-to-end

```ts
import { PaysatsClient } from "@paysats/sdk";

const client = new PaysatsClient({ apiKey: process.env.PAYSATS_API_KEY! });

const methods = await client.listPayoutMethods();
const bca = methods.find((m) => m.bankCode === "014")!;

const order = await client.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning",
  idrxBankCode: bca.bankCode,
  idrxBankName: bca.bankName,
  recipientDetails: "1234567890",
  bankAccountName: "Jane Doe",
});

const final = await client.waitForOrder(order.orderId);
console.log(final.state); // COMPLETED
```

## What to read next

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>SDK reference</strong></td><td>Every method, option, and error type.</td><td><a href="../developers/sdk.md">sdk.md</a></td></tr><tr><td><strong>Order lifecycle</strong></td><td>All possible order states and how to drive UI from them.</td><td><a href="../developers/order-lifecycle.md">order-lifecycle.md</a></td></tr><tr><td><strong>MCP server</strong></td><td>Let an LLM drive the same flow via Model Context Protocol.</td><td><a href="../developers/mcp-server.md">mcp-server.md</a></td></tr></tbody></table>
