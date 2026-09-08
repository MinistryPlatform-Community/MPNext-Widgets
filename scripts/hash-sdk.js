/**
 * Post-build script: content-hash the SDK bundle + CSS, generate a tiny loader.
 *
 * Run after `vite build` and before `copy-sdk.js`.
 *
 * Input:  packages/embed-sdk/dist/next-embed.es.js  (unhashed Vite output)
 *         public/embed-sdk/mp-widget-overrides.css   (source CSS, tracked in git)
 *
 * Both inputs are required; a missing one exits non-zero rather than emitting a
 * partial build.
 * Output: packages/embed-sdk/dist/next-embed.{hash}.es.js
 *         packages/embed-sdk/dist/next-embed.{hash}.es.js.map
 *         packages/embed-sdk/dist/mp-widget-overrides.{hash}.css
 *         packages/embed-sdk/dist/next-embed.js       (loader)
 */
const { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync } = require("fs");
const { resolve } = require("path");
const { createHash } = require("crypto");

const root = resolve(__dirname, "..");
const dist = resolve(root, "packages/embed-sdk/dist");
const publicDir = resolve(root, "public/embed-sdk");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortHash(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

// ---------------------------------------------------------------------------
// 1. Hash the ES bundle
// ---------------------------------------------------------------------------

const esSrc = resolve(dist, "next-embed.es.js");
const esMapSrc = resolve(dist, "next-embed.es.js.map");
const cssSrc = resolve(publicDir, "mp-widget-overrides.css");

if (!existsSync(esSrc)) {
  console.error(`SDK bundle not found: ${esSrc}`);
  console.error("Run 'vite build' first.");
  process.exit(1);
}

// Checked up front, before anything below mutates dist/: a missing source CSS
// used to only warn, and the loader was then generated with no
// `__nextEmbedCSSUrl` — a silently CSS-less SDK that looks like a clean build.
// It is tracked in git (`.gitignore` negates it), so it going missing means
// something deleted it, not that the build is legitimately CSS-free.
if (!existsSync(cssSrc)) {
  console.error(`Source CSS not found: ${cssSrc}`);
  console.error("It is tracked in git — restore it with 'git checkout -- public/embed-sdk/mp-widget-overrides.css'.");
  process.exit(1);
}

const bundleHash = shortHash(esSrc);
const hashedBundleName = `next-embed.${bundleHash}.es.js`;
const hashedBundlePath = resolve(dist, hashedBundleName);

renameSync(esSrc, hashedBundlePath);
console.log(`  Hashed bundle: ${hashedBundleName}`);

// Rename sourcemap too (and update the sourceMappingURL inside the bundle)
if (existsSync(esMapSrc)) {
  const hashedMapName = `${hashedBundleName}.map`;
  renameSync(esMapSrc, resolve(dist, hashedMapName));

  // Update sourceMappingURL in the hashed bundle
  let bundleContent = readFileSync(hashedBundlePath, "utf-8");
  bundleContent = bundleContent.replace(
    /\/\/# sourceMappingURL=next-embed\.es\.js\.map/,
    `//# sourceMappingURL=${hashedMapName}`,
  );
  writeFileSync(hashedBundlePath, bundleContent);
  console.log(`  Hashed sourcemap: ${hashedMapName}`);
}

// ---------------------------------------------------------------------------
// 2. Hash the CSS override file
// ---------------------------------------------------------------------------

const cssHash = shortHash(cssSrc);
const hashedCssName = `mp-widget-overrides.${cssHash}.css`;
copyFileSync(cssSrc, resolve(dist, hashedCssName));
console.log(`  Hashed CSS: ${hashedCssName}`);

// ---------------------------------------------------------------------------
// 3. Generate the loader (next-embed.js)
// ---------------------------------------------------------------------------

const loaderCode = `// MPNext Embed SDK Loader — auto-generated, do not edit
// Captures the host URL then dynamically imports the content-hashed bundle.
const _base = import.meta.url.replace(/\\/[^/]*$/, '');
window.__nextEmbedApiHost = new URL(_base + '/').origin;
window.__nextEmbedBaseUrl = _base;
window.__nextEmbedCSSUrl = _base + '/${hashedCssName}';
await import(_base + '/${hashedBundleName}');
`;

writeFileSync(resolve(dist, "next-embed.js"), loaderCode);
console.log(`  Generated loader: next-embed.js → ${hashedBundleName}`);

console.log("SDK hashing complete.");
