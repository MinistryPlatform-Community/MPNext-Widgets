/**
 * Better Auth `secondaryStorage`, backed by the same Redis the embed widget
 * sessions already use (`EMBED_SESSION_STORE_URL` / `_TOKEN`, see
 * `src/lib/embed/session-store.ts`).
 *
 * ## Why this instead of a `database`
 *
 * `betterAuth()` with no `database` silently falls back to an in-process
 * memory adapter (`better-auth/dist/db/adapter-base.mjs`), so every row lived
 * in one Node process: a restart, a cold start, or a request landing on
 * another serverless instance signed the user out.
 *
 * Better Auth 1.7.3 serves the whole *session* path from `secondaryStorage`
 * when one is configured and `session.storeSessionInDatabase` is off
 * (`db/internal-adapter.mjs`):
 *
 * - `createSession` mirrors `{ session, user }` — a denormalised snapshot of
 *   the user row, additional fields included — into the store, plus an
 *   `active-sessions-<userId>` index.
 * - `findSession` / `findSessions` / `listSessions` read only from the store
 *   and never touch the adapter, so `getSession` (with or without
 *   `disableCookieCache`) survives a restart.
 * - `updateSession` merges in place, preserving the mirrored user.
 * - `deleteSession` / `deleteSessions` remove the token and prune the index,
 *   so a sign-out really revokes the session everywhere.
 * - `updateUser` re-mirrors the fresh row into every live session
 *   (`refreshUserSessions`), which is what keeps the item-11
 *   `userGuid` / `imageGuid` hooks effective across instances.
 *
 * Verification values move to the store too, and `create-context.mjs` flips
 * rate limiting to `"secondary-storage"` automatically once this is set.
 *
 * That leaves the `user` and `account` tables on the memory adapter. They stay
 * ephemeral by design, and it is correct *for this app*: nothing here persists
 * data keyed by the Better Auth `user.id` (`checkDemoAccess` authorises on
 * `userGuid`, which comes from MP on every sign-in), no password or
 * account-linking flow is enabled, and OAuth state lives in a cookie
 * (`account.storeStateStrategy: "cookie"`), not the verification table. The
 * only visible effect is that a returning user who signs in on a cold instance
 * gets a fresh `user.id` — sessions already minted stay valid, because they
 * live here. Introducing a durable `user.id` (or anything keyed on it) means
 * adding a real `database` adapter first.
 *
 * Errors are deliberately NOT swallowed: a store outage should surface, not
 * degrade into "you are signed out", which is the failure this replaced.
 */

import type { BetterAuthOptions } from "better-auth";
import { getSessionStore } from "@/lib/embed/session-store";

type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;

/**
 * Namespace for Better Auth's keys inside the shared store. The embed store
 * puts every generic key under `nw:kv:`, so these land at
 * `nw:kv:ba:<better-auth key>` and cannot collide with `nw:sess:*` &c.
 */
const PREFIX = "ba:";

const key = (k: string) => `${PREFIX}${k}`;

/**
 * Better Auth's `SecondaryStorage`. Resolved lazily on every call so the
 * process picks up `EMBED_SESSION_STORE_URL` whenever the env is loaded, and
 * so tests can swap the store via `__resetSessionStoreForTests()`.
 */
export function betterAuthSecondaryStorage(): SecondaryStorage {
  return {
    get: (k) => getSessionStore().kvGet(key(k)),
    getAndDelete: (k) => getSessionStore().kvGetDelete(key(k)),
    set: (k, value, ttl) => getSessionStore().kvSet(key(k), value, ttl),
    delete: (k) => getSessionStore().kvDelete(key(k)),
    increment: (k, ttl) => getSessionStore().kvIncrement(key(k), ttl),
  };
}
