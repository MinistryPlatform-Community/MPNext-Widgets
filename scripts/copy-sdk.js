/**
 * Copies built SDK bundles from packages/embed-sdk/dist/ to public/embed-sdk/
 * Run after `hash-sdk.js` to stage artifacts for Next.js static serving.
 *
 * Cleanup is driven by the build manifest, not by a hand-written list of
 * filenames: `vite build` empties `dist/` (`emptyOutDir`, pinned explicitly in
 * `packages/embed-sdk/vite.config.ts`) and `hash-sdk.js` then writes only the
 * current build's artifacts into it, so `dist/` *is* the set of files that
 * belong in `dest`. Anything else the build owns there is stale by definition —
 * including outputs of naming schemes this repo no longer uses
 * (`next-embed.es.js`, `next-embed.umd.js`), which a filename-pattern list
 * could never keep up with.
 *
 * `dest` doubles as a source directory, so the one input that lives there is
 * exempt — see KEEP.
 */
const { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } = require("fs");
const { resolve } = require("path");

const root = resolve(__dirname, "..");
const src = resolve(root, "packages/embed-sdk/dist");
const dest = resolve(root, "public/embed-sdk");

/**
 * Files in `dest` that the build owns. Deliberately the same predicate the copy
 * step uses below, so the cleanup domain and the publish domain cannot drift.
 */
function isBuildOwned(name) {
  return name.startsWith("next-embed") || name.startsWith("mp-widget-overrides");
}

/**
 * Build *inputs* that live in `dest` and must survive cleanup.
 *
 * `mp-widget-overrides.css` is the tracked source CSS that `hash-sdk.js` reads
 * (the only file in `public/embed-sdk/` in git — see `.gitignore`), and it is
 * also a public URL churches point MP's `customcss` attribute at. Deleting it
 * does not break this build; it breaks the *next* one.
 */
const KEEP = new Set(["mp-widget-overrides.css"]);

if (!existsSync(src)) {
  console.error(`SDK dist not found: ${src}`);
  console.error("Run 'pnpm build:sdk' first.");
  process.exit(1);
}

if (!existsSync(dest)) {
  mkdirSync(dest, { recursive: true });
}

// ---------------------------------------------------------------------------
// 1. Clean every build-owned file in dest that this build did not just emit
// ---------------------------------------------------------------------------

const distFiles = readdirSync(src).filter(isBuildOwned);
const current = new Set(distFiles);

let cleaned = 0;
for (const file of readdirSync(dest)) {
  if (!isBuildOwned(file) || KEEP.has(file) || current.has(file)) continue;
  unlinkSync(resolve(dest, file));
  console.log(`  Removed stale: ${file}`);
  cleaned++;
}
if (cleaned) console.log(`  Cleaned ${cleaned} stale file(s) from public/embed-sdk/`);

// ---------------------------------------------------------------------------
// 2. Copy new files from dist/
// ---------------------------------------------------------------------------

let copied = 0;
for (const file of distFiles) {
  copyFileSync(resolve(src, file), resolve(dest, file));
  copied++;
  console.log(`  ${file}`);
}

console.log(`Copied ${copied} SDK file(s) to public/embed-sdk/`);
