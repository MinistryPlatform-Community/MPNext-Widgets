import { notFound } from "next/navigation";
import Link from "next/link";
import { getWidgetBySlug, widgetCatalog } from "../_lib/widget-catalog";
import { generateInitToken } from "@/lib/embed/config";
import { WidgetDemo } from "../_components/widget-demo";

// Pre-generate all widget slugs at build time
export function generateStaticParams() {
  return widgetCatalog.map((w) => ({ slug: w.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const widget = getWidgetBySlug(slug);
  return {
    title: widget ? `${widget.title} Demo | MPNext` : "Widget Demo",
  };
}

export default async function WidgetDemoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const widget = getWidgetBySlug(slug);

  if (!widget) {
    notFound();
  }

  const tenantId =
    process.env.NODE_ENV === "production" ? "mpnext-prod" : "mpnext-dev";
  const initToken = generateInitToken(tenantId);
  const apiHost = process.env.NEXTAUTH_URL || "http://localhost:3000";
  // mp-base-url for widgets is the MP host without /ministryplatformapi path
  const mpBaseUrlRaw = process.env.MINISTRY_PLATFORM_BASE_URL || "https://my.northwoods.church";
  const mpBaseUrl = mpBaseUrlRaw.replace(/\/ministryplatformapi\/?$/, "");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/demo"
        className="mb-4 inline-block text-sm text-[#004C97] hover:underline"
      >
        &larr; All Widgets
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#004C97]">{widget.title}</h1>
        <p className="mt-1 text-gray-600">{widget.description}</p>
        <code className="mt-2 inline-block text-xs text-gray-400">
          &lt;{widget.tag}&gt;
        </code>
      </div>

      <WidgetDemo
        widget={widget}
        initToken={initToken}
        tenantId={tenantId}
        apiHost={apiHost}
        mpBaseUrl={mpBaseUrl}
      />
    </div>
  );
}
