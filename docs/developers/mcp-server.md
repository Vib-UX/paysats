---
description: >-
  @paysats/mcp — Model Context Protocol server that lets Cursor, Claude
  Desktop, Claude web, and other MCP clients quote, list, and create PaySats
  off-ramp orders.
icon: plug
---

# MCP server — @paysats/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server that wraps `@paysats/sdk` so a connected LLM can:

* Fetch BTC/IDR quotes and platform stats
* List payout banks / e-wallets
* Check configured deposit rails
* Create Bitcoin → IDR off-ramp orders and return the BOLT11 invoice
* Look up and list orders for the tenant

{% hint style="info" %}
The server ships a canonical `instructions` string so clients (Claude, ChatGPT-compatible connectors, etc.) know to call `list_payout_methods` first, resolve `idrxBankCode` / `idrxBankName` from that list, and only then call `create_offramp_order`.
{% endhint %}

## Tools

| Tool | Purpose |
|------|---------|
| `get_btc_idr_quote` | Live BTC/IDR + USDC/IDR quote |
| `list_payout_methods` | Supported IDR banks and e-wallets (with `bankCode` / `bankName` and `kind`) |
| `get_deposit_rails` | Lightning + EVM deposit rails currently configured |
| `get_platform_stats` | Liquidity / volume display stats |
| `create_offramp_order` | Create an off-ramp; returns `bolt11`, `satAmount`, `idrAmount`, ... |
| `get_offramp_order` | State of a specific order |
| `list_offramp_orders` | Recent orders for the authenticated tenant |

## Transports

| Mode | When to use |
|------|-------------|
| `stdio` (default) | Local MCP clients that spawn child processes (Cursor, Claude Desktop) |
| `http` | Remote MCP (Claude web / mobile custom connector, hosted deploys) |

Stdio writes all logs to **stderr** (stdout is the JSON-RPC channel). The HTTP transport exposes `POST /mcp` and `GET /healthz`.

{% hint style="warning" %}
Every HTTP deployment **requires** `Authorization: Bearer <PAYSATS_MCP_HTTP_TOKEN>`. There is no unauthenticated internet-facing mode.
{% endhint %}

## Environment variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `PAYSATS_API_KEY` | yes | — | Tenant API key (`pk_live_...`). See [API keys](../getting-started/api-keys.md). |
| `PAYSATS_BASE_URL` | no | `https://api.paysats.io` | Point at a self-hosted backend when needed. |
| `PAYSATS_MCP_TRANSPORT` | no | `stdio` | `stdio` or `http`. |
| `PAYSATS_MCP_HTTP_TOKEN` | yes for `http` | — | Bearer token required by the HTTP transport. |
| `PAYSATS_MCP_HOST` | no | `127.0.0.1` | Use `0.0.0.0` on Railway / containers. |
| `PAYSATS_MCP_PORT` / `PORT` | no | `3333` | Railway sets `PORT` automatically and it takes precedence. |
| `PAYSATS_MCP_ALLOWED_HOSTS` | no | any | Comma-separated allowlist for the `Host` header (DNS-rebinding protection). |
| `PAYSATS_MCP_RATE_LIMIT_PER_MINUTE` | no | `60` | Per-bearer rate limit on `POST /mcp`. |
| `PAYSATS_MCP_NAME` | no | `@paysats/mcp` | Server name advertised to clients. |
| `PAYSATS_MCP_LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error`. |

Generate a strong HTTP token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Deployment

{% tabs %}
{% tab title="stdio (Cursor / Claude Desktop)" %}
### 1. Build from source

The repo uses `file:../sdk`, so build both in order:

```bash
cd sdk && npm install && npm run build
cd ../mcp && npm install && npm run build
```

### 2. Register with your MCP client

Add to `~/.cursor/mcp.json` or Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paysats": {
      "command": "node",
      "args": ["/absolute/path/to/paysats/mcp/dist/index.js"],
      "env": {
        "PAYSATS_API_KEY": "pk_live_xxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Restart the client. The `paysats` server should appear with all seven tools listed.
{% endtab %}

{% tab title="Railway (one-click)" %}
### Deploy via the Railway template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FGlittrfi%2Fpaysats&envs=PAYSATS_API_KEY%2CPAYSATS_MCP_TRANSPORT%2CPAYSATS_MCP_HOST%2CPAYSATS_MCP_HTTP_TOKEN%2CPAYSATS_MCP_ALLOWED_HOSTS&PAYSATS_MCP_TRANSPORTDefault=http&PAYSATS_MCP_HOSTDefault=0.0.0.0&PAYSATS_API_KEYDesc=PaySats+tenant+API+key+%28pk_live_...%29&PAYSATS_MCP_HTTP_TOKENDesc=Strong+bearer+token+MCP+clients+must+send&PAYSATS_MCP_ALLOWED_HOSTSDesc=Comma-separated+Host+allowlist+%28optional%29)

The repo-root [`railway.json`](https://github.com/Glittrfi/paysats/blob/main/railway.json) pins the service to `mcp/Dockerfile` with `healthcheckPath=/healthz`. Supply:

* `PAYSATS_API_KEY`
* `PAYSATS_MCP_HTTP_TOKEN`
* `PAYSATS_MCP_ALLOWED_HOSTS` (e.g. `your-service.up.railway.app`)

After deploy, expose the HTTPS URL to clients as:

```
https://<host>/mcp
Authorization: Bearer <PAYSATS_MCP_HTTP_TOKEN>
```
{% endtab %}

{% tab title="Docker (self-host)" %}
Build from the repo root:

```bash
docker build -f mcp/Dockerfile -t paysats-mcp .

docker run --rm -p 3333:3333 \
  -e PAYSATS_API_KEY=pk_live_xxx.yyy \
  -e PAYSATS_MCP_TRANSPORT=http \
  -e PAYSATS_MCP_HOST=0.0.0.0 \
  -e PAYSATS_MCP_HTTP_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))") \
  paysats-mcp
```

Health check:

```bash
curl -s http://127.0.0.1:3333/healthz
```
{% endtab %}

{% tab title="PaySats-hosted" %}
Same image operated by PaySats. Customers only add the published URL in their MCP client:

```
<code class="expression">space.vars.mcp_hosted_url</code>
```

with `Authorization: Bearer <issued-token>`. Multi-tenant OAuth on the MCP edge is planned; today every deployment uses a single tenant API key in env.
{% endtab %}
{% endtabs %}

## Expected client flow

{% hint style="success" %}
This is the flow encoded in the server's `instructions` string — clients will follow it by default.
{% endhint %}

{% stepper %}
{% step %}
### `list_payout_methods`

Pull the live list of banks / e-wallets. Pick one matching the user's destination. Capture its `bankCode` and `bankName`.
{% endstep %}

{% step %}
### `get_btc_idr_quote` (optional)

Show the user the locked BTC/IDR rate before committing.
{% endstep %}

{% step %}
### `create_offramp_order`

Pass `idrxBankCode` + `idrxBankName` exactly as returned, plus `recipientDetails` (digits for bank, mobile for e-wallet), `bankAccountName`, and either `satAmount` or `idrAmount`.

Receive `bolt11` (Lightning) or `deposit` (on-chain EVM) instructions.
{% endstep %}

{% step %}
### `get_offramp_order`

Poll state until `COMPLETED` or `FAILED`. Prefer ~5 s intervals.
{% endstep %}
{% endstepper %}

## Safety and redaction

* `recipientDetails` (bank account / mobile number) and `bankAccountName` are **redacted from logs**.
* The backend `/v1` always requires a valid tenant API key — there is no anonymous MCP path.
* Remote MCP connections (Claude web / mobile) originate from the provider's cloud. Your MCP server must be **reachable on the public internet and behind a strong bearer token**.

## Troubleshooting

<details>

<summary>Client can't see any tools</summary>

* Confirm the server process started — check the client's MCP logs for stdout (stdio) or `GET /healthz` (HTTP).
* For stdio, remember: **stdout is the JSON-RPC channel**. Anything your wrapper prints to stdout will corrupt the protocol. Only stderr is safe.
* For HTTP, make sure `Authorization: Bearer` matches `PAYSATS_MCP_HTTP_TOKEN` exactly (base64url, no whitespace).

</details>

<details>

<summary><code>create_offramp_order</code> returns a 400</summary>

* `idrxBankCode` and `idrxBankName` must be a matched pair from `list_payout_methods`.
* `recipientDetails` must be digits for `kind: "bank"` and a mobile number for `kind: "ewallet"`.
* Supply **either** `satAmount` or `idrAmount`, not both.

</details>

<details>

<summary>Railway deploy fails the healthcheck</summary>

* `PAYSATS_MCP_HOST` must be `0.0.0.0`, not `127.0.0.1`.
* `PORT` is injected by Railway and takes precedence over `PAYSATS_MCP_PORT`.
* `PAYSATS_MCP_ALLOWED_HOSTS` must include your Railway public hostname.

</details>

Next: [HTTP API /v1](http-api.md) · [SDK reference](sdk.md) · [Order lifecycle](order-lifecycle.md)
