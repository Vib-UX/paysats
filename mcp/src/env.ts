export type Transport = "stdio" | "http";

export interface AppEnv {
  transport: Transport;
  paysatsApiKey: string;
  paysatsBaseUrl: string;
  httpHost: string;
  httpPort: number;
  httpToken: string | null;
  allowedHosts: string[] | null;
  rateLimitPerMinute: number;
  serverName: string;
  serverVersion: string;
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseTransport(raw: string | undefined): Transport {
  const v = (raw || "stdio").trim().toLowerCase();
  if (v === "http" || v === "stdio") return v;
  throw new Error(
    `PAYSATS_MCP_TRANSPORT must be "stdio" or "http" (got "${raw}")`,
  );
}

function parseHosts(raw: string | undefined): string[] | null {
  if (!raw || !raw.trim()) return null;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadEnv(pkg: { name: string; version: string }): AppEnv {
  const transport = parseTransport(process.env.PAYSATS_MCP_TRANSPORT);

  const apiKey = (process.env.PAYSATS_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error(
      "PAYSATS_API_KEY is required. Set it in the MCP process env (local config for stdio, or secrets for HTTP deployments).",
    );
  }

  const baseUrl = (process.env.PAYSATS_BASE_URL ?? "").trim() || "https://api.paysats.io";

  const httpHost = (process.env.PAYSATS_MCP_HOST ?? "").trim() || "127.0.0.1";
  const httpPort = readInt(
    process.env.PORT ?? process.env.PAYSATS_MCP_PORT,
    3333,
  );

  const httpToken = (process.env.PAYSATS_MCP_HTTP_TOKEN ?? "").trim() || null;
  if (transport === "http" && !httpToken) {
    throw new Error(
      "PAYSATS_MCP_HTTP_TOKEN is required when PAYSATS_MCP_TRANSPORT=http. Set a strong bearer token (e.g. `node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"`).",
    );
  }

  const allowedHosts = parseHosts(process.env.PAYSATS_MCP_ALLOWED_HOSTS);
  const rateLimitPerMinute = readInt(
    process.env.PAYSATS_MCP_RATE_LIMIT_PER_MINUTE,
    60,
  );

  const serverName = (process.env.PAYSATS_MCP_NAME ?? "").trim() || pkg.name;

  return {
    transport,
    paysatsApiKey: apiKey,
    paysatsBaseUrl: baseUrl,
    httpHost,
    httpPort,
    httpToken,
    allowedHosts,
    rateLimitPerMinute,
    serverName,
    serverVersion: pkg.version,
  };
}
