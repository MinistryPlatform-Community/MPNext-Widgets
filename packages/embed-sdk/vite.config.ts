import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";

// Root of the monorepo where .env.local lives
const monorepoRoot = resolve(__dirname, "../..");

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
      entry: resolve(__dirname, "src/index.ts"),
      name: "MPNextEmbed",
      formats: ["es", "umd"],
      fileName: (format) => `next-embed.${format}.js`,
    },
    target: "es2019",
    sourcemap: true,
    minify: "esbuild",
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: "next-embed.[hash][extname]",
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
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
