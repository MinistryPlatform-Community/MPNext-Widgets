"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestAppLogout } from "@/lib/app-logout";

interface SignOutButtonProps {
  /** Tailwind classes for the control. Defaults to the `/demo` header style. */
  className?: string;
  /** Button text while idle. */
  label?: string;
}

const DEFAULT_CLASS =
  "rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Signs the user out of both the Better Auth session and the MP IdP session.
 *
 * This has to be a button, not a link. Better Auth registers `/sign-out` as
 * POST-only, so the anchor this replaced 404'd and left the user signed in
 * (TODO 27) — and even a POST to that endpoint would only end the app session,
 * leaving MP to sign the user straight back in on the next `/demo` visit.
 * `requestAppLogout` is the single logout path shared with `TokenBridge`.
 */
export function SignOutButton({ className = DEFAULT_CLASS, label = "Sign Out" }: SignOutButtonProps = {}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);

    const redirectUrl = await requestAppLogout();
    if (redirectUrl) {
      // Cross-origin, top-level navigation to MinistryPlatform's OIDC
      // end-session endpoint — router.push() cannot leave the origin.
      window.location.href = redirectUrl;
      return;
    }

    // No MP end-session URL: the Better Auth session is still gone, so send
    // the user to /signin rather than leaving them on a page they can no
    // longer load. `refresh()` drops the cached RSC payload for /demo.
    setPending(false);
    router.push("/signin");
    router.refresh();
  }

  return (
    <button type="button" onClick={() => void signOut()} disabled={pending} className={className}>
      {pending ? "Signing out…" : label}
    </button>
  );
}
