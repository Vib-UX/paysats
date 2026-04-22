# @paysats/mcp

Model Context Protocol (MCP) server for PaySats. Wraps `@paysats/sdk` so a connected LLM (Claude Desktop, Cursor, Claude web/mobile via remote connector, etc.) can:

- Fetch BTC/IDR quotes and platform stats
- List payout banks / e-wallets (BCA, Jago, GoPay, OVO, ...)
- Check configured deposit rails (Lightning, cbBTC, BTCB)
- Create a Bitcoin -> IDR off-ramp order and receive a BOLT11 invoice
- Look up and list orders for the tenant

## Tools

| Tool | Purpose |
|------|---------|
| `get_btc_idr_quote` | Live BTC/IDR + USDC/IDR quote |
| `list_payout_methods` | Supported IDR banks and e-wallets (with `bankCode` / `bankName`) |
| `get_deposit_rails` | Lightning + EVM deposit rails currently configured |
| `get_platform_stats` | Liquidity / volume display stats |
| `create_offramp_order` | Create an off-ramp; returns `bolt11`, `satAmount`, `idrAmount`, ... |
| `get_offramp_order` | State of a specific order |
| `list_offramp_orders` | Recent orders for the authenticated tenant |

The server ships a canonical `instructions` string so clients (Claude, ChatGPT-compatible connectors, etc.) know to call `list_payout_methods` first, resolve `idrxBankCode` / `idrxBankName` from that list, and then call `create_offramp_order`.

## Transports

| Mode | When to use |
|------|-------------|
| `stdio` (default) | Local MCP clients that spawn child processes (Cursor, Claude Desktop) |
| `http` | Remote MCP (Claude web/mobile custom connector, hosted deploys) |

Stdio writes all logs to **stderr** (stdout is the JSON-RPC channel). The HTTP transport exposes `POST /mcp` and a `GET /healthz` for health checks.

## Environment variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `PAYSATS_API_KEY` | yes | - | Tenant API key (see backend `key:revoke` / `tenant:create`) |
| `PAYSATS_BASE_URL` | no | `https://api.paysats.io` | Point at local/self-hosted backend when needed |
| `PAYSATS_MCP_TRANSPORT` | no | `stdio` | `stdio` or `http` |
| `PAYSATS_MCP_HTTP_TOKEN` | yes for `http` | - | Bearer token required by the HTTP transport |
| `PAYSATS_MCP_HOST` | no | `127.0.0.1` | `0.0.0.0` for containers / Railway |
| `PAYSATS_MCP_PORT` / `PORT` | no | `3333` | Railway sets `PORT` automatically |
| `PAYSATS_MCP_ALLOWED_HOSTS` | no | any | Comma-separated allowlist for the `Host` header |
| `PAYSATS_MCP_RATE_LIMIT_PER_MINUTE` | no | `60` | Per-bearer rate limit on `/mcp` |
| `PAYSATS_MCP_NAME` | no | `@paysats/mcp` | Server name advertised to clients |
| `PAYSATS_MCP_LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error` |

## Build

```bash
cd sdk && npm install && npm run build
cd ../mcp && npm install && npm run build
```

Start locally (stdio):

```bash
PAYSATS_API_KEY=pk_live_xxx.yyy node dist/index.js
```

Start locally (HTTP):

```bash
PAYSATS_API_KEY=pk_live_xxx.yyy \
PAYSATS_MCP_TRANSPORT=http \
PAYSATS_MCP_HTTP_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))") \
npm run start:http
```

Then check health:

```bash
curl -s http://127.0.0.1:3333/healthz
```

## Deployment

### 1. Self-host (stdio - Cursor / Claude Desktop)

Add to your client's MCP config, e.g. `~/.cursor/mcp.json` or Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paysats": {
      "command": "node",
      "args": ["/absolute/path/to/paysats/mcp/dist/index.js"],
      "env": {
        "PAYSATS_API_KEY": "pk_live_xxx.yyy"
      }
    }
  }
}
```

### 2. One-click Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FGlittrfi%2Fpaysats&envs=PAYSATS_API_KEY%2CPAYSATS_MCP_TRANSPORT%2CPAYSATS_MCP_HOST%2CPAYSATS_MCP_HTTP_TOKEN%2CPAYSATS_MCP_ALLOWED_HOSTS&PAYSATS_MCP_TRANSPORTDefault=http&PAYSATS_MCP_HOSTDefault=0.0.0.0&PAYSATS_API_KEYDesc=PaySats+tenant+API+key+%28pk_live_...%29&PAYSATS_MCP_HTTP_TOKENDesc=Strong+bearer+token+MCP+clients+must+send&PAYSATS_MCP_ALLOWED_HOSTSDesc=Comma-separated+Host+allowlist+%28optional%2C+e.g.+your-service.up.railway.app%29)

The root-level [`railway.json`](../railway.json) pins the service to `mcp/Dockerfile` with `healthcheckPath=/healthz`, so you only need to supply the variables above. After deploy, expose the resulting HTTPS URL to clients as `https://<host>/mcp` with `Authorization: Bearer <PAYSATS_MCP_HTTP_TOKEN>`.

### 3. Self-host (HTTP / Docker)

Build the container from the repo root:

```bash
docker build -f mcp/Dockerfile -t paysats-mcp .
docker run --rm -p 3333:3333 \
  -e PAYSATS_API_KEY=pk_live_xxx.yyy \
  -e PAYSATS_MCP_TRANSPORT=http \
  -e PAYSATS_MCP_HOST=0.0.0.0 \
  -e PAYSATS_MCP_HTTP_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))") \
  paysats-mcp
```

### 4. PaySats-hosted

Same image operated by PaySats; customers add the published `https://mcp.paysats.io/mcp` URL in their MCP client. Multi-tenant OAuth on the MCP edge is a later addition; today every deployment uses a single tenant API key in env.

## Notes

- For remote MCP (Claude web/mobile), connections originate from the provider's cloud, not the user's device. Your MCP server must be reachable on the public internet and behind a strong bearer token.
- `recipientDetails` (bank account / mobile number) and `bankAccountName` are redacted from logs.
- The backend `/v1` always requires a valid tenant API key; there is no anonymous MCP path.
