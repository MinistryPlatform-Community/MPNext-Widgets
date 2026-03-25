import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";

// Root of the monorepo where .env.local lives
const monorepoRoot = resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
  // Load env from monorepo root so demo pages can read MINISTRY_PLATFORM_BASE_URL etc.
  const env = loadEnv(mode, monorepoRoot, "");

  // Strip /ministryplatformapi suffix — widgets need the bare host
  const mpBaseUrl = (env.MINISTRY_PLATFORM_BASE_URL || "https://my.northwoods.church")
    .replace(/\/ministryplatformapi\/?$/, "");
  const apiHost = env.BETTER_AUTH_URL || env.NEXTAUTH_URL || "http://localhost:3000";

  return {
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
    target: "es2019",
    sourcemap: true,
    minify: true,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        assetFileNames: "next-embed.[hash][extname]",
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
          .replace(/__MP_BASE_URL__/g, mpBaseUrl)
          .replace(/__API_HOST__/g, apiHost);
      },
    },
  ],
  };
});
