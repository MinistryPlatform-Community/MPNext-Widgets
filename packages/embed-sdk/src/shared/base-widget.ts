/**
 * Base class for MPNext embeddable widgets
 * Handles Shadow DOM, API communication, and token management
 */
export abstract class MPNextWidget extends HTMLElement {
  protected root: ShadowRoot;
  protected apiHost: string;
  protected tenantId: string;
  protected tokenProvider: () => Promise<string>;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });

    // Read config from <script> tag or element attributes
    const scriptTag = document.querySelector<HTMLScriptElement>(
      "script[data-api-host]"
    );
    this.apiHost =
      this.getAttribute("api-host") ||
      scriptTag?.dataset.apiHost ||
      "";
    this.tenantId =
      this.getAttribute("tenant") || scriptTag?.dataset.tenant || "";

    console.log("🔧 Widget constructor - checking for token provider...");
    console.log("window.__nextTokenProvider exists?", !!(window as any).__nextTokenProvider);
    console.log("window.__nextTokenProvider.get exists?", !!(window as any).__nextTokenProvider?.get);

    // Token provider with refresh support
    this.tokenProvider =
      (window as any).__nextTokenProvider?.get ||
      (async () => {
        console.warn("⚠️ No token provider initialized. Call init() before using the widget.");
        return this.getAttribute("token") || "";
      });
  }

  /**
   * Fetch wrapper with automatic token injection and refresh on 401
   */
  protected async fetch(path: string, init?: RequestInit): Promise<Response> {
    // Wait for token provider to be ready (max 5 seconds)
    await this.waitForTokenProvider();

    let token: string;

    try {
      token = await this.tokenProvider();
    } catch (error) {
      console.error("❌ Error getting token from tokenProvider:", error);
      throw new Error(`Failed to get authentication token: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    if (!token) {
      console.error("❌ No token received from tokenProvider");
      console.error("Make sure you called init() with a tokenProvider before mounting the widget");
      throw new Error("Authentication token not available. Did you call init()?");
    }

    console.log("🔑 Token received:", token.substring(0, 20) + "...");

    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
    };

    if (this.tenantId) {
      headers["X-Tenant-ID"] = this.tenantId;
    }

    const res = await fetch(`${this.apiHost}${path}`, {
      ...init,
      headers,
      credentials: "omit",
      mode: "cors",
    });

    // Handle token refresh on 401
    if (res.status === 401 && (window as any).__nextTokenProvider?.refresh) {
      const newToken = await (window as any).__nextTokenProvider.refresh();
      return fetch(`${this.apiHost}${path}`, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          Authorization: `Bearer ${newToken}`,
          "X-Tenant-ID": this.tenantId,
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
      } catch (e) {
        // Fallback for older browsers
        this.injectStyleTag(css);
      }
    } else {
      this.injectStyleTag(css);
    }
  }

  /**
   * Fallback style injection via <style> tag
   */
  private injectStyleTag(css: string): void {
    const style = document.createElement("style");
    style.textContent = css;
    this.root.appendChild(style);
  }

  /**
   * Wait for token provider to be initialized
   */
  private async waitForTokenProvider(): Promise<void> {
    // Wait for SDK ready promise first (if it exists)
    if ((window as any).__nextSDKReady) {
      console.log("⏳ Waiting for SDK initialization...");
      await (window as any).__nextSDKReady;
      console.log("✅ SDK initialization complete");
    }

    // Double-check token provider is available
    const maxWaitTime = 5000; // 5 seconds
    const checkInterval = 100; // Check every 100ms
    const startTime = Date.now();

    while (!(window as any).__nextTokenProvider) {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error("Token provider not initialized after 5 seconds. Make sure init() is called.");
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    // Update token provider reference
    this.tokenProvider = (window as any).__nextTokenProvider.get;
    console.log("✅ Token provider ready");
  }

  /**
   * Emit custom event from widget
   */
  protected emit(eventName: string, detail?: any): void {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Abstract method to be implemented by child widgets
   */
  abstract render(): void;

  /**
   * Lifecycle hook - called when element is added to DOM
   */
  abstract connectedCallback(): void;
}

/**
 * Global token provider interface
 */
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
