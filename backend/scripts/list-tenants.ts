#!/usr/bin/env tsx
/** List paysats tenants and their active API key prefixes. */
import "dotenv/config";
import { prisma } from "../src/prisma.js";

async function main() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      apiKeys: {
        orderBy: { createdAt: "desc" },
        select: {
          prefix: true,
          label: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
    },
  });

  if (!tenants.length) {
    console.log("No tenants yet. Run: npm --prefix backend run tenant:create -- --name <name>");
    return;
  }

  for (const t of tenants) {
    console.log(`\n${t.name}  (id=${t.id})  created=${t.createdAt.toISOString()}`);
    if (t.webhookUrl) console.log(`  webhook: ${t.webhookUrl}`);
    for (const k of t.apiKeys) {
      const status = k.revokedAt ? `REVOKED ${k.revokedAt.toISOString()}` : "active";
      const lastUsed = k.lastUsedAt ? k.lastUsedAt.toISOString() : "never";
      console.log(`  - ${k.prefix}  (${k.label ?? "default"})  ${status}  lastUsed=${lastUsed}`);
    }
  }
  console.log();
}

main()
  .catch((err) => {
    console.error("tenant:list failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
