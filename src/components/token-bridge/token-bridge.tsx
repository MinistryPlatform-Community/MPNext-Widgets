"use client";

import { useEffect } from "react";

export function TokenBridge() {
  useEffect(() => {
    async function bridgeTokens() {
      try {
        const res = await fetch("/api/auth/session-tokens");
        if (!res.ok) return;

        const data = await res.json();
        if (!data.authenticated) return;

        if (data.accessToken) {
          localStorage.setItem("mpp-widgets_AuthToken", data.accessToken);
        }
        if (data.idToken) {
          localStorage.setItem("mpp-widgets_IdToken", data.idToken);
        }
        if (data.refreshToken) {
          localStorage.setItem("mpp-widgets_Refresh", data.refreshToken);
        }
        if (data.expiresAt) {
          const expiresDate = new Date(data.expiresAt * 1000);
          localStorage.setItem("mpp-widgets_ExpiresAfter", expiresDate.toString());
        }
      } catch {
        // Not authenticated or fetch failed — tokens stay absent
      }
    }

    bridgeTokens();

    function handleLogout(e: Event) {
      // Synchronously cancel the event so the widget knows TokenBridge will handle the redirect
      e.preventDefault();

      const detail = (e as CustomEvent).detail as { postLogoutRedirectUri?: string } | undefined;
      const postLogoutRedirectUri = detail?.postLogoutRedirectUri;

      const keys = [
        "mpp-widgets_AuthToken",
        "mpp-widgets_IdToken",
        "mpp-widgets_ExpiresAfter",
        "mpp-widgets_Refresh",
      ];
      keys.forEach((key) => localStorage.removeItem(key));
      try {
        sessionStorage.removeItem("userObj");
      } catch {
        // sessionStorage may be blocked
      }

      (async () => {
        try {
          const res = await fetch("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ postLogoutRedirectUri }),
          });
          const data = await res.json();
          if (data.redirectUrl) {
            window.location.href = data.redirectUrl;
            return;
          }
        } catch {
          // Logout API failed
        }

        window.location.href = "/signin";
      })();
    }

    document.addEventListener("userLogout", handleLogout);

    return () => {
      document.removeEventListener("userLogout", handleLogout);
    };
  }, []);

  return null;
}
