/**
 * Boltz: browser UI automation only (beta.boltz.exchange).
 * We do not call Boltz REST/Web APIs here — Playwright-style flow drives the site like a user.
 */
import { chromium } from "patchright";
import type { BrowserContext, Page } from "patchright";
import { log } from "./logger.js";

type LogFn = (msg: string) => void;

const PROFILE_PATH = "./chrome-profiles/boltz";
const BOLTZ_URL = "https://beta.boltz.exchange/?sendAsset=LN&receiveAsset=USDT0";
const BOLTZ_ORIGIN = "https://beta.boltz.exchange";

const keptBoltzContexts: BrowserContext[] = [];

async function bestEffortAutoClaim(context: BrowserContext, swapId: string, logFn: LogFn): Promise<void> {
  const maxWaitMs = Math.max(0, Number(process.env.BOLTZ_AUTO_CLAIM_MAX_WAIT_MS || "300000") || 300_000);
  const pollMs = Math.max(750, Number(process.env.BOLTZ_AUTO_CLAIM_POLL_MS || "2000") || 2_000);
  const deadline = Date.now() + maxWaitMs;

  const openClaimSelectors = [
    'button:has-text("OPEN CLAIM TRANSACTION")',
    'text=OPEN CLAIM TRANSACTION',
    'button:has-text("Open claim transaction")',
    'text=Open claim transaction'
  ];

  while (Date.now() < deadline) {
    try {
      // If the user opened extra tabs, pick the swap tab by URL match.
      const pages = context.pages();
      const swapPage =
        pages.find((p) => p.url().includes(`/swap/${swapId}`)) ??
        pages.find((p) => p.url().includes("/swap/")) ??
        pages[0];
      if (!swapPage) {
        await delay(pollMs);
        continue;
      }

      for (const sel of openClaimSelectors) {
        const loc = swapPage.locator(sel).first();
        const visible = await loc.isVisible().catch(() => false);
        if (visible) {
          logFn('Found "OPEN CLAIM TRANSACTION" — clicking…');
          await loc.click({ timeout: 5000 });
          await delay(1500);
          const url = swapPage.url();
          log.info("boltz", "auto-claim click done", { swapId, url });
          return;
        }
      }
    } catch (e) {
      log.warn("boltz", "auto-claim watcher error (retrying)", { swapId, error: e instanceof Error ? e.message : String(e) });
    }
    await delay(pollMs);
  }

  log.info("boltz", "auto-claim watcher timed out (no OPEN CLAIM TRANSACTION found)", { swapId, maxWaitMs });
}

/** Same shape as your reference `BoltzSwapResult`. */
export interface BoltzSwapResult {
  swapId: string;
  bolt11: string;
  satsAmount: string;
  usdtAmount: string;
}

async function delay(ms: number): Promise<void> {
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

/**
 * Automate Boltz UI: Lightning → USDT on Arbitrum One (USDT0). Base is not available in the UI; funds go to Arbitrum.
 * Then copy the LN invoice from clipboard (same pattern as Polygon reference, different network button).
 */
export async function createBoltzSwapOnPage(
  context: BrowserContext,
  recipientAddress: string,
  satsToSend: number,
  logFn: LogFn
): Promise<BoltzSwapResult> {
  const page = await context.newPage();
  try {
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BOLTZ_ORIGIN });
    } catch {
      log.warn("boltz", "clipboard permission grant failed (may still work)");
    }

    logFn("Opening Boltz Exchange...");
    await page.goto(BOLTZ_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await delay(4000);

    logFn("Selecting USDT on Arbitrum One...");

    const currentNetwork = await page
      .locator('input[placeholder*="address to receive"]')
      .getAttribute("placeholder")
      .catch(() => "");
    logFn(`  Current receive config: ${currentNetwork}`);

    await page.locator("button").nth(2).click({ timeout: 5000 });
    await delay(2000);
    await page.screenshot({ path: "boltz-debug-dropdown.png", fullPage: true }).catch(() => {});

    const usdtNetworkBtn = page.locator(
      'button:has-text("USDT Select network"), button:has-text("Select network")'
    );
    try {
      await usdtNetworkBtn.first().waitFor({ state: "visible", timeout: 5000 });
      await usdtNetworkBtn.first().click();
      await delay(1500);
    } catch {
      logFn("  'USDT Select network' not found — trying direct network list...");
    }

    await page.screenshot({ path: "boltz-debug-networks.png", fullPage: true }).catch(() => {});

    const arbitrumBtn = page.locator(
      'button:has-text("Arbitrum One"), button:has-text("Arbitrum")'
    );
    try {
      await arbitrumBtn.first().waitFor({ state: "visible", timeout: 5000 });
    } catch {
      logFn("  Arbitrum not visible, scrolling dropdown...");
      await page.evaluate(() => {
        const scrollable = document.querySelector(
          '[class*="dropdown"], [class*="scroll"], [class*="list"], [role="listbox"]'
        );
        if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
      });
      await delay(1000);
    }
    await arbitrumBtn.first().click({ timeout: 8000 });
    await delay(2000);
    logFn("  Selected Arbitrum One network");

    const newPlaceholder = await page
      .locator('input[placeholder*="address to receive"]')
      .getAttribute("placeholder")
      .catch(() => "");
    logFn(`  Address field: ${newPlaceholder}`);

    logFn(`Setting send amount: ${satsToSend} sats...`);
    const sendInput = page.locator('input[placeholder="0"]').first();
    await sendInput.click();
    await sendInput.fill(String(satsToSend));
    await delay(2000);

    const receiveInput = page.locator('input[placeholder="0"]').nth(1);
    const usdtAmount = await receiveInput.inputValue();
    logFn(`  Will receive ~${usdtAmount} USDT`);

    logFn(`Pasting recipient address: ${recipientAddress}...`);
    const addressInput = page.locator('input[placeholder*="address to receive funds"]');
    await addressInput.fill(recipientAddress);
    await delay(2000);

    logFn('Clicking "Create Atomic Swap"...');
    const swapBtn = page.locator('button:has-text("Create Atomic Swap")');
    await swapBtn.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const buttons = document.querySelectorAll("button");
        for (const b of buttons) {
          if (b.textContent?.includes("Create Atomic Swap")) {
            return !b.disabled;
          }
        }
        return false;
      },
      { timeout: 10_000 }
    );
    await swapBtn.click();
    logFn("  Swap creation in progress...");

    await page.waitForURL(/beta\.boltz\.exchange\/swap\//, { timeout: 20_000 });
    const swapUrl = page.url();
    const swapId = swapUrl.split("/swap/")[1]?.split("?")[0] || "unknown";
    logFn(`  Swap created: ${swapId}`);
    logFn(`  URL: ${swapUrl}`);

    await delay(4000);

    let finalSats = String(satsToSend);
    try {
      const payText = await page.locator("text=Pay this invoice about").textContent({ timeout: 5000 });
      if (payText) {
        const satsMatch = payText.match(/([\d\s]+)\s*sats/);
        if (satsMatch) finalSats = satsMatch[1].replace(/\s/g, "");
      }
    } catch {
      // keep input amount
    }
    logFn(`  Invoice amount: ~${finalSats} sats`);

    logFn('Clicking "LIGHTNING INVOICE" to copy invoice...');
    await page.evaluate(() => window.scrollBy(0, 600));
    await delay(1500);

    await clickByText(
      page,
      [
        "text=LIGHTNING INVOICE",
        'button:has-text("LIGHTNING INVOICE")',
        "[class*='invoice'] >> text=LIGHTNING",
        "text=Lightning Invoice"
      ],
      "LIGHTNING INVOICE button",
      10_000
    );
    await delay(2000);

    let bolt11 = await page.evaluate(() => navigator.clipboard.readText());

    if (!bolt11 || !bolt11.startsWith("lnbc")) {
      logFn(`  Clipboard returned: "${(bolt11 || "").slice(0, 60)}..."`);
      logFn("  Trying DOM fallback...");
      const pageText = await page.evaluate(() => document.body?.innerText || "");
      const lnMatch = pageText.match(/(lnbc[a-z0-9]+)/i);
      if (lnMatch) {
        logFn("  Found invoice in page text (may be truncated)");
        return { swapId, bolt11: lnMatch[1], satsAmount: finalSats, usdtAmount };
      }
      throw new Error("Could not extract Lightning invoice from clipboard or page");
    }

    logFn(`  Invoice copied successfully (${bolt11.length} chars)`);
    return { swapId, bolt11, satsAmount: finalSats, usdtAmount };
  } finally {
    // Intentionally do not close the tab/context here.
    // The caller may keep the browser context open briefly after invoice copy so Boltz can continue routing liquidity.
  }
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
  log.info("boltz", "createBoltzSwap start (UI automation)", {
    satAmount: input.satAmount,
    receiveAddressPrefix: `${input.receiveAddress.slice(0, 10)}…${input.receiveAddress.slice(-6)}`
  });
  const headless = process.env.BOLTZ_HEADLESS !== "0";
  const keepOpenMs = Math.max(0, Number(process.env.BOLTZ_KEEP_OPEN_MS || "120000") || 120_000);
  let lastError: Error | undefined;
  let attempts = 0;

  while (attempts < 3) {
    attempts += 1;
    const context = await chromium.launchPersistentContext(PROFILE_PATH, {
      headless,
      args: ["--disable-dev-shm-usage", "--no-sandbox"]
    });
    try {
      const result = await createBoltzSwapOnPage(context, input.receiveAddress, input.satAmount, logFn);
      log.info("boltz", "createBoltzSwap success", {
        swapId: result.swapId,
        satsAmount: result.satsAmount,
        usdtAmount: result.usdtAmount,
        boltzInvoicePrefix: result.bolt11.slice(0, 28) + (result.bolt11.length > 28 ? "…" : ""),
        boltzInvoiceLen: result.bolt11.length
      });
      if (keepOpenMs > 0) {
        logFn(`Keeping Boltz browser open for ~${Math.ceil(keepOpenMs / 1000)}s for routing...`);
        keptBoltzContexts.push(context);
        // While we keep it open, also try to click "OPEN CLAIM TRANSACTION" when it appears.
        // This usually shows up after the LN invoice is paid and the swap is ready to be claimed.
        bestEffortAutoClaim(context, result.swapId, logFn).catch(() => {});
        setTimeout(() => {
          const idx = keptBoltzContexts.indexOf(context);
          if (idx >= 0) keptBoltzContexts.splice(idx, 1);
          context
            .close()
            .then(() => log.info("boltz", "kept Boltz context closed after keep-open delay"))
            .catch(() => {});
        }, keepOpenMs);
        (context as any).__paysats_keepOpen = true;
      }
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
        const p = context.pages()[0];
        if (p) await p.screenshot({ path: "boltz-debug-attempt.png", fullPage: true });
      } catch {
        /* ignore */
      }
      if (attempts === 3) {
        throw new Error(`Boltz automation failed after 3 attempts: ${lastError.message}`);
      }
      await delay(10_000);
    } finally {
      // Only close immediately if we are not intentionally keeping it open.
      if (!(context as any).__paysats_keepOpen) {
        await context.close();
      }
    }
  }
  throw new Error("Unable to create Boltz swap.");
}

/** Placeholder until UI status polling is implemented — not the Boltz API. */
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
