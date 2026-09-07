import { betterAuth, BetterAuthOptions } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { customSession } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { getAccountCookie } from "better-auth/cookies";
import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";

const mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");

const options = {
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60, // 1 hour cache
      strategy: "jwt" as const,
    },
  },
  account: {
    storeStateStrategy: "cookie" as const,
    storeAccountCookie: true,
  },
  user: {
    additionalFields: {
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
          mapProfileToUser: async (profile) => {
            // Fetch Image_GUID from dp_Users during initial sign-in
            const mp = new MPHelper();
            let imageGuid: string | null = null;

            try {
              const records = await mp.getTableRecords<{ Image_GUID: string }>({
                table: "dp_Users",
                filter: `User_GUID = '${profile.id}'`,
                select:
                  "Contact_ID_TABLE.dp_fileUniqueId AS Image_GUID",
                top: 1,
              });
              imageGuid = records[0]?.Image_GUID || null;
            } catch (error) {
              console.error("mapProfileToUser - Error fetching image GUID:", error);
            }

            return {
              userGuid: profile.id,
              imageGuid,
            } as Record<string, unknown>;
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
