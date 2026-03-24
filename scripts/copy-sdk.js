/**
 * Copies built SDK bundles from packages/embed-sdk/dist/ to public/embed-sdk/
 * Run after `pnpm build:sdk` to stage artifacts for Next.js static serving.
 */
const { copyFileSync, existsSync, mkdirSync } = require("fs");
const { resolve } = require("path");

const root = resolve(__dirname, "..");
const src = resolve(root, "packages/embed-sdk/dist");
const dest = resolve(root, "public/embed-sdk");

const files = [
  "next-embed.es.js",
  "next-embed.es.js.map",
  "next-embed.umd.js",
  "next-embed.umd.js.map",
];

if (!existsSync(src)) {
  console.error(`SDK dist not found: ${src}`);
  console.error("Run 'pnpm build:sdk' first.");
  process.exit(1);
}

if (!existsSync(dest)) {
  mkdirSync(dest, { recursive: true });
}

let copied = 0;
for (const file of files) {
  const from = resolve(src, file);
  const to = resolve(dest, file);
  if (existsSync(from)) {
    copyFileSync(from, to);
    copied++;
    console.log(`  ${file}`);
  } else {
    console.warn(`  SKIP ${file} (not found)`);
  }
}

console.log(`Copied ${copied}/${files.length} SDK files to public/embed-sdk/`);
