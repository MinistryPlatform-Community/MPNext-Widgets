import { betterAuth, BetterAuthOptions } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { customSession } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { getAccountCookie } from "better-auth/cookies";
import { MPHelper } from "@/lib/providers/ministry-platform";
import {
  captureMpProfile,
  getCapturedMpProfile,
} from "@/lib/auth-profile-capture";
import { getEnv } from "@/lib/env";
import { betterAuthSecondaryStorage } from "@/lib/auth-secondary-storage";

const mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");

const options = {
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // No `database`, on purpose. Better Auth 1.7 serves the entire session path
  // -- create / find / update / delete / list, with a denormalised copy of the
  // user row (additional fields included) -- from `secondaryStorage` when one
  // is set, and never reads the adapter for it. That is what makes a sign-in
  // outlive a restart or an instance switch, which the in-process memory
  // adapter could not. The remaining `user` / `account` rows stay ephemeral
  // and that is correct here; the full argument, with the better-auth source
  // it rests on, is in `src/lib/auth-secondary-storage.ts`.
  //
  // This is the same Upstash Redis the widget sessions use
  // (`EMBED_SESSION_STORE_URL` / `_TOKEN`); unset, it degrades to the same
  // in-memory store, which is dev-only.
  secondaryStorage: betterAuthSecondaryStorage(),
  session: {
    cookieCache: {
      enabled: true,
      // Better Auth's own default. It was 1h while the store was in-process
      // memory, because a store read was as likely to lose the session as to
      // find it -- the cache WAS the session. With a shared store the cache is
      // just a read optimisation, and its real cost is revocation lag: a
      // signed-out or revoked session keeps authorizing until the cached
      // cookie expires. 5 minutes bounds that to the same window as the widget
      // JWT, at the price of one Redis GET per user per 5 minutes.
      maxAge: 60 * 5,
      strategy: "jwt" as const,
    },
  },
  account: {
    storeStateStrategy: "cookie" as const,
    storeAccountCookie: true,
  },
  user: {
    additionalFields: {
      // `input: false` keeps both fields non-writable from the client:
      // Better Auth's `parseUserInput` rejects them outright on `updateUser`
      // (FIELD_NOT_ALLOWED). `userGuid` is an authorization input --
      // `src/app/(demo)/layout.tsx` feeds it to `checkDemoAccess`, which
      // resolves it to a `dp_Users.User_ID` and checks group membership -- so
      // a client that could set its own `userGuid` could impersonate another
      // MP user. They are populated server-side by the `databaseHooks` below.
      userGuid: {
        type: "string" as const,
        required: false,
        input: false,
      },
      imageGuid: {
        type: "string" as const,
        required: false,
        input: false,
      },
    },
  },
  // Write the MP identity captured in `mapProfileToUser` straight onto the
  // user record. A `databaseHooks` `before` hook's returned `data` is merged
  // into the row after `parseAdditionalUserInputFromProviderProfile` has
  // already stripped every `input: false` field out of the provider profile,
  // so this is the only place the values survive -- and it is server-side
  // only, so the fields stay unsettable by a client. Both hooks no-op unless
  // an MP OAuth profile was captured earlier in the same request, which means
  // an ordinary `updateUser` call cannot reach them.
  databaseHooks: {
    user: {
      create: {
        before: async () => {
          const profile = getCapturedMpProfile();
          if (!profile) return;
          return {
            data: {
              userGuid: profile.userGuid,
              imageGuid: profile.imageGuid,
            },
          };
        },
      },
      update: {
        // Refreshes an existing row on every sign-in. Requires
        // `overrideUserInfo: true` on the provider below -- without it Better
        // Auth never calls `updateUser` for a returning OAuth user, so a row
        // created before this fix would keep its NULL `userGuid` forever.
        before: async () => {
          const profile = getCapturedMpProfile();
          if (!profile) return;
          return {
            data: {
              userGuid: profile.userGuid,
              imageGuid: profile.imageGuid,
            },
          };
        },
      },
    },
  },
  plugins: [
    genericOAuth({
      config: [
        {
          // Also the `:id` in Better Auth's `/callback/:id` route, so this is
          // the trailing segment of the redirect URI registered on the MP
          // OAuth client: {BETTER_AUTH_URL}/api/auth/callback/ministryplatform
          providerId: "ministryplatform",
          discoveryUrl: `${mpBaseUrl}/oauth/.well-known/openid-configuration`,
          clientId: process.env.OIDC_CLIENT_ID || getEnv("MINISTRY_PLATFORM_CLIENT_ID"),
          clientSecret: process.env.OIDC_CLIENT_SECRET || getEnv("MINISTRY_PLATFORM_CLIENT_SECRET"),
          scopes: [
            "openid",
            "offline_access",
            "http://www.thinkministry.com/dataplatform/scopes/all",
          ],
          // MP rejects PKCE. Must stay explicit: Better Auth 1.7 flipped the
          // default to true.
          pkce: false,
          // Re-run the profile mapping (and therefore the `user.update.before`
          // hook) on every sign-in, not just at sign-up. MP is the source of
          // truth for name/email, and this is what lets an existing user row
          // pick up a `userGuid`/`imageGuid` it was created without.
          overrideUserInfo: true,
          // Better Auth 1.7 drives RP-initiated logout from the discovery
          // document's end_session_endpoint on signOut(). We already hand-roll
          // that in /api/auth/logout, so leave it to us and avoid two redirects.
          disableProviderLogout: true,
          authorizationUrlParams: {
            realm: "realm",
          },
          getUserInfo: async (tokens) => {
            const response = await fetch(
              `${mpBaseUrl}/oauth/connect/userinfo`,
              {
                headers: {
                  Authorization: `Bearer ${tokens.accessToken}`,
                },
              },
            );

            if (!response.ok) {
              console.error(
                "getUserInfo - Failed to fetch user info:",
                response.status,
              );
              return null;
            }

            const profile = await response.json();

            return {
              // Better Auth 1.7 derives the stable account id from `sub` for
              // OIDC-discovery providers (MP advertises
              // id_token_signing_alg_values_supported, so it takes that branch)
              // and from `id` otherwise. Return both: omitting `sub` resolves
              // the subject to "" and sign-in fails with
              // OAUTH_ACCOUNT_SUBJECT_INVALID.
              sub: profile.sub,
              id: profile.sub,
              email: profile.email,
              name: `${profile.given_name} ${profile.family_name}`,
              image: undefined,
              emailVerified: true,
            };
          },
          // Resolves the MP identity for this sign-in and hands it to the
          // `databaseHooks` above. Returning the fields from here does NOT
          // work: `parseAdditionalUserInputFromProviderProfile`
          // (better-auth/db) drops every additional field declared
          // `input: false` from the provider profile before the user row is
          // built, which is why `userGuid`/`imageGuid` used to arrive on the
          // session as `undefined` with nothing logged. Return an empty object
          // so no `input: false` field is ever offered as input.
          mapProfileToUser: async (profile) => {
            const userGuid =
              typeof profile.id === "string" && profile.id.length > 0
                ? profile.id
                : null;

            if (!userGuid) {
              console.error(
                "mapProfileToUser - MP profile has no subject; userGuid unavailable",
              );
              return {};
            }

            // Fetch Image_GUID from dp_Users during sign-in
            const mp = new MPHelper();
            let imageGuid: string | null = null;

            try {
              const records = await mp.getTableRecords<{ Image_GUID: string }>({
                table: "dp_Users",
                filter: `User_GUID = '${userGuid}'`,
                select:
                  "Contact_ID_TABLE.dp_fileUniqueId AS Image_GUID",
                top: 1,
              });
              imageGuid = records[0]?.Image_GUID || null;
            } catch (error) {
              console.error("mapProfileToUser - Error fetching image GUID:", error);
            }

            captureMpProfile({ userGuid, imageGuid });

            return {};
          },
        },
      ],
    }),
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...options,
  plugins: [
    ...(options.plugins ?? []),
    customSession(
      async ({ user, session }, ctx) => {
        // Surface OAuth tokens from the account cookie onto the session
        // so API routes (session-tokens, embed/session) can access them.
        // With cookieCache enabled (1hr), this only runs when cache expires.
        let accessToken: string | null = null;
        let refreshToken: string | null = null;
        let idToken: string | null = null;
        let expiresAt: number | null = null;

        try {
          const account = await getAccountCookie(ctx);
          if (account) {
            accessToken = account.accessToken ?? null;
            refreshToken = account.refreshToken ?? null;
            idToken = account.idToken ?? null;
            expiresAt = account.accessTokenExpiresAt
              ? Math.floor(
                  new Date(account.accessTokenExpiresAt).getTime() / 1000,
                )
              : null;
          }
        } catch {
          // Account cookie may not be present (e.g. during initial setup)
        }

        return {
          user: {
            ...user,
            firstName: user.name?.split(" ")[0] || "",
            lastName: user.name?.split(" ").slice(1).join(" ") || "",
          },
          session: {
            ...session,
            accessToken,
            refreshToken,
            idToken,
            expiresAt,
          },
        };
      },
      options,
    ),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
