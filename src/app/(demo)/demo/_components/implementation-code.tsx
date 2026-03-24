"use client";

import { useState } from "react";
import type { WidgetConfig } from "../_lib/widget-catalog";

export function ImplementationCode({ widget }: { widget: WidgetConfig }) {
  const [copiedWidget, setCopiedWidget] = useState(false);
  const [copiedSetup, setCopiedSetup] = useState(false);

  const widgetCode = `${widget.implementationCode}

<!-- Listen to events (optional) -->
<script>
  const widget = document.querySelector("${widget.tag}");
${widget.events.map((e) => `  widget.addEventListener("${e}", (e) => console.log("${e}:", e.detail));`).join("\n")}
</script>`;

  const universalSetup = `<!-- Load MPNext Embed SDK (auto-initializes) -->
<script type="module" src="https://your-host.com/embed-sdk/next-embed.es.js"></script>`;

  async function handleCopyWidget() {
    await navigator.clipboard.writeText(widgetCode);
    setCopiedWidget(true);
    setTimeout(() => setCopiedWidget(false), 2000);
  }

  async function handleCopySetup() {
    await navigator.clipboard.writeText(universalSetup);
    setCopiedSetup(true);
    setTimeout(() => setCopiedSetup(false), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Widget-specific code */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-[#002855]">
            Widget Code
            <span className="ml-2 text-xs font-normal text-gray-500">
              Add this to any page where you want this widget
            </span>
          </h3>
          <button
            onClick={handleCopyWidget}
            className="rounded bg-[#004C97] px-3 py-1 text-xs font-medium text-white hover:bg-[#002855]"
          >
            {copiedWidget ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="overflow-x-auto bg-[#1f2937] p-4 text-sm text-[#e5e7eb]">
          <code>{widgetCode}</code>
        </pre>
      </div>

      {/* Universal setup */}
      <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 shadow-sm">
        <div className="flex items-center justify-between border-b border-amber-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-[#002855]">
            Universal Setup
            <span className="ml-2 text-xs font-normal text-amber-700">
              Add ONCE to your site (e.g. header or layout template) — all widgets share this
            </span>
          </h3>
          <button
            onClick={handleCopySetup}
            className="rounded bg-[#004C97] px-3 py-1 text-xs font-medium text-white hover:bg-[#002855]"
          >
            {copiedSetup ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="overflow-x-auto bg-[#1f2937] p-4 text-sm text-[#e5e7eb]">
          <code>{universalSetup}</code>
        </pre>
      </div>
    </div>
  );
}
