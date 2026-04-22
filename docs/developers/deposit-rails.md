---
description: >-
  Bitcoin-in channels PaySats accepts. Lightning by default, cbBTC on Base,
  and BTCB on BNB Chain, with instructions for funding each one.
icon: wave-square
---

# Deposit rails

PaySats accepts Bitcoin through three channels today. Pick one by setting `depositChannel` on `createOfframpOrder`.

| `depositChannel` | Chain | Token | Response shape |
|------------------|-------|-------|----------------|
| `lightning` (default) | Lightning | BTC (sats) | `bolt11` (BOLT11 invoice) |
| `cbbtc` | Base (`chainId 8453`) | cbBTC (8 decimals) | `deposit` (EVM instructions) |
| `btcb` | BNB Chain (`chainId 56`) | BTCB (18 decimals) | `deposit` (EVM instructions) |

## Discovery: `GET /v1/deposit/rails`

Query the backend to see what's actually configured. If `configured: false`, only Lightning is usable (the operator hasn't set `WDK_SEED`).

```ts
const rails = await client.getDepositRails();
```

Example response:

```json
{
  "configured": true,
  "bitcoinOnchain": {
    "label": "Bitcoin (on-chain)",
    "summary": "Native BTC via Tether WDK Spark deposit addresses."
  },
  "lightning": {
    "label": "Lightning Network",
    "summary": "Default. Create an order and pay the returned BOLT11 invoice."
  },
  "arbitrumUsdt": {
    "chainId": 42161,
    "safeAddress": "0x....",
    "token": "USDT",
    "role": "Boltz receive (internal)."
  },
  "baseCbbtc": {
    "chainId": 8453,
    "safeAddress": "0x....",
    "token": "cbBTC",
    "contractAddress": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    "decimals": 8,
    "depositChannel": "cbbtc"
  },
  "bscBtcb": {
    "chainId": 56,
    "safeAddress": "0x....",
    "token": "BTCB",
    "contractAddress": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "decimals": 18,
    "depositChannel": "btcb"
  }
}
```

{% hint style="info" %}
`arbitrumUsdt.safeAddress` is the **internal** Boltz receive target. You should never deposit to it directly. It's exposed for operator observability only.
{% endhint %}

## Channel details

{% tabs %}
{% tab title="lightning (default)" %}
### Lightning

The simplest path. Create an order and show the returned BOLT11 to the payer.

```ts
const order = await client.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning",
  idrxBankCode: "014",
  idrxBankName: "BCA",
  recipientDetails: "1234567890",
  bankAccountName: "Jane Doe",
});

showQr(order.bolt11!);
```

* `order.bolt11` is the full BOLT11 string.
* `order.satAmount` is the exact number of sats to pay.
* `order.invoiceExpiresAt` is an ISO 8601 expiry; show a countdown.

State transitions: `IDLE` → `LN_INVOICE_PAID` → `BOLTZ_SWAP_PENDING` → `USDT_RECEIVED` → `IDR_SETTLED` → `COMPLETED`.
{% endtab %}

{% tab title="cbbtc (Base)" %}
### cbBTC on Base

For apps already holding cbBTC on Base.

```ts
const order = await client.createOfframpOrder({
  idrAmount: 500_000,
  depositChannel: "cbbtc",
  idrxBankCode: "014",
  idrxBankName: "BCA",
  recipientDetails: "1234567890",
});

if (order.deposit) {
  console.log("Send", order.satAmount, "sats equivalent in cbBTC to", order.deposit.toAddress);
}
```

`order.deposit` shape:

```ts
{
  channel: "cbbtc",
  chainId: 8453,
  chainName: "Base",
  tokenSymbol: "cbBTC",
  tokenAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  toAddress: "0x<per-tenant ERC-4337 safe>",
  decimals: 8,
  qrValue: "ethereum:0x....@8453/transfer?..."  // wallet-scannable
}
```

* `bolt11` is `null` for this channel. The payer funds on-chain.
* Send the **cbBTC amount** corresponding to `order.satAmount` (with 8 decimals).
* Once received on the safe, the pipeline swaps via LiFi to IDRX on Base and redeems to the payout target.
{% endtab %}

{% tab title="btcb (BNB Chain)" %}
### BTCB on BNB Chain

For apps holding BTCB on BNB Chain.

```ts
const order = await client.createOfframpOrder({
  idrAmount: 500_000,
  depositChannel: "btcb",
  idrxBankCode: "014",
  idrxBankName: "BCA",
  recipientDetails: "1234567890",
});
```

`order.deposit` shape:

```ts
{
  channel: "btcb",
  chainId: 56,
  chainName: "BNB Smart Chain",
  tokenSymbol: "BTCB",
  tokenAddress: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  toAddress: "0x<per-tenant ERC-4337 safe>",
  decimals: 18,
  qrValue: "ethereum:0x....@56/transfer?..."
}
```

{% hint style="warning" %}
**BTCB has 18 decimals.** Convert carefully. 1 BTCB = `10**18` base units, not `10**8` like native BTC or cbBTC.
{% endhint %}

State transitions: `IDLE` → (on-chain deposit observed) → `USDT_RECEIVED` → `IDR_SETTLED` → `COMPLETED`.
{% endtab %}
{% endtabs %}

## Choosing a channel

{% columns %}
{% column %}
**Use `lightning` when:**

* The payer has a Lightning wallet.
* You want sub-dollar to everyday amounts settled in **seconds**, not minutes.
* You want a single BOLT11 invoice to show in a QR code.
{% endcolumn %}

{% column %}
**Use `cbbtc` / `btcb` when:**

* The payer already holds wrapped BTC on Base or BNB Chain.
* You want to avoid Lightning routing liquidity constraints for larger amounts.
* You're bridging from an existing EVM-only flow.
{% endcolumn %}
{% endcolumns %}

## What's next on the deposit side

{% hint style="info" %}
**Native on-chain BTC via Spark** is wired in the backend (single-use and static deposit addresses). The SDK surface for it is being finalized. Track the [changelog](../reference/changelog.md).
{% endhint %}

Other wrapped BTC variants (WBTC, ZBTC, ...) will land on the same `depositChannel` model as cbBTC / BTCB.

Next: [Payout methods](payout-methods.md) · [Order lifecycle](order-lifecycle.md) · [Example end-to-end flow](../reference/example-flow.md)
