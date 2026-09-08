/**
 * Embed session store: server-side storage for MP tokens (sealed) keyed by
 * `sha256(sid)`, plus the small key/value primitives the auth flow needs
 * (one-time handoff codes, short locks, fixed-window counters).
 *
 * Two adapters:
 * - `MemorySessionStore` — Map with expiry; **development and unit tests only**
 *   (single process). Its backing Map is hung off `globalThis` — see
 *   "Singleton" at the bottom of this file for why that is load-bearing rather
 *   than a style choice.
 * - `UpstashSessionStore` — Upstash Redis REST via `fetch`, no SDK dependency.
 *   The only adapter that is correct in production; `getSessionStore()`
 *   *requires* it there.
 *
 * Key layout: `nw:sess:<sidHash>`, `nw:handoff:<codeHash>`, `nw:lock:<key>`,
 * `nw:rl:<key>` (callers append the window start to the rate-limit key),
 * `nw:kv:<key>` (generic namespace; see the `kv*` methods).
 */

import type { EmbedSessionRecord } from "./types";

export interface HandoffValue {
  sid: string;
  origin: string;
  wid: string;
}

export interface EmbedSessionStore {
  get(sidHash: string): Promise<EmbedSessionRecord | null>;
  set(record: EmbedSessionRecord, ttlSeconds: number): Promise<void>;
  delete(sidHash: string): Promise<void>;
  // one-time handoff codes
  setHandoff(codeHash: string, value: HandoffValue, ttlSeconds: number): Promise<void>;
  /** Atomic single-use read (GETDEL on redis). */
  takeHandoff(codeHash: string): Promise<HandoffValue | null>;
  // short lock for refresh stampede
  /** SET NX EX — true when this caller now holds the lock. */
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
  // fixed-window counter for rate limiting
  incr(key: string, ttlSeconds: number): Promise<number>;
  // ---------------------------------------------------------------------
  // Generic string KV, namespaced under `nw:kv:`. Kept deliberately dumb --
  // it is the substrate for callers that bring their own key layout and
  // serialisation, currently Better Auth's `secondaryStorage`
  // (`src/lib/auth-secondary-storage.ts`). Values are opaque strings; nothing
  // here parses or validates them.
  // ---------------------------------------------------------------------
  /** Value, or null when absent/expired. */
  kvGet(key: string): Promise<string | null>;
  /** Store a value. No `ttlSeconds` (or <= 0) means no expiry. */
  kvSet(key: string, value: string, ttlSeconds?: number): Promise<void>;
  kvDelete(key: string): Promise<void>;
  /** Atomic single-use read (GETDEL on redis). */
  kvGetDelete(key: string): Promise<string | null>;
  /**
   * Atomic increment. The key is created at 1 with `ttlSeconds` on first call;
   * later increments never extend the window (fixed window, like `incr`).
   */
  kvIncrement(key: string, ttlSeconds: number): Promise<number>;
}

const KEY = {
  session: (sidHash: string) => `nw:sess:${sidHash}`,
  handoff: (codeHash: string) => `nw:handoff:${codeHash}`,
  lock: (key: string) => `nw:lock:${key}`,
  rateLimit: (key: string) => `nw:rl:${key}`,
  kv: (key: string) => `nw:kv:${key}`,
} as const;

function ttlMs(ttlSeconds: number): number {
  return Math.max(1, Math.floor(ttlSeconds)) * 1000;
}

function isHandoffValue(value: unknown): value is HandoffValue {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.sid === "string" && typeof v.origin === "string" && typeof v.wid === "string";
}

function isSessionRecord(value: unknown): value is EmbedSessionRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sidHash === "string" &&
    typeof v.origin === "string" &&
    typeof v.mpAccessTokenEnc === "string" &&
    typeof v.mpExpiresAt === "number" &&
    typeof v.absoluteExpiresAt === "number" &&
    typeof v.user === "object" && v.user !== null
  );
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

/** One row in {@link MemorySessionStore}. Exported only because it appears in
 * the store's constructor signature (the shared backing Map). */
export interface Entry {
  value: string;
  expiresAt: number; // epoch ms
}

export class MemorySessionStore implements EmbedSessionStore {
  private readonly map: Map<string, Entry>;
  private writes = 0;

  /**
   * @param backingMap Storage to adopt instead of a private one. `getSessionStore()`
   * passes the process-wide Map kept on `globalThis` so that every module
   * instance of this file — and every instance created after an HMR
   * re-evaluation — reads and writes the same rows. Tests leave it undefined
   * and get an isolated store.
   */
  constructor(backingMap?: Map<string, Entry>) {
    this.map = backingMap ?? new Map<string, Entry>();
  }

  private now(): number {
    return Date.now();
  }

  private read(key: string): string | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  private write(key: string, value: string, ttlSeconds: number): void {
    this.map.set(key, { value, expiresAt: this.now() + ttlMs(ttlSeconds) });
    if (++this.writes % 500 === 0) this.sweep();
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }

  /** Number of live (unexpired) keys; for tests. */
  get size(): number {
    this.sweep();
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  async get(sidHash: string): Promise<EmbedSessionRecord | null> {
    const raw = this.read(KEY.session(sidHash));
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSessionRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async set(record: EmbedSessionRecord, ttlSeconds: number): Promise<void> {
    this.write(KEY.session(record.sidHash), JSON.stringify(record), ttlSeconds);
  }

  async delete(sidHash: string): Promise<void> {
    this.map.delete(KEY.session(sidHash));
  }

  async setHandoff(codeHash: string, value: HandoffValue, ttlSeconds: number): Promise<void> {
    this.write(KEY.handoff(codeHash), JSON.stringify(value), ttlSeconds);
  }

  async takeHandoff(codeHash: string): Promise<HandoffValue | null> {
    const key = KEY.handoff(codeHash);
    const raw = this.read(key);
    this.map.delete(key);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isHandoffValue(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const k = KEY.lock(key);
    if (this.read(k) !== null) return false;
    this.write(k, "1", ttlSeconds);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.map.delete(KEY.lock(key));
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const k = KEY.rateLimit(key);
    const current = this.read(k);
    if (current === null) {
      this.write(k, "1", ttlSeconds);
      return 1;
    }
    const next = (parseInt(current, 10) || 0) + 1;
    // Keep the original expiry (fixed window): update value in place.
    const entry = this.map.get(k);
    if (entry) entry.value = String(next);
    return next;
  }

  async kvGet(key: string): Promise<string | null> {
    return this.read(KEY.kv(key));
  }

  async kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const k = KEY.kv(key);
    if (ttlSeconds === undefined || ttlSeconds <= 0) {
      // No expiry. Mirrors redis `SET` without `EX`.
      this.map.set(k, { value, expiresAt: Number.POSITIVE_INFINITY });
      return;
    }
    this.write(k, value, ttlSeconds);
  }

  async kvDelete(key: string): Promise<void> {
    this.map.delete(KEY.kv(key));
  }

  async kvGetDelete(key: string): Promise<string | null> {
    const k = KEY.kv(key);
    const raw = this.read(k);
    this.map.delete(k);
    return raw;
  }

  async kvIncrement(key: string, ttlSeconds: number): Promise<number> {
    const k = KEY.kv(key);
    const current = this.read(k);
    if (current === null) {
      this.write(k, "1", ttlSeconds);
      return 1;
    }
    const next = (parseInt(current, 10) || 0) + 1;
    // Fixed window: keep the original expiry, update the value in place.
    const entry = this.map.get(k);
    if (entry) entry.value = String(next);
    return next;
  }
}

// ---------------------------------------------------------------------------
// Upstash Redis REST adapter
// ---------------------------------------------------------------------------

type RedisArg = string | number;
type RedisCommand = RedisArg[];
interface UpstashResult {
  result?: unknown;
  error?: string;
}

const UPSTASH_TIMEOUT_MS = 5000;

export class UpstashSessionStore implements EmbedSessionStore {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    if (!url || !token) {
      throw new Error("UpstashSessionStore requires both a REST URL and token");
    }
    this.url = url.replace(/\/+$/, "");
    this.token = token;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Session store request failed (${res.status})`);
    }
    return res.json();
  }

  private async command(cmd: RedisCommand): Promise<unknown> {
    const data = (await this.post("", cmd)) as UpstashResult;
    if (data && typeof data === "object" && "error" in data && data.error) {
      throw new Error(`Session store error: ${data.error}`);
    }
    return data?.result ?? null;
  }

  private async pipeline(cmds: RedisCommand[]): Promise<unknown[]> {
    const data = (await this.post("/pipeline", cmds)) as UpstashResult[];
    if (!Array.isArray(data)) {
      throw new Error("Session store pipeline returned an unexpected response");
    }
    return data.map((item) => {
      if (item && typeof item === "object" && item.error) {
        throw new Error(`Session store error: ${item.error}`);
      }
      return item?.result ?? null;
    });
  }

  async get(sidHash: string): Promise<EmbedSessionRecord | null> {
    const raw = await this.command(["GET", KEY.session(sidHash)]);
    if (typeof raw !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSessionRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async set(record: EmbedSessionRecord, ttlSeconds: number): Promise<void> {
    await this.command([
      "SET",
      KEY.session(record.sidHash),
      JSON.stringify(record),
      "EX",
      Math.max(1, Math.floor(ttlSeconds)),
    ]);
  }

  async delete(sidHash: string): Promise<void> {
    await this.command(["DEL", KEY.session(sidHash)]);
  }

  async setHandoff(codeHash: string, value: HandoffValue, ttlSeconds: number): Promise<void> {
    await this.command([
      "SET",
      KEY.handoff(codeHash),
      JSON.stringify(value),
      "EX",
      Math.max(1, Math.floor(ttlSeconds)),
    ]);
  }

  async takeHandoff(codeHash: string): Promise<HandoffValue | null> {
    const raw = await this.command(["GETDEL", KEY.handoff(codeHash)]);
    if (typeof raw !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isHandoffValue(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.command([
      "SET",
      KEY.lock(key),
      "1",
      "NX",
      "EX",
      Math.max(1, Math.floor(ttlSeconds)),
    ]);
    return result === "OK";
  }

  async releaseLock(key: string): Promise<void> {
    await this.command(["DEL", KEY.lock(key)]);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const k = KEY.rateLimit(key);
    const [count] = await this.pipeline([
      ["INCR", k],
      ["EXPIRE", k, Math.max(1, Math.floor(ttlSeconds))],
    ]);
    return typeof count === "number" ? count : parseInt(String(count), 10) || 0;
  }

  async kvGet(key: string): Promise<string | null> {
    const raw = await this.command(["GET", KEY.kv(key)]);
    return typeof raw === "string" ? raw : null;
  }

  async kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const cmd: RedisCommand = ["SET", KEY.kv(key), value];
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      cmd.push("EX", Math.max(1, Math.floor(ttlSeconds)));
    }
    await this.command(cmd);
  }

  async kvDelete(key: string): Promise<void> {
    await this.command(["DEL", KEY.kv(key)]);
  }

  async kvGetDelete(key: string): Promise<string | null> {
    const raw = await this.command(["GETDEL", KEY.kv(key)]);
    return typeof raw === "string" ? raw : null;
  }

  async kvIncrement(key: string, ttlSeconds: number): Promise<number> {
    const k = KEY.kv(key);
    // NX so the window is anchored to the first increment: a later EXPIRE
    // would slide the window and let a caller outrun a fixed-window limit.
    const [count] = await this.pipeline([
      ["INCR", k],
      ["EXPIRE", k, Math.max(1, Math.floor(ttlSeconds)), "NX"],
    ]);
    return typeof count === "number" ? count : parseInt(String(count), 10) || 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * ## Why the singleton lives on `globalThis`
 *
 * A module-level `let instance` is not process-wide in the App Router. Next 16
 * (Turbopack) builds the React Server Component graph and the route-handler
 * graph as **separate bundles**, and each one evaluates this file separately.
 * Measured on 2026-09-07 with `next dev`, a probe printing `process.pid`, a
 * per-module-evaluation random id, and a `globalThis` id:
 *
 *   where=route-handler   pid=65364 module=8ixqsx global=nbnf4q
 *   where=demo-layout-rsc pid=65364 module=72ctu2 global=nbnf4q
 *
 * One process, **two module instances, one `globalThis`**. So a module-level
 * `MemorySessionStore` gave the two halves of the app two disjoint Maps:
 * `POST /api/auth/...` wrote the Better Auth session into the route-handler
 * Map (`secondaryStorage` is namespaced into this same store — see
 * `src/lib/auth-secondary-storage.ts`), `src/app/(demo)/layout.tsx` read the
 * RSC Map, found nothing, and redirected to `/signin`, which saw the session
 * and redirected back. Signing in locally was impossible — 130 `/signin ↔
 * /demo` round trips in 12 seconds (TODO 31).
 *
 * Hanging both the instance *and* its backing Map off `globalThis` fixes it,
 * and also survives HMR: an edited file is re-evaluated into a fresh module
 * instance, which would otherwise start with an empty Map and sign the
 * developer out on every save.
 *
 * This is a **development** mechanism. It cannot help across processes or
 * serverless instances, which is exactly why production must use Upstash.
 */
const REGISTRY = Symbol.for("mpnext.embed.session-store");

interface StoreRegistry {
  instance: EmbedSessionStore | null;
  /** Shared backing storage for `MemorySessionStore`; outlives HMR re-evaluation. */
  memory: Map<string, Entry> | null;
  warned: boolean;
  legacyNamesWarned: boolean;
}

type GlobalWithRegistry = typeof globalThis & { [REGISTRY]?: StoreRegistry };

function registry(): StoreRegistry {
  const g = globalThis as GlobalWithRegistry;
  return (g[REGISTRY] ??= {
    instance: null,
    memory: null,
    warned: false,
    legacyNamesWarned: false,
  });
}

/**
 * Redis connection env, new names first, legacy `EMBED_SESSION_STORE_*` names
 * as a fallback.
 *
 * The store stopped being an embed-session detail once Better Auth's whole
 * session path moved into it (`src/lib/auth-secondary-storage.ts`) and the
 * generic `kv*` namespace opened it to anything else that wants a shared cache,
 * so it is named for what it is: an Upstash Redis REST endpoint. The names are
 * Upstash's own, which is also what the Upstash integration injects on Vercel
 * and what `@upstash/redis`'s `Redis.fromEnv()` reads — a deploy wired through
 * the integration needs no manual entry at all.
 *
 * The legacy names still work; drop them once every deploy has been migrated.
 */
const REDIS_URL_VARS = ["UPSTASH_REDIS_REST_URL", "EMBED_SESSION_STORE_URL"] as const;
const REDIS_TOKEN_VARS = ["UPSTASH_REDIS_REST_TOKEN", "EMBED_SESSION_STORE_TOKEN"] as const;

/**
 * First non-empty value among `names`, with the variable it came from. Read
 * through explicit `process.env.X` lookups rather than a dynamic index so the
 * bundler can see them.
 */
function readEnv(names: readonly string[]): { name: string; value: string } | null {
  const env: Record<string, string | undefined> = {
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    EMBED_SESSION_STORE_URL: process.env.EMBED_SESSION_STORE_URL,
    EMBED_SESSION_STORE_TOKEN: process.env.EMBED_SESSION_STORE_TOKEN,
  };
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

/**
 * Set to `1`/`true` to allow the in-memory store in production. Off by
 * default: see {@link getSessionStore}.
 */
function memoryAllowedInProduction(): boolean {
  const raw =
    process.env.REDIS_ALLOW_MEMORY_FALLBACK || process.env.EMBED_SESSION_STORE_ALLOW_MEMORY || "";
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** One deprecation warning per process when a legacy variable name supplied a value. */
function warnOnLegacyNames(...names: string[]): void {
  const legacy = names.filter((name) => name.startsWith("EMBED_SESSION_STORE_"));
  if (legacy.length === 0) return;
  const reg = registry();
  if (reg.legacyNamesWarned) return;
  reg.legacyNamesWarned = true;
  console.warn(
    `Redis store configured via deprecated ${legacy.join(" / ")}. ` +
      "Rename to UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN " +
      "(the names Upstash and the Vercel integration use); the old ones will be removed.",
  );
}

const MISSING_STORE_MESSAGE =
  "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are required in production. " +
  "The Redis store holds both the embed server sessions and the whole Better Auth " +
  "session path (src/lib/auth-secondary-storage.ts), so the in-memory fallback signs " +
  "users out on every cold start and whenever a request lands on another instance. " +
  "Configure an Upstash Redis REST endpoint, or set REDIS_ALLOW_MEMORY_FALLBACK=1 " +
  "to accept that behaviour deliberately.";

const PARTIAL_STORE_MESSAGE =
  "A Redis REST URL is set but UPSTASH_REDIS_REST_TOKEN is missing, so the store " +
  "cannot be reached. " +
  MISSING_STORE_MESSAGE;

/**
 * Store chosen by env: Upstash when `UPSTASH_REDIS_REST_URL` **and**
 * `UPSTASH_REDIS_REST_TOKEN` are set (or their legacy `EMBED_SESSION_STORE_*`
 * spellings), else the in-memory store.
 *
 * ## Production requires a real store
 *
 * In production the in-memory branch **throws** rather than degrading
 * silently. Item 14 moved Better Auth's entire session path into this store
 * precisely because the in-process fallback it replaced meant "a restart, a
 * cold start, or a request landing on another serverless instance signed the
 * user out". Falling back to memory re-creates that bug, and the only signal
 * it ever produced was one `console.warn` in a log nobody reads — which is how
 * it went unnoticed long enough to become TODO 14. A 500 naming the missing
 * variable is a better failure than an app that intermittently forgets who you
 * are.
 *
 * The throw is lazy (first *use*, not module load), so `next build` and any
 * code path that never touches a session are unaffected.
 * `REDIS_ALLOW_MEMORY_FALLBACK=1` opts back in explicitly for the rare
 * deploy that genuinely wants it; it still warns.
 *
 * Outside production the memory store is used and warns **once**, in dev too —
 * the old warning was gated on production, the one environment where the
 * branch was about to be removed.
 */
export function getSessionStore(): EmbedSessionStore {
  const reg = registry();
  if (reg.instance) return reg.instance;

  const url = readEnv(REDIS_URL_VARS);
  const token = readEnv(REDIS_TOKEN_VARS);

  if (url && token) {
    warnOnLegacyNames(url.name, token.name);
    reg.instance = new UpstashSessionStore(url.value, token.value);
    return reg.instance;
  }

  const message = url ? PARTIAL_STORE_MESSAGE : MISSING_STORE_MESSAGE;

  if (process.env.NODE_ENV === "production" && !memoryAllowedInProduction()) {
    // Not cached: a misconfigured process should fail the same way on every
    // request, and should recover as soon as the env is fixed and it restarts.
    throw new Error(message);
  }

  if (!reg.warned) {
    reg.warned = true;
    console.warn(
      process.env.NODE_ENV === "production"
        ? `${message} A memory-fallback override is set, so continuing on the in-memory store.`
        : "Using the in-memory session store (no UPSTASH_REDIS_REST_URL). " +
            "Fine for local development — sessions are process-local and reset with the dev server — " +
            "but production requires Upstash; see README \"Widget Authentication\".",
    );
  }

  reg.memory ??= new Map<string, Entry>();
  reg.instance = new MemorySessionStore(reg.memory);
  return reg.instance;
}

/** Test hook: drop the singleton so the next `getSessionStore()` re-reads env. */
export function __resetSessionStoreForTests(): void {
  const g = globalThis as GlobalWithRegistry;
  g[REGISTRY] = { instance: null, memory: null, warned: false, legacyNamesWarned: false };
}
