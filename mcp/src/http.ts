import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

import type { AppEnv } from "./env.js";
import { log } from "./logger.js";
import { buildServer } from "./server.js";

const MCP_PATH = "/mcp";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function bearerAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") || "";
    const m = /^bearer\s+(.+)$/i.exec(header.trim());
    const provided = m?.[1]?.trim();
    if (!provided || !safeCompare(provided, token)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

function hostAllowlist(allowed: string[] | null) {
  if (!allowed || allowed.length === 0) return null;
  const set = new Set(allowed.map((h) => h.toLowerCase()));
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = (req.header("host") || "").toLowerCase();
    const hostname = host.split(":")[0];
    if (!set.has(host) && !set.has(hostname)) {
      res.status(403).json({ error: "Host not allowed" });
      return;
    }
    next();
  };
}

export interface HttpRuntime {
  close: () => Promise<void>;
}

export async function startHttp(env: AppEnv): Promise<HttpRuntime> {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, name: env.serverName, version: env.serverVersion });
  });

  const guards: Array<ReturnType<typeof bearerAuth>> = [];
  const hostGuard = hostAllowlist(env.allowedHosts);
  if (hostGuard) guards.push(hostGuard);
  if (env.httpToken) guards.push(bearerAuth(env.httpToken));

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: env.rateLimitPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const header = req.header("authorization") || "";
      const m = /^bearer\s+(.+)$/i.exec(header.trim());
      return m?.[1]?.trim() || req.ip || "anon";
    },
  });

  app.post(MCP_PATH, ...guards, limiter, async (req: Request, res: Response) => {
    const server = buildServer({
      name: env.serverName,
      version: env.serverVersion,
      apiKey: env.paysatsApiKey,
      baseUrl: env.paysatsBaseUrl,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("http", "mcp request failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get(MCP_PATH, ...guards, methodNotAllowed);
  app.delete(MCP_PATH, ...guards, methodNotAllowed);

  const server: HttpServer = await new Promise((resolve, reject) => {
    const s = app
      .listen(env.httpPort, env.httpHost, () => resolve(s))
      .on("error", reject);
  });

  log.info("http", "listening", {
    host: env.httpHost,
    port: env.httpPort,
    path: MCP_PATH,
    allowedHosts: env.allowedHosts ?? "any",
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
