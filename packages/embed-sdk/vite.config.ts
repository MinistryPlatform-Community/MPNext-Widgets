import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
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
});
