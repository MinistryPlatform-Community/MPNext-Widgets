/**
 * Tenant configuration for embed widgets
 * In production, this would be stored in a database
 *
 * Allowed origins are merged from:
 * 1. Hardcoded defaults per tenant (below)
 * 2. EMBED_ALLOWED_ORIGINS env var (comma-separated, applies to all tenants)
 * 3. Vercel auto-detected URLs (VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL)
 */

import { TenantConfig } from "./types";

/**
 * Build the dynamic origins list from environment variables and Vercel auto-detection.
 * Computed once at module load time.
 */
function getEnvironmentOrigins(): string[] {
  const origins: string[] = [];

  // Env-var overrides (comma-separated)
  const envOrigins = process.env.EMBED_ALLOWED_ORIGINS;
  if (envOrigins) {
    origins.push(
      ...envOrigins.split(",").map((o) => o.trim()).filter(Boolean)
    );
  }

  // Vercel auto-detection — preview & production URLs
  const vercelUrl = process.env.VERCEL_URL; // e.g. my-app-abc123.vercel.app
  if (vercelUrl) {
    origins.push(`https://${vercelUrl}`);
  }
  const vercelProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL; // e.g. my-app.vercel.app
  if (vercelProdUrl) {
    origins.push(`https://${vercelProdUrl}`);
  }

  return origins;
}

const ENV_ORIGINS = getEnvironmentOrigins();

// Mock tenant configs - replace with database lookup
const TENANT_CONFIGS: Record<string, TenantConfig> = {
  "northwoods-dev": {
    id: "northwoods-dev",
    name: "Northwoods Church (dev)",
    allowedOrigins: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
      ...ENV_ORIGINS,
    ],
    mpClientId: process.env.MINISTRY_PLATFORM_CLIENT_ID || "",
    mpClientSecret: process.env.MINISTRY_PLATFORM_CLIENT_SECRET || "",
  },
  "northwoods-prod": {
    id: "northwoods-prod",
    name: "Northwoods Church",
    allowedOrigins: [
      "https://northwoods.church",
      "https://www.northwoods.church",
      "https://widgets.northwoods.church",
      "https://tools.northwoods.church",
      ...ENV_ORIGINS,
    ],
    mpClientId: process.env.MINISTRY_PLATFORM_CLIENT_ID || "",
    mpClientSecret: process.env.MINISTRY_PLATFORM_CLIENT_SECRET || "",
  },
};

export async function getTenantConfig(
  tenantId: string
): Promise<TenantConfig | null> {
  // TODO: Replace with database query
  // const config = await prisma.tenantConfig.findUnique({ where: { id: tenantId } });
  return TENANT_CONFIGS[tenantId] || null;
}

export async function validateInitToken(
  tenantId: string,
  initToken: string
): Promise<TenantConfig | null> {
  // TODO: Implement proper init token validation
  // This would typically:
  // 1. Verify the token signature
  // 2. Check it's not expired
  // 3. Ensure it's for the correct tenant
  // 4. Verify it hasn't been revoked

  // For now, simple validation
  if (!initToken || initToken.length < 20) {
    return null;
  }

  const tenant = await getTenantConfig(tenantId);
  if (!tenant) {
    return null;
  }

  // TODO: Add real token validation here
  // For production, accept tokens that start with the tenant ID
  // This allows custom generated tokens from generate-init-token.ps1
  if (!initToken.startsWith(`${tenantId}_`)) {
    console.warn(`Invalid init token for tenant ${tenantId}: token doesn't start with tenant ID`);
    return null;
  }

  // Token is valid if it starts with tenant ID and is long enough
  console.log(`✅ Valid init token for tenant ${tenantId}`);
  return tenant;
}

export function generateInitToken(tenantId: string): string {
  // Generate a long-lived init token for a tenant
  // This would be done in your admin dashboard
  return `${tenantId}_${process.env.EMBED_INIT_TOKEN_SECRET || "dev-secret"}`;
}
