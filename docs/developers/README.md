---
description: >-
  Developer hub — three integration surfaces over the same tenant API key: the
  HTTP /v1 API, @paysats/sdk, and @paysats/mcp.
icon: code
---

# Developers

PaySats exposes **three integration surfaces**, all backed by the same tenant API key.

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td><strong>SDK — @paysats/sdk</strong></td><td>Typed Node client. Quotes, payout methods, orders, polling.</td><td><a href="sdk.md">sdk.md</a></td></tr><tr><td><strong>MCP server — @paysats/mcp</strong></td><td>Model Context Protocol server for Cursor, Claude Desktop, and Claude web.</td><td><a href="mcp-server.md">mcp-server.md</a></td></tr><tr><td><strong>HTTP API /v1</strong></td><td>Raw REST endpoints with curl, SDK, and TypeScript examples.</td><td><a href="http-api.md">http-api.md</a></td></tr><tr><td><strong>Order lifecycle</strong></td><td>Every <code>OrderState</code>, terminal rules, and polling strategy.</td><td><a href="order-lifecycle.md">order-lifecycle.md</a></td></tr><tr><td><strong>Deposit rails</strong></td><td>Lightning, cbBTC on Base, BTCB on BNB Chain — shapes and examples.</td><td><a href="deposit-rails.md">deposit-rails.md</a></td></tr><tr><td><strong>Payout methods</strong></td><td>Bank vs e-wallet, <code>bankCode</code>/<code>bankName</code>, and recipient formats.</td><td><a href="payout-methods.md">payout-methods.md</a></td></tr></tbody></table>

## Pick a surface

| Use case | Use this |
|----------|----------|
| A Node / TypeScript backend creating off-ramp orders | [`@paysats/sdk`](sdk.md) |
| A backend in another language, or you need a specific endpoint | [HTTP API `/v1`](http-api.md) |
| An LLM (Cursor, Claude Desktop, Claude web) that should be able to quote / list / create orders on your behalf | [`@paysats/mcp`](mcp-server.md) |
| Driving UI off order state | [Order lifecycle](order-lifecycle.md) |

## Base URL

All surfaces resolve to the same API:

```
<code class="expression">space.vars.api_base_url</code>
```

You can point the SDK or MCP at a self-hosted backend by setting `PAYSATS_BASE_URL`.

## Shared conventions

* **Auth.** Every request sends the tenant API key as `x-api-key: <PAYSATS_API_KEY>` (or `Authorization: Bearer <PAYSATS_API_KEY>`; both are accepted). See [API keys](../getting-started/api-keys.md).
* **JSON.** All request and response bodies are JSON.
* **Amounts.** `idrAmount` is in whole rupiah (integer). `satAmount` is in sats (integer). No floats — ever.
* **Timestamps.** ISO 8601 strings (UTC) on the wire. The SDK surfaces them as `string | Date` on read, `string` on write.
* **Redaction.** `recipientDetails` and `bankAccountName` are **redacted from server logs**. Only the tenant that created an order can retrieve it.
* **Errors.** Non-2xx responses return `{ "error": "<message>" }`. The SDK raises `PaysatsApiError` with `status` and `body`.

Next: [SDK](sdk.md) · [MCP](mcp-server.md) · [HTTP API](http-api.md)
