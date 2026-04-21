import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PaysatsApiError, PaysatsClient } from "@paysats/sdk";
import { z } from "zod";

import { log, redactCreateOrderInput } from "./logger.js";

const INSTRUCTIONS = `You are driving the PaySats off-ramp (Bitcoin/Lightning -> Indonesian Rupiah).

Canonical workflow when a user asks to pay IDR from sats:
1. If the user has not told you the rail, use Lightning (default). For on-chain cbBTC/BTCB, call \`get_deposit_rails\` first.
2. For bank or e-wallet payouts, ALWAYS call \`list_payout_methods\` first so \`idrxBankCode\` + \`idrxBankName\` match exactly (BCA, Jago, GoPay, OVO, etc.). Never guess codes.
3. Call \`create_offramp_order\` with either \`idrAmount\` (IDR) or \`satAmount\` (sats) - not both - plus \`recipientDetails\` and the matched bank code/name.
4. For Lightning orders, the response contains \`bolt11\` and \`satAmount\`. Present those to the user so they can pay the invoice. Invoice expiry is in \`invoiceExpiresAt\`.
5. To track status, call \`get_offramp_order\` and branch on \`state\`. Terminal states are COMPLETED and FAILED.

Treat \`recipientDetails\` (bank account / mobile number) as sensitive: never echo it beyond the minimum needed to confirm the payout target with the user.`;

function toStructuredResult<T>(data: T, summary?: string) {
  const text = summary ?? JSON.stringify(data);
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    structuredContent: data as unknown as { [k: string]: unknown },
  };
}

function toToolError(scope: string, error: unknown) {
  if (error instanceof PaysatsApiError) {
    log.warn(scope, `paysats API error ${error.status}`, { message: error.message });
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `PaySats API error (${error.status}): ${error.message}`,
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  log.error(scope, "tool handler failed", { message });
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `PaySats MCP error: ${message}`,
      },
    ],
  };
}

export interface BuildServerOptions {
  name: string;
  version: string;
  apiKey: string;
  baseUrl: string;
}

export function buildServer(opts: BuildServerOptions): McpServer {
  const client = new PaysatsClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  const server = new McpServer(
    {
      name: opts.name,
      version: opts.version,
    },
    {
      instructions: INSTRUCTIONS,
    },
  );

  server.registerTool(
    "get_btc_idr_quote",
    {
      title: "Get BTC/IDR quote",
      description:
        "Fetch the live BTC/IDR quote used by PaySats. Also returns the USDC/IDR rate and the source timestamp.",
      inputSchema: {},
    },
    async () => {
      try {
        const quote = await client.getBtcIdrQuote();
        const summary = `1 BTC = ${quote.btcIdr.toLocaleString("en-US")} IDR (source: ${quote.source}, fetched ${quote.fetchedAt}).`;
        return toStructuredResult(quote, summary);
      } catch (e) {
        return toToolError("get_btc_idr_quote", e);
      }
    },
  );

  server.registerTool(
    "list_payout_methods",
    {
      title: "List payout methods",
      description:
        "List the supported IDR bank accounts and e-wallets with their `bankCode` / `bankName`. Call this before `create_offramp_order` so the codes match exactly.",
      inputSchema: {},
    },
    async () => {
      try {
        const methods = await client.listPayoutMethods();
        const summary = `${methods.length} payout method(s) available: ${methods
          .slice(0, 8)
          .map((m) => `${m.bankName} (${m.bankCode}, ${m.kind})`)
          .join(", ")}${methods.length > 8 ? ", ..." : ""}`;
        return toStructuredResult({ methods }, summary);
      } catch (e) {
        return toToolError("list_payout_methods", e);
      }
    },
  );

  server.registerTool(
    "get_deposit_rails",
    {
      title: "Get deposit rails",
      description:
        "Return the configured funding rails: Bitcoin on-chain (Spark), Lightning, plus EVM rails (cbBTC on Base, BTCB on BNB Chain) if the operator has them enabled.",
      inputSchema: {},
    },
    async () => {
      try {
        const rails = await client.getDepositRails();
        return toStructuredResult(rails);
      } catch (e) {
        return toToolError("get_deposit_rails", e);
      }
    },
  );

  server.registerTool(
    "get_platform_stats",
    {
      title: "Get platform stats",
      description: "Liquidity / volume display stats for the PaySats platform.",
      inputSchema: {},
    },
    async () => {
      try {
        const stats = await client.getPlatformStats();
        return toStructuredResult(stats);
      } catch (e) {
        return toToolError("get_platform_stats", e);
      }
    },
  );

  server.registerTool(
    "create_offramp_order",
    {
      title: "Create off-ramp order",
      description:
        "Create a new Bitcoin -> IDR off-ramp order. For the default Lightning rail the response includes `bolt11` (the invoice) and `satAmount`; show these to the user so they can pay. Always call `list_payout_methods` first to get the exact `idrxBankCode` / `idrxBankName`.",
      inputSchema: {
        idrAmount: z
          .number()
          .positive()
          .optional()
          .describe("Target IDR amount (sats derived from live quote)."),
        satAmount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Exact sat amount. Provide this OR `idrAmount`, not both."),
        depositChannel: z
          .enum(["lightning", "cbbtc", "btcb"])
          .optional()
          .describe('Funding rail. Defaults to "lightning".'),
        idrxBankCode: z
          .string()
          .min(1)
          .describe("From `list_payout_methods().methods[].bankCode` (e.g. BCA, JAGO, GOPAY)."),
        idrxBankName: z
          .string()
          .min(1)
          .describe("From the same method row as `idrxBankCode` (e.g. BCA, Jago, GoPay)."),
        recipientDetails: z
          .string()
          .min(1)
          .describe(
            "Bank account number (digits only) for bank rails, or E.164 +62... / 10-15 digit mobile for e-wallets.",
          ),
        bankAccountName: z
          .string()
          .optional()
          .describe("Legal account holder name. Optional; server provides a default."),
        payoutMethod: z
          .literal("bank_transfer")
          .optional()
          .describe("Reserved for future rails. Only `bank_transfer` is supported today."),
      },
    },
    async (input) => {
      try {
        if ((input.satAmount ?? 0) <= 0 && (input.idrAmount ?? 0) <= 0) {
          return toToolError(
            "create_offramp_order",
            new Error("Provide a positive `idrAmount` or `satAmount`."),
          );
        }
        if (input.satAmount && input.idrAmount) {
          return toToolError(
            "create_offramp_order",
            new Error("Provide either `idrAmount` or `satAmount`, not both."),
          );
        }
        log.info("create_offramp_order", "creating order", redactCreateOrderInput(input));
        const resp = await client.createOfframpOrder(input);
        const summary = resp.bolt11
          ? `Order ${resp.orderId}: pay ${resp.satAmount.toLocaleString("en-US")} sats (= ${resp.idrAmount.toLocaleString("en-US")} IDR) via the Lightning invoice. Expires ${resp.invoiceExpiresAt ?? "unknown"}.`
          : `Order ${resp.orderId}: ${resp.satAmount.toLocaleString("en-US")} sats (= ${resp.idrAmount.toLocaleString("en-US")} IDR). Fund via the on-chain deposit instructions in \`deposit\`.`;
        return toStructuredResult(resp, summary);
      } catch (e) {
        return toToolError("create_offramp_order", e);
      }
    },
  );

  server.registerTool(
    "get_offramp_order",
    {
      title: "Get off-ramp order",
      description:
        "Fetch the current state of an order. Branch on `state`; terminal states are COMPLETED and FAILED.",
      inputSchema: {
        orderId: z.string().min(1).describe("Order id returned from `create_offramp_order`."),
      },
    },
    async ({ orderId }) => {
      try {
        const order = await client.getOrder(orderId);
        const summary = `Order ${order.id} is in state ${order.state}.`;
        return toStructuredResult(order, summary);
      } catch (e) {
        return toToolError("get_offramp_order", e);
      }
    },
  );

  server.registerTool(
    "list_offramp_orders",
    {
      title: "List off-ramp orders",
      description:
        "List recent off-ramp orders for the authenticated tenant. Orders are returned newest first.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max rows to return (1-100, default 50)."),
      },
    },
    async ({ limit }) => {
      try {
        const orders = await client.listOrders({ limit });
        const summary = `${orders.length} order(s).`;
        return toStructuredResult({ orders }, summary);
      } catch (e) {
        return toToolError("list_offramp_orders", e);
      }
    },
  );

  return server;
}
