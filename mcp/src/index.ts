import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadEnv } from "./env.js";
import { startHttp } from "./http.js";
import { log } from "./logger.js";
import { buildServer } from "./server.js";

function readPkg(): { name: string; version: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(here, "../package.json"),
    resolve(here, "../../package.json"),
  ]) {
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name && parsed.version) {
        return { name: parsed.name, version: parsed.version };
      }
    } catch {
      // try next candidate
    }
  }
  return { name: "@paysats/mcp", version: "0.0.0" };
}

async function main(): Promise<void> {
  const pkg = readPkg();
  const env = loadEnv(pkg);

  log.info("boot", "starting", {
    name: env.serverName,
    version: env.serverVersion,
    transport: env.transport,
    baseUrl: env.paysatsBaseUrl,
  });

  if (env.transport === "stdio") {
    const server = buildServer({
      name: env.serverName,
      version: env.serverVersion,
      apiKey: env.paysatsApiKey,
      baseUrl: env.paysatsBaseUrl,
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);

    const shutdown = async (signal: NodeJS.Signals) => {
      log.info("boot", `received ${signal}, shutting down`);
      try {
        await server.close();
      } catch (err) {
        log.warn("boot", "server close failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const http = await startHttp(env);
  const shutdown = async (signal: NodeJS.Signals) => {
    log.info("boot", `received ${signal}, shutting down`);
    try {
      await http.close();
    } catch (err) {
      log.warn("boot", "http close failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("boot", "fatal error", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
