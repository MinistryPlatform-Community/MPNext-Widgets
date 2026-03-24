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
