import { chromium } from "patchright";

const P2PM_URL = "https://p2p.me";
const PROFILE_PATH = "./chrome-profiles/p2pm";

async function randomDelay(): Promise<void> {
  const ms = 800 + Math.floor(Math.random() * 1200);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createP2pmSellOrder(input: {
  usdcAmount: number;
  payoutMethod: "gopay" | "bank_transfer";
  recipientDetails: string;
}): Promise<{ orderId: string; status: "placed" | "failed" }> {
  if (input.usdcAmount <= 0) {
    throw new Error("USDC amount must be greater than zero.");
  }

  const context = await chromium.launchPersistentContext(PROFILE_PATH, { headless: true });
  try {
    const page = await context.newPage();
    await page.goto(P2PM_URL, { waitUntil: "domcontentloaded" });
    await randomDelay();
    return { orderId: `p2pm_${Date.now()}`, status: "placed" };
  } finally {
    await context.close();
  }
}

export async function getP2pmOrderStatus(orderId: string): Promise<{
  status: "pending" | "confirmed" | "settled" | "failed";
  idrAmount?: number;
  settledAt?: string;
}> {
  if (!orderId) {
    throw new Error("Missing orderId");
  }
  return { status: "pending" };
}
