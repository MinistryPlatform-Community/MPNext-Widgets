/**
 * Church-supplied label overrides.
 *
 * A separate capability from language, and the half of the legacy `GetLabels`
 * mechanism that has nothing to do with translation: a church renaming "Groups"
 * to "Small Groups", or "Opportunities" to "Serve", to match its own ministry
 * vocabulary. Every church that had done that in MP's Application Labels lost
 * the rename on migration to these widgets (filed as C67); this restores it
 * without putting the catalogue in MP.
 *
 * Set from the host page, so a church needs no build step and no deploy of ours:
 *
 *   MPNextEmbed.setMessages("es", { "groupFinder.title": "Encuentra un Grupo" });
 *   MPNextEmbed.setMessages("*",  { "common.signIn": "Member Login" });
 *
 * Overrides win over the locale catalogue and over English — they are the top
 * rung of `t()`'s resolution order. Values are plain text and pass through the
 * same escaping boundary as catalogue strings, so this is not a route for a host
 * page to inject markup into a shadow root.
 */

import type { LocaleCode } from "./registry";

/** `"*"` applies to every locale; a locale code applies to just that one. */
export type OverrideScope = LocaleCode | "*";

type OverrideMap = Record<string, string>;

const byScope = new Map<OverrideScope, OverrideMap>();

/** Notified when overrides change, so mounted widgets can re-render. */
const listeners = new Set<() => void>();

/**
 * Merge a batch of overrides into a scope. Repeated calls accumulate; pass
 * `null` as the value of a key to drop it back to the catalogue string.
 */
export function setOverrides(
  scope: OverrideScope,
  messages: Record<string, string | null>,
): void {
  let map = byScope.get(scope);
  if (!map) {
    map = {};
    byScope.set(scope, map);
  }
  for (const [key, value] of Object.entries(messages)) {
    if (value === null) {
      delete map[key];
    } else if (typeof value === "string") {
      map[key] = value;
    }
  }
  for (const fn of listeners) fn();
}

/**
 * The override for `key` in `locale`, if any: the locale-specific bucket first,
 * then the all-locales bucket.
 *
 * A key that matches nothing in the catalogue is simply never consulted — a
 * stale override left behind after a key rename must not blank a label, so
 * there is no "unknown key" failure path here.
 */
export function getOverride(
  locale: LocaleCode,
  key: string,
): string | undefined {
  return byScope.get(locale)?.[key] ?? byScope.get("*")?.[key];
}

/** True when any override is registered, for the locale or for all locales. */
export function hasOverrides(locale?: LocaleCode): boolean {
  if (locale && byScope.get(locale)) {
    return Object.keys(byScope.get(locale) as OverrideMap).length > 0;
  }
  for (const map of byScope.values()) {
    if (Object.keys(map).length > 0) return true;
  }
  return false;
}

export function onOverridesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam. */
export function __clearOverrides(): void {
  byScope.clear();
  listeners.clear();
}
