/**
 * Events-domain widget namespaces: `next-event-finder`, `next-event-details`,
 * `next-full-calendar` (and its sub-modules) and `next-add-to-calendar`.
 *
 * See `core.ts` for the shared namespaces and `../../types.ts` for why this
 * file is TypeScript rather than JSON.
 */
export const events = {
  eventFinder: {
    searchPlaceholder: "Search events…",
    /** Accessible name for the keyword input, which has no visible label. */
    searchLabel: "Search events",
    showAdvanced: "Advanced Search",
    hideAdvanced: "Hide Advanced Search",
    allCongregations: "All Congregations",
    allMinistries: "All Ministries",
    allMonths: "All Months",
    month: "Month",
    signupType: "Sign-up Type",
    signupBoth: "Both",
    signupRegistration: "Open Registration",
    signupVolunteer: "Open Volunteer Opportunities",
    loading: "Loading events…",
    empty: "No events found.",
    featured: "Featured",
  },

  eventDetails: {
    loading: "Loading event…",
    notAvailable: "This event is not available.",
    noEventSpecified: "No event specified.",
    backToEvents: "Back to events",
    /** Visibility gating — level 1 (private) and level 2 (staff only). */
    private: "This event is private.",
    staffOnly: "This event is only available to staff.",
    meetingInstructions: "Meeting Instructions",
    /** MP models several rooms per event, hence the parenthesised plural. */
    rooms: "Room(s)",
    contacts: "Contact(s)",
    /** Accessible name for the embedded Google Maps iframe. */
    mapTitle: "Event location map",
    register: "Register",
    volunteer: "Volunteer",
    emailFriend: "Email a Friend",
    emailUnavailable: "Emailing a friend is not available in this widget.",
    signInToRegister: "Please sign in to register for this event.",
    registrationInactive: "Registration is not currently active.",
    registrationFull: "Registration is full.",
    /**
     * The *registration* invoice timed out, not the sign-in session — distinct
     * from `errors.sessionExpired`, and the remedy is different too.
     */
    registrationSessionExpired: "Your registration session expired.",
    verifyDetails: "Please verify the registration details.",
    dobInFuture: "Date of birth cannot be in the future.",
    saveFailed: "Unable to save your registration.",
    savedAddAnother: "Saved. Add another person below.",
    registrationFailed: "Registration failed.",
    invoiceNotFound: "Unable to find the invoice.",
    deleteFailed: "Unable to delete the registration.",
    deleteError: "An error occurred while deleting the registration.",
    registerAs: "Register As",
    selectPrompt: "-- Select --",
    /**
     * Also the option's `value`, which the submit path matches on as a
     * sentinel. Only this label is translated; the value stays "Blank Form".
     */
    blankForm: "Blank Form",
    /** Fallback when a household member record carries no usable name. */
    myInfo: "My Info",
    alreadyRegistered: "This person is already registered for this event.",
    attendee: "Attendee",
    attendeeMinor: "Attendee (Minor)",
    parentGuardian: "Parent / Guardian",
    updateMyInfo: "Update my contact info with the above",
    addOns: "Add-ons",
    optionColumn: "Option",
    qtyColumn: "Qty",
    priceColumn: "Price",
    notSelected: "Not Selected",
    promoCode: "Promo Code",
    promoPlaceholder: "Enter code",
    promoApply: "Apply",
    promoInvalid: "Invalid promo code.",
    additionalInformation: "Additional Information",
    checkout: "Checkout",
    registerAndCheckout: "Register & Checkout",
    registerAndAddAnother: "Register & Add Another",
    participants: "Participants",
    participantNumber: "Participant {number}",
    minorLabel: "Minor: {name}",
    registered: "Registered",
  },

  /**
   * `next-full-calendar` plus its four rendering sub-modules (cards, list,
   * mini-cal, modal). They register no element of their own, so their copy
   * belongs to the widget that composes them.
   */
  fullCalendar: {
    loading: "Loading calendar…",
    initFailed: "Failed to load calendar. Please refresh the page.",
    libraryFailed: "Failed to load calendar library.",
    libraryUnavailable: "The calendar library is not available.",
    today: "Today",
    tomorrow: "Tomorrow",
    viewMonth: "Month",
    viewGrid: "Grid",
    viewWeek: "Week",
    viewList: "List",
    viewCards: "Cards",
    viewCalendar: "Calendar",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    /** Mini-calendar density legend: how many events one, two or three dots mean. */
    density1to3: "1-3 events",
    density4to6: "4-6 events",
    density7plus: "7+ events",
    campus: "Campus",
    noEventsFound: "No events found",
    /** Deliberately upper case: the card's call-to-action bar is set in caps. */
    learnMore: "LEARN MORE",
    showMore: "Show More",
    emptyPeriod: "No events scheduled for this period.",
    eventCount: { one: "{count} event", other: "{count} events" },
    featured: "Featured",
    register: "Register",
    /** Modal section shown only to staff. */
    adminDetails: "Admin Details",
    participants: "Participants",
    registration: "Registration",
    openInMinistryPlatform: "Open in Ministry Platform",
  },

  addToCalendar: {
    trigger: "Add to Calendar",
    loading: "Loading event…",
    /** Accessible name for the provider menu. */
    menuLabel: "Add {title} to calendar",
    /**
     * A missing or malformed `event-id`. The developer detail is logged; a
     * congregant only ever reads this.
     */
    notConfigured: "This calendar link is not configured correctly.",
    buildFailed: "Could not build the calendar entry.",
    /**
     * The one provider row that is prose rather than a brand name — Google
     * Calendar, Apple Calendar, Outlook.com, Microsoft 365 and Yahoo Calendar
     * are proper nouns and stay in the component.
     */
    otherIcs: "Other (.ics file)",
  },
} as const;
