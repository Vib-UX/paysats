#!/usr/bin/env tsx
/**
 * Revoke a paysats API key by its prefix.
 *
 * Usage:
 *   npm --prefix backend run key:revoke -- --prefix pk_live_abc123
 */
import "dotenv/config";
import { prisma } from "../src/prisma.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return undefined;
  return v;
}

async function main() {
  const prefix = arg("--prefix");
  if (!prefix) {
    console.error("Usage: key:revoke --prefix <pk_live_...>");
    process.exit(1);
  }

  const existing = await prisma.apiKey.findUnique({ where: { prefix } });
  if (!existing) {
    console.error(`No API key found with prefix: ${prefix}`);
    process.exit(1);
  }
  if (existing.revokedAt) {
    console.log(`Key ${prefix} was already revoked at ${existing.revokedAt.toISOString()}.`);
    return;
  }

  const updated = await prisma.apiKey.update({
    where: { prefix },
    data: { revokedAt: new Date() },
  });
  console.log(`Revoked ${updated.prefix} (tenant ${updated.tenantId}) at ${updated.revokedAt?.toISOString()}.`);
}

main()
  .catch((err) => {
    console.error("key:revoke failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
