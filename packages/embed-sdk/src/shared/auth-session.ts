/**
 * AuthSession — browser-side session state for the embed SDK.
 *
 * One instance per page (singleton on `window.__nextAuthSession`). Owns:
 *   - auth mode discovery (`GET /api/embed/auth/config`, once; legacy on failure)
 *   - the opaque `sid` (localStorage by default, sessionStorage when scope="tab")
 *   - the `#nw_auth=<code>` handoff fragment written by the OAuth callback
 *   - the in-memory widget JWT cache (never persisted)
 *   - the token ladder: handoff exchange → sid → legacy silent-upgrade → public
 *   - login() / logout() / me() helpers used by the widgets
 *
 * The legacy `mpp-widgets_*` keys written by MPWidgets.js are only READ here
 * (silent upgrade in `dual`, today's behavior in `legacy`). They are never
 * written. They are removed only on an explicit logout() in a non-hardened mode
 * so a signed-out visitor cannot be silently re-upgraded from a stale MP token.
 */

export type EmbedAuthMode = "legacy" | "dual" | "hardened";

export interface AuthConfig {
  mode: EmbedAuthMode;
  loginUrl: string;
  logoutUrl: string;
  meUrl: string;
  /**
   * The one `post_logout_redirect_uri` the widget host has registered on its
   * MP OAuth client, when it has one. Only `legacy` needs it -- that mode
   * builds MP's end-session URL in the browser, and MP refuses to complete a
   * logout whose redirect URI it does not recognise (TODO 29). Absent means
   * "send none", which MP also completes, just without a return trip.
   */
  postLogoutRedirectUri?: string;
}

export interface AuthSessionUser {
  userGuid: string;
  firstName: string;
  lastName: string;
  email: string;
  imageGuid?: string | null;
}

export interface MeResponse {
  authenticated: boolean;
  user?: AuthSessionUser;
}

export type StorageScope = "local" | "tab";

export const SID_KEY = "nw_sid";
export const LEGACY_TOKEN_KEY = "mpp-widgets_AuthToken";
export const LEGACY_EXPIRES_KEY = "mpp-widgets_ExpiresAfter";

/** Legacy keys removed on logout() outside hardened mode (mirrors user-menu). */
const LEGACY_KEYS = [
  "mpp-widgets_AuthToken",
  "mpp-widgets_IdToken",
  "mpp-widgets_ExpiresAfter",
  "mpp-widgets_Refresh",
];

/** Re-mint this many ms before the JWT `exp`. */
const TOKEN_SKEW_MS = 30_000;

const VALID_MODES: readonly EmbedAuthMode[] = ["legacy", "dual", "hardened"];

interface CachedToken {
  token: string;
  /** epoch ms after which the cached token is considered stale */
  staleAt: number;
  /** credential basis the token was minted from ("sid:…", "legacy:…", "public") */
  basis: string;
}

interface SessionResponseBody {
  token?: string;
  expiresIn?: number;
  sid?: string;
  mode?: EmbedAuthMode;
  error?: string;
}

/** Decode the `exp` claim of a JWT without verifying it. Returns epoch ms or null. */
function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const claims = JSON.parse(atob(payload)) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Same validity rule as user-menu's `hasLocalStorageAuth()`:
 * token present, and `mpp-widgets_ExpiresAfter` (a Date.toString()) is absent,
 * unparsable, or in the future.
 */
export function readLegacyToken(): string | null {
  try {
    const token = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!token) return null;
    const expiresAfter = localStorage.getItem(LEGACY_EXPIRES_KEY);
    if (expiresAfter) {
      const expiryDate = new Date(expiresAfter);
      if (!isNaN(expiryDate.getTime()) && expiryDate <= new Date()) {
        return null; // present but expired
      }
    }
    return token;
  } catch {
    return null;
  }
}

export class AuthSession {
  private readonly apiHost: string;

  private config: AuthConfig | null = null;
  private configPromise: Promise<AuthConfig> | null = null;

  private scope: StorageScope = "local";
  /** Fallback when both storages are blocked (private mode, sandboxed iframes). */
  private memorySid: string | null = null;

  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  private handoffParsed = false;
  private pendingHandoffCode: string | null = null;
  private lastAuthError: string | null = null;

  private meCache: { sid: string; value: MeResponse } | null = null;

  private listeners = new Set<() => void>();
  private storageListenerAttached = false;
  private readonly storageListener = (e: StorageEvent) => {
    if (
      e.key === null ||
      e.key === SID_KEY ||
      e.key === LEGACY_TOKEN_KEY ||
      e.key === LEGACY_EXPIRES_KEY
    ) {
      this.notify();
    }
  };

  constructor(apiHost: string) {
    this.apiHost = (apiHost || "").replace(/\/+$/, "");
  }

  // ── Config ─────────────────────────────────────────────────────

  private fallbackConfig(): AuthConfig {
    return {
      mode: "legacy",
      loginUrl: `${this.apiHost}/api/embed/auth/login`,
      logoutUrl: `${this.apiHost}/api/embed/auth/logout`,
      meUrl: `${this.apiHost}/api/embed/auth/me`,
    };
  }

  /**
   * Fetch `/api/embed/auth/config` once. Any failure (network, non-2xx, bad
   * body) resolves to legacy so existing customers never break.
   */
  getConfig(): Promise<AuthConfig> {
    if (this.config) return Promise.resolve(this.config);
    if (!this.configPromise) {
      this.configPromise = this.fetchConfig().then((cfg) => {
        this.config = cfg;
        return cfg;
      });
    }
    return this.configPromise;
  }

  private async fetchConfig(): Promise<AuthConfig> {
    const fallback = this.fallbackConfig();
    try {
      const res = await fetch(`${this.apiHost}/api/embed/auth/config`, {
        method: "GET",
        credentials: "omit",
        mode: "cors",
      });
      if (!res.ok) return fallback;
      const data = (await res.json()) as Partial<AuthConfig> | null;
      if (!data || !VALID_MODES.includes(data.mode as EmbedAuthMode)) return fallback;
      return {
        mode: data.mode as EmbedAuthMode,
        loginUrl: typeof data.loginUrl === "string" && data.loginUrl ? data.loginUrl : fallback.loginUrl,
        logoutUrl: typeof data.logoutUrl === "string" && data.logoutUrl ? data.logoutUrl : fallback.logoutUrl,
        meUrl: typeof data.meUrl === "string" && data.meUrl ? data.meUrl : fallback.meUrl,
        ...(typeof data.postLogoutRedirectUri === "string" && data.postLogoutRedirectUri
          ? { postLogoutRedirectUri: data.postLogoutRedirectUri }
          : {}),
      };
    } catch {
      return fallback;
    }
  }

  /** Synchronous mode accessor; null until getConfig() has resolved. */
  getMode(): EmbedAuthMode | null {
    return this.config?.mode ?? null;
  }

  /**
   * The widget host's registered `post_logout_redirect_uri`, or null when the
   * config has not resolved or the host advertises none. Read synchronously by
   * the legacy end-session builder, which runs long after config resolution.
   */
  getPostLogoutRedirectUri(): string | null {
    return this.config?.postLogoutRedirectUri ?? null;
  }

  // ── sid storage ────────────────────────────────────────────────

  setStorageScope(scope: StorageScope): void {
    if (scope !== "local" && scope !== "tab") return;
    if (this.scope === scope) return;
    this.scope = scope;
    this.notify();
  }

  getStorageScope(): StorageScope {
    return this.scope;
  }

  private storage(): Storage | null {
    try {
      return this.scope === "tab" ? window.sessionStorage : window.localStorage;
    } catch {
      return null;
    }
  }

  getSid(): string | null {
    try {
      const store = this.storage();
      if (store) {
        // Storage is reachable: it is authoritative (cross-tab clears must win).
        return store.getItem(SID_KEY) || null;
      }
    } catch {
      /* storage blocked — fall back to memory */
    }
    return this.memorySid;
  }

  setSid(sid: string): void {
    if (!sid) return;
    const prev = this.getSid();
    this.memorySid = sid;
    try {
      this.storage()?.setItem(SID_KEY, sid);
    } catch {
      /* storage blocked — memory fallback keeps this page working */
    }
    if (prev !== sid) {
      this.meCache = null;
      this.notify();
    }
  }

  clearSid(): void {
    const prev = this.getSid();
    this.memorySid = null;
    for (const getStore of [() => window.localStorage, () => window.sessionStorage]) {
      try {
        getStore().removeItem(SID_KEY);
      } catch {
        /* storage blocked */
      }
    }
    this.meCache = null;
    if (prev !== null) this.notify();
  }

  // ── Handoff fragment ───────────────────────────────────────────

  /**
   * Parse `#nw_auth=<code>` / `#nw_auth_error=<code>` from the URL, strip them
   * (history.replaceState, other fragment params preserved) and return them.
   * Returns the parsed values on the first call only; null afterwards or when
   * nothing was present. The code is also retained internally so getToken()
   * can exchange it even when a host page consumed the return value.
   */
  consumeHandoffFromUrl(): { code?: string; error?: string } | null {
    if (this.handoffParsed) return null;
    this.handoffParsed = true;

    if (typeof window === "undefined" || !window.location) return null;
    const rawHash = window.location.hash || "";
    if (!rawHash.includes("nw_auth")) return null;

    const segments = rawHash.replace(/^#/, "").split("&");
    let code: string | undefined;
    let error: string | undefined;
    const kept: string[] = [];
    for (const seg of segments) {
      const eq = seg.indexOf("=");
      const key = eq === -1 ? seg : seg.slice(0, eq);
      const val = eq === -1 ? "" : seg.slice(eq + 1);
      if (key === "nw_auth") {
        code = safeDecode(val) || undefined;
      } else if (key === "nw_auth_error") {
        error = safeDecode(val) || undefined;
      } else if (seg.length) {
        kept.push(seg);
      }
    }
    if (code === undefined && error === undefined) return null;

    try {
      const newUrl =
        window.location.pathname +
        window.location.search +
        (kept.length ? `#${kept.join("&")}` : "");
      history.replaceState(history.state, "", newUrl);
    } catch {
      /* replaceState unavailable — fragment stays, harmless */
    }

    if (code) this.pendingHandoffCode = code;
    if (error) {
      this.lastAuthError = error;
      this.notify();
    }
    const result: { code?: string; error?: string } = {};
    if (code) result.code = code;
    if (error) result.error = error;
    return result;
  }

  /** Short error code from `#nw_auth_error=…` on this page load, if any. */
  getAuthError(): string | null {
    return this.lastAuthError;
  }

  /**
   * True when the page arrived with a `#nw_auth=<code>` that has not been
   * exchanged yet. Parses (and strips) the fragment on first use. Callers use
   * it to trigger the exchange eagerly at boot — the code expires in 60s.
   */
  hasPendingHandoff(): boolean {
    if (!this.handoffParsed) this.consumeHandoffFromUrl();
    return this.pendingHandoffCode !== null;
  }

  // ── Widget JWT ─────────────────────────────────────────────────

  /**
   * Current credential basis. Used to invalidate the JWT cache when the
   * underlying credential changes (login via MP widget, logout, sid set/cleared)
   * so widgets never keep using a stale public/user token for up to 5 minutes.
   */
  private currentBasis(mode: EmbedAuthMode): string {
    const sid = this.getSid();
    if (sid) return `sid:${sid}`;
    if (mode !== "hardened") {
      const legacy = readLegacyToken();
      if (legacy) return `legacy:${legacy}`;
    }
    return "public";
  }

  getToken(wid: string): Promise<string> {
    if (this.inflight) return this.inflight;
    const p = this.resolveToken(wid).finally(() => {
      if (this.inflight === p) this.inflight = null;
    });
    this.inflight = p;
    return p;
  }

  refreshToken(wid: string): Promise<string> {
    if (this.inflight) {
      // Let the in-flight mint settle, then force a fresh one.
      return this.inflight.catch(() => undefined).then(() => {
        this.cached = null;
        return this.getToken(wid);
      });
    }
    this.cached = null;
    return this.getToken(wid);
  }

  private async resolveToken(wid: string): Promise<string> {
    const cfg = await this.getConfig();
    const mode = cfg.mode;

    if (!this.handoffParsed) this.consumeHandoffFromUrl();

    // 1. Pending handoff code → exchange for sid + token.
    if (this.pendingHandoffCode) {
      const code = this.pendingHandoffCode;
      this.pendingHandoffCode = null;
      const exchanged = await this.exchangeHandoff(code, wid);
      if (exchanged) return exchanged;
    }

    // Cache hit (only if minted from the same credential).
    const basis = this.currentBasis(mode);
    if (this.cached && this.cached.basis === basis && Date.now() < this.cached.staleAt) {
      return this.cached.token;
    }
    this.cached = null;

    // 2. sid → session-backed token.
    const sid = this.getSid();
    if (sid) {
      const res = await this.postSession({ wid, sid });
      if (res.ok) {
        const data = (await res.json()) as SessionResponseBody;
        return this.cacheToken(data, `sid:${sid}`);
      }
      if (res.status === 401) {
        // invalid_session: revoked, expired, or origin mismatch — drop it and fall through.
        this.clearSid();
      } else {
        throw new Error(await readError(res));
      }
    }

    // 3. Legacy MP token (silent upgrade in dual; today's path in legacy).
    if (mode !== "hardened") {
      const legacy = readLegacyToken();
      if (legacy) {
        const res = await this.postSession({ wid, mpUserToken: legacy });
        if (!res.ok) throw new Error(await readError(res));
        const data = (await res.json()) as SessionResponseBody;
        if (data.sid) {
          this.setSid(data.sid);
          return this.cacheToken(data, `sid:${data.sid}`);
        }
        return this.cacheToken(data, `legacy:${legacy}`);
      }
    }

    // 4. Public token.
    const res = await this.postSession({ wid });
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as SessionResponseBody;
    return this.cacheToken(data, "public");
  }

  private async exchangeHandoff(code: string, wid: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiHost}/api/embed/auth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, wid }),
        credentials: "omit",
        mode: "cors",
      });
      if (!res.ok) {
        this.lastAuthError = (await res.json().catch(() => ({}) as SessionResponseBody)).error || "invalid_code";
        this.notify();
        return null;
      }
      const data = (await res.json()) as SessionResponseBody;
      if (!data.sid || !data.token) return null;
      this.lastAuthError = null;
      this.setSid(data.sid);
      return this.cacheToken(data, `sid:${data.sid}`);
    } catch {
      return null;
    }
  }

  private postSession(body: { wid: string; sid?: string; mpUserToken?: string }): Promise<Response> {
    return fetch(`${this.apiHost}/api/embed/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      mode: "cors",
    });
  }

  private cacheToken(data: SessionResponseBody, basis: string): string {
    const token = data.token;
    if (!token) throw new Error("Token fetch failed");
    const expMs = decodeJwtExpMs(token);
    const ttlMs =
      expMs !== null
        ? expMs - Date.now()
        : typeof data.expiresIn === "number"
          ? data.expiresIn * 1000
          : 300_000;
    this.cached = { token, staleAt: Date.now() + Math.max(0, ttlMs - TOKEN_SKEW_MS), basis };
    return token;
  }

  // ── State queries ──────────────────────────────────────────────

  /**
   * True when a sid is present, or (outside hardened mode) a valid legacy MP
   * token is present. Before config resolves, mode is treated as legacy.
   */
  isAuthenticated(): boolean {
    if (this.getSid()) return true;
    const mode = this.getMode();
    if (mode === "hardened") return false;
    return readLegacyToken() !== null;
  }

  // ── Login / logout / me ────────────────────────────────────────

  /**
   * Top-level navigation to the widget host's login route, which starts the
   * OAuth flow with MP and returns to `returnTo` (default: current URL) with a
   * one-time `#nw_auth=<code>` fragment.
   */
  login(opts?: { wid?: string; returnTo?: string }): void {
    if (typeof window === "undefined") return;
    const loginUrl = this.config?.loginUrl ?? this.fallbackConfig().loginUrl;
    const params = new URLSearchParams();
    params.set("origin", window.location.origin);
    params.set("return_to", opts?.returnTo ?? window.location.href);
    params.set("wid", opts?.wid ?? "user-menu");
    const sep = loginUrl.includes("?") ? "&" : "?";
    this.navigateTo(`${loginUrl}${sep}${params.toString()}`);
  }

  /** Top-level navigation seam (jsdom cannot navigate; tests spy on this). */
  protected navigateTo(url: string): void {
    window.location.assign(url);
  }

  /**
   * End the server session. Clears the sid locally (always) and returns the MP
   * end-session URL for the caller to navigate to (null when unavailable).
   * Outside hardened mode the legacy `mpp-widgets_*` keys are removed too so a
   * signed-out visitor is not silently re-upgraded from a stale MP token.
   */
  async logout(opts?: { postLogoutRedirectUri?: string }): Promise<string | null> {
    const sid = this.getSid();
    const logoutUrl = this.config?.logoutUrl ?? this.fallbackConfig().logoutUrl;
    let endSessionUrl: string | null = null;

    if (sid) {
      try {
        const res = await fetch(logoutUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sid,
            ...(opts?.postLogoutRedirectUri ? { postLogoutRedirectUri: opts.postLogoutRedirectUri } : {}),
          }),
          credentials: "omit",
          mode: "cors",
        });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { endSessionUrl?: string };
          if (typeof data.endSessionUrl === "string" && data.endSessionUrl) {
            endSessionUrl = data.endSessionUrl;
          }
        }
      } catch {
        /* network failure — still clear locally */
      }
    }

    this.cached = null;
    if (this.getMode() !== "hardened") {
      for (const key of LEGACY_KEYS) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* storage blocked */
        }
      }
    }
    this.clearSid();
    this.notify();
    return endSessionUrl;
  }

  /**
   * Who is signed in, according to the server session. Cached per sid.
   * Returns `{ authenticated: false }` without a network call when no sid is
   * present (a public token would only 401).
   */
  async me(wid = "user-menu"): Promise<MeResponse> {
    const sid = this.getSid();
    if (!sid) return { authenticated: false };
    if (this.meCache && this.meCache.sid === sid) return this.meCache.value;

    const cfg = await this.getConfig();
    let token: string;
    try {
      token = await this.getToken(wid);
    } catch {
      return { authenticated: false };
    }
    try {
      const res = await fetch(cfg.meUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        mode: "cors",
      });
      if (!res.ok) return { authenticated: false };
      const data = (await res.json()) as MeResponse;
      const value: MeResponse =
        data && data.authenticated && data.user
          ? { authenticated: true, user: data.user }
          : { authenticated: false };
      if (value.authenticated && this.getSid() === sid) {
        this.meCache = { sid, value };
      }
      return value;
    } catch {
      return { authenticated: false };
    }
  }

  // ── Change notification ────────────────────────────────────────

  /**
   * Subscribe to credential changes: sid set/clear in this tab, storage scope
   * changes, logout, handoff errors, and cross-tab `storage` events on the sid
   * or legacy keys. Returns an unsubscribe function.
   */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    if (!this.storageListenerAttached && typeof window !== "undefined") {
      try {
        window.addEventListener("storage", this.storageListener);
        this.storageListenerAttached = true;
      } catch {
        /* no window events */
      }
    }
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    for (const cb of Array.from(this.listeners)) {
      try {
        cb();
      } catch {
        /* listener errors must not break the session */
      }
    }
  }
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

async function readError(res: Response): Promise<string> {
  const err = (await res.json().catch(() => ({ error: "Token fetch failed" }))) as { error?: string };
  return err.error || "Token fetch failed";
}

/**
 * Page-wide singleton. The first caller's `apiHost` wins; later callers with a
 * different host get the existing instance (there is one widget host per page).
 */
export function getAuthSession(apiHost?: string): AuthSession {
  if (typeof window === "undefined") {
    return new AuthSession(apiHost || "");
  }
  let session = window.__nextAuthSession;
  if (!session) {
    session = new AuthSession(apiHost || window.__nextEmbedApiHost || "");
    window.__nextAuthSession = session;
  }
  return session;
}

declare global {
  interface Window {
    __nextAuthSession?: AuthSession;
    __nextEmbedApiHost?: string;
  }
}
