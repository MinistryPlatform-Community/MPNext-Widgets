"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestAppLogout } from "@/lib/app-logout";

export function TokenBridge() {
  const router = useRouter();

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

      (async () => {
        // Shared with the `/demo` header's Sign Out button: clears the
        // `mpp-widgets_*` copies, ends the Better Auth session and hands back
        // MP's end-session URL. See `src/lib/app-logout.ts`.
        //
        // The widget's `postLogoutRedirectUri` (its own page URL) is
        // deliberately NOT forwarded: it is not registered on the MP OAuth
        // client, and passing it is what left the MP session alive behind a
        // "Would you like to logout?" prompt (TODO 29). Same-origin logouts
        // land on the registered `/signin` instead.
        const redirectUrl = await requestAppLogout();
        if (redirectUrl) {
          // Cross-origin, top-level navigation to MinistryPlatform's OIDC end-session
          // endpoint. Must stay a raw location assignment — router.push() cannot
          // leave the origin.
          window.location.href = redirectUrl;
          return;
        }

        router.push("/signin");
      })();
    }

    document.addEventListener("userLogout", handleLogout);

    return () => {
      document.removeEventListener("userLogout", handleLogout);
    };
  }, [router]);

  return null;
}
