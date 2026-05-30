import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readVersion(): string {
  try {
    return readFileSync(join(process.cwd(), "VERSION"), "utf8").trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: readVersion(),
  },
};

export default nextConfig;
