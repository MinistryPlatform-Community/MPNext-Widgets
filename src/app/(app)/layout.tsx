import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { SessionProvider } from "@/components/session-provider";
import { TokenBridge } from "@/components/token-bridge";
import Script from "next/script";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <SessionProvider session={session ?? null}>
      <Script src="/embed-sdk/next-embed.es.js" type="module" strategy="beforeInteractive" />
      <TokenBridge />
      <div className="flex min-h-screen flex-col">
        <main className="flex-1">{children}</main>
      </div>
    </SessionProvider>
  );
}
