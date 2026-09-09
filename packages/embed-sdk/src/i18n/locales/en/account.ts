/**
 * Account widget namespaces. See `core.ts` for the shared namespaces and
 * `../../types.ts` for why this file is TypeScript rather than JSON.
 */
export const account = {
  /**
   * `next-my-invoices`. Invoice descriptions, product names and the
   * `Invoice_Status` lookup value are MP-authored and stay as MP sends them —
   * only the widget's own chrome is here.
   */
  myInvoices: {
    title: "My Invoices",
    invoiceCount: { one: "{count} invoice", other: "{count} invoices" },
    searchPlaceholder: "Search invoices…",
    loading: "Loading invoices…",
    loadingDetail: "Loading invoice details…",
    empty: "No invoices found.",
    noMatches: "No invoices match your search.",
    /** Stands in as the row description when MP sends no product summary. */
    invoiceNumber: "Invoice #{id}",
    description: "Description",
    status: "Status",
    /** The row-level "pay this one" affordance; the arrow lives in the markup. */
    pay: "Pay",
    payNow: "Pay Now",
    detailTitle: "Invoice Details",
    backToList: "Back to Invoices",
    /**
     * Leaves the legacy `<mpp-checkout>` overlay. The checkout inside it is
     * MP's own element and carries MP's copy, in MP's locale.
     */
    backToInvoice: "Back to Invoice",
    invoiceDate: "Invoice Date",
    lineItems: "Line Items",
    product: "Product",
    quantity: "Qty",
    unitPrice: "Unit Price",
  },

  /**
   * `next-user-menu`. Only the `dual` / `hardened` menu is covered: in `legacy`
   * the visible control is MinistryPlatform's `<mpp-user-login>`, whose labels
   * come from MP's own `GetLabels` in MP's locale and cannot be reached from
   * here. Sign In / Sign Out live in `common`, shared with eight other widgets.
   */
  /**
   * `next-unsubscribe` — the landing page for the unsubscribe link in a bulk
   * email. Lives here rather than beside `subscriptions` (which sits in
   * `giving.ts`, a misfiling: publications are not giving) because `account.ts`
   * is where account-level communication preferences belong. Moving
   * `subscriptions` across is `subscriptions.md`'s job.
   *
   * Nine keys, and nothing more: `common.retry`, `fields.email` and the whole
   * `errors.*` namespace via `errorText` cover the rest of the surface.
   *
   * **No plurals in this namespace.** Nothing here is counted, so
   * `catalogue-parity`'s plural-branch assertion has nothing to check and the
   * `es` / `pt-BR` `many` category is not in play. Worth stating, because the
   * guard test's existence implies a plural is expected somewhere.
   *
   * Seeded from the seven legacy `mpp-unsubscribe` labels, which shipped with
   * vetted Spanish and Portuguese — see the notes in the translated files for
   * what was adopted, adapted and rewritten.
   */
  unsubscribe: {
    /** Legacy showed a bare spinner; a sentence is kinder and is announced. */
    working: "One moment — updating your email preferences…",
    /**
     * Two headlines rather than one with a `{scope}` placeholder. Legacy has
     * exactly this split, and its Spanish and Portuguese confirm it is
     * structural rather than lexical — "Has sido desuscrito" and "Has sido
     * eliminado de nuestro servicio de notificaciones" share no verb.
     *
     * Neither names the publication: we never read `dp_Publications.Title` on
     * this path, and naming it would confirm that the link's `pubid` maps to a
     * real publication — a small oracle for no gain.
     */
    donePublication: "You have been unsubscribed.",
    doneBulk: "You have been removed from bulk email.",
    undoButton: "Undo",
    undone: "You have been re-subscribed.",
    undoFailed: "Unable to undo unsubscribe.",
    /**
     * Legacy's button read "My Subscriptions" — a widget's name, not an
     * action. A deliberate copy improvement.
     */
    manageLink: "Manage all my email preferences",
    badLink:
      "This unsubscribe link is incomplete. Please use the link in a recent email from us.",
    /** Accessible name for the `role="status"` region the headline lives in. */
    title: "Email Preferences",
  },

  userMenu: {
    /** Accessible name for the avatar button, which shows only a photo or initials. */
    menuLabel: "User menu",
    myAccount: "My Account",
    modalDescription: "Manage your account settings and preferences.",
    contributionStatement: "Contribution Statement",
    tabs: {
      profile: "Profile",
      family: "Family",
      groups: "Groups",
      giving: "Giving",
      subscriptions: "Subscriptions",
      invoices: "Invoices",
    },
  },
} as const;
