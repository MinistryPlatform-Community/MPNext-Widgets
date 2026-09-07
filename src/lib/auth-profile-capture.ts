import { AsyncLocalStorage } from "node:async_hooks";

/**
 * MP identity fields that belong on the Better Auth user row but must never be
 * settable by a client: `userGuid` is an authorization input (see
 * `src/app/(demo)/demo/_lib/check-demo-access.ts`, which resolves it to a
 * `dp_Users.User_ID` and checks group membership).
 */
export interface MpProfileFields {
  userGuid: string;
  imageGuid: string | null;
}

interface CaptureStore {
  profile: MpProfileFields | null;
}

const storage = new AsyncLocalStorage<CaptureStore>();

/**
 * Runs `fn` with a request-scoped slot for the MP OAuth profile.
 *
 * Better Auth resolves the provider profile (`mapProfileToUser`) and creates
 * the user row (`databaseHooks.user.create.before`) inside the same endpoint
 * invocation, but gives us no supported channel to carry data between the two:
 * `parseAdditionalUserInputFromProviderProfile` deletes every additional field
 * declared `input: false` from the provider profile before the user is built.
 * This async-local slot is that channel, and being request-scoped it cannot
 * leak one signer-in's GUID onto another's row the way a module-level cache
 * keyed by email could.
 *
 * Wrapped around the Better Auth route handler in
 * `src/app/api/auth/[...all]/route.ts`.
 */
export function runWithMpProfileCapture<T>(fn: () => T): T {
  return storage.run({ profile: null }, fn);
}

/**
 * Records the MP identity resolved from the OAuth provider profile for the
 * current request. No-op (with a warning) outside `runWithMpProfileCapture`.
 */
export function captureMpProfile(profile: MpProfileFields): void {
  const store = storage.getStore();
  if (!store) {
    // Never log the GUID itself -- it is an authorization input.
    console.warn(
      "captureMpProfile: called outside runWithMpProfileCapture; " +
        "userGuid/imageGuid will not be persisted for this request.",
    );
    return;
  }
  store.profile = profile;
}

/** Reads back what `captureMpProfile` stored for the current request. */
export function getCapturedMpProfile(): MpProfileFields | null {
  return storage.getStore()?.profile ?? null;
}
