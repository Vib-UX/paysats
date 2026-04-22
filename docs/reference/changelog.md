---
description: Public changelog for the PaySats API, SDK, and MCP server.
icon: clock-rotate-left
---

# Changelog

Notable public changes to the **PaySats API (`/v1`)**, **`@paysats/sdk`**, and **`@paysats/mcp`**. Internal infra changes are omitted unless they affect integrators.

{% hint style="info" %}
Versions follow the npm packages. Breaking changes bump the major. API `/v1` endpoints are additive; if we need to break wire compatibility, it ships as `/v2`.
{% endhint %}

{% updates format="full" %}
{% update date="2025-04-22" %}
## Documentation launch

* Published this GitBook with product overview, SDK / MCP / HTTP references, order-lifecycle guide, deposit-rails and payout-methods pages, and a worked end-to-end example.
* Added **"Why PaySats"** — P2P scam exposure, bank-account freezes, and manual-exchange pain as motivation.
* Architecture page is intentionally locked at a high level; deeper internals will ship incrementally.
{% endupdate %}

{% update date="2025-04-22" %}
## `@paysats/mcp` public

* MCP server with seven tools: `get_btc_idr_quote`, `list_payout_methods`, `get_deposit_rails`, `get_platform_stats`, `create_offramp_order`, `get_offramp_order`, `list_offramp_orders`.
* Two transports: `stdio` (Cursor / Claude Desktop) and `http` (remote MCP for Claude web / mobile).
* Three ways to run: self-host stdio, one-click Railway, Docker. Bearer-token auth required on every HTTP deploy.
{% endupdate %}

{% update date="2025-04-22" %}
## `@paysats/sdk` public

* Typed Node client covering every `/v1` endpoint.
* Terminal-state helper `waitForOrder` with `pollMs`, `timeoutMs`, `onUpdate`, and `AbortSignal` support.
* Structured errors via `PaysatsApiError` (`status`, `body`).
{% endupdate %}

{% update date="2025-04" %}
## Wrapped-BTC deposit rails

* Added `cbbtc` (Base) and `btcb` (BNB Chain) as `depositChannel` values.
* `POST /v1/offramp/orders` returns `deposit` (EVM instructions) instead of `bolt11` for these channels.
* Per-tenant ERC-4337 safe addresses exposed via `GET /v1/deposit/rails`.
{% endupdate %}

{% update date="2025-03" %}
## `/v1` API, tenant-scoped

* Launched `/v1/quote/btc-idr`, `/v1/payout/methods`, `/v1/deposit/rails`, `/v1/platform/stats`, and the off-ramp order endpoints.
* All endpoints gated by tenant API keys (`x-api-key` or `Authorization: Bearer`).
{% endupdate %}
{% endupdates %}

## Coming soon

* **Spark deposit addresses** surfaced in the SDK for native on-chain BTC.
* **Webhooks** for push notifications on order state changes (reducing the need for `waitForOrder` polling).
* **QRIS ⇄ IDRX** full round-trip settlement.
* **Gift cards and e-vouchers** via the custom P2P merchant network.
* **Multi-tenant OAuth on the MCP edge** (today every MCP HTTP deployment is single-tenant, keyed by env var).

Have a request or want early access? Email <code class="expression">space.vars.support_email</code>.
