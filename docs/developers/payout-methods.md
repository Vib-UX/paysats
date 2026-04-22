---
description: >-
  IDR-out payout methods — banks vs e-wallets, bankCode and bankName semantics,
  and required recipientDetails formats.
icon: building-columns
---

# Payout methods

Every off-ramp order settles into an **Indonesian bank account** or **e-wallet**. Which ones are available depends on IDRX's partner coverage at request time, which is why you should **always call `GET /v1/payout/methods`** before creating an order.

## Shape

```ts
type PayoutMethod = {
  bankCode: string;
  bankName: string;
  maxAmountTransfer?: number | string | null;
  kind: "bank" | "ewallet";
};
```

* `bankCode` — opaque identifier. **Do not parse it.** For banks it's typically the 3-digit BI code (e.g. `014` for BCA); for e-wallets it's a short slug (e.g. `gopay`).
* `bankName` — display name. Must be passed back as `idrxBankName` **exactly as given**.
* `maxAmountTransfer` — optional per-transaction cap in IDR. When present, `idrAmount` must be ≤ this value.
* `kind` — `"bank"` or `"ewallet"`. Determines the `recipientDetails` format.

## Banks (`kind: "bank"`)

Standard Indonesian bank list routed through IDRX's redeem partners.

| Bank | `bankCode` |
|------|-----------|
| BCA | `014` |
| Mandiri | `008` |
| BRI | `002` |
| BNI | `009` |
| CIMB Niaga | `022` |
| Permata | `013` |
| Danamon | `011` |

{% hint style="info" %}
The table above is **illustrative**. The authoritative list is whatever `GET /v1/payout/methods` returns at the moment you make the call. New banks are added over time and individual codes can change.
{% endhint %}

`recipientDetails` for banks:

* **Digits only** — no spaces, dashes, or leading country codes.
* Typically 10–16 digits depending on the bank.

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

## E-wallets (`kind: "ewallet"`)

Mobile-number-routed payouts.

| E-wallet | `bankCode` (typical) |
|----------|----------------------|
| GoPay | `gopay` |
| OVO | `ovo` |
| DANA | `dana` |
| Jago | `jago` |
| ShopeePay | `shopeepay` |

`recipientDetails` for e-wallets:

* E.164 format: `+628123456789`
* Or local format: `08123456789`
* 10–15 digits total

```ts
const order = await client.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning",
  idrxBankCode: "gopay",
  idrxBankName: "GoPay",
  recipientDetails: "+628123456789",
});
```

{% hint style="warning" %}
The exact accepted format is validated server-side. If the server rejects, the `error` message tells you what to send (e.g. _"recipientDetails must be a valid Indonesian mobile number for e-wallet payouts"_).
{% endhint %}

## `bankAccountName`

* **Banks:** the legal holder name on the account. Optional — the server provides a default (`IDRX_DEFAULT_BANK_ACCOUNT_NAME`) and a name normalisation step, but passing the real name improves payout routing and matching.
* **E-wallets:** usually ignored by the payout partner; safe to omit.

Either way, it's **redacted from server logs**.

## Picking a payout method programmatically

```ts
const methods = await client.listPayoutMethods();

const banks = methods.filter((m) => m.kind === "bank");
const ewallets = methods.filter((m) => m.kind === "ewallet");

// Ask the user to pick
const chosen = methods.find((m) => m.bankName === userSelection);
if (!chosen) throw new Error("Selected payout method is no longer available");

await client.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning",
  idrxBankCode: chosen.bankCode,
  idrxBankName: chosen.bankName,   // must match bankCode
  recipientDetails,
  bankAccountName,
});
```

{% hint style="danger" %}
**Never** build `idrxBankName` from a locally hard-coded lookup table. The pair `(bankCode, bankName)` is validated as a unit — mismatches return HTTP 400.
{% endhint %}

## Fees

{% hint style="warning" %}
**Rp 5,000** off-ramp fee applies when the payout target is a **bank account** or **e-wallet**. It's bundled into the quote returned at order creation — `idrAmount` is the amount the recipient receives.
{% endhint %}

## Limits

* `maxAmountTransfer` (when present on the `PayoutMethod`) is an **upper bound per transaction**.
* Additional daily / monthly caps may apply at the partner level; PaySats surfaces these as 400 errors at order creation time if you exceed them.

Next: [Deposit rails](deposit-rails.md) · [Order lifecycle](order-lifecycle.md) · [HTTP API /v1](http-api.md)
