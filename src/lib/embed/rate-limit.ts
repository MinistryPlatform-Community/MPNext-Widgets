/**
 * Fixed-window rate limiter backed by the embed session store.
 *
 * Window is 60s aligned to the minute by default; counter key is
 * `<key>:<windowStart>` under the store's `nw:rl:` prefix. Fails open (with a
 * logged error) if the store is unreachable so a store outage cannot take
 * public widgets down.
 *
 * ## Two options exist for the anonymous-write routes, and both are deliberate
 *
 * `windowSeconds` — the 60s window cannot express "3 per hour", which is what
 * an endpoint that *sends email to a submitted address* needs: a per-minute
 * limit alone lets one address be mail-bombed steadily all day, and from
 * rotating IPs it is not even slowed down.
 *
 * `failClosed` — the default fail-open is right for a read: a store outage
 * should not blank a church's event list. It is wrong for a send. Failing open
 * on an unauthenticated email endpoint turns a store outage into an open relay
 * pointed at whatever address the caller supplies, so those callers pass
 * `failClosed: true` and get a `429` they can report as `rate_limited`.
 */

import { getSessionStore } from "./session-store";

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 120;

export interface RateLimitOptions {
  /** Window length in seconds. Defaults to 60. */
  windowSeconds?: number;
  /**
   * Deny the request when the store cannot be reached, instead of allowing it.
   * Use on any unauthenticated endpoint that sends email or writes MP records.
   */
  failClosed?: boolean;
}

export function getDefaultRateLimit(): number {
  const raw = process.env.EMBED_SESSION_RATE_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

export async function checkRateLimit(
  key: string,
  limitPerWindow: number = getDefaultRateLimit(),
  options: RateLimitOptions = {},
): Promise<{ ok: boolean; remaining: number }> {
  const limit = Math.max(1, Math.floor(limitPerWindow));
  const windowSeconds = Math.max(1, Math.floor(options.windowSeconds ?? WINDOW_SECONDS));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - (nowSeconds % windowSeconds);
  // The window length is part of the key: without it, changing a limit's window
  // would have the new window's counter collide with the old one's.
  const counterKey = `${key}:${windowSeconds}:${windowStart}`;

  let count: number;
  try {
    // TTL slightly longer than the window so the key outlives the last request in it.
    count = await getSessionStore().incr(counterKey, windowSeconds + 5);
  } catch (error) {
    console.error(
      options.failClosed
        ? "checkRateLimit: session store unavailable; denying request"
        : "checkRateLimit: session store unavailable; allowing request",
      error instanceof Error ? error.message : error,
    );
    return options.failClosed ? { ok: false, remaining: 0 } : { ok: true, remaining: limit };
  }

  return { ok: count <= limit, remaining: Math.max(0, limit - count) };
}
