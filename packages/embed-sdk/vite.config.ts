import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";

// Root of the monorepo where .env.local lives
const monorepoRoot = resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
  // Load env from monorepo root so demo pages can read MINISTRY_PLATFORM_BASE_URL etc.
  const env = loadEnv(mode, monorepoRoot, "");

  // Strip /ministryplatformapi suffix — widgets need the bare host.
  // No tenant-specific default: if unset, the placeholder resolves to "" and the
  // demo/widget surfaces a "not configured" state rather than a hardcoded host.
  const mpBaseUrl = (env.MINISTRY_PLATFORM_BASE_URL || "")
    .replace(/\/ministryplatformapi\/?$/, "");
  const apiHost = env.BETTER_AUTH_URL || "http://localhost:3000";

  // Organization display name baked into widgets (e.g. SMS opt-in consent text).
  // Tenant-configurable via VITE_ORG_NAME; empty falls back to a neutral phrase.
  const orgName = env.VITE_ORG_NAME || env.ORG_NAME || "";

  // ── Canonical "Universal Setup" snippet ────────────────────────────────────
  // Single source of truth for the setup card shown on every demo page. Each
  // demo page carries the literal `__UNIVERSAL_SETUP__` placeholder inside its
  // <pre><code id="setup-code"> block; transformIndexHtml swaps it in below.
  // Edit here to update every demo page at once (HTML-escaped for <pre>).
  const universalSetup =
    "&lt;!-- Load MPNext Embed SDK (auto-initializes) --&gt;\n" +
    '&lt;script type="module" src="https://your-host.com/embed-sdk/next-embed.js"&gt;&lt;/script&gt;';

  return {
  define: {
    __ORG_NAME__: JSON.stringify(orgName),
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      name: "MPNextEmbed",
      formats: ["es"],
      fileName: () => `next-embed.es.js`,
    },
    // Pinned, not inherited: `dist/` being emptied on every build is what makes
    // it an exact manifest of the current build, which `scripts/copy-sdk.js`
    // relies on to delete stale artifacts from `public/embed-sdk/` and
    // `src/package-manifest.test.ts` relies on when reasoning about `dist/`.
    emptyOutDir: true,
    target: "es2019",
    sourcemap: true,
    minify: true,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        assetFileNames: "next-embed.[hash][extname]",
        // Lazy locale catalogues (`src/i18n/registry.ts` reaches them through
        // `() => import("./locales/es")`) are emitted as separate chunks.
        //
        // The `next-embed` prefix is load-bearing, not cosmetic:
        // `scripts/copy-sdk.js` decides both what to publish into
        // `public/embed-sdk/` and what to prune from it with
        // `isBuildOwned(name)` → `name.startsWith("next-embed") || …`. Under
        // rolldown's default `chunkFileNames` a locale chunk would be built,
        // never published, and 404 at runtime on every customer site — a
        // failure that does not reproduce in `vite dev`, where the import is
        // served straight off the filesystem.
        //
        // `vercel.json` needs a matching `source` pattern for CORS; these
        // chunks are fetched cross-origin from church sites.
        chunkFileNames: "next-embed-locale-[name].[hash].js",
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [
    {
      name: "demo-env-replace",
      transformIndexHtml(html) {
        return html
          .replace(/__UNIVERSAL_SETUP__/g, universalSetup)
          .replace(/__MP_BASE_URL__/g, mpBaseUrl)
          .replace(/__API_HOST__/g, apiHost);
      },
    },
  ],
  };
});
