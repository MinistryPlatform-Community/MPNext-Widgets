/**
 * Embed session store: server-side storage for MP tokens (sealed) keyed by
 * `sha256(sid)`, plus the small key/value primitives the auth flow needs
 * (one-time handoff codes, short locks, fixed-window counters).
 *
 * Two adapters:
 * - `MemorySessionStore` — Map with expiry; dev/test only (single process).
 * - `UpstashSessionStore` — Upstash Redis REST via `fetch`, no SDK dependency.
 *
 * Key layout: `nw:sess:<sidHash>`, `nw:handoff:<codeHash>`, `nw:lock:<key>`,
 * `nw:rl:<key>` (callers append the window start to the rate-limit key).
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
}

const KEY = {
  session: (sidHash: string) => `nw:sess:${sidHash}`,
  handoff: (codeHash: string) => `nw:handoff:${codeHash}`,
  lock: (key: string) => `nw:lock:${key}`,
  rateLimit: (key: string) => `nw:rl:${key}`,
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

interface Entry {
  value: string;
  expiresAt: number; // epoch ms
}

export class MemorySessionStore implements EmbedSessionStore {
  private readonly map = new Map<string, Entry>();
  private writes = 0;

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
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: EmbedSessionStore | null = null;
let warnedMemoryInProduction = false;

/** Store chosen by env: Upstash when `EMBED_SESSION_STORE_URL` is set, else memory. */
export function getSessionStore(): EmbedSessionStore {
  if (instance) return instance;

  const url = process.env.EMBED_SESSION_STORE_URL;
  const token = process.env.EMBED_SESSION_STORE_TOKEN;

  if (url && token) {
    instance = new UpstashSessionStore(url, token);
    return instance;
  }

  if (process.env.NODE_ENV === "production" && !warnedMemoryInProduction) {
    warnedMemoryInProduction = true;
    console.warn(
      url
        ? "EMBED_SESSION_STORE_URL is set but EMBED_SESSION_STORE_TOKEN is missing; falling back to the in-memory session store."
        : "EMBED_SESSION_STORE_URL is not set; using the in-memory session store. Sessions will not survive restarts or span instances.",
    );
  }

  instance = new MemorySessionStore();
  return instance;
}

/** Test hook: drop the singleton so the next `getSessionStore()` re-reads env. */
export function __resetSessionStoreForTests(): void {
  instance = null;
  warnedMemoryInProduction = false;
}
