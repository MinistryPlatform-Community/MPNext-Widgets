/**
 * Copies built SDK bundles from packages/embed-sdk/dist/ to public/embed-sdk/
 * Run after `hash-sdk.js` to stage artifacts for Next.js static serving.
 *
 * Handles dynamic content-hashed filenames and cleans stale hashed files.
 */
const { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } = require("fs");
const { resolve } = require("path");

const root = resolve(__dirname, "..");
const src = resolve(root, "packages/embed-sdk/dist");
const dest = resolve(root, "public/embed-sdk");

if (!existsSync(src)) {
  console.error(`SDK dist not found: ${src}`);
  console.error("Run 'pnpm build:sdk' first.");
  process.exit(1);
}

if (!existsSync(dest)) {
  mkdirSync(dest, { recursive: true });
}

// ---------------------------------------------------------------------------
// 1. Clean old hashed files from public/embed-sdk/
// ---------------------------------------------------------------------------

const stalePatterns = [
  /^next-embed\.[a-f0-9]+\.es\.js(\.map)?$/,  // hashed bundles + maps
  /^next-embed\.js$/,                           // loader
  /^mp-widget-overrides\.[a-f0-9]+\.css$/,      // hashed CSS
];

const existing = readdirSync(dest);
let cleaned = 0;
for (const file of existing) {
  if (stalePatterns.some((p) => p.test(file))) {
    unlinkSync(resolve(dest, file));
    cleaned++;
  }
}
if (cleaned) console.log(`  Cleaned ${cleaned} stale file(s) from public/embed-sdk/`);

// ---------------------------------------------------------------------------
// 2. Copy new files from dist/
// ---------------------------------------------------------------------------

const distFiles = readdirSync(src).filter((f) =>
  f.startsWith("next-embed") || f.startsWith("mp-widget-overrides"),
);

let copied = 0;
for (const file of distFiles) {
  copyFileSync(resolve(src, file), resolve(dest, file));
  copied++;
  console.log(`  ${file}`);
}

console.log(`Copied ${copied} SDK file(s) to public/embed-sdk/`);
