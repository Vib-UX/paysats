import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { log } from "./logger.js";
import { prisma } from "./prisma.js";

/**
 * API keys are formatted as `<prefix>.<secret>`, where `<prefix>` is stored
 * plaintext on ApiKey.prefix (for O(1) lookup + display) and the full
 * `prefix.secret` string is sha256-hashed into ApiKey.hash.
 *
 * Example: `pk_live_Ab12Cd34.9f8e...` → prefix=`pk_live_Ab12Cd34`.
 */
const PREFIX_SCHEME = "pk_live_";
const PREFIX_RANDOM_LEN = 12;
const SECRET_RANDOM_LEN = 32;

export type AuthedTenant = {
  id: string;
  name: string;
  apiKeyId: string;
  apiKeyPrefix: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: AuthedTenant;
    }
  }
}

function hashKey(fullKey: string): string {
  return crypto.createHash("sha256").update(fullKey, "utf8").digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function extractKey(req: Request): string | null {
  const header = req.header("x-api-key");
  if (header && header.trim()) return header.trim();
  const auth = req.header("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  return null;
}

export function generateApiKey(): { fullKey: string; prefix: string; hash: string } {
  const prefixRandom = crypto.randomBytes(PREFIX_RANDOM_LEN).toString("base64url").slice(0, PREFIX_RANDOM_LEN);
  const secretRandom = crypto.randomBytes(SECRET_RANDOM_LEN).toString("base64url").slice(0, SECRET_RANDOM_LEN);
  const prefix = `${PREFIX_SCHEME}${prefixRandom}`;
  const fullKey = `${prefix}.${secretRandom}`;
  const hash = hashKey(fullKey);
  return { fullKey, prefix, hash };
}

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const raw = extractKey(req);
  if (!raw) {
    res.status(401).json({ error: "Missing API key (send x-api-key or Authorization: Bearer)" });
    return;
  }

  const dot = raw.indexOf(".");
  const prefix = dot > 0 ? raw.slice(0, dot) : raw;
  if (!prefix.startsWith(PREFIX_SCHEME)) {
    res.status(401).json({ error: "Invalid API key format" });
    return;
  }

  let record;
  try {
    record = await prisma.apiKey.findUnique({
      where: { prefix },
      include: { tenant: true },
    });
  } catch (e) {
    log.error("auth", "apiKey lookup failed", e);
    res.status(503).json({ error: "Auth backend unavailable" });
    return;
  }

  if (!record || record.revokedAt) {
    res.status(401).json({ error: "Invalid or revoked API key" });
    return;
  }

  const provided = hashKey(raw);
  if (!timingSafeEqualHex(provided, record.hash)) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  req.tenant = {
    id: record.tenantId,
    name: record.tenant.name,
    apiKeyId: record.id,
    apiKeyPrefix: record.prefix,
  };

  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch((e) => log.warn("auth", "lastUsedAt update failed", { error: e instanceof Error ? e.message : String(e) }));

  next();
}

export function requireTenant(req: Request): AuthedTenant {
  if (!req.tenant) {
    throw new Error("Tenant not attached to request (apiKeyAuth missing?)");
  }
  return req.tenant;
}
