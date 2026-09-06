/**
 * Resolve the embed auth mode for an embedding origin.
 *
 * Precedence: per-origin override (`EMBED_AUTH_MODE_ORIGINS`) → deployment-wide
 * `EMBED_AUTH_MODE` → `"legacy"`. Invalid values fall back to `"legacy"` and
 * warn once per distinct bad value so a typo never silently hardens a tenant.
 */

import type { EmbedAuthMode } from "./types";

const VALID_MODES: ReadonlySet<string> = new Set(["legacy", "dual", "hardened"]);
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function isAuthMode(value: string): value is EmbedAuthMode {
  return VALID_MODES.has(value);
}

/** Normalize an origin string to `scheme://host[:port]`; lowercases; falls back to the trimmed input. */
function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim();
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Parse `https://a.com=hardened,https://b.org=legacy` into a Map keyed by
 * normalized origin. Malformed entries are skipped with a single warning.
 */
export function parseAuthModeOverrides(raw: string | undefined): Map<string, EmbedAuthMode> {
  const map = new Map<string, EmbedAuthMode>();
  if (!raw) return map;

  for (const entry of raw.split(",")) {
    const item = entry.trim();
    if (!item) continue;
    const eq = item.lastIndexOf("=");
    if (eq <= 0) {
      warnOnce(`override:${item}`, `EMBED_AUTH_MODE_ORIGINS: ignoring malformed entry "${item}" (expected origin=mode)`);
      continue;
    }
    const origin = normalizeOrigin(item.slice(0, eq));
    const mode = item.slice(eq + 1).trim().toLowerCase();
    if (!origin) continue;
    if (!isAuthMode(mode)) {
      warnOnce(`override:${item}`, `EMBED_AUTH_MODE_ORIGINS: ignoring entry for ${origin} with invalid mode "${mode}"`);
      continue;
    }
    map.set(origin, mode);
  }
  return map;
}

let cachedOverridesRaw: string | undefined;
let cachedOverrides: Map<string, EmbedAuthMode> = new Map();

function getOverrides(): Map<string, EmbedAuthMode> {
  const raw = process.env.EMBED_AUTH_MODE_ORIGINS;
  if (raw !== cachedOverridesRaw) {
    cachedOverridesRaw = raw;
    cachedOverrides = parseAuthModeOverrides(raw);
  }
  return cachedOverrides;
}

/** Resolve the auth mode for an origin. */
export function resolveAuthMode(origin: string): EmbedAuthMode {
  if (origin) {
    const override = getOverrides().get(normalizeOrigin(origin));
    if (override) return override;
  }

  const raw = (process.env.EMBED_AUTH_MODE || "").trim().toLowerCase();
  if (!raw) return "legacy";
  if (isAuthMode(raw)) return raw;

  warnOnce(`mode:${raw}`, `EMBED_AUTH_MODE: invalid value "${raw}"; falling back to "legacy"`);
  return "legacy";
}
