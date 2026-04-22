---
description: >-
  How PaySats tenant API keys work, where to keep them, and how they gate every
  integration surface.
icon: key
---

# API keys

PaySats uses a **single tenant API key** as the credential across every integration surface:

* The HTTP `/v1` API, sent as `Authorization: Bearer <key>`
* `@paysats/sdk`, passed to `new PaysatsClient({ apiKey })`
* `@paysats/mcp`, read from the `PAYSATS_API_KEY` env var

{% hint style="danger" %}
**Never** ship an API key in a browser bundle, mobile binary, or public MCP configuration. All three surfaces are designed to be called from a **server you control**. The key authenticates **you** (the tenant), not an end user.
{% endhint %}

## Format

Keys look like:

```
pk_live_xxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

* `pk_live_` prefix is always present.
* The part before the `.` is the **key ID** (safe to log, useful for support).
* The part after the `.` is the **secret**. Treat it like a password.

## Getting a key

{% hint style="success" %}
**Ping us on Telegram at [@vibcrypto](https://t.me/vibcrypto).** Fastest way to get a tenant API key during private beta.
{% endhint %}

PaySats is currently in **private beta**. To request a tenant API key, message [@vibcrypto](https://t.me/vibcrypto) on Telegram or email <code class="expression">space.vars.support_email</code>. Include:

* The product / app you're integrating
* Expected monthly volume (approx local fiat)
* Which rails you need (Lightning, cbBTC, BTCB)
* Whether you want **bank** or **e-wallet** payouts (or both), and the target market (Indonesia / India / other)

## Where to store it

{% tabs %}
{% tab title="Node / server" %}
Environment variable, read at startup:

```bash
export PAYSATS_API_KEY="pk_live_xxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

```ts
import { PaysatsClient } from "@paysats/sdk";

const client = new PaysatsClient({
  apiKey: process.env.PAYSATS_API_KEY!,
});
```
{% endtab %}

{% tab title="MCP (Cursor / Claude Desktop)" %}
In `~/.cursor/mcp.json` or `claude_desktop_config.json`, under `env`:

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

The file is read only by your local MCP client. It never leaves your machine.
{% endtab %}

{% tab title="Railway / Docker" %}
As a service env var. Never check the value into git.

```bash
railway variables set PAYSATS_API_KEY="pk_live_xxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```
{% endtab %}
{% endtabs %}

## What the key can do

Every call with a valid tenant key can:

* Create off-ramp orders against **that tenant's** smart accounts and payout configuration
* Read back **only its own** orders (`GET /v1/offramp/orders` and `/:id` are scoped by `tenantId`)
* Query quotes, payout methods, deposit rails, and platform stats (these are effectively public but still require a valid key)

It **cannot**:

* See other tenants' orders
* Mint new API keys (that's a backend-only operator command)
* Change payout destinations of existing orders

## Rotating and revoking

* Key rotation is handled by PaySats ops via the backend `key:rotate` / `key:revoke` commands.
* If a key leaks, ping us on Telegram at [@vibcrypto](https://t.me/vibcrypto) or email <code class="expression">space.vars.support_email</code> from the account of record. We revoke and reissue.
* Losing a secret is recoverable (rotate); losing the key ID is not sensitive.

Next: [Quickstart](quickstart.md) · [HTTP API /v1](../developers/http-api.md)
