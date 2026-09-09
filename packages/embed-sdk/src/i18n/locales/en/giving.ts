/**
 * Giving widget namespaces. See `core.ts` for the shared namespaces and
 * `../../types.ts` for why this file is TypeScript rather than JSON.
 *
 * Covers `next-my-giving`, `next-my-pledges`, `next-pledge-campaign`,
 * `next-my-contribution-statement`, `next-statement-preferences`,
 * `next-checkout`, `next-checkout-complete`, `next-pay` and
 * `next-subscriptions`.
 *
 * What is deliberately absent: fund, program and publication names, invoice
 * line-item text, gateway status strings, and the statement PDFs themselves.
 * Those are MP-authored content, entered by the church in its own language, and
 * translating them here would mean overriding the church's own words.
 */
export const giving = {
  myGiving: {
    title: "My Giving",
    loading: "Loading giving history…",
    totalGiving: "Total Giving",
    includeSoftCredits: "Include Soft Credit Donations",
    /** The month filter's "no month chosen" option, which carries the year. */
    allMonths: "All Months {year}",
    byMonth: "By Month",
    byProgram: "By Program",
    chartEmpty: "No giving to chart.",
    /** Accessible names for the two charts, which are `role="img"`. */
    byMonthChartLabel: "Giving by month",
    byProgramChartLabel: "Giving by program",
    disclaimer:
      "The following list of Donations is informational and should not be used for tax purposes.",
    softCreditDisclaimer:
      "Soft credit donations are included below and reflect gifts you are credited with but did not personally contribute.",
    donations: "Donations",
    empty: "No donations",
    showMore: "SHOW MORE DONATIONS",
    /** Stands in for the date of a donation that has not yet settled. */
    pending: "PENDING",
    // The three row badges are upper-cased by CSS, so they are written in
    // sentence case here — an all-caps entry would read as shouting in a
    // locale whose upper-casing the badge style then applies again.
    badgeSpouse: "Spouse",
    badgeSoftCredit: "Soft credit",
    badgeNonDeductible: "Non-deductible",
  },

  myPledges: {
    title: "My Pledges",
    loading: "Loading pledges…",
    empty: "You are not associated with any pledges.",
    cancel: "Cancel Pledge",
    confirmCancel: "Cancel this pledge?",
    confirmCancelYes: "Cancel pledge",
    keep: "Keep",
    canceling: "Canceling…",
    canceled: "Pledge canceled",
    cancelFailed: "Error canceling the pledge, please try again.",
    /** Progress under the bar: "$250.00 of $1,000.00 (25%)". */
    progress: "{paid} of {total} ({percent})",
    installments: {
      one: "{count} installment beginning {date}",
      other: "{count} installments beginning {date}",
    },
    /** Accessible name for the placeholder heart icon. */
    iconLabel: "Pledge",
    /**
     * Pledge statuses. MP ships these four by name; a domain that adds its own
     * falls through to the raw MP value, which is the church's own wording.
     */
    status: {
      active: "Active",
      completed: "Completed",
      discontinued: "Discontinued",
      pending: "Pending",
    },
  },

  pledgeCampaign: {
    loading: "Loading campaign…",
    notSpecified: "No pledge campaign specified.",
    notFound: "No pledge campaign found.",
    closed: "This Campaign is no longer accepting new Pledges.",
    alreadyPledged:
      "You have already made a Pledge for this Campaign. Please ensure you want to pledge again.",
    pastEndDate: "You cannot give past the campaign end date.",
    pastEndDateOn: "You cannot give past the campaign end date ({date}).",
    saveFailed: "Unable to save your pledge.",
    /** Default thank-you; a campaign's own `onlineThankYouMessage` wins. */
    thankYou:
      "Thank you! Your response for {name} has been received. If desired, click the button below to respond for another household member.",
    /** Stands in for the pledger's name when neither the contact nor the form supplies one. */
    yourHousehold: "your household",
    /** Household-picker option for a member with no name on record. */
    myInfo: "My Info",
    defaultTitle: "Pledge Campaign",
    progress: "Progress",
    progressBarLabel: "Campaign progress",
    pledgedOfGoal: "{pledged} pledged of {goal} goal",
    receivedPercent: "{percent} received",
    pledgedPercent: "{percent} pledged",
    signInPrompt: "Please sign in to make a pledge for this campaign.",
    createPledge: "Create a Pledge",
    pledgeDetails: "Pledge Details",
    pledgeAmount: "Pledge Amount",
    selectFrequency: "Select Frequency",
    selectPlaceholder: "-- Select --",
    startDate: "Pledge Start Date",
    endDate: "Pledge End Date",
    totalPledge: "Total Pledge",
    makePledgeAs: "Make a Pledge as",
    blankForm: "Blank Form",
    submit: "Create Pledge",
    submitAnother: "Create Another Pledge",
  },

  contributionStatement: {
    title: "My Contribution Statements",
    loading: "Loading statements…",
    empty: "No statements currently available.",
    selectYear: "Select statement year",
    savePdf: "Save as PDF",
  },

  statementPreferences: {
    title: "Contribution Statements",
    loading: "Loading preferences…",
    goPaperless: "Go Paperless! Get statements online/via email.",
    updated: "Statement method updated",
    updateFailed: "Error updating the statement method, please try again.",
  },

  checkout: {
    header: "Invoice Details",
    processing: "Processing…",
    loading: "Loading invoice…",
    empty: "No invoice to display.",
    noInvoiceSpecified: "No invoice was specified.",
    processorMissing: "Payment processor is not configured.",
    invoiceDate: "Invoice Date",
    status: "Status",
    noLineItems: "No line items.",
    /** Fallback for a line item MP has no name for. */
    item: "Item",
    amountPaid: "Amount Paid",
    balanceDue: "Balance Due",
    paymentAmount: "Payment Amount",
    payInFull: "Pay in full ({amount})",
    payDeposit: "Pay deposit ({amount})",
    otherAmount: "Other amount",
    youWillPay: "You will pay",
    pay: "Pay",
    makeChanges: "Make Changes",
    paidInFull: "Paid in full",
    invalidAmount: "Please enter a valid payment amount.",
    paymentReceived: "Payment received — thank you!",
    paymentPending:
      "Your payment is being processed. This invoice will update once the payment clears.",
    paymentUnconfirmed: "We could not confirm your payment.",
    paymentUnconfirmedDetail: "We could not confirm your payment: {detail}",
  },

  checkoutComplete: {
    confirming: "Confirming your payment…",
    titleSuccess: "Payment Complete",
    titlePending: "Payment Pending",
    titleFailed: "Payment Not Confirmed",
    noPaymentInfo: "No payment information was found.",
    received: "Thank you! Your payment was received.",
    processing:
      "Thank you! Your payment is being processed and will be confirmed shortly.",
    failed: "We were unable to confirm your payment. Please try again or contact us.",
    unconfirmed: "We were unable to confirm your payment.",
  },

  pay: {
    header: "Secure Payment",
    /** The sandbox gateway says so in as many words; `{card}` is the test PAN. */
    sandboxNotice: "Sandbox payment — use test card {card}",
    loading: "Loading payment request…",
    noRequest: "No payment request was provided.",
    unavailable: "Payment request unavailable.",
    decodeFailed: "Could not decode the payment request.",
    invoice: "Invoice",
    amountDue: "Amount Due",
    nameOnCard: "Name on Card",
    /** A sample name, so it has to read as one in the target language. */
    namePlaceholder: "Jane Doe",
    cardNumber: "Card Number",
    expiry: "Expiry",
    /** Month/year mask: the letters are translated, the shape is not. */
    expiryPlaceholder: "MM/YY",
    cvv: "CVV",
    payAmount: "Pay {amount}",
    processing: "Processing…",
    submitFailed: "Payment could not be submitted.",
    enterName: "Please enter the name on the card.",
    enterCard: "Please enter a card number.",
    enterExpiry: "Please enter the expiry date.",
    enterCvv: "Please enter the CVV.",
  },

  subscriptions: {
    title: "My Subscriptions",
    subtitle: "Choose which publications you'd like to receive.",
    loading: "Loading subscriptions…",
    searchPlaceholder: "Search publications…",
    empty: "No publications available.",
    noMatches: "No publications match your search.",
    subscribed: "Subscribed to {title}",
    unsubscribed: "Unsubscribed from {title}",
    updateFailed: "Could not update subscription, please try again.",
  },
} as const;
