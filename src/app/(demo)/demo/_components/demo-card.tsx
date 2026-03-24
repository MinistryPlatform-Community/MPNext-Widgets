import Link from "next/link";
import type { WidgetConfig } from "../_lib/widget-catalog";

const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  Public: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  Authenticated: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  "Staff / Admin": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  Authentication: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
};

export function DemoCard({ widget }: { widget: WidgetConfig }) {
  const colors = categoryColors[widget.category] ?? categoryColors.Public;

  return (
    <Link
      href={`/demo/${widget.slug}`}
      className="group block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-[#004C97] hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold text-[#2D2926] group-hover:text-[#004C97]">
          {widget.title}
        </h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text} ${colors.border}`}
        >
          {widget.category}
        </span>
      </div>
      <p className="mb-3 text-sm text-gray-600 line-clamp-2">{widget.description}</p>
      <code className="text-xs text-gray-400">&lt;{widget.tag}&gt;</code>
    </Link>
  );
}
