/**
 * Embed widget configuration
 *
 * Allowed origins are loaded from:
 * 1. EMBED_ALLOWED_ORIGINS env var (comma-separated)
 * 2. Vercel auto-detected URLs (VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL)
 */

/**
 * Parsed allowed origins, computed once at module load time.
 */
function loadAllowedOrigins(): string[] {
  const origins: string[] = [];

  const envOrigins = process.env.EMBED_ALLOWED_ORIGINS;
  if (envOrigins) {
    origins.push(
      ...envOrigins.split(",").map((o) => o.trim()).filter(Boolean),
    );
  }

  // Vercel auto-detection
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    origins.push(`https://${vercelUrl}`);
  }
  const vercelProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProdUrl) {
    origins.push(`https://${vercelProdUrl}`);
  }

  return origins;
}

export const allowedOrigins = loadAllowedOrigins();

/**
 * MinistryPlatform host (bare host, without the `/ministryplatformapi` suffix)
 * resolved from `MINISTRY_PLATFORM_BASE_URL`.
 *
 * There is no tenant-specific default: server code requires explicit
 * configuration and throws a clear error when the env var is missing.
 */
export function getMpHost(): string {
  const raw = process.env.MINISTRY_PLATFORM_BASE_URL;
  if (!raw) {
    throw new Error(
      "MINISTRY_PLATFORM_BASE_URL is not configured. Set it to your MinistryPlatform host (e.g. https://my.example.church).",
    );
  }
  return raw.replace(/\/ministryplatformapi\/?$/, "");
}

/**
 * MP host for use in illustrative documentation/example snippets only.
 * Falls back to a neutral, obviously-placeholder host when unconfigured so
 * importing modules never crashes at load time.
 */
export function getMpHostForDocs(): string {
  const raw = process.env.MINISTRY_PLATFORM_BASE_URL || "https://your-mp-host.example.com";
  return raw.replace(/\/ministryplatformapi\/?$/, "");
}
