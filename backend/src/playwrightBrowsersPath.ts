/**
 * Must load before any `patchright` import. postinstall installs browsers under
 * node_modules when PLAYWRIGHT_BROWSERS_PATH=0; without this at runtime,
 * Patchright looks in ~/.cache (empty on Railway).
 */
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}
