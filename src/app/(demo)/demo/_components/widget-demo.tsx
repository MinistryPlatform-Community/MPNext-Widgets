"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { WidgetConfig } from "../_lib/widget-catalog";
import { EventLog, useEventLog } from "./event-log";
import { ImplementationCode } from "./implementation-code";

const MP_AUTH_TOKEN_KEY = "mpp-widgets_AuthToken";

interface WidgetDemoProps {
  widget: WidgetConfig;
  apiHost: string;
  mpBaseUrl: string;
}

export function WidgetDemo({
  widget,
  apiHost,
  mpBaseUrl,
}: WidgetDemoProps) {
  const demoRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const { entries, log, clear } = useEventLog();
  const [activeTab, setActiveTab] = useState(0);
  const [controlValues, setControlValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    widget.controls?.forEach((c) => {
      if (c.defaultValue) defaults[c.name] = c.defaultValue;
    });
    return defaults;
  });

  // One-shot initialization — mirrors how Vite demos work
  useEffect(() => {
    if (initialized.current || !demoRef.current) return;
    initialized.current = true;

    const container = demoRef.current;

    async function bootstrap() {
      // 1. MPWidgets.js is loaded via next/script beforeInteractive in the demo layout,
      //    so its custom elements polyfill registers mpp-* elements before React hydrates.

      // 2. Load SDK
      log("sdk", "Loading embed SDK...");
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector('script[src="/embed-sdk/next-embed.es.js"]');
        if (existing) { setTimeout(resolve, 300); return; }
        const script = document.createElement("script");
        script.type = "module";
        script.src = "/embed-sdk/next-embed.es.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load SDK"));
        document.head.appendChild(script);
      });

      // SDK auto-initializes — detects its host and wires up the token provider
      log("sdk", "SDK loaded (auto-initialized)");

      // 3. Build the demo HTML — same structure as Vite demos
      let html = "";

      // User menu bar for auth widgets
      if (widget.needsUserMenu) {
        html += `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#002855;border-radius:8px;margin-bottom:24px;">
            <span style="color:white;font-weight:600;font-size:16px;">Sign in to continue</span>
            <next-user-menu mp-base-url="${mpBaseUrl}" api-host="${apiHost}"></next-user-menu>
          </div>`;
      }

      // Widget element with all attributes baked in
      const attrs: Record<string, string> = { "api-host": apiHost };
      if (widget.needsMpWidgets) attrs["mp-base-url"] = mpBaseUrl;
      for (const [k, v] of Object.entries(widget.attributes)) attrs[k] = v;
      if (widget.recaptchaSiteKey) attrs["recaptcha-site-key"] = widget.recaptchaSiteKey;

      // For tabbed widgets, use first tab's attributes
      if (widget.tabs?.length) {
        for (const [k, v] of Object.entries(widget.tabs[0].attributes)) attrs[k] = v;
      }

      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v.replace(/"/g, "&quot;")}"`)
        .join(" ");

      if (widget.needsUserMenu) {
        // For auth widgets: show widget container, hidden until auth
        html += `<div id="next-widget-container"><${widget.tag} ${attrStr}></${widget.tag}></div>`;
      } else if (widget.tag === "next-user-menu") {
        // User menu needs a header bar context to display properly (same as Vite demo)
        html += `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:#002855;border-radius:8px;">
            <span style="color:white;font-weight:600;font-size:18px;">mpnext.church</span>
            <${widget.tag} ${attrStr}></${widget.tag}>
          </div>`;
      } else {
        html += `<${widget.tag} ${attrStr}></${widget.tag}>`;
      }

      container.innerHTML = html;

      // 4. Attach event listeners to the widget
      const widgetEl = container.querySelector(widget.tag);
      if (widgetEl) {
        for (const eventName of widget.events) {
          widgetEl.addEventListener(eventName, ((e: CustomEvent) => {
            log(eventName, e.detail);
          }) as EventListener);
        }
      }
      log("widget", `Mounted <${widget.tag}>`);

      // 5. For auth widgets: poll localStorage and re-init token when user signs in
      if (widget.needsUserMenu) {
        const poll = setInterval(() => {
          const token = localStorage.getItem(MP_AUTH_TOKEN_KEY);
          if (token) {
            log("auth", "MP auth token detected — user signed in");
            clearInterval(poll);
            // Re-fetch widget token now that mpUserToken is available
            // The widget will auto-refresh on next API call via 401 → refresh
          }
        }, 1000);
      }
    }

    bootstrap().catch((err) => {
      log("error", `Bootstrap failed: ${err.message}`);
    });
  }, [widget, apiHost, mpBaseUrl, log]);

  // Tab switching — rebuild widget with new attributes
  const handleTabSwitch = useCallback((tabIndex: number) => {
    setActiveTab(tabIndex);
    if (!demoRef.current || !widget.tabs) return;

    const widgetEl = demoRef.current.querySelector(widget.tag);
    if (!widgetEl) return;

    const tab = widget.tabs[tabIndex];
    for (const [k, v] of Object.entries(tab.attributes)) {
      widgetEl.setAttribute(k, v);
    }
    log("demo", `Switched to "${tab.label}" config`);
  }, [widget, log]);

  // Apply controls
  function handleApplyControls() {
    if (!demoRef.current || !widget.controls) return;
    const widgetEl = demoRef.current.querySelector(widget.tag);
    if (!widgetEl) return;

    for (const control of widget.controls) {
      const value = controlValues[control.name];
      if (value) {
        widgetEl.setAttribute(control.attribute, value);
      } else {
        widgetEl.removeAttribute(control.attribute);
      }
    }
    log("controls", controlValues);
  }

  const showControls = widget.controls && widget.controls.length > 0 && !widget.tabs;
  const showTabs = widget.tabs && widget.tabs.length > 0;

  return (
    <div className="space-y-6">
      {/* Tabs */}
      {showTabs && (
        <div className="flex flex-wrap gap-2">
          {widget.tabs!.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => handleTabSwitch(i)}
              className={`rounded-full border-2 px-5 py-2 text-sm font-medium transition ${
                i === activeTab
                  ? "border-[#004C97] bg-[#004C97] text-white"
                  : "border-[#004C97] bg-white text-[#004C97] hover:bg-blue-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Controls */}
      {showControls && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
          {widget.controls!.map((control) => (
            <div key={control.name} className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500">
                {control.label}
              </label>
              {control.type === "select" ? (
                <select
                  value={controlValues[control.name] ?? ""}
                  onChange={(e) =>
                    setControlValues((prev) => ({ ...prev, [control.name]: e.target.value }))
                  }
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#004C97] focus:outline-none focus:ring-1 focus:ring-[#004C97]"
                >
                  {control.options!.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={control.type}
                  placeholder={control.placeholder}
                  value={controlValues[control.name] ?? ""}
                  onChange={(e) =>
                    setControlValues((prev) => ({ ...prev, [control.name]: e.target.value }))
                  }
                  className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#004C97] focus:outline-none focus:ring-1 focus:ring-[#004C97]"
                />
              )}
            </div>
          ))}
          <button
            onClick={handleApplyControls}
            className="rounded-md bg-[#004C97] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#002855]"
          >
            Apply
          </button>
        </div>
      )}

      {/* Demo container — widgets render here imperatively, like the Vite demos */}
      <div
        ref={demoRef}
        className="min-h-[200px] rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      />

      {/* Event log */}
      <EventLog entries={entries} onClear={clear} />

      {/* Implementation code */}
      <ImplementationCode widget={widget} />
    </div>
  );
}
