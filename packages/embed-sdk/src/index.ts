/**
 * MPNext Embed SDK
 *
 * Auto-initializing Web Components for embedding MPNext widgets.
 *
 * Usage — just load the script and drop in widgets:
 *
 *   <script type="module" src="https://your-host.com/embed-sdk/next-embed.js"></script>
 *   <next-user-menu mp-base-url="https://mp.church.com"></next-user-menu>
 *
 * The SDK detects its own host, auto-registers a token provider that calls
 * /api/embed/session, and resolves the ready promise so widgets can fetch.
 */

export { MPNextWidget } from "./shared/base-widget";
export { ApiClient } from "./shared/api-client";
export {
  AuthSession,
  getAuthSession,
  SID_KEY,
  LEGACY_TOKEN_KEY,
  type AuthConfig,
  type EmbedAuthMode,
  type AuthSessionUser,
  type MeResponse,
} from "./shared/auth-session";
import { getAuthSession } from "./shared/auth-session";
import {
  disablePseudoLocale,
  enablePseudoLocale,
  getLocaleSession,
  setOverrides,
  type LocaleCode,
  type OverrideScope,
} from "./i18n";
export { UserMenuWidget } from "./components/user-menu";
export { AddToCalendarWidget } from "./components/add-to-calendar";
export { FullCalendarWidget } from "./components/full-calendar";
export { ProfileWidget } from "./components/profile";
export { MyInvoicesWidget } from "./components/my-invoices";
export { MyContributionStatementWidget } from "./components/my-contribution-statement";
export { StatementPreferencesWidget } from "./components/statement-preferences";
export { MyGivingWidget } from "./components/my-giving";
export { MyHouseholdWidget } from "./components/my-household";
export { MyPledgesWidget } from "./components/my-pledges";
export { MyGroupsWidget } from "./components/my-groups";
export { SubscriptionsWidget } from "./components/subscriptions";
export { EventFinderWidget } from "./components/event-finder";
export { EventDetailsWidget } from "./components/event-details";
export { GroupFinderWidget } from "./components/group-finder";
export { GroupDetailsWidget } from "./components/group-details";
export { OpportunityFinderWidget } from "./components/opportunity-finder";
export { OpportunityDetailsWidget } from "./components/opportunity-details";
export { PlanYourVisitWidget } from "./components/plan-your-visit";
export { OnlineDirectoryWidget } from "./components/online-directory";
export { PledgeCampaignWidget } from "./components/pledge-campaign";
export { CustomFormWidget } from "./components/custom-form";
export { CheckoutWidget } from "./components/checkout";
export { PayWidget } from "./components/pay";
export { CheckoutCompleteWidget } from "./components/checkout-complete";
export { LocaleSelectorWidget } from "./components/locale-selector";

// Localisation. Host pages reach these through `window.MPNextEmbed`; widgets
// reach them through `this.t` / `this.fmt` on the base class.
export {
  getLocaleSession,
  LocaleSession,
  resolveLocale,
  isSupportedLocale,
  endonym,
  setOverrides,
  enablePseudoLocale,
  disablePseudoLocale,
  LOCALE_CODES,
  DEFAULT_LOCALE,
  LOCALE_KEY,
  type LocaleCode,
} from "./i18n";

// Auto-register components
import "./components/user-menu";
import "./components/add-to-calendar";
import "./components/full-calendar";
import "./components/profile";
import "./components/my-invoices";
import "./components/my-contribution-statement";
import "./components/statement-preferences";
import "./components/my-giving";
import "./components/my-household";
import "./components/my-pledges";
import "./components/my-groups";
import "./components/subscriptions";
import "./components/event-finder";
import "./components/event-details";
import "./components/group-finder";
import "./components/group-details";
import "./components/opportunity-finder";
import "./components/opportunity-details";
import "./components/plan-your-visit";
import "./components/online-directory";
import "./components/pledge-campaign";
import "./components/custom-form";
import "./components/checkout";
import "./components/pay";
import "./components/checkout-complete";
import "./components/locale-selector";

// ---------------------------------------------------------------------------
// Auto-initialization
// ---------------------------------------------------------------------------

/**
 * Derive the API host from the script's own URL.
 * e.g. https://your-host.com/embed-sdk/next-embed.js → https://your-host.com
 */
function detectApiHost(): string {
  if (typeof document === "undefined") return "";

  // 1. Set by the cache-busting loader (next-embed.js)
  if ((window as any).__nextEmbedApiHost) {
    return (window as any).__nextEmbedApiHost;
  }

  // 2. Currently executing script (works for direct <script src="https://...">)
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.src) {
    try {
      return new URL(current.src).origin;
    } catch { /* fall through */ }
  }

  // 3. Find our script tag by filename
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[src*="next-embed"]',
  );
  for (const s of scripts) {
    try {
      return new URL(s.src).origin;
    } catch { /* continue */ }
  }

  // 4. Read api-host from the first widget element on the page
  //    (handles Vite dev where the SDK is a local module import)
  const widget = document.querySelector(
    "next-user-menu, next-add-to-calendar, next-full-calendar, next-profile, next-my-invoices, next-my-contribution-statement, next-statement-preferences, next-my-giving, next-my-household, next-my-pledges, next-my-groups, next-subscriptions, next-event-finder, next-event-details, next-group-finder, next-group-details, next-opportunity-finder, next-opportunity-details, next-plan-your-visit, next-online-directory, next-pledge-campaign, next-custom-form, next-checkout, next-pay, next-checkout-complete, next-locale-selector",
  );
  if (widget) {
    const host = widget.getAttribute("api-host");
    if (host) return host;
  }

  return "";
}

/**
 * Built-in token provider. Delegates to the page-wide AuthSession, which owns
 * mode discovery, the sid, the handoff exchange, the legacy silent-upgrade and
 * the in-memory JWT cache.
 */
function createTokenProvider(apiHost: string) {
  // Determine widget ID from the first next-* element on the page
  const resolveWid = () => detectFirstWidgetId() || "unknown";

  return {
    get: () => getAuthSession(apiHost).getToken(resolveWid()),
    refresh: () => getAuthSession(apiHost).refreshToken(resolveWid()),
  };
}

function detectFirstWidgetId(): string | null {
  const widgetMap: Record<string, string> = {
    "NEXT-USER-MENU": "user-menu",
    "NEXT-ADD-TO-CALENDAR": "add-to-calendar",
    "NEXT-FULL-CALENDAR": "full-calendar",
    "NEXT-PROFILE": "profile",
    "NEXT-MY-INVOICES": "invoices",
    "NEXT-MY-CONTRIBUTION-STATEMENT": "contribution-statements",
    "NEXT-STATEMENT-PREFERENCES": "statement-preferences",
    "NEXT-MY-GIVING": "my-giving",
    "NEXT-MY-HOUSEHOLD": "my-household",
    "NEXT-MY-PLEDGES": "my-pledges",
    "NEXT-MY-GROUPS": "my-groups",
    "NEXT-SUBSCRIPTIONS": "subscriptions",
    "NEXT-EVENT-FINDER": "event-finder",
    "NEXT-EVENT-DETAILS": "event-details",
    "NEXT-GROUP-FINDER": "group-finder",
    "NEXT-GROUP-DETAILS": "group-details",
    "NEXT-OPPORTUNITY-FINDER": "opportunity-finder",
    "NEXT-OPPORTUNITY-DETAILS": "opportunity-details",
    "NEXT-PLAN-YOUR-VISIT": "plan-your-visit",
    "NEXT-ONLINE-DIRECTORY": "online-directory",
    "NEXT-PLEDGE-CAMPAIGN": "pledge-campaign",
    "NEXT-CUSTOM-FORM": "custom-form",
    "NEXT-CHECKOUT": "checkout",
    "NEXT-PAY": "pay",
    "NEXT-CHECKOUT-COMPLETE": "checkout-complete",
    // Present for host detection only: this widget needs no token and calls no
    // API, so it never actually requests one.
    "NEXT-LOCALE-SELECTOR": "locale-selector",
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
      // Returned from the OAuth callback with #nextwidgets_auth=<code>: exchange it now
      // (single-use, 60s TTL) instead of waiting for the first widget fetch.
      const session = getAuthSession(apiHost);
      if (session.hasPendingHandoff()) {
        void provider.get().catch(() => {});
      }
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

  // Expose global API for manual init (advanced use), the auth session and the
  // locale layer.
  (window as any).MPNextEmbed = {
    init,
    getAuthSession,
    getLocaleSession,

    /**
     * Force the widget language, overriding `<html lang>`, the visitor's stored
     * choice and the browser preference. Persists, and re-renders every mounted
     * widget once the catalogue is in hand.
     */
     setLocale: (locale: string) => getLocaleSession().setLocale(locale),

    /** The resolved language for this page. */
    getLocale: () => getLocaleSession().getLocale(),

    /**
     * Override individual labels — a church renaming "Groups" to "Small
     * Groups", which is a different thing from translating. Scope `"*"` applies
     * to every language; a locale code applies to one. Overrides beat both the
     * locale catalogue and the English fallback.
     *
     *   MPNextEmbed.setMessages("es", { "groupFinder.title": "Grupos Pequeños" });
     *   MPNextEmbed.setMessages("*",  { "common.signIn": "Member Login" });
     */
    setMessages: (scope: string, messages: Record<string, string | null>) =>
      setOverrides(scope as OverrideScope, messages),

    /**
     * Development aid: re-render every string accented and padded, so
     * unextracted literals stand out as plain ASCII and layouts that cannot
     * take the 20-30% expansion Spanish and Portuguese cost break visibly.
     */
    enablePseudoLocale,
    disablePseudoLocale,
  };
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
    __nextEmbedApiHost?: string;
    __nextEmbedBaseUrl?: string;
    __nextEmbedCSSUrl?: string;
  }
}
