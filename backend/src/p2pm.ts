/**
 * P2P.me automation — real Firefox profile only.
 * .env: P2P_FIREFOX_PROFILE_DIR, P2P_HEADLESS=1 (optional)
 *
 * Debug: `backend/p2pm-debug/run-*` (+ `P2P_DEBUG_DIR`).
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { firefox } from "patchright";
import type { BrowserContext, Page } from "patchright";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);
const APP_URL = process.env.P2P_APP_URL?.trim() || "https://app.p2p.me";

type LogFn = (msg: string) => void;

export interface P2pmSellInput {
  usdcAmount: number;
  payoutMethod: "gopay" | "bank_transfer";
  recipientDetails: string;
}

export interface P2pmSellResult {
  orderId: string;
  status: "placed" | "failed";
  detail?: string;
}

export type P2pmWalletSnapshot = {
  debugDir: string;
  finalUrl: string;
  loggedInHeuristic: boolean;
  balanceHints: string[];
  evmAddresses: string[];
  screenshotPaths: string[];
  extractedJsonPath: string;
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function p2pmDebugBaseDir(): string {
  const override = process.env.P2P_DEBUG_DIR?.trim();
  if (override) return path.resolve(override);
  const cwd = process.cwd();
  for (const [base, pkgPath] of [
    [cwd, path.join(cwd, "package.json")],
    [path.join(cwd, "backend"), path.join(cwd, "backend", "package.json")],
  ] as [string, string][]) {
    if (fs.existsSync(pkgPath)) {
      try {
        const j = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          name?: string;
        };
        if (j.name === "paysats-backend") return path.join(base, "p2pm-debug");
      } catch {
        /* ignore */
      }
    }
  }
  return path.join(cwd, "p2pm-debug");
}

function getFirefoxProfileDir(): string {
  const d = process.env.P2P_FIREFOX_PROFILE_DIR?.trim();
  if (!d)
    throw new Error(
      "P2P_FIREFOX_PROFILE_DIR is required (about:profiles → Root Directory)",
    );
  return path.resolve(d);
}

function makeDebugDir(): string {
  const dir = path.join(p2pmDebugBaseDir(), `run-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "run-meta.json"),
    JSON.stringify(
      {
        cwd: process.cwd(),
        p2pmDebugBase: p2pmDebugBaseDir(),
        mode: "firefox-real-profile",
        startedAt: new Date().toISOString(),
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  log.info("p2pm", "debug run folder", { dir });
  return dir;
}

function writeDebugTextFile(
  debugDir: string,
  name: string,
  body: string,
): void {
  try {
    fs.writeFileSync(path.join(debugDir, name), body, "utf8");
  } catch {
    /* ignore */
  }
}

async function shot(page: Page, dir: string, name: string): Promise<void> {
  if (process.env.P2P_SKIP_SCREENSHOTS === "1") return;
  if (page.url().startsWith("about:")) return;
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  try {
    await page.screenshot({
      path: path.join(dir, `${safe}.png`),
      fullPage: false,
      timeout: 20_000,
    });
  } catch (e) {
    log.warn("p2pm", "screenshot failed", {
      name: safe,
      err: e instanceof Error ? e.message : e,
    });
  }
}

// ── Firefox BiDi guard ────────────────────────────────────────────────────────

function isBenignBidiRejection(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const r = reason as { method?: string; message?: string };
  if (r.method === "browsingContext.locateNodes") return true;
  const msg = r.message ?? (reason instanceof Error ? reason.message : "");
  return (
    typeof msg === "string" &&
    msg.includes("no such frame") &&
    msg.includes("Browsing Context")
  );
}

let bidiGuardRefs = 0;
let bidiGuardHandler: ((r: unknown) => void) | undefined;

function pushBidiGuard(): void {
  if (process.env.P2P_FIREFOX_BIDI_GUARD === "0") return;
  bidiGuardRefs++;
  if (bidiGuardHandler) return;
  bidiGuardHandler = (reason: unknown) => {
    if (bidiGuardRefs <= 0) return;
    if (isBenignBidiRejection(reason)) return;
    log.error("p2pm", "unhandledRejection during Firefox automation", reason);
    process.exit(1);
  };
  process.on("unhandledRejection", bidiGuardHandler);
}

function popBidiGuard(): void {
  if (process.env.P2P_FIREFOX_BIDI_GUARD === "0") return;
  bidiGuardRefs = Math.max(0, bidiGuardRefs - 1);
  if (bidiGuardRefs === 0 && bidiGuardHandler) {
    process.removeListener("unhandledRejection", bidiGuardHandler);
    bidiGuardHandler = undefined;
  }
}

// ── Browser lifecycle ─────────────────────────────────────────────────────────

async function quitFirefox(): Promise<void> {
  if (process.env.P2P_DONT_QUIT_FIREFOX === "1" || process.platform !== "darwin")
    return;
  log.info("p2pm", "quitting Firefox to release profile lock…");
  try {
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      'tell application "Firefox" to quit',
    ]);
  } catch {
    /* not running */
  }
  await delay(2500);
}

async function launchProfileContext(): Promise<{
  context: BrowserContext;
  dispose: () => Promise<void>;
}> {
  const userDataDir = getFirefoxProfileDir();
  await quitFirefox();
  await delay(1500);

  log.info("p2pm", "launching Firefox", { userDataDir });
  pushBidiGuard();

  let context: BrowserContext;
  try {
    context = await firefox.launchPersistentContext(userDataDir, {
      channel: "moz-firefox",
      headless: process.env.P2P_HEADLESS === "1",
      viewport: null,
      firefoxUserPrefs: { "fission.autostart": false },
    });
  } catch (e) {
    popBidiGuard();
    throw e;
  }

  await delay(1500);
  return {
    context,
    dispose: async () => {
      try {
        await context.close();
      } catch {
        /* ignore */
      } finally {
        popBidiGuard();
      }
    },
  };
}

async function getWorkPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.bringToFront();
  return page;
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function navigateTo(page: Page, url: string, logFn: LogFn): Promise<void> {
  logFn(`[nav] → ${url}`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  } catch (e) {
    logFn(
      `[nav] goto threw (checking url): ${e instanceof Error ? e.message : e}`,
    );
  }
  logFn(`[nav] landed: ${page.url()}`);

  if (page.url().startsWith("about:")) {
    logFn("[nav] still about:* — force via location.href");
    await page.evaluate((u: string) => {
      window.location.href = u;
    }, url);
    await page.waitForURL((u) => !u.href.startsWith("about:"), {
      timeout: 30_000,
    });
    logFn(`[nav] after force: ${page.url()}`);
  }
}

// ── Keypad ────────────────────────────────────────────────────────────────────

/** Wait until the sell amount keypad is mounted (navigation can finish first). */
async function waitForKeypad(page: Page, logFn: LogFn): Promise<void> {
  logFn("[keypad] waiting for keypad…");
  const main = page.locator("main");
  const ready = main
    .getByRole("button", { name: "Clear", exact: true })
    .or(main.getByRole("button", { name: "1", exact: true }));
  await ready.first().waitFor({ state: "visible", timeout: 60_000 });
  logFn("[keypad] visible");
}

async function tapKey(page: Page, ch: string, _logFn: LogFn): Promise<void> {
  const inMain = page
    .locator("main")
    .getByRole("button", { name: ch, exact: true });
  const count = await inMain.count().catch(() => 0);
  if (count > 0) {
    await inMain.last().click({ timeout: 5000 });
    return;
  }

  const anywhere = page.getByRole("button", { name: ch, exact: true });
  const n = await anywhere.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) {
    const el = anywhere.nth(i);
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      await el.click({ timeout: 5000 });
      return;
    }
  }

  const byText = page.locator("main").getByText(ch, { exact: true });
  const tn = await byText.count().catch(() => 0);
  for (let i = tn - 1; i >= 0; i--) {
    const el = byText.nth(i);
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      await el.click({ timeout: 5000 });
      return;
    }
  }

  throw new Error(`tapKey: could not click "${ch}"`);
}

async function enterAmount(
  page: Page,
  amount: number,
  logFn: LogFn,
): Promise<void> {
  try {
    const clear = page
      .locator("main")
      .getByRole("button", { name: "Clear", exact: true });
    if (await clear.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clear.click({ timeout: 4000 });
      logFn("[keypad] cleared");
      await delay(200);
    }
  } catch {
    /* no clear button yet */
  }

  const digits = String(amount);
  logFn(`[keypad] entering: ${digits}`);
  for (const ch of digits) {
    await tapKey(page, ch, logFn);
    await delay(100);
  }
  logFn("[keypad] done");
}

async function waitForContinue(page: Page, logFn: LogFn): Promise<void> {
  const btn = page
    .locator("main")
    .getByRole("button", { name: "Continue", exact: true });
  logFn("[continue] waiting for enabled…");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await btn.isEnabled().catch(() => false)) break;
    await delay(150);
  }
  if (!(await btn.isEnabled().catch(() => false))) {
    throw new Error(
      "Continue never enabled — amount may be 0 or exceeds available balance",
    );
  }
  logFn("[continue] clicking");
  await btn.click({ timeout: 10_000 });
}

// ── Sell flow ─────────────────────────────────────────────────────────────────

export type P2pmFlowOptions = { log: LogFn; debugDir: string };

function extractOrderRef(page: Page): string | null {
  const url = page.url();
  for (const re of [
    /\/(?:orders?|sell|transaction)\/([a-zA-Z0-9_-]+)/i,
    /[?&](?:orderId|id)=([a-zA-Z0-9_-]+)/i,
  ]) {
    const m = url.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function runP2pmSellFlowOnPage(
  page: Page,
  input: P2pmSellInput,
  opts: P2pmFlowOptions,
): Promise<P2pmSellResult> {
  const { log: logFn, debugDir } = opts;
  const snap = (n: string) => shot(page, debugDir, n);

  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) logFn(`[nav] ${f.url()}`);
  });
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(60_000);

  await navigateTo(page, `${APP_URL.replace(/\/$/, "")}/sell`, logFn);
  await waitForKeypad(page, logFn);
  await delay(3000);
  await snap("flow-01-sell-landed");

  logFn(`[sell] entering ${input.usdcAmount} USDC`);
  await enterAmount(page, input.usdcAmount, logFn);
  await delay(500);
  await snap("flow-02-amount-entered");

  await waitForContinue(page, logFn);
  await delay(2000);
  await snap("flow-03-after-continue");

  logFn(`[sell] selecting payout method: ${input.payoutMethod}`);
  if (input.payoutMethod === "gopay") {
    for (const loc of [
      () => page.getByRole("radio", { name: /gopay/i }),
      () => page.getByRole("tab", { name: /gopay/i }),
      () => page.getByText(/^gopay$/i),
      () => page.getByText(/gopay/i).first(),
    ]) {
      try {
        const el = loc();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          await el.click({ timeout: 5000 });
          logFn("[sell] gopay selected");
          break;
        }
      } catch {
        /* try next */
      }
    }
  } else {
    for (const loc of [
      () => page.getByRole("radio", { name: /bank/i }),
      () => page.getByText(/bank transfer/i).first(),
    ]) {
      try {
        const el = loc();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          await el.click({ timeout: 5000 });
          break;
        }
      } catch {
        /* try next */
      }
    }
  }
  await delay(800);
  await snap("flow-04-payout-method");

  if (input.recipientDetails.trim()) {
    logFn(`[sell] filling recipient: ${input.recipientDetails}`);
    const phone = input.recipientDetails.trim();
    let filled = false;
    for (const loc of [
      () => page.getByPlaceholder(/phone|mobile|number|gopay|e-?wallet/i),
      () =>
        page.getByRole("textbox", { name: /phone|mobile|gopay|number/i }),
      () => page.getByLabel(/phone|mobile|gopay|number/i),
      () => page.locator('input[type="tel"]'),
      () => page.locator('input[inputmode="tel"]'),
      () => page.locator('input[inputmode="numeric"]'),
    ]) {
      try {
        const el = loc().first();
        if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
          await el.click({ timeout: 3000 });
          await el.fill(phone, { timeout: 5000 });
          logFn("[sell] recipient filled");
          filled = true;
          break;
        }
      } catch {
        /* try next */
      }
    }
    if (!filled) throw new Error("Could not find recipient input field");
    await snap("flow-05-recipient");
  }

  logFn("[sell] submitting…");
  for (const loc of [
    () =>
      page.getByRole("button", {
        name: /confirm|place order|sell now|submit|next/i,
      }),
    () => page.getByRole("button", { name: /continue/i }),
    () => page.getByRole("button", { name: /sell/i }),
  ]) {
    try {
      const el = loc().first();
      if (await el.isEnabled({ timeout: 2000 }).catch(() => false)) {
        await el.click({ timeout: 10_000 });
        logFn("[sell] submit clicked");
        break;
      }
    } catch {
      /* try next */
    }
  }
  await delay(4000);
  await snap("flow-06-submitted");

  const ref = extractOrderRef(page);
  const orderId = ref ?? `p2pm_${Date.now()}`;
  if (!ref)
    log.warn("p2pm", "synthetic order id", { orderId, url: page.url() });

  return { orderId, status: "placed", detail: page.url() };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createP2pmSellOrder(
  input: P2pmSellInput,
  options?: { log?: LogFn },
): Promise<P2pmSellResult> {
  if (input.usdcAmount <= 0) throw new Error("usdcAmount must be > 0");

  const debugDir = makeDebugDir();
  const logFn = options?.log ?? (() => {});
  const maxAttempts = Math.max(
    1,
    Math.min(
      5,
      Number(process.env.P2P_FLOW_MAX_ATTEMPTS || "3") || 3,
    ),
  );

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let context: BrowserContext;
    let dispose: () => Promise<void>;
    try {
      const acquired = await launchProfileContext();
      context = acquired.context;
      dispose = acquired.dispose;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeDebugTextFile(debugDir, `acquire-${attempt}.txt`, msg);
      if (attempt === maxAttempts) {
        throw new Error(
          `Firefox launch failed after ${maxAttempts} attempts: ${msg}`,
        );
      }
      await delay(8000);
      continue;
    }

    try {
      const page = await getWorkPage(context);
      const result = await runP2pmSellFlowOnPage(page, input, {
        log: logFn,
        debugDir,
      });
      log.info("p2pm", "sell done", { orderId: result.orderId, debugDir });
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log.error("p2pm", `attempt ${attempt}/${maxAttempts} failed`, lastError);
      writeDebugTextFile(
        debugDir,
        `error-${attempt}.txt`,
        `${lastError.message}\n${lastError.stack ?? ""}`,
      );
      if (attempt === maxAttempts) {
        throw new Error(
          `P2P.me failed after ${maxAttempts} attempts: ${lastError.message}\nSee: ${debugDir}`,
        );
      }
      await delay(8000);
    } finally {
      await dispose().catch(() => {});
    }
  }
  throw lastError ?? new Error("unreachable");
}

export async function getP2pmOrderStatus(orderId: string): Promise<{
  status: "pending" | "confirmed" | "settled" | "failed";
  idrAmount?: number;
  settledAt?: string;
}> {
  if (!orderId) throw new Error("Missing orderId");
  return { status: "pending" };
}

export async function p2pmNavTest(options?: {
  log?: LogFn;
}): Promise<{ debugDir: string; finalUrl: string }> {
  const debugDir = makeDebugDir();
  const logFn = options?.log ?? ((m: string) => log.info("p2pm-nav", m));
  const { context, dispose } = await launchProfileContext();
  try {
    const page = await getWorkPage(context);
    await navigateTo(page, APP_URL, logFn);
    return { debugDir, finalUrl: page.url() };
  } finally {
    await dispose();
  }
}

export async function p2pmWalletSnapshot(options?: {
  log?: LogFn;
}): Promise<P2pmWalletSnapshot> {
  const debugDir = makeDebugDir();
  const logFn = options?.log ?? ((m: string) => log.info("p2pm-wallet", m));
  const { context, dispose } = await launchProfileContext();
  try {
    const page = await getWorkPage(context);
    await navigateTo(page, APP_URL, logFn);
    await delay(4000);
    await shot(page, debugDir, "verify-01-app");

    const { balanceHints, evmAddresses } = await page.evaluate(() => {
      const text = document.body?.innerText ?? "";
      const lines = text
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l.length < 220);
      return {
        balanceHints: lines
          .filter((l) =>
            /USDC|IDR|balance|available|wallet|deposit/i.test(l),
          )
          .slice(0, 48),
        evmAddresses: [...new Set(text.match(/0x[a-fA-F0-9]{40}/g) ?? [])],
      };
    });

    const loginVisible = await page
      .getByRole("button", { name: /^Login$/i })
      .isVisible()
      .catch(() => false);
    await shot(page, debugDir, "verify-02-final");
    const finalUrl = page.url();

    const extractedJsonPath = path.join(debugDir, "extracted.json");
    fs.writeFileSync(
      extractedJsonPath,
      JSON.stringify(
        {
          finalUrl,
          loggedInHeuristic: !loginVisible,
          balanceHints,
          evmAddresses,
        },
        null,
        2,
      ),
      "utf8",
    );

    const screenshotPaths = fs
      .readdirSync(debugDir)
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => path.join(debugDir, f));
    return {
      debugDir,
      finalUrl,
      loggedInHeuristic: !loginVisible,
      balanceHints,
      evmAddresses,
      screenshotPaths,
      extractedJsonPath,
    };
  } finally {
    await dispose().catch(() => {});
  }
}

export function logP2pVerifyReport(s: P2pmWalletSnapshot): void {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" P2P VERIFY");
  console.log("══════════════════════════════════════════════════════════");
  console.log(` Dir:  ${s.debugDir}`);
  console.log(` URL:  ${s.finalUrl}`);
  console.log(
    ` Auth: ${s.loggedInHeuristic ? "logged in ✓" : "NOT logged in ✗"}`,
  );
  console.log("\n Balances:");
  s.balanceHints.forEach((b) => console.log(`   ${b}`));
  console.log("\n EVM addresses:");
  s.evmAddresses.forEach((a) => console.log(`   ${a}`));
  console.log("\n Screenshots:");
  s.screenshotPaths.forEach((p) => console.log(`   • ${p}`));
  console.log("══════════════════════════════════════════════════════════\n");
}
