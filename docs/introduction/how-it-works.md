---
description: >-
  High-level view of how a BTC payment becomes local fiat on a bank account or
  e-wallet. Internals are intentionally locked at this stage.
icon: diagram-project
---

# How it works

{% hint style="info" %}
This page is intentionally a **high-level overview**. Internal routing, fee policy, liquidity pool layout, and provider-level detail are locked at this stage, deeper developer material will be published as PaySats matures.
{% endhint %}

## End-to-end, in one picture

```mermaid
sequenceDiagram
  autonumber
  actor User as User / merchant
  participant App as PaySats app or SDK
  participant API as PaySats API
  participant Spark as Spark (TWDK Lightning)
  participant Boltz as Boltz (LN to USDT)
  participant WDK as TWDK ERC-4337
  participant Chains as Base / Arb / BNB / Polygon
  participant Fiat as IDR payout (BCA / e-wallet)

  User->>App: Create order (sats or IDR amount + recipient)
  App->>API: POST /v1/offramp/orders
  API-->>App: bolt11 invoice (LN) or deposit address (on-chain)
  User->>Spark: Pay BOLT11
  Spark-->>Boltz: LN settlement
  Boltz-->>WDK: USDT on smart account
  API->>WDK: LiFi / IDRX / burn / redeem
  WDK->>Chains: USDT to IDRX (routed)
  API->>Fiat: Bank or e-wallet credit
  API-->>App: state: COMPLETED
```

## The same thing as a flow

```mermaid
flowchart LR
  subgraph btcIn [Bitcoin in]
    ln[Lightning BOLT11]
    onchain[On-chain BTC via Spark]
    wrapped[cbBTC on Base or BTCB on BNB]
  end
  subgraph swap [Swap layer]
    ln --> boltz[Boltz LN to USDT]
    wrapped --> lifi[LiFi to IDRX]
    onchain --> twdk[TWDK smart accounts]
    boltz --> twdk
    lifi --> twdk
  end
  subgraph settle [Settlement]
    twdk --> idrx[IDRX burn and redeem]
  end
  subgraph payout [IDR out]
    idrx --> bank[BCA and partner banks]
    idrx --> ewallet[GoPay / OVO / Jago / DANA]
  end
```

## The pieces you'll actually touch

{% hint style="success" %}
As a developer you only interact with **one API** and **one SDK call**. Everything in the swap and settlement layer is orchestrated server-side.
{% endhint %}

| Layer | What you do | What PaySats does |
|-------|-------------|-------------------|
| **Quote** | `getBtcIdrQuote()` | Cached BTC/IDR + USDC/IDR rate |
| **Payout discovery** | `listPayoutMethods()` | Live list of banks + e-wallets with `bankCode` / `bankName` |
| **Order creation** | `createOfframpOrder({ idrAmount, depositChannel, ... })` | Lock quote, derive deposit target, return BOLT11 or deposit instructions |
| **Payment** | Payer pays BOLT11 or sends on-chain BTC / cbBTC / BTCB | Server watches invoice / deposit address, starts swap pipeline |
| **Swap** | (server-side) | LN → USDT via Boltz, or wrapped BTC → IDRX via LiFi |
| **Settle** | (server-side) | USDT → IDRX, then IDRX burn + redeem |
| **Payout** | (server-side) | IDRX partner credits BCA bank or e-wallet |
| **Status** | `getOrder()` or `waitForOrder()` | Deterministic state transitions up to `COMPLETED` / `FAILED` |

See [Order lifecycle](../developers/order-lifecycle.md) for the full state machine.

## What's live vs what's coming

| Area | Status |
|------|--------|
| Lightning in → BCA bank out | **Live** |
| Lightning in → e-wallet out (Jago, GoPay, OVO, ...) | **Live** |
| cbBTC (Base) in → IDR out | **Live (operator-triggered swap)** |
| BTCB (BNB Chain) in → IDR out | **Live (operator-triggered swap)** |
| Native on-chain BTC via Spark deposit addresses | **Wired; integrating in the SDK surface** |
| QRIS ⇄ IDRX full round-trip | **In progress** |
| Gift cards and e-vouchers (P2P merchant network) | **In progress** |
| Webhooks (push notifications for order state) | **Planned** |

Next: [Supported rails](supported-rails.md) · [Quickstart](../getting-started/quickstart.md)
