"use client";

import { useEffect, useState, Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { useSearchParams } from "next/navigation";

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") || "/";
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the sign-in effect when the user clicks "Retry".
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function startSignIn() {
      try {
        const { data: session } = await authClient.getSession();
        if (cancelled) {
          return;
        }
        if (session) {
          window.location.href = callbackUrl;
          return;
        }
        await authClient.signIn.oauth2({
          providerId: "ministry-platform",
          callbackURL: callbackUrl,
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Sign-in failed:", err);
        setError(
          "We couldn't reach the sign-in service. Please check your connection and try again.",
        );
      }
    }

    void startSignIn();

    return () => {
      cancelled = true;
    };
  }, [callbackUrl, attempt]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md px-4">
          <h2 className="text-2xl font-semibold mb-4">Sign-in unavailable</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Retry sign-in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-4">Redirecting to sign in...</h2>
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto"></div>
      </div>
    </div>
  );
}

function SignInFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-4">Loading...</h2>
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto"></div>
      </div>
    </div>
  );
}

export default function SignIn() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInContent />
    </Suspense>
  );
}
