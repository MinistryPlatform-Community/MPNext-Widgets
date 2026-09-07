import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkDemoAccess } from "./demo/_lib/check-demo-access";
import { AccessDenied } from "./demo/_components/access-denied";
import { MPWidgetsLoader } from "./demo/_components/mp-widgets-loader";

export const metadata = {
  title: "Widget Demo Library | MPNext",
  description: "QA testing environment for MPNext embed widgets",
};

export default async function DemoLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth.api.getSession({ headers: await headers() });

  // Only a genuinely unauthenticated request goes to /signin. Anything else
  // would loop: /signin sees a valid session and sends the user straight back.
  if (!session?.user) {
    redirect("/signin?callbackUrl=/demo");
  }

  const userGuid = session.user.userGuid as string | null | undefined;

  // Signed in, but the session is missing the field the access check needs.
  // Redirecting here is what used to spin the browser forever, so render an
  // explanation instead and make the cause visible in the server log.
  if (!userGuid) {
    console.error(
      "DemoLayout: session has a user but no `userGuid`; cannot check demo access. " +
        "Expected `databaseHooks.user.create/update.before` in src/lib/auth.ts to " +
        "populate it from the MP profile. " +
        `userId=${session.user.id ?? "(none)"}`,
    );
    return (
      <div className="min-h-screen bg-gray-50">
        <AccessDenied
          icon="⚠️"
          title="Profile Incomplete"
          message="You're signed in, but your MinistryPlatform user ID is missing from this session, so demo access can't be verified. Sign out and back in; if it keeps happening, contact your administrator."
        />
      </div>
    );
  }

  const hasAccess = await checkDemoAccess(userGuid);

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AccessDenied />
      </div>
    );
  }

  const mpBaseUrl = (process.env.MINISTRY_PLATFORM_BASE_URL || "")
    .replace(/\/ministryplatformapi\/?$/, "");

  return (
    <div className="min-h-screen bg-gray-50">
      <MPWidgetsLoader mpBaseUrl={mpBaseUrl} />
      {children}
    </div>
  );
}
