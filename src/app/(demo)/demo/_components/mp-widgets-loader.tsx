"use client";

import { useEffect } from "react";

/**
 * Loads MPWidgets.js on the client side and re-dispatches DOMContentLoaded
 * to trigger the polyfill's custom element registration.
 */
export function MPWidgetsLoader({ mpBaseUrl }: { mpBaseUrl: string }) {
  useEffect(() => {
    if (!mpBaseUrl) return;

    const scriptId = "MPWidgets";
    if (document.getElementById(scriptId)) return;

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `${mpBaseUrl}/widgets/dist/MPWidgets.js`;
    script.async = true;
    script.onload = () => {
      // Re-dispatch DOMContentLoaded to trigger mpp-* element registration
      if (!customElements.get("mpp-user-login")) {
        document.dispatchEvent(new Event("DOMContentLoaded"));
      }
    };
    document.head.appendChild(script);
  }, [mpBaseUrl]);

  return null;
}
