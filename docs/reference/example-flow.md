---
description: >-
  Walkthrough of a real Lightning → BCA order with screenshots and on-chain
  transaction links. Hashes below are illustrative.
icon: list-check
---

# Example end-to-end flow

A worked example of a Lightning-in → BCA-out order, annotated with the real transactions each step produces. **Hashes are illustrative** — your order produces different hashes, but the shape is identical.

## The order

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

Returns:

```json
{
  "orderId": "ord_01H...",
  "bolt11": "lnbc250u1p...",
  "satAmount": 294,
  "idrAmount": 50000,
  "btcIdr": 1700000000,
  "fetchedAt": "2025-...",
  "invoiceExpiresAt": "2025-..."
}
```

## Step 1 — Payer pays the Lightning invoice

The payer scans `order.bolt11` with any Lightning wallet and pays. The order transitions `IDLE` → `LN_INVOICE_PAID`.

{% hint style="info" %}
PaySats' current Lightning pay path uses a Boltz beta flow for the swap leg. The screenshot below is the Boltz beta invoice UI from a real order.
{% endhint %}

<img src="https://github.com/user-attachments/assets/978f7297-4751-4554-8063-848b4c0b3a3d" alt="Boltz beta Lightning invoice UI" />

## Step 2 — Boltz swaps LN → USDT

Boltz settles the Lightning leg and releases USDT to the operator's ERC-4337 smart account on **Arbitrum**. Order state becomes `BOLTZ_SWAP_PENDING` then `USDT_RECEIVED`.

## Step 3 — LiFi routes USDT → IDRX

The orchestration layer uses LiFi to swap the USDT into IDRX on the appropriate chain (typically Arbitrum → Base).

| Leg | Explorer |
|-----|----------|
| LiFi USDT → IDRX user-operation on Arbitrum | [Arbiscan tx `0x0c3a9014…`](<code class="expression">space.vars.arbiscan_base</code>/0x0c3a9014df697efbc2d65911700238dcba3b06c1defcc448586d8625017b52fa) |

## Step 4 — IDRX burn on Base

The backend calls `burnWithAccountNumber` on the IDRX contract on Base, producing the `txHash` that's used as the `txHash` on the subsequent IDRX redeem request.

| Leg | Explorer |
|-----|----------|
| IDRX burn on Base (bundle tx — this is the `txHash` used for redeem) | [Basescan tx `0xe0f59942…`](<code class="expression">space.vars.basescan_base</code>/0xe0f599423181d65e91d5464e344691505a8c8c27d2c7fe329052411eeb6bdd7b) |

State becomes `IDR_SETTLED` once the burn is confirmed and the redeem request is accepted.

## Step 5 — IDRX redeem → BCA

The backend calls IDRX's redeem endpoint:

```
POST https://idrx.co/api/transaction/redeem-request
```

The response includes `data.id`, `custRefNumber`, and other partner references. The order record now contains `idrxRedeemId`.

IDR is credited to the specified BCA account. Order state becomes `COMPLETED` and `completedAt` is set.

## Step 6 — Poll until terminal

```ts
const final = await client.waitForOrder(order.orderId, {
  onUpdate: (o) => console.log("state:", o.state),
});
// state: IDLE
// state: LN_INVOICE_PAID
// state: BOLTZ_SWAP_PENDING
// state: USDT_RECEIVED
// state: IDR_SETTLED
// state: COMPLETED
```

The final `OfframpOrder` record carries references to every leg:

| Field | Populated from |
|-------|----------------|
| `invoiceBolt11` | Order creation |
| `invoicePaidAt` | Lightning settlement |
| `boltzSwapId`, `boltzTxHash` | Boltz swap |
| `swapTxHash` | LiFi route |
| `idrxBurnTxHash` | On-chain burn (Basescan) |
| `idrxRedeemId` | IDRX redeem response |
| `completedAt` | Terminal success |

## Reconciling on your side

For every PaySats `orderId`, you can store:

* A merchant-side `invoiceId` → `orderId` map
* The `idrxBurnTxHash` (Basescan) as proof of on-chain settlement
* The `idrxRedeemId` as proof of fiat redemption
* `payoutRecipient` (masked) and `idrxPayoutBankName` for receipts

This gives you a **three-way audit trail** — Bitcoin / Lightning payment → on-chain IDRX burn → fiat redemption — tied together by a single `orderId`.

## Adding your own screenshots

{% hint style="info" %}
To pre-populate asset-based screenshots from inside GitBook (rather than hot-linking GitHub), upload images to `docs/.gitbook/assets/` and reference them with `![alt](../.gitbook/assets/filename.svg)`. GitBook's UI will also surface them in the asset picker.
{% endhint %}

Next: [Order lifecycle](../developers/order-lifecycle.md) · [HTTP API /v1](../developers/http-api.md) · [Changelog](changelog.md)
