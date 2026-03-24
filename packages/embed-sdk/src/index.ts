/**
 * MPNext Embed SDK
 *
 * Auto-initializing Web Components for embedding MPNext widgets.
 *
 * Usage — just load the script and drop in widgets:
 *
 *   <script type="module" src="https://your-host.com/embed-sdk/next-embed.es.js"></script>
 *   <next-user-menu mp-base-url="https://mp.church.com"></next-user-menu>
 *
 * The SDK detects its own host, auto-registers a token provider that calls
 * /api/embed/session, and resolves the ready promise so widgets can fetch.
 */

export { MPNextWidget } from "./shared/base-widget";
export { ApiClient } from "./shared/api-client";
export { UserMenuWidget } from "./components/user-menu";
export { AddToCalendarWidget } from "./components/add-to-calendar";
export { FullCalendarWidget } from "./components/full-calendar";
export { ProfileWidget } from "./components/profile";
export { MyInvoicesWidget } from "./components/my-invoices";

// Auto-register components
import "./components/user-menu";
import "./components/add-to-calendar";
import "./components/full-calendar";
import "./components/profile";
import "./components/my-invoices";

// ---------------------------------------------------------------------------
// Auto-initialization
// ---------------------------------------------------------------------------

/**
 * Derive the API host from the script's own URL.
 * e.g. https://your-host.com/embed-sdk/next-embed.es.js → https://your-host.com
 */
function detectApiHost(): string {
  if (typeof document === "undefined") return "";

  // 1. Currently executing script (works for <script src="https://...">)
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.src) {
    try {
      return new URL(current.src).origin;
    } catch { /* fall through */ }
  }

  // 2. Find our script tag by filename
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[src*="next-embed"]',
  );
  for (const s of scripts) {
    try {
      return new URL(s.src).origin;
    } catch { /* continue */ }
  }

  // 3. Read api-host from the first widget element on the page
  //    (handles Vite dev where the SDK is a local module import)
  const widget = document.querySelector(
    "next-user-menu, next-add-to-calendar, next-full-calendar, next-profile, next-my-invoices",
  );
  if (widget) {
    const host = widget.getAttribute("api-host");
    if (host) return host;
  }

  return "";
}

/**
 * Built-in token provider that calls /api/embed/session.
 */
function createTokenProvider(apiHost: string) {
  async function fetchToken(wid?: string): Promise<string> {
    // Determine widget ID from the first next-* element on the page
    const resolvedWid =
      wid || detectFirstWidgetId() || "unknown";

    const mpToken = typeof localStorage !== "undefined"
      ? localStorage.getItem("mpp-widgets_AuthToken")
      : null;

    const body: Record<string, string> = { wid: resolvedWid };
    if (mpToken) body.mpUserToken = mpToken;

    const res = await fetch(`${apiHost}/api/embed/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Token fetch failed" }));
      throw new Error(err.error || "Token fetch failed");
    }

    const data = await res.json();
    return data.token;
  }

  return {
    get: () => fetchToken(),
    refresh: () => fetchToken(),
  };
}

function detectFirstWidgetId(): string | null {
  const widgetMap: Record<string, string> = {
    "NEXT-USER-MENU": "user-menu",
    "NEXT-ADD-TO-CALENDAR": "add-to-calendar",
    "NEXT-FULL-CALENDAR": "full-calendar",
    "NEXT-PROFILE": "profile",
    "NEXT-MY-INVOICES": "invoices",
  };

  for (const [tag, wid] of Object.entries(widgetMap)) {
    if (document.querySelector(tag.toLowerCase())) return wid;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  let readyResolve: (() => void) | undefined;
  window.__nextSDKReady = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  window.__nextSDKReadyResolve = readyResolve;

  // Auto-init: detect host and wire up token provider
  function autoInit() {
    const apiHost = detectApiHost();
    if (apiHost) {
      const provider = createTokenProvider(apiHost);
      window.__nextTokenProvider = provider;
      window.__nextSDKReadyResolve?.();
      return true;
    }
    return false;
  }

  // Try immediately (works when script src is a full URL)
  if (!autoInit()) {
    // Defer until DOM is ready (Vite dev: widget elements aren't parsed yet)
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => autoInit());
    } else {
      // DOM already loaded but no host found — try on next microtask
      // (covers dynamic script injection after DOMContentLoaded)
      queueMicrotask(() => autoInit());
    }
  }

  // Expose global API for manual init (advanced use)
  (window as any).MPNextEmbed = { init };
}

/**
 * Manual init — for advanced use cases where the host page needs to
 * provide its own token provider (e.g. proxying through their backend).
 */
export function init(config: {
  tokenProvider: {
    get: () => Promise<string>;
    refresh?: () => Promise<string>;
  };
}): void {
  if (typeof window !== "undefined") {
    window.__nextTokenProvider = config.tokenProvider;
    window.__nextSDKReadyResolve?.();
  }
}

// Global types
declare global {
  interface Window {
    __nextTokenProvider?: {
      get: () => Promise<string>;
      refresh?: () => Promise<string>;
    };
    __nextSDKReady?: Promise<void>;
    __nextSDKReadyResolve?: () => void;
  }
}
