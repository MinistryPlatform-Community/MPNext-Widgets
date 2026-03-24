/**
 * MPNext Embed SDK
 * Web components for embedding MPNext widgets
 */

export { MPNextWidget } from "./shared/base-widget";
export { ApiClient } from "./shared/api-client";
export { UserMenuWidget } from "./components/user-menu";
export { AddToCalendarWidget } from "./components/add-to-calendar";
export { FullCalendarWidget } from "./components/full-calendar";

// Auto-register components
import "./components/user-menu";
import "./components/add-to-calendar";
import "./components/full-calendar";

// Global ready promise that resolves when SDK is initialized
if (typeof window !== "undefined") {
  let readyResolve: (() => void) | null = null;
  (window as any).__nextSDKReady = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  (window as any).__nextSDKReadyResolve = readyResolve;
}

/**
 * Initialize the SDK with token provider
 */
export function init(config: {
  tokenProvider: {
    get: () => Promise<string>;
    refresh?: () => Promise<string>;
  };
}): void {
  console.log("✅ MPNext SDK initialized with token provider");

  if (typeof window !== "undefined") {
    (window as any).__nextTokenProvider = config.tokenProvider;
    console.log("✅ Token provider set on window.__nextTokenProvider");

    // Resolve ready promise
    if ((window as any).__nextSDKReadyResolve) {
      (window as any).__nextSDKReadyResolve();
      console.log("✅ SDK ready promise resolved");
    }
  }

  // Test the token provider immediately
  config.tokenProvider.get()
    .then(token => {
      if (token) {
        console.log("✅ Token provider test successful, token length:", token.length);
      } else {
        console.error("❌ Token provider returned empty token");
      }
    })
    .catch(error => {
      console.error("❌ Token provider test failed:", error);
    });
}

/**
 * Set token provider globally (alternative to init)
 */
if (typeof window !== "undefined") {
  (window as any).MPNextEmbed = {
    init,
    setTokenProvider: (provider: { get: () => Promise<string>; refresh?: () => Promise<string> }) => {
      (window as any).__nextTokenProvider = provider;
    }
  };
}

// Export global types
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
