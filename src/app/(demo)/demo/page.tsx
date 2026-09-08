import { getCachedSession } from "@/lib/auth-session";
import { headers } from "next/headers";
import { widgetCategoryOrder } from "@mpnext/types";
import { getWidgetsByCategory } from "./_lib/widget-catalog";
import { DemoCard } from "./_components/demo-card";
import { SignOutButton } from "@/components/sign-out-button";

const categoryOrder = widgetCategoryOrder;

export default async function DemoCatalogPage() {
  // Cached read on purpose: this is the display name in the header, and
  // `(demo)/layout.tsx` has already made the authoritative access decision for
  // this render. Keeping item 14's optimisation here is why the authoritative
  // read costs one extra store GET per page, not two.
  const session = await getCachedSession(await headers());
  const grouped = getWidgetsByCategory();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-[#004C97]">Widget Demo Library</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{session?.user?.name}</span>
          {/* Sign-out cannot be a link: Better Auth's `/sign-out` is POST-only
              (a GET 404s), and ending the Better Auth session alone leaves the
              MP IdP session alive to sign the user straight back in. The
              button POSTs `/api/auth/logout`, which ends both. */}
          <SignOutButton />
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
