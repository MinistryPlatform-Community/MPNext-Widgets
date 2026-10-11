/**
 * Giving widget namespaces. See `core.ts` for the shared namespaces and
 * `../../types.ts` for why this file is TypeScript rather than JSON.
 *
 * Covers `next-my-giving`, `next-my-pledges`, `next-pledge-campaign`,
 * `next-my-contribution-statement`, `next-statement-preferences`,
 * `next-checkout`, `next-checkout-complete`, `next-pay`,
 * `next-subscriptions` and `next-subscribe-to-publication`.
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
      "Soft credit donations are gifts you are credited with but did not personally contribute. Their amounts are excluded from your Total Giving and will not appear on your tax statement.",
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
    /** Signed-out prompt (C30); legacy: "Please login to view your giving information." */
    signInPrompt: "Please sign in to view your giving information.",
    // ── By Month chart readout (C33) ──
    /** Column header of the hidden data table behind the By Month chart. */
    month: "Month",
    /** A month with its year: "March 2026". Also the month picker's options (C37). */
    monthYear: "{month} {year}",
    /** Native tooltip on a By Month bar: "March 2026: $1,250.00". */
    barTooltip: "{label}: {amount}",
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
    /** Signed-out prompt (C30); legacy: "Please login to view your pledges". */
    signInPrompt: "Please sign in to view your pledges.",
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

    // ── Registration window and capacity (C76 phase 1) ──
    //
    // Four states that `closed` above used to swallow. They are written
    // separately because they differ in what the visitor should do next: a
    // full campaign is over for them, a window that has not opened yet is
    // worth coming back for, and a closed one is not. `api_MPPW_GetPledgeCampaign`
    // has always returned the fields; the widget simply never read them, so a
    // trip with a full bus accepted applications forever.
    //
    // Deliberately campaign-neutral wording rather than trip wording: this is
    // `next-pledge-campaign`, which serves capital campaigns too, and the
    // capacity defect was never trip-specific.
    full: "This campaign is full. All available spots have been taken.",
    registrationNotOpen: "Registration is not open yet.",
    registrationOpensOn: "Registration opens on {date}.",
    registrationClosed: "Registration for this campaign has closed.",
    registrationClosedOn: "Registration for this campaign closed on {date}.",
    // ── Amount limits (C32) ──
    //
    // `{amount}` is a formatted currency value: $0.00 for the floor, the flat
    // ceiling (MAX_PLEDGE_AMOUNT) for the two upper bounds.
    amountTooLow: "Enter a pledge amount greater than {amount}.",
    amountTooHigh: "Enter a pledge amount of {amount} or less.",
    totalTooHigh: "Your total pledge cannot be more than {amount}. Check the amount and the schedule.",
    /** The dates and frequency chosen yield no installment, so the total is $0.00. */
    scheduleEmpty:
      "This schedule has no installments. Choose a later end date or a different frequency.",
  },

  contributionStatement: {
    title: "My Contribution Statements",
    loading: "Loading statements…",
    empty: "No statements currently available.",
    selectYear: "Select statement year",
    savePdf: "Save as PDF",
    /** Signed-out prompt (C30); legacy: "Please login to view your contribution statements." */
    signInPrompt: "Please sign in to view your contribution statements.",
    // ── Save as PDF fallback (C34) ──
    // Shown only when MP's file host refused the direct download and the
    // browser then blocked the new tab: a real link the donor can press.
    popupBlocked: "Your browser blocked the statement from opening.",
    openStatement: "Open the statement",
    /** Link across to the page hosting My Giving (C62, `my-giving-url`); legacy: "See My Giving Page >". */
    myGivingLink: "See my giving →",
  },

  statementPreferences: {
    title: "Contribution Statements",
    loading: "Loading preferences…",
    goPaperless: "Go Paperless! Get statements online/via email.",
    updated: "Statement method updated",
    updateFailed: "Error updating the statement method, please try again.",
    /** Signed-out prompt (C30). */
    signInPrompt: "Please sign in to manage how you receive your contribution statements.",
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
    paymentDeclined: "Your payment was declined and nothing was charged. Please try another card.",
    paymentError: "We could not record your payment. Please contact us before trying again, so you are not charged twice.",
    amountTooHigh: "The amount cannot be more than the balance due ({amount}).",
    balanceChanged: "The balance on this invoice has changed. Please review it and try again.",
    registrationComplete: "Your registration is complete.",
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
    unconfirmed: "We were unable to confirm your payment.",
    titleDeclined: "Payment Declined",
    declined: "Your payment was declined and nothing was charged. Please return to your invoice and try another card.",
    error: "We could not record your payment. Please contact us before trying again, so you are not charged twice.",
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
    linkUsedTitle: "This payment link has already been used",
    linkUsed: "Nothing more has been charged. Return to your invoice to see its current balance.",
    linkExpiredTitle: "This payment link has expired",
    linkExpired: "Nothing has been charged. Return to your invoice and start the payment again.",
    returnToInvoice: "Return to invoice",
    invalidCard: "Please enter a valid card number.",
    invalidExpiry: "Please enter the expiry date as MM/YY.",
    expiredCard: "This card has expired.",
    invalidCvv: "Please enter the 3- or 4-digit security code.",
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
    signInPrompt: "Please sign in to view your subscriptions.",
    /**
     * C55. One string for the bulk-email control in both `next-subscriptions` and
     * `next-profile`, phrased positively (checked = receives email) instead of
     * legacy's double negative; the widgets invert it onto `Bulk_Email_Opt_Out`.
     */
    bulkEmailTitle: "All church email",
    sendBulkEmail: "Send me general church emails",
    bulkEmailHint: "Turn this off to stop all bulk email from the church.",
    bulkEmailOn: "You'll receive general church emails again.",
    bulkEmailOff: "You won't receive bulk email from the church.",
  },
  /**
   * `next-subscribe-to-publication` (C70) — the anonymous, email-verified
   * opt-in that legacy had and the new stack did not.
   *
   * Here rather than in `core.ts` because none of it is shared, and here rather
   * than in `people.ts` because this is the publication lifecycle: the same two
   * tables and the same subscription state as `subscriptions` twenty lines
   * above.
   *
   * Seeded from legacy's 13 `mpp-subscribe-to-publication` labels, which
   * shipped with vetted Spanish and Portuguese. Two things had to be fixed
   * rather than copied, and both are recorded in the translated files: the
   * register (legacy's Spanish is `tú`, its Portuguese European `tu`, ours are
   * `usted` / `você`), and the **merge token**, which legacy's own translations
   * dropped from `emailSentConfirmation` and *translated* in the Portuguese
   * `publicationDescription` — `[Título de Publicação]` would simply not
   * interpolate. `catalogue-parity.test.ts` now makes that class of mistake a
   * test failure rather than worse copy.
   *
   * **No plurals.** Nothing here counts anything, so the CLDR trap does not
   * arise — worth stating, because `es` and `pt-BR` both report `many` and a
   * two-branch plural would fail parity for both.
   *
   * Reused rather than re-added, which is what `core.ts` is for:
   * `fields.firstName` / `lastName` / `email` (legacy had all three),
   * `validation.formIncomplete` (legacy's `validationFailedMessage`),
   * `common.loading` / `submitting` / `retry` / `unableToLoad`, and the
   * `errors.*` set — including the three `verification_*` sentences C69 wrote
   * neutrally for exactly this reason.
   */
  subscribeToPublication: {
    /** Accessible name for the `role="status"` region every state paints into. */
    title: "Email Subscription",
    /** Legacy's `publicationDescription`, split: the heading half. */
    heading: "Subscribe to {title}",
    /** And the instruction half, which legacy ran into the same sentence. */
    lead: "Complete the form below and we'll email you a link to confirm your subscription.",
    loading: "Loading publication…",
    /**
     * Legacy's button read "Send" (*Enviar*), which describes the mechanism
     * rather than what the visitor is doing. They are subscribing.
     */
    submit: "Subscribe",
    checkEmailTitle: "Check your email",
    checkEmail:
      "We've sent a confirmation link to {email}. Open it to finish subscribing to {title}.",
    verifying: "Confirming your subscription…",
    verifiedTitle: "You're subscribed",
    verified: "You'll start receiving {title} at {email}.",
    /**
     * Three link states, not one "bad link" message, because they differ in
     * **affordance**: this one offers a fresh sign-up…
     */
    linkExpired: "That confirmation link has expired. Sign up again to get a new one.",
    /** …this one the same… */
    linkInvalid: "That confirmation link isn't valid. Please sign up again.",
    /**
     * …and this one neither, because the likeliest cause is a second click on
     * a link that already worked. Legacy's links were replayable, so this
     * state could not arise there.
     *
     * It leads with the reassurance and never with "already been used", which
     * reads as a rebuke for succeeding: the visitor almost certainly is
     * subscribed and is simply seeing the page twice. It must not read as an
     * error, and it must not imply they need to do anything.
     */
    linkUsed: "You're all set — this link has already been confirmed.",
    /** Legacy's `publicationDoesNotExist`, phrased for a visitor. */
    notAvailable: "This publication isn't available for online sign-up.",
    signUpAgain: "Sign Up Again",
    privacyNote: "We'll only email you {title}, and you can unsubscribe from any message.",
    managePreferences: "Manage all your email preferences",
  },

  /**
   * `next-mission-trip-finder` (C76) — the public trip search.
   *
   * Here rather than in `events.ts` because a mission trip is a
   * `Pledge_Campaign` with a fundraising goal, and the details page a card
   * links to is `next-pledge-campaign`, forty lines above.
   *
   * Seeded from MP's own `mpp-mission-trip-finder.json`, which ships vetted
   * Spanish and Portuguese for 12 labels. Six of those were **not** adopted:
   * `congregationLabel` ("Campus") is a church-configurable term and belongs
   * behind `MPNextEmbed.setMessages()`, `seeDetailsButtonText` is
   * `common.seeDetails`, `ministryLabel` is `fields.ministry`, and the
   * advanced-search pair has no analogue here — this finder's filters are
   * attributes a church sets, not dropdowns a visitor opens, because the
   * search route exposes no config endpoint to populate them from.
   */
  missionTripFinder: {
    title: "Mission Trips",
    loading: "Loading mission trips…",
    /** MP's `noMissionTripsFoundMessage`, without its leading literal "0". */
    empty: "No mission trips found. Please try again with different search criteria.",
    searchPlaceholder: "Search mission trips…",
    searchLabel: "Search mission trips",
    /**
     * The capacity badge. Full trips are still listed unless the church sets
     * `show-full-trips="false"`, so the badge is the honest signal — legacy
     * had only the (inverted) filter and no badge at all.
     */
    full: "Trip is full",
    openForRegistration: "Open for registration",
    registrationOpens: "Registration opens {date}",
    registrationCloses: "Registration closes {date}",
    registrationClosed: "Registration closed",
    /** `{dates}` is already a formatted range and always carries the year (C09). */
    tripDates: "Trip dates: {dates}",
    spotsLeft: {
      one: "{count} spot left",
      other: "{count} spots left",
    },
    resultsCount: {
      one: "{count} mission trip",
      other: "{count} mission trips",
    },
  },

  /**
   * `next-my-mission-trips` (C76) — the participant's own trips, their donor
   * list and, for a trip leader, the team roster.
   *
   * Reused rather than re-added: `myPledges.progress` for the fundraising bar
   * and `myPledges.status.*` for the four MP pledge statuses (MP's own
   * `mpp-my-mission-trips.json` carries a second copy of all four; adopting it
   * would have put the same words under two keys in three catalogues),
   * `fields.name` / `address` / `mobilePhone` / `email` / `amount` / `notes` /
   * `date` for the two grids' column headers, and `common.signIn`.
   */
  myMissionTrips: {
    title: "My Mission Trips",
    loading: "Loading mission trips…",
    empty: "No mission trips found.",
    /**
     * Its own sentence rather than `common.signInPrompt`, because legacy had
     * one and it says what the visitor gets for signing in.
     */
    signInPrompt: "Please sign in to view your mission trips.",
    /** Legacy's section for a household member's trip (`isMine` false). */
    familyTitle: "Family Mission Trips",
    leader: "Trip leader",
    tripDates: "Trip dates: {dates}",
    supportProgress: "My Support Progress",
    donorsTitle: "My Donors",
    /** Legacy's copy, which is warmer than an empty-state sentence needs to be and right to be. */
    donorsEmpty:
      "Once people start donating, their contact information displays here so you can thank them for their support!",
    /**
     * Rendered in place of the server's donor name when `anonymous` is set.
     * The route already collapses the name, but it collapses it to English —
     * this is the translated one, and the reason the flag is on the wire at
     * all rather than only the label.
     */
    anonymousDonor: "Anonymous Donor",
    teamTitle: "Team Progress",
    teamEmpty: "No team members yet.",
    pledgeStatus: "Pledge Status",
    supportGoal: "Support Goal",
    amountRaised: "Amount Raised",
    progress: "Progress",
  },
} as const;
