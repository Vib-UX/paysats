---
description: >-
  The case for PaySats — why informal BTC ↔ IDR flows end in scams, frozen bank
  accounts, and disputed receipts, and how PaySats removes that risk.
icon: shield-halved
---

# Why PaySats

Moving value between **Bitcoin** and **IDR** in Indonesia today is almost always a mess of **informal peer-to-peer trades, manual exchanges, and inbound bank transfers from strangers**. PaySats exists because every single one of those steps is a risk.

## The problems we actually see

{% hint style="danger" %}
**P2P scams are the default experience for small BTC ↔ IDR deals.**

Buyers and sellers meet on Telegram, WhatsApp groups, Facebook Marketplace, or unmoderated OTC channels. Common outcomes:

* **Fake transfer receipts** — a forged BCA / Mandiri screenshot while the sender never actually pushed funds.
* **Chargeback-style reversals** — inbound transfer is later reversed by the sender's bank, leaving the BTC seller out of pocket after they already released sats.
* **"Middleman" impersonation** — someone pretending to be an escrow agent disappears with the sats.
* **Price manipulation** — ad-hoc rates applied mid-trade once the counterparty has already committed.

There is **no audit trail**, **no settlement guarantee**, and **no recourse**.
{% endhint %}

{% hint style="warning" %}
**Bank accounts and e-wallets get frozen.**

Indonesian banks and e-wallets (BCA, Mandiri, BRI, GoPay, OVO, DANA, ...) routinely **freeze or block accounts** that receive multiple unverified inbound transfers from strangers — which is exactly what a P2P BTC trade looks like to a fraud engine.

Typical triggers:

* Repeated inbound transfers from new, unrelated senders.
* Amounts and memos that match patterns flagged by PPATK / internal AML rules.
* A single complaint from one of those senders later claiming fraud.

Once frozen, unfreezing is a **manual, weeks-long process** involving branch visits, documentation, and sometimes PPATK review. Your entire payout rail disappears overnight.
{% endhint %}

{% hint style="warning" %}
**Manual exchange babysitting eats the spread on small amounts.**

For **sub-dollar to everyday amounts**, the user experience today is:

1. Sell BTC on a CEX or P2P desk.
2. Wait for the fiat leg to clear (sometimes hours).
3. Manually withdraw to a bank / e-wallet.
4. Hope the withdrawal isn't flagged.

Every one of those steps has a **spread, a fee, and a delay**, and the user has to physically sit in front of the trade.
{% endhint %}

{% hint style="danger" %}
**No transparent settlement for merchants.**

A merchant who accepts BTC directly has no way to prove — to themselves, to their accountant, or to regulators — which on-chain payment corresponds to which IDR settlement. There is no consistent order ID, no invoice linkage, no explorer link tied to a payout reference.
{% endhint %}

## What PaySats replaces that with

{% columns %}
{% column %}
### Without PaySats

* P2P chat groups and forged receipts
* Inbound transfers from strangers → frozen accounts
* Manual CEX withdrawals, watched by hand
* No single reference linking BTC payment to IDR payout
* FX drift between "quote" and "settled"
* Invoice paid in sats but reconciled manually in IDR
{% endcolumn %}

{% column %}
### With PaySats

* A single **API call** creates an order with a BOLT11 invoice (or a deposit address for on-chain BTC).
* Funds move through **regulated, auditable rails** — Boltz for LN, Tether WDK smart accounts, IDRX burn/redeem, and licensed IDR payout partners.
* **One `orderId`** ties the Lightning invoice, the on-chain txes, the IDRX redeem, and the final bank / e-wallet credit together.
* **Live quote** is locked at order creation so what the payer sees is what the merchant gets.
* **Webhooks and polling** give a deterministic state machine from `IDLE` to `COMPLETED`.
{% endcolumn %}
{% endcolumns %}

## Who PaySats is for

* **Indonesian merchants** accepting BTC / Lightning but wanting IDR in their existing BCA or e-wallet account, without running their own swap infra.
* **Apps and wallets** that want a single `createOfframpOrder` call instead of plugging together Boltz, LiFi, IDRX, and a payout API themselves.
* **Tooling and AI agents** using the MCP server to programmatically price, quote, and settle small BTC → IDR transactions on behalf of a user.

{% hint style="success" %}
If you've ever thought "I just want to send sats and have a known amount of rupiah land in a named bank account, with a receipt" — that's exactly what PaySats is.
{% endhint %}

## How we stay out of the risky zone

* **No anonymous inbound cash to your account.** Settlement originates from **licensed IDRX redeem partners**, not from anonymous P2P senders, which is what triggers bank-side freezes in the first place.
* **Every leg has an on-chain or ledger reference.** Lightning payment hash → USDT tx → IDRX burn tx → redeem ID → bank reference. See [Example end-to-end flow](../reference/example-flow.md).
* **Operator funds move through TWDK smart accounts** with clear per-chain safe addresses — see [Deposit rails](../developers/deposit-rails.md).
* **Redacted by default.** Recipient bank account numbers and holder names are stripped from logs; only the tenant that created the order can retrieve it via the API.

Next: [How it works](how-it-works.md) · [Quickstart](../getting-started/quickstart.md)
