---
description: >-
  Current matrix of Bitcoin-in rails and local-fiat-out payout methods
  supported by PaySats.
icon: route
---

# Supported rails

## Bitcoin in: deposit channels

| `depositChannel` | Chain | Token | Notes |
|------------------|-------|-------|-------|
| `lightning` (default) | Lightning Network | BTC (sats) | You pay the returned **BOLT11** invoice. Fastest, and the only channel with a native invoice flow today. |
| `cbbtc` | Base (chainId 8453) | **cbBTC** (8 decimals) | Send cbBTC to the per-tenant ERC-4337 safe returned by `GET /v1/deposit/rails`. |
| `btcb` | BNB Chain (chainId 56) | **BTCB** (18 decimals) | Send BTCB to the per-tenant ERC-4337 safe returned by `GET /v1/deposit/rails`. |

{% hint style="info" %}
**Coming on the deposit side:** native on-chain BTC via **Spark** (`getSingleUseDepositAddress` / `getStaticDepositAddress`), plus other wrapped BTC variants (WBTC, ZBTC). The rails are already wired in the backend; SDK surface is being finalized.
{% endhint %}

## Local fiat out: payout methods

Indonesia (IDR) is live today. India (INR) is the next market. Within each market, the live list of banks and e-wallets is always served by `GET /v1/payout/methods`. **Do not hard-code** bank codes or names. Each entry has:

```ts
type PayoutMethod = {
  bankCode: string;
  bankName: string;
  maxAmountTransfer?: number | string | null;
  kind: "bank" | "ewallet";
};
```

### Banks (`kind: "bank"`)

Indonesia (live): BCA (code `014`, most common payout target), Mandiri, BRI, BNI, CIMB Niaga, Permata, Danamon, and the rest of the Bank Indonesia member list, routed through IDRX's redeem partners.

India (next): HDFC, ICICI, SBI, Axis, Kotak, and the rest of the IFSC list, routed through INR-pegged stablecoin redeem partners and UPI / IMPS rails.

`recipientDetails` for banks must be a **digits-only account number** (or an IFSC-qualified account identifier in the India flow, once live).

### E-wallets (`kind: "ewallet"`)

Indonesia (live, routed via IDRX e-wallet rails):

* **GoPay**
* **OVO**
* **DANA**
* **Jago**
* **ShopeePay**

India (next, targeted): Paytm, PhonePe, Google Pay (UPI VPA-based routing).

`recipientDetails` for e-wallets must be a **mobile number** in one of:

* E.164 format: `+628123456789` (Indonesia) or `+919123456789` (India)
* Local format: `08123456789` (Indonesia) or `9123456789` (India)

Exact accepted format is validated server-side; if it rejects, the error message tells you what to send.

## Fees

{% hint style="warning" %}
A fixed fiat off-ramp fee applies when the payout target is a **bank account** or **e-wallet** (**Rp 5,000** in Indonesia today; INR equivalent once India launches). Network and swap costs are bundled into the locked quote returned at order creation.
{% endhint %}

## Quick reference

{% columns %}
{% column %}
**Simplest path** (recommended for first integration)

* Deposit: `lightning`
* Payout: `bank` → BCA
* Amount basis: `idrAmount`

Returns a BOLT11 invoice, payer pays, local fiat lands in the named bank.
{% endcolumn %}

{% column %}
**Wrapped-BTC path** (for apps already holding cbBTC / BTCB)

* Deposit: `cbbtc` or `btcb`
* Payout: `ewallet` → GoPay / OVO
* Amount basis: `idrAmount`

Returns an EVM deposit address (per-tenant smart account). Sender sends the token, pipeline swaps via a stablecoin leg (IDRX today) and redeems to local fiat.
{% endcolumn %}
{% endcolumns %}

Next: [Quickstart](../getting-started/quickstart.md) · [Deposit rails](../developers/deposit-rails.md) · [Payout methods](../developers/payout-methods.md)
