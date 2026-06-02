/**
 * Framework-neutral widget registry — the single source of truth for which
 * widgets exist, their tag/title/description, and how they're grouped.
 *
 * Consumed by:
 *  - the Next.js demo at /demo (src/app/(demo)/demo/_lib/widget-catalog.ts),
 *    which layers on demo-only extras (controls, embed snippets);
 *  - the embed-sdk Vite demo landing (packages/embed-sdk/index.html), which
 *    renders its cards from this list at dev time.
 *
 * Keep this file dependency-free (no zod) so both runtimes can import it.
 */

export type WidgetCategory = "Public" | "Profile" | "Stewardship" | "Authentication";

export interface WidgetMeta {
  /** URL slug (/demo/{slug}) and basis for demo-{slug}.html. */
  slug: string;
  /** Custom element tag name. */
  tag: string;
  title: string;
  description: string;
  category: WidgetCategory;
  /** Whether the widget relies on a signed-in session (next-user-menu). */
  needsUserMenu: boolean;
  /** Whether the demo embeds legacy MP Shadow-DOM widgets. */
  needsMpWidgets: boolean;
  /** Custom events the widget dispatches. */
  events: string[];
}

/** Display order for category sections across both demo surfaces. */
export const widgetCategoryOrder: WidgetCategory[] = [
  "Public",
  "Profile",
  "Stewardship",
  "Authentication",
];

/**
 * Coarse access level shown as the per-card badge (distinct from the section
 * grouping). Profile + Stewardship widgets both require a signed-in session,
 * so they share the single "Authenticated" badge.
 */
export type WidgetAccessLevel = "Public" | "Authenticated" | "Authentication";

export function widgetAccessLevel(category: WidgetCategory): WidgetAccessLevel {
  if (category === "Public") return "Public";
  if (category === "Authentication") return "Authentication";
  return "Authenticated";
}

export const widgetRegistry: WidgetMeta[] = [
  // ── Public ───────────────────────────────────────────────
  {
    slug: "add-to-calendar",
    tag: "next-add-to-calendar",
    title: "Add to Calendar",
    description: "iCal/calendar export button for a single event.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["calendarEventLoaded", "addToCalendarError"],
  },
  {
    slug: "full-calendar",
    tag: "next-full-calendar",
    title: "Full Calendar",
    description: "Multi-view calendar with month, week, list, cards, and mini-cal views.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["calendarLoaded", "eventSelected", "viewChanged", "fullCalendarError"],
  },
  {
    slug: "event-finder",
    tag: "next-event-finder",
    title: "Event Finder",
    description:
      "Public, filterable event search with result cards that deep-link to an event-details page.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["eventsLoaded", "eventSelected", "eventFinderError"],
  },
  {
    slug: "event-details",
    tag: "next-event-details",
    title: "Event Details & Registration",
    description:
      "Full event detail view with registration: product options, promo codes, custom forms, participant management, and checkout redirect.",
    category: "Public",
    needsUserMenu: true,
    needsMpWidgets: false,
    events: [
      "eventDetailLoaded",
      "registrationSaved",
      "registrationError",
      "participantRemoved",
      "loginRequired",
      "emailRequested",
      "eventDetailError",
    ],
  },

  {
    slug: "custom-form",
    tag: "next-custom-form",
    title: "Custom Form",
    description:
      "Standalone MinistryPlatform custom form — renders any form's fields (the same engine used inside event registration) and saves a response.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["formLoaded", "formSubmitted", "formError", "loginRequired"],
  },

  // ── Profile ──────────────────────────────────────────────
  {
    slug: "profile",
    tag: "next-profile",
    title: "Profile Editor",
    description: "Edit user profile fields including name, email, phone, and address.",
    category: "Profile",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["profileLoaded", "profileSaved", "profileError", "passwordChanged", "passwordError"],
  },
  {
    slug: "my-household",
    tag: "next-my-household",
    title: "My Household",
    description: "View and edit household details, addresses, and members with photos.",
    category: "Profile",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["householdLoaded", "householdUpdated", "memberSaved", "householdError"],
  },
  {
    slug: "my-groups",
    tag: "next-my-groups",
    title: "My Groups",
    description: "List the groups you belong to with meeting details and a Connect button.",
    category: "Profile",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["groupsLoaded", "groupError"],
  },
  {
    slug: "subscriptions",
    tag: "next-subscriptions",
    title: "My Subscriptions",
    description: "Toggle publication subscriptions on or off with a single checkbox.",
    category: "Profile",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["subscriptionsLoaded", "subscriptionChanged", "subscriptionError"],
  },

  // ── Stewardship ──────────────────────────────────────────
  {
    slug: "my-invoices",
    tag: "next-my-invoices",
    title: "My Invoices",
    description: "View and manage user invoices with line item details.",
    category: "Stewardship",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["invoicesLoaded", "invoiceSelected", "invoiceError"],
  },
  {
    slug: "my-contribution-statement",
    tag: "next-my-contribution-statement",
    title: "My Contribution Statements",
    description: "View and download contribution statements by accounting company and year.",
    category: "Stewardship",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["statementsLoaded", "statementDownloaded", "statementError"],
  },
  {
    slug: "statement-preferences",
    tag: "next-statement-preferences",
    title: "Statement Preferences",
    description: "Toggle paperless delivery of contribution statements.",
    category: "Stewardship",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["preferenceLoaded", "preferenceUpdated", "preferenceError"],
  },
  {
    slug: "my-giving",
    tag: "next-my-giving",
    title: "My Giving",
    description: "Giving history with by-month and by-program charts and a donation list.",
    category: "Stewardship",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["donationsLoaded", "givingError"],
  },
  {
    slug: "my-pledges",
    tag: "next-my-pledges",
    title: "My Pledges",
    description: "List pledges with progress bars and cancel an active pledge.",
    category: "Stewardship",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["pledgesLoaded", "pledgeCanceled", "pledgeError"],
  },

  // ── Authentication ───────────────────────────────────────
  {
    slug: "user-menu",
    tag: "next-user-menu",
    title: "User Menu",
    description:
      "Authentication widget with avatar dropdown and account modal. Deep-link via hash.",
    category: "Authentication",
    needsUserMenu: false,
    needsMpWidgets: true,
    events: ["userLogout", "accountModalOpen", "accountModalClose"],
  },
];
