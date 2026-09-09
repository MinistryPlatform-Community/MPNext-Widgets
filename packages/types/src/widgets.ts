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

export type WidgetCategory = "Public" | "Payments" | "Profile" | "Stewardship" | "Authentication";

export interface WidgetMeta {
  /** URL slug (/demo/{slug}) and basis for demo-{slug}.html. */
  slug: string;
  /** Custom element tag name. */
  tag: string;
  title: string;
  description: string;
  category: WidgetCategory;
  /**
   * Explicit access badge override. Defaults to the category-derived level
   * (see {@link widgetAccessLevel}). Needed when a category mixes access
   * levels — e.g. Payments holds publicly-reachable checkout widgets plus the
   * authenticated My Invoices.
   */
  accessLevel?: WidgetAccessLevel;
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
  "Payments",
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

export function widgetAccessLevel(
  widget: Pick<WidgetMeta, "category" | "accessLevel">
): WidgetAccessLevel {
  if (widget.accessLevel) return widget.accessLevel;
  if (widget.category === "Public") return "Public";
  if (widget.category === "Authentication") return "Authentication";
  return "Authenticated";
}

export const widgetRegistry: WidgetMeta[] = [
  // ── Public ───────────────────────────────────────────────
  {
    slug: "add-to-calendar",
    tag: "next-add-to-calendar",
    title: "Add to Calendar",
    description:
      "Add-to-calendar menu for a single event: Google, Apple, Outlook, Yahoo, or a downloaded .ics file.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: [
      "calendarEventLoaded",
      "calendarProviderSelected",
      "addToCalendarError",
    ],
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
    slug: "group-finder",
    tag: "next-group-finder",
    title: "Group Finder",
    description:
      "Public, filterable small-group search with result cards that deep-link to a group-details page, plus an optional Suggest-a-Group form.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["groupsLoaded", "groupSelected", "groupSuggested", "loginRequired", "groupFinderError"],
  },
  {
    slug: "group-details",
    tag: "next-group-details",
    title: "Group Details & Sign-up",
    description:
      "Full group detail view with a tabbed contact-the-group (inquiry) and sign-up flow honoring full-group, hidden-tab, and address options.",
    category: "Public",
    needsUserMenu: true,
    needsMpWidgets: false,
    events: [
      "groupDetailLoaded",
      "inquirySubmitted",
      "signupSubmitted",
      "loginRequired",
      "groupDetailError",
    ],
  },

  {
    slug: "opportunity-finder",
    tag: "next-opportunity-finder",
    title: "Opportunity Finder",
    description:
      "Public, filterable volunteer-opportunity search with result cards that deep-link to an opportunity-details page.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["opportunitiesLoaded", "opportunitySelected", "opportunityFinderError"],
  },
  {
    slug: "opportunity-details",
    tag: "next-opportunity-details",
    title: "Opportunity Details & Response",
    description:
      "Full volunteer-opportunity detail view with a response form: Respond As household picker, custom form, and remaining-needed gating.",
    category: "Public",
    needsUserMenu: true,
    needsMpWidgets: false,
    events: [
      "opportunityDetailLoaded",
      "responseSaved",
      "responseError",
      "loginRequired",
      "opportunityDetailError",
    ],
  },

  {
    slug: "plan-your-visit",
    tag: "next-plan-your-visit",
    title: "Plan Your Visit",
    description:
      "Two-step first-time-visitor registration: a verified-email link unlocks a household visit-details form (head, spouse, children, address) that creates MP records and notifies the church.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["verificationSent", "contactExists", "verified", "visitPlanned", "loginRequired"],
  },

  {
    slug: "prayer-feedback",
    tag: "next-prayer-feedback",
    title: "Prayer & Feedback",
    description:
      "Prayer requests, praise reports and general feedback, written to MP's Feedback Entries. Works with no sign-in: a signed-out visitor confirms one emailed link before anything is created, while a signed-in member can file for themselves or a household member immediately.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: [
      "feedbackSubmitted",
      "verificationSent",
      "feedbackVerified",
      "feedbackError",
      "loginRequired",
    ],
  },

  {
    slug: "online-directory",
    tag: "next-online-directory",
    title: "Online Directory",
    description:
      "Authenticated member directory: search by name/phone/email, filter by family, with phone, birthday, map, and email-a-member actions.",
    category: "Public",
    accessLevel: "Authenticated",
    needsUserMenu: true,
    needsMpWidgets: false,
    events: ["directoryReady", "directorySearched", "directoryEmailSent", "loginRequired", "directoryError"],
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

  {
    slug: "unsubscribe",
    tag: "next-unsubscribe",
    title: "Unsubscribe",
    description:
      "Landing page for the unsubscribe link in a bulk email. Identifies the recipient from the link (?cg= / &pubid=, or a sealed token), opts them out on load with no sign-in, and offers Undo plus a link to full email preferences.",
    category: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["unsubscribed", "resubscribed", "unsubscribeError"],
  },

  // ── Payments ─────────────────────────────────────────────
  {
    slug: "checkout",
    tag: "next-checkout",
    title: "Checkout & Payment",
    description:
      "Invoice summary + payment options that hand off to a payment gateway. Reached by invoice GUID (no login required).",
    category: "Payments",
    accessLevel: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["invoiceLoaded", "paymentComplete", "checkoutError"],
  },
  {
    slug: "pay",
    tag: "next-pay",
    title: "Payment Gateway (Sandbox)",
    description:
      "Sandbox hosted-payment page (test card 4111…). Stand-in for a real vendor; swap by pointing checkout at the vendor URL + sharing the signing key.",
    category: "Payments",
    accessLevel: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["paymentSubmitted"],
  },
  {
    slug: "checkout-complete",
    tag: "next-checkout-complete",
    title: "Checkout Complete",
    description: "Payment confirmation page reached on return from the gateway.",
    category: "Payments",
    accessLevel: "Public",
    needsUserMenu: false,
    needsMpWidgets: false,
    events: ["paymentComplete"],
  },
  {
    slug: "my-invoices",
    tag: "next-my-invoices",
    title: "My Invoices",
    description: "View and manage user invoices with line item details.",
    category: "Payments",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["invoicesLoaded", "invoiceSelected", "invoiceError"],
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
  {
    slug: "pledge-campaign",
    tag: "next-pledge-campaign",
    title: "Pledge Campaign",
    description:
      "Show a campaign's pledged/received progress and make a pledge (signed-in or anonymous) with suggested amounts, frequency, and a live installment total.",
    category: "Stewardship",
    accessLevel: "Public",
    needsUserMenu: true,
    needsMpWidgets: true,
    events: ["pledgeCampaignLoaded", "pledgeSaved", "pledgeError", "loginRequired", "pledgeCampaignError"],
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
