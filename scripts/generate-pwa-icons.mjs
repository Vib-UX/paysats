/**
 * Generates PWA / home-screen PNGs from app/icon.svg (run after editing the SVG).
 * Usage: node scripts/generate-pwa-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "app", "icon.svg");
const publicDir = path.join(root, "public");

const svg = fs.readFileSync(svgPath);

async function main() {
  await sharp(svg).resize(192, 192).png().toFile(path.join(publicDir, "icon-192.png"));
  await sharp(svg).resize(512, 512).png().toFile(path.join(publicDir, "icon-512.png"));
  await sharp(svg).resize(180, 180).png().toFile(path.join(publicDir, "apple-touch-icon.png"));
  console.log("Wrote public/icon-192.png, icon-512.png, apple-touch-icon.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
