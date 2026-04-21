#!/usr/bin/env tsx
/**
 * Create a new paysats SDK tenant and issue its first API key.
 *
 * Usage:
 *   npm --prefix backend run tenant:create -- --name "Acme Wallet" [--label "prod"] \
 *       [--webhook https://example.com/hook] [--webhook-secret <hex>]
 *
 * Prints the full API key ONCE. Only the sha256 hash is stored.
 */
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { generateApiKey } from "../src/apiKeyAuth.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return undefined;
  return v;
}

async function main() {
  const name = arg("--name");
  if (!name) {
    console.error("Usage: tenant:create --name <tenant name> [--label <key label>] [--webhook <url>] [--webhook-secret <secret>]");
    process.exit(1);
  }
  const label = arg("--label") || "default";
  const webhookUrl = arg("--webhook") || null;
  const webhookSecret = arg("--webhook-secret") || null;

  const tenant = await prisma.tenant.create({
    data: { name, webhookUrl, webhookSecret },
  });

  const { fullKey, prefix, hash } = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: { tenantId: tenant.id, prefix, hash, label },
  });

  console.log("\nTenant created.");
  console.log("  id:        ", tenant.id);
  console.log("  name:      ", tenant.name);
  console.log("  apiKey.id: ", apiKey.id);
  console.log("  label:     ", label);
  console.log("\nAPI KEY (store securely — NOT shown again):");
  console.log(`  PAYSATS_API_KEY=${fullKey}`);
  console.log("\nPrefix (safe to display / log):");
  console.log(`  ${prefix}`);
  console.log();
}

main()
  .catch((err) => {
    console.error("tenant:create failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
