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
