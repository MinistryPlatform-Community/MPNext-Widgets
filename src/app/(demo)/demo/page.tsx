import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getWidgetsByCategory, type WidgetCategory } from "./_lib/widget-catalog";
import { DemoCard } from "./_components/demo-card";

const categoryOrder: WidgetCategory[] = [
  "Public",
  "Authenticated",
  "Authentication",
  "Staff / Admin",
];

export default async function DemoCatalogPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const grouped = getWidgetsByCategory();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-[#004C97]">Widget Demo Library</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{session?.user?.name}</span>
          {/* Sign-out targets an API route, not a page — a full navigation is
              required and next/link must not prefetch it. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/auth/sign-out"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Sign Out
          </a>
        </div>
      </div>
      <p className="mt-2 mb-8 text-gray-600">
        Select a widget to view its interactive demo, test events, and copy embed code.
      </p>

      {categoryOrder.map((category) => {
        const widgets = grouped[category];
        if (!widgets.length) return null;
        return (
          <section key={category} className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-[#002855]">{category}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {widgets.map((widget) => (
                <DemoCard key={widget.slug} widget={widget} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
