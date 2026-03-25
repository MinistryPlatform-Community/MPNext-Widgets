/**
 * Base class for MPNext embeddable widgets
 * Handles Shadow DOM, API communication, and token management
 */
export abstract class MPNextWidget extends HTMLElement {
  protected root: ShadowRoot;
  protected apiHost: string;
  protected tokenProvider: () => Promise<string>;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });

    // Determine API host: element attribute → script tag origin → empty
    this.apiHost =
      this.getAttribute("api-host") ||
      this.detectApiHostFromScript() ||
      "";

    // Token provider — resolved lazily via waitForTokenProvider()
    this.tokenProvider =
      window.__nextTokenProvider?.get ||
      (async () => {
        console.warn("No token provider initialized.");
        return this.getAttribute("token") || "";
      });
  }

  /**
   * Derive the API host from the SDK script's own URL.
   */
  private detectApiHostFromScript(): string {
    // Prefer host set by the cache-busting loader
    if ((window as any).__nextEmbedApiHost) {
      return (window as any).__nextEmbedApiHost;
    }

    const scripts = document.querySelectorAll<HTMLScriptElement>(
      'script[src*="next-embed"]',
    );
    for (const s of scripts) {
      try {
        return new URL(s.src).origin;
      } catch { /* continue */ }
    }
    return "";
  }

  /**
   * Fetch wrapper with automatic token injection and refresh on 401
   */
  protected async fetch(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    await this.waitForTokenProvider();

    const token = await this.tokenProvider();

    if (!token) {
      throw new Error("Authentication token not available.");
    }

    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
    };

    const res = await fetch(`${this.apiHost}${path}`, {
      ...init,
      headers,
      credentials: "omit",
      mode: "cors",
    });

    // Handle token refresh on 401
    if (res.status === 401 && window.__nextTokenProvider?.refresh) {
      const newToken = await window.__nextTokenProvider.refresh();
      return fetch(`${this.apiHost}${path}`, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          Authorization: `Bearer ${newToken}`,
        },
        credentials: "omit",
        mode: "cors",
      });
    }

    return res;
  }

  /**
   * Inject CSS into Shadow DOM
   * Uses Constructable Stylesheets when available, fallback to <style> tag
   */
  protected injectStyles(css: string): void {
    if (
      "adoptedStyleSheets" in Document.prototype &&
      "replace" in CSSStyleSheet.prototype
    ) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        this.root.adoptedStyleSheets = [sheet];
      } catch {
        this.injectStyleTag(css);
      }
    } else {
      this.injectStyleTag(css);
    }
  }

  private injectStyleTag(css: string): void {
    const style = document.createElement("style");
    style.textContent = css;
    this.root.appendChild(style);
  }

  /**
   * Wait for token provider to be initialized (max 5 seconds)
   */
  private async waitForTokenProvider(): Promise<void> {
    if (window.__nextSDKReady) {
      await window.__nextSDKReady;
    }

    const maxWait = 5000;
    const interval = 100;
    const start = Date.now();

    while (!window.__nextTokenProvider) {
      if (Date.now() - start > maxWait) {
        throw new Error(
          "Token provider not initialized after 5 seconds.",
        );
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    this.tokenProvider = window.__nextTokenProvider.get;
  }

  /**
   * Emit custom event from widget
   */
  protected emit(eventName: string, detail?: unknown): void {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  abstract render(): void;
  abstract connectedCallback(): void;
}

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
