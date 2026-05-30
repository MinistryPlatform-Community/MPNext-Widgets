import { getMpHostForDocs } from "@/lib/embed/config";

export type WidgetCategory =
  | "Public"
  | "Authenticated"
  | "Staff / Admin"
  | "Authentication";

export interface WidgetControl {
  name: string;
  label: string;
  type: "number" | "select" | "text";
  attribute: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}

export interface WidgetTab {
  label: string;
  attributes: Record<string, string>;
}

export interface WidgetConfig {
  slug: string;
  tag: string;
  title: string;
  description: string;
  category: WidgetCategory;
  needsUserMenu: boolean;
  needsMpWidgets: boolean;
  attributes: Record<string, string>;
  events: string[];
  controls?: WidgetControl[];
  tabs?: WidgetTab[];
  recaptchaSiteKey?: string;
  implementationCode: string;
}

export const RECAPTCHA_SITE_KEY = "6LeMwXQsAAAAALCfbMktsSEmklS8Bj52F89TA58w";

/** MP host without /ministryplatformapi suffix, for use in example snippets */
const mpHost = getMpHostForDocs();

export const widgetCatalog: WidgetConfig[] = [
  // ─── Authentication ───────────────────────────────────────────────
  {
    slug: "user-menu",
    tag: "next-user-menu",
    title: "User Menu",
    description: "Authentication widget with avatar dropdown and account modal. Deep-link via hash.",
    category: "Authentication",
    needsUserMenu: false,
    needsMpWidgets: true,
    attributes: {},
    events: ["userLogout", "accountModalOpen", "accountModalClose"],
    implementationCode: `<next-user-menu mp-base-url="${mpHost}"></next-user-menu>

<!-- With post-logout redirect -->
<next-user-menu
  mp-base-url="${mpHost}"
  post-logout-redirect-uri="${mpHost}"
></next-user-menu>

<!-- Deep-link to profile tab -->
<!-- Add #next-tab=profile to URL -->
<!-- Options: profile, family, giving, subscriptions, invoices -->`,
  },

  // ─── Public Widgets ───────────────────────────────────────────────
  {
    slug: "add-to-calendar",
    tag: "next-add-to-calendar",
    title: "Add to Calendar",
    description: "iCal/calendar export button for a single event.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    attributes: { "event-id": "1" },
    events: ["calendarEventLoaded", "addToCalendarError"],
    controls: [
      { name: "eventId", label: "Event ID", type: "number", attribute: "event-id", placeholder: "e.g. 1234" },
    ],
    implementationCode: `<next-add-to-calendar event-id="1234"></next-add-to-calendar>`,
  },
  {
    slug: "full-calendar",
    tag: "next-full-calendar",
    title: "Full Calendar",
    description: "Multi-view calendar with month, week, list, cards, and mini-cal views.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    attributes: {},
    events: ["calendarLoaded", "eventSelected", "viewChanged", "fullCalendarError"],
    controls: [
      {
        name: "view", label: "View", type: "select", attribute: "view",
        options: [
          { label: "Cards", value: "cards" },
          { label: "List", value: "list" },
          { label: "Month", value: "month" },
          { label: "Week", value: "week" },
          { label: "Calendar", value: "calendar" },
        ],
        defaultValue: "cards",
      },
      {
        name: "showToolbar", label: "Toolbar", type: "select", attribute: "show-toolbar",
        options: [
          { label: "Show", value: "true" },
          { label: "Hide", value: "false" },
        ],
        defaultValue: "true",
      },
      { name: "congregationId", label: "Congregation ID", type: "number", attribute: "congregation-id", placeholder: "e.g. 1" },
    ],
    implementationCode: `<next-full-calendar></next-full-calendar>

<!-- List view with toolbar hidden -->
<next-full-calendar view="list" show-toolbar="false"></next-full-calendar>

<!-- Filtered by congregation -->
<next-full-calendar congregation-id="1" view="month"></next-full-calendar>`,
  },

  // ─── Authenticated Widgets ─────────────────────────────────────────
  {
    slug: "profile",
    tag: "next-profile",
    title: "Profile Editor",
    description: "Edit user profile fields including name, email, phone, and address.",
    category: "Authenticated",
    needsUserMenu: true,
    needsMpWidgets: true,
    attributes: {},
    events: ["profileLoaded", "profileSaved", "profileError", "passwordChanged", "passwordError"],
    implementationCode: `<next-profile></next-profile>`,
  },
  {
    slug: "my-invoices",
    tag: "next-my-invoices",
    title: "My Invoices",
    description: "View and manage user invoices with line item details.",
    category: "Authenticated",
    needsUserMenu: true,
    needsMpWidgets: true,
    attributes: {},
    events: ["invoicesLoaded", "invoiceSelected", "invoiceError"],
    implementationCode: `<next-my-invoices></next-my-invoices>`,
  },
];

export function getWidgetBySlug(slug: string): WidgetConfig | undefined {
  return widgetCatalog.find((w) => w.slug === slug);
}

export function getWidgetsByCategory(): Record<WidgetCategory, WidgetConfig[]> {
  const grouped: Record<WidgetCategory, WidgetConfig[]> = {
    Public: [],
    Authenticated: [],
    "Staff / Admin": [],
    Authentication: [],
  };
  for (const widget of widgetCatalog) {
    grouped[widget.category].push(widget);
  }
  return grouped;
}
