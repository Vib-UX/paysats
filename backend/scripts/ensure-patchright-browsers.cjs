/**
 * Download Patchright/Playwright browser binaries during npm install (Linux on Railway, local dev).
 * Hermetic path keeps browsers under node_modules so they are included in the deploy artifact.
 */
const { execSync } = require("node:child_process");

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

execSync("npx patchright install chromium-headless-shell", {
  stdio: "inherit",
  env: process.env
});
