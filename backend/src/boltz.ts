import { chromium } from "patchright";
import type { BrowserContext, Page } from "patchright";
import { log } from "./logger.js";

type LogFn = (msg: string) => void;

const PROFILE_PATH = "./chrome-profiles/boltz";
const BOLTZ_URL = "https://beta.boltz.exchange/?sendAsset=LN&receiveAsset=USDT0";
const BOLTZ_ORIGIN = "https://beta.boltz.exchange";

async function randomDelay(): Promise<void> {
  const ms = 800 + Math.floor(Math.random() * 1200);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickByText(
  page: Page,
  candidates: string[],
  description: string,
  timeoutMs = 10_000
): Promise<void> {
  for (const text of candidates) {
    try {
      const loc = page.locator(text);
      await loc.click({ timeout: timeoutMs / candidates.length });
      return;
    } catch {
      // try next
    }
  }
  throw new Error(`Could not find ${description}`);
}

async function createSwapInContext(
  context: BrowserContext,
  recipientAddress: string,
  satsToSend: number,
  logFn: LogFn
): Promise<{ swapId: string; bolt11: string; satsAmount: string; usdtAmount: string }> {
  const page = await context.newPage();
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BOLTZ_ORIGIN });
  } catch {
    log.warn("boltz", "clipboard permission grant failed (may still work)");
  }

  logFn("Opening Boltz Exchange...");
  await page.goto(BOLTZ_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await randomDelay();

  logFn("Selecting USDT on Base...");
  await page.locator("button").nth(2).click({ timeout: 5_000 });
  await randomDelay();

  await clickByText(
    page,
    [
      'button:has-text("USDT Select network")',
      'button:has-text("Select network")',
      "text=USDT"
    ],
    "USDT network selector"
  );
  await randomDelay();

  await clickByText(
    page,
    ['button:has-text("Base")', "text=Base", "text=USDT0"],
    "USDT on Base option"
  );
  await randomDelay();

  logFn(`Setting send amount: ${satsToSend} sats...`);
  const sendInput = page.locator('input[placeholder="0"]').first();
  await sendInput.click();
  await sendInput.fill(String(satsToSend));
  await randomDelay();

  const receiveInput = page.locator('input[placeholder="0"]').nth(1);
  const usdtAmount = await receiveInput.inputValue();

  logFn(`Pasting recipient address: ${recipientAddress}...`);
  const addressInput = page.locator('input[placeholder*="address to receive"]');
  await addressInput.fill(recipientAddress);
  await randomDelay();

  const swapBtn = page.locator('button:has-text("Create Atomic Swap")');
  await swapBtn.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const buttons = document.querySelectorAll("button");
      for (const b of buttons) {
        if (b.textContent?.includes("Create Atomic Swap") && !b.disabled) return true;
      }
      return false;
    },
    { timeout: 20_000 }
  );
  await swapBtn.click();

  await page.waitForURL(/beta\.boltz\.exchange\/swap\//, { timeout: 20_000 });
  const swapUrl = page.url();
  const swapId = swapUrl.split("/swap/")[1]?.split("?")[0] || "unknown";

  let finalSats = String(satsToSend);
  try {
    const payText = await page.locator("text=Pay this invoice about").textContent({ timeout: 5_000 });
    if (payText) {
      const satsMatch = payText.match(/([\d\s]+)\s*sats/);
      if (satsMatch) {
        finalSats = satsMatch[1].replace(/\s/g, "");
      }
    }
  } catch {
    // fallback to requested sats
  }

  await page.evaluate(() => window.scrollBy(0, 600));
  await randomDelay();
  await clickByText(
    page,
    [
      "text=LIGHTNING INVOICE",
      'button:has-text("LIGHTNING INVOICE")',
      "[class*='invoice'] >> text=LIGHTNING",
      "text=Lightning Invoice"
    ],
    "LIGHTNING INVOICE button"
  );
  await randomDelay();

  let bolt11 = await page.evaluate(() => navigator.clipboard.readText());
  if (!bolt11 || !bolt11.startsWith("lnbc")) {
    const pageText = await page.evaluate(() => document.body?.innerText || "");
    const lnMatch = pageText.match(/(lnbc[a-z0-9]+)/i);
    if (!lnMatch) {
      throw new Error("Could not extract Lightning invoice from clipboard or page");
    }
    bolt11 = lnMatch[1];
  }

  return { swapId, bolt11, satsAmount: finalSats, usdtAmount };
}

export async function createBoltzSwap(input: {
  satAmount: number;
  receiveAddress: string;
  log?: LogFn;
}): Promise<{ invoice: string; swapId: string; satsAmount: string; usdtAmount: string }> {
  if (input.satAmount <= 0) {
    throw new Error("satAmount must be greater than 0");
  }

  const logFn = input.log || (() => {});
  const headless = process.env.BOLTZ_HEADLESS !== "0";
  let lastError: Error | undefined;
  let attempts = 0;
  while (attempts < 3) {
    attempts += 1;
    const context = await chromium.launchPersistentContext(PROFILE_PATH, {
      headless,
      args: ["--disable-dev-shm-usage", "--no-sandbox"]
    });
    try {
      const result = await createSwapInContext(context, input.receiveAddress, input.satAmount, logFn);
      return {
        invoice: result.bolt11,
        swapId: result.swapId,
        satsAmount: result.satsAmount,
        usdtAmount: result.usdtAmount
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log.error("boltz", `attempt ${attempts}/3 failed`, lastError);
      try {
        const page = context.pages()[0];
        if (page) await page.screenshot({ path: "boltz-debug-attempt.png", fullPage: true });
      } catch {
        /* ignore */
      }
      if (attempts === 3) {
        throw new Error(
          `Boltz automation failed after 3 attempts: ${lastError.message}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    } finally {
      await context.close();
    }
  }
  throw new Error("Unable to create Boltz swap.");
}

export async function getBoltzSwapStatus(swapId: string): Promise<{
  status: "pending" | "completed" | "failed";
  txHash?: string;
  usdtAmount?: number;
}> {
  if (!swapId) {
    throw new Error("Missing swapId.");
  }
  return { status: "pending" };
}
