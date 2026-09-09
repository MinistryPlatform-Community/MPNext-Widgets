import { getMpHostForDocs } from "@/lib/embed/config";
import {
  widgetRegistry,
  widgetCategoryOrder,
  type WidgetCategory,
  type WidgetMeta,
} from "@mpnext/types";

export type { WidgetCategory };

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

/**
 * A demo catalog entry: the shared {@link WidgetMeta} (slug/tag/title/
 * description/category/events) plus demo-only presentation extras.
 */
export interface WidgetConfig extends WidgetMeta {
  attributes: Record<string, string>;
  controls?: WidgetControl[];
  tabs?: WidgetTab[];
  recaptchaSiteKey?: string;
  implementationCode: string;
}

export const RECAPTCHA_SITE_KEY = "6LeMwXQsAAAAALCfbMktsSEmklS8Bj52F89TA58w";

/** MP host without /ministryplatformapi suffix, for use in example snippets */
const mpHost = getMpHostForDocs();

/**
 * Demo-only extras keyed by widget slug. The base metadata (title, category,
 * events, …) lives in the shared `@mpnext/types` registry; only the
 * interactive demo controls + embed snippets live here.
 */
interface WidgetExtras {
  attributes?: Record<string, string>;
  controls?: WidgetControl[];
  tabs?: WidgetTab[];
  recaptchaSiteKey?: string;
  implementationCode: string;
}

const extras: Record<string, WidgetExtras> = {
  "user-menu": {
    implementationCode: `<next-user-menu mp-base-url="${mpHost}"></next-user-menu>

<!-- Land somewhere specific after sign-out. Defaults to the current page. -->
<!-- In legacy mode the URI must be registered on the MP OAuth client. -->
<next-user-menu
  mp-base-url="${mpHost}"
  post-logout-redirect-uri="https://your-site.example.org/goodbye"
></next-user-menu>

<!-- Deep-link to profile tab -->
<!-- Add #next-tab=profile to URL -->
<!-- Options: profile, family, giving, subscriptions, invoices -->`,
  },

  "add-to-calendar": {
    attributes: { "event-id": "1" },
    controls: [
      { name: "eventId", label: "Event ID", type: "number", attribute: "event-id", placeholder: "e.g. 1234" },
      {
        name: "providers", label: "Calendars", type: "select", attribute: "providers",
        options: [
          { label: "All (default)", value: "google,apple,outlook,yahoo,ics" },
          { label: "Google only", value: "google" },
          { label: "Google + Apple", value: "google,apple" },
          { label: "Microsoft (Outlook.com + 365)", value: "outlook,office365" },
          { label: ".ics download only", value: "ics" },
        ],
        defaultValue: "google,apple,outlook,yahoo,ics",
      },
    ],
    implementationCode: `<next-add-to-calendar event-id="1234"></next-add-to-calendar>

<!-- Narrow the menu. Default: google,apple,outlook,yahoo,ics
     (office365 is also available.) -->
<next-add-to-calendar event-id="1234" providers="google,apple,ics"></next-add-to-calendar>

<!-- Override the zone the MP event times are in. Defaults to the
     MP domain timezone, which the API ships with the event. -->
<next-add-to-calendar event-id="1234" time-zone="America/New_York"></next-add-to-calendar>`,
  },

  "full-calendar": {
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

  "event-finder": {
    attributes: { "target-url": "/demo/event-details" },
    controls: [
      { name: "keyword", label: "Keyword", type: "text", attribute: "keyword", placeholder: "e.g. retreat" },
      { name: "congregationId", label: "Congregation ID", type: "number", attribute: "congregation-id", placeholder: "e.g. 1" },
      { name: "ministryId", label: "Ministry ID", type: "number", attribute: "ministry-id", placeholder: "e.g. 5" },
      {
        name: "featured", label: "Featured Only", type: "select", attribute: "featured",
        options: [
          { label: "All Events", value: "" },
          { label: "Featured Only", value: "true" },
        ],
        defaultValue: "",
      },
    ],
    implementationCode: `<next-event-finder target-url="/events/details"></next-event-finder>

<!-- Pre-filtered: featured events for a congregation -->
<next-event-finder
  target-url="/events/details"
  congregation-id="1"
  featured="true"
></next-event-finder>`,
  },

  "event-details": {
    attributes: { "event-id": "1", "return-url": "/demo/event-finder", "checkout-url": "/demo/my-invoices" },
    controls: [
      { name: "eventId", label: "Event ID", type: "number", attribute: "event-id", placeholder: "e.g. 1234" },
      { name: "checkoutUrl", label: "Checkout URL", type: "text", attribute: "checkout-url", placeholder: "/checkout" },
      { name: "returnUrl", label: "Return URL", type: "text", attribute: "return-url", placeholder: "/events" },
    ],
    implementationCode: `<next-event-details
  event-id="1234"
  return-url="/events"
  checkout-url="/checkout"
></next-event-details>

<!-- The event id can also come from the URL query string -->
<next-event-details return-url="/events" checkout-url="/checkout"></next-event-details>`,
  },

  checkout: {
    attributes: { "payment-processor-url": "/demo/pay", "back-to-event-url": "/demo/event-finder" },
    controls: [
      { name: "invoiceId", label: "Invoice GUID", type: "text", attribute: "invoice-id", placeholder: "Invoice_GUID" },
    ],
    implementationCode: `<next-checkout
  payment-processor-url="/pay"
  back-to-event-url="/events"
></next-checkout>

<!-- Invoice GUID comes from the URL (?id=) or an invoice-id attribute -->`,
  },

  pay: {
    implementationCode: `<!-- Sandbox gateway. The request token arrives via ?token= -->
<next-pay></next-pay>`,
  },

  "checkout-complete": {
    implementationCode: `<!-- Reached on return from the gateway with ?token= -->
<next-checkout-complete></next-checkout-complete>`,
  },

  "custom-form": {
    attributes: { "form-id": "1" },
    controls: [
      { name: "formId", label: "Form ID", type: "number", attribute: "form-id", placeholder: "e.g. 1" },
      { name: "formGuid", label: "Form GUID", type: "text", attribute: "form-guid", placeholder: "or a Form GUID" },
    ],
    implementationCode: `<next-custom-form form-id="123"></next-custom-form>

<!-- Or reference a form by GUID -->
<next-custom-form form-guid="00000000-0000-0000-0000-000000000000"></next-custom-form>`,
  },

  profile: {
    implementationCode: `<next-profile></next-profile>`,
  },

  "my-household": {
    controls: [
      {
        name: "hideAddHouseholdMember", label: "Add Member Button", type: "select", attribute: "hideaddhouseholdmember",
        options: [
          { label: "Show", value: "false" },
          { label: "Hide", value: "true" },
        ],
        defaultValue: "false",
      },
    ],
    implementationCode: `<next-my-household></next-my-household>`,
  },

  "my-groups": {
    controls: [
      {
        name: "hideGroupLife", label: "Group Life Link", type: "select", attribute: "hidegrouplife",
        options: [
          { label: "Show", value: "false" },
          { label: "Hide", value: "true" },
        ],
        defaultValue: "false",
      },
    ],
    implementationCode: `<next-my-groups></next-my-groups>`,
  },

  subscriptions: {
    implementationCode: `<next-subscriptions></next-subscriptions>`,
  },

  "my-invoices": {
    implementationCode: `<next-my-invoices></next-my-invoices>`,
  },

  "my-contribution-statement": {
    implementationCode: `<next-my-contribution-statement></next-my-contribution-statement>`,
  },

  "statement-preferences": {
    implementationCode: `<next-statement-preferences></next-statement-preferences>`,
  },

  "my-giving": {
    controls: [
      {
        name: "hideSoftCredits", label: "Soft Credits", type: "select", attribute: "hidesoftcredits",
        options: [
          { label: "Show", value: "false" },
          { label: "Hide", value: "true" },
        ],
        defaultValue: "false",
      },
    ],
    implementationCode: `<next-my-giving></next-my-giving>`,
  },

  "my-pledges": {
    controls: [
      {
        name: "hideCancelButton", label: "Cancel Button", type: "select", attribute: "hidecancelbuttonpledge",
        options: [
          { label: "Hidden", value: "true" },
          { label: "Shown", value: "false" },
        ],
        defaultValue: "true",
      },
    ],
    implementationCode: `<next-my-pledges hidecancelbuttonpledge="true"></next-my-pledges>`,
  },

  "pledge-campaign": {
    attributes: { "campaign-id": "3", "suggested-amounts": "30,50,100" },
    controls: [
      { name: "campaignId", label: "Pledge Campaign ID", type: "number", attribute: "campaign-id", placeholder: "e.g. 3" },
      { name: "suggestedAmounts", label: "Suggested Amounts", type: "text", attribute: "suggested-amounts", placeholder: "30,50,100 (or NULL)" },
      { name: "pledgeEmailTemplate", label: "Email Template ID", type: "number", attribute: "pledge-email-template", placeholder: "dp_Communications ID" },
    ],
    implementationCode: `<next-pledge-campaign campaign-id="3" suggested-amounts="30,50,100"></next-pledge-campaign>

<!-- The campaign id can also come from the URL query string (?id=) -->
<next-pledge-campaign
  campaign-id="3"
  suggested-amounts="30,50,100"
  pledge-email-template="528"
></next-pledge-campaign>`,
  },

  "subscribe-to-publication": {
    // `4` is `Weekly Newsletter` on the reference instance and is
    // `Available_Online`; `1` is not, which is the interesting failure to
    // demonstrate — it answers exactly like an id that does not exist.
    attributes: { "publication-id": "4", "verification-email-template-id": "5125" },
    controls: [
      { name: "publicationId", label: "Publication ID", type: "number", attribute: "publication-id", placeholder: "e.g. 4" },
      { name: "verificationTemplate", label: "Verification Template ID", type: "number", attribute: "verification-email-template-id", placeholder: "dp_Communications ID" },
      { name: "mySubscriptionsUrl", label: "My-subscriptions URL", type: "text", attribute: "my-subscriptions-url", placeholder: "/demo/subscriptions" },
    ],
    implementationCode: `<!-- Both attributes are required: the publication must be
     Available_Online, and the template's Body must render
     [mpp_verify_email_url]. -->
<next-subscribe-to-publication
  publication-id="4"
  verification-email-template-id="5125"
></next-subscribe-to-publication>

<!-- return-url is where the emailed link lands. It must be same-origin
     with the page (https, no embedded credentials) or the request is
     refused and no email is sent. Defaults to the current page URL with
     the query string stripped. -->
<next-subscribe-to-publication
  publication-id="4"
  verification-email-template-id="5125"
  return-url="https://your-site.example.org/newsletter"
  my-subscriptions-url="https://your-site.example.org/email-preferences"
></next-subscribe-to-publication>

<!-- Merge tokens available in the verification template:
       [mpp_verify_email_url]      the confirmation link — required
       [mpp_contact_first_name]
       [mpp_contact_last_name]
       [mpp_publication_title]
     The confirmation link is single-use and lives 3 days. -->`,
  },
};

export const widgetCatalog: WidgetConfig[] = widgetRegistry.map((meta) => {
  const extra = extras[meta.slug] ?? { implementationCode: `<${meta.tag}></${meta.tag}>` };
  return {
    ...meta,
    attributes: extra.attributes ?? {},
    controls: extra.controls,
    tabs: extra.tabs,
    recaptchaSiteKey: extra.recaptchaSiteKey,
    implementationCode: extra.implementationCode,
  };
});

export function getWidgetBySlug(slug: string): WidgetConfig | undefined {
  return widgetCatalog.find((w) => w.slug === slug);
}

export function getWidgetsByCategory(): Record<WidgetCategory, WidgetConfig[]> {
  const grouped = Object.fromEntries(
    widgetCategoryOrder.map((c) => [c, [] as WidgetConfig[]])
  ) as Record<WidgetCategory, WidgetConfig[]>;
  for (const widget of widgetCatalog) {
    grouped[widget.category].push(widget);
  }
  return grouped;
}
