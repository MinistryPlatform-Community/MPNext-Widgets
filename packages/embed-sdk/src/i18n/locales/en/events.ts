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

  /**
   * `next-pre-check` (C78) — a household checks itself in before Sunday.
   *
   * **This namespace had no legacy seed.** MP ships 38 label files under
   * `DatabaseScripts/ApplicationLabels/` and there is no `mpp-pre-check.json`
   * among them, exactly consistent with the legacy widget's
   * `excludeFromConfigurator:!0` — its own `new I18N("mpp-pre-check")` resolved
   * against nothing, which is why every string in that widget is a raw English
   * literal in the source. So unlike its three siblings there was no
   * MP-authored translation to lift: the `es` and `pt-BR` copy below is
   * written, not ported.
   *
   * Kept deliberately short. The submit control, the retry, the sign-in label
   * and the date field all come from `common.*` / `fields.*`, so `preCheck`
   * carries only copy that is genuinely specific to pre-check.
   *
   * **No `rowLabel` key, on purpose.** A row is composed structurally — the
   * time, the event title, the group name and the role, each in its own
   * element — rather than interpolated into one sentence, because punctuation
   * and ordering differ across the three locales. The event title and group
   * name are MP-authored and are not translatable by a file-based catalogue
   * either way.
   */
  preCheck: {
    title: "Pre Check-In",
    intro: "Check your family in before you arrive.",
    loading: "Loading your family's events…",
    /**
     * Not an error state. A Tuesday has no Sunday classes, and MP's own
     * check-in visibility rule legitimately hides a household whose groups do
     * not match the event's.
     */
    emptyNoEvents: "There are no check-in events on {date}.",
    /** `dual` / `hardened`: a real Sign In button sits under this. */
    signedOutPrompt: "Sign in to check your family in.",
    /**
     * `legacy`: the SDK cannot start a sign-in, so the copy names the page's
     * own control and **no button is drawn**. Legacy always drew a button
     * whether or not it could work; a button that silently does nothing is
     * worse than none.
     */
    signedOutLegacy:
      "Please sign in using the sign-in link on this page to check your family in.",
    selectAll: "Select all",
    clearAll: "Clear all",
    /** Shown on a row a check-in station has already scanned or confirmed. */
    attendedLocked: "Already checked in",
    /** Accessible name for one member's group of checkboxes. */
    memberEventsLabel: "Events for {name}",
    save: "Check In",
    qrTitle: "Your check-in code",
    qrHelp: "Show this code at the check-in station.",
    qrUnavailable: "The check-in code is not available right now.",
    savedCount: {
      one: "{count} person is checked in for {date}.",
      other: "{count} people are checked in for {date}.",
    },
    /** Follows `savedCount` when the save also cancelled something. */
    cancelledNote: "Anyone you unchecked has been removed.",
    /** Nothing ticked and nothing to cancel — the save was a no-op. */
    savedNone: "Nobody is checked in for {date}.",
    /**
     * The submitted selection did not match what the server holds — a page
     * left open while someone else in the household saved, most often. The
     * copy says what to do rather than naming the mismatch.
     */
    staleSelection:
      "This page is out of date. It has been refreshed — please check your choices and try again.",
  },
} as const;
