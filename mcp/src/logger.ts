/**
 * stderr-only logger.
 *
 * Critical for stdio transport: stdout is reserved for JSON-RPC framing,
 * so every log line MUST go to stderr. We also use it from HTTP mode for
 * consistency, which keeps Railway/Docker logs uniform.
 */

type Level = "info" | "warn" | "error" | "debug";

const levelOrder: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel(): number {
  const raw = (process.env.PAYSATS_MCP_LOG_LEVEL || "info").toLowerCase();
  return levelOrder[(raw as Level)] ?? levelOrder.info;
}

function write(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (levelOrder[level] < activeLevel()) return;
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
  };
  if (extra !== undefined) payload.extra = extra;
  try {
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  } catch {
    process.stderr.write(`[${level}] ${scope}: ${msg}\n`);
  }
}

export const log = {
  info: (scope: string, msg: string, extra?: unknown) => write("info", scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown) => write("warn", scope, msg, extra),
  error: (scope: string, msg: string, extra?: unknown) => write("error", scope, msg, extra),
  debug: (scope: string, msg: string, extra?: unknown) => write("debug", scope, msg, extra),
};

/**
 * Redact PII (bank account numbers, e-wallet numbers, names) before logging.
 * We only log shape + hashes, never the raw details.
 */
export function redactCreateOrderInput<T extends Record<string, unknown>>(
  input: T,
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...input };
  if ("recipientDetails" in clone) clone.recipientDetails = "<redacted>";
  if ("bankAccountName" in clone) clone.bankAccountName = "<redacted>";
  return clone;
}
