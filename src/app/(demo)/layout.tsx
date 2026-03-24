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

  if (!session?.user?.userGuid) {
    redirect("/signin?callbackUrl=/demo");
  }

  const hasAccess = await checkDemoAccess(session.user.userGuid as string);

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
