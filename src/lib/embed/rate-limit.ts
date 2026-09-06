/**
 * Fixed-window rate limiter backed by the embed session store.
 *
 * Window is 60s aligned to the minute; counter key is `<key>:<windowStart>`
 * under the store's `nw:rl:` prefix. Fails open (with a logged error) if the
 * store is unreachable so a store outage cannot take public widgets down.
 */

import { getSessionStore } from "./session-store";

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 120;

export function getDefaultRateLimit(): number {
  const raw = process.env.EMBED_SESSION_RATE_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

export async function checkRateLimit(
  key: string,
  limitPerMinute: number = getDefaultRateLimit(),
): Promise<{ ok: boolean; remaining: number }> {
  const limit = Math.max(1, Math.floor(limitPerMinute));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - (nowSeconds % WINDOW_SECONDS);
  const counterKey = `${key}:${windowStart}`;

  let count: number;
  try {
    // TTL slightly longer than the window so the key outlives the last request in it.
    count = await getSessionStore().incr(counterKey, WINDOW_SECONDS + 5);
  } catch (error) {
    console.error(
      "checkRateLimit: session store unavailable; allowing request",
      error instanceof Error ? error.message : error,
    );
    return { ok: true, remaining: limit };
  }

  return { ok: count <= limit, remaining: Math.max(0, limit - count) };
}
