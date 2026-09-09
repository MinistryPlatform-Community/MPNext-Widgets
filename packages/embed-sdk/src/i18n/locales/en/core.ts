/**
 * Shared message namespaces: copy that appears in more than one widget.
 *
 * `common.retry` alone had **17** independent copies of the string "Try Again"
 * in the pre-i18n tree, `common.unableToLoad` had 8, `common.signIn` 8. Those
 * collapse to one entry each here, which is why ~1,900 raw literals reduce to
 * roughly 1,200 catalogue keys.
 *
 * Put a string here only when two or more widgets genuinely share it *and* the
 * shared wording is intentional. Resist the urge to parameterise widget-specific
 * copy into a generic key — "Loading {thing}…" reads fine in English and breaks
 * in Spanish and Portuguese, where the article and the noun's gender have to
 * agree ("Cargando eventos" vs "Cargando la información"). Each widget owns its
 * own loading and empty-state lines in its own namespace.
 */
export const core = {
  common: {
    loading: "Loading…",
    retry: "Try Again",
    unableToLoad: "Unable to Load",
    signIn: "Sign In",
    signOut: "Sign Out",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    close: "Close",
    edit: "Edit",
    remove: "Remove",
    submit: "Submit",
    submitting: "Submitting…",
    search: "Search",
    back: "Back",
    next: "Next",
    previous: "Previous",
    total: "Total",
    all: "All",
    yes: "Yes",
    no: "No",
    optional: "optional",
    required: "required",
    seeDetails: "See Details",
    getDirections: "Get Directions",
    signInPrompt: "Please sign in to continue.",
    dismiss: "Dismiss",
  },

  /**
   * Shared form-field labels. These recur across `custom-form`, `profile`,
   * `my-household`, `plan-your-visit`, `group-details` and `checkout` — eight
   * copies of "Mobile Phone" in the pre-i18n tree, four of "Last Name".
   */
  fields: {
    firstName: "First Name",
    lastName: "Last Name",
    middleName: "Middle Name",
    nickname: "Nickname",
    prefix: "Prefix",
    suffix: "Suffix",
    email: "Email",
    mobilePhone: "Mobile Phone",
    homePhone: "Home Phone",
    workPhone: "Work Phone",
    addressLine1: "Address Line 1",
    addressLine2: "Address Line 2",
    city: "City",
    stateRegion: "State / Region",
    postalCode: "Postal Code",
    country: "Country",
    address: "Address",
    dateOfBirth: "Date of Birth",
    gender: "Gender",
    maritalStatus: "Marital Status",
    congregation: "Congregation",
    ministry: "Ministry",
    name: "Name",
    message: "Message",
    notes: "Notes",
    amount: "Amount",
    date: "Date",
    location: "Location",
    contact: "Contact",
    personalDetails: "Personal Details",
  },

  /**
   * Client-side form validation, from `shared/form-validation.ts`. Every widget
   * form routes through that module, so these reach all of them at once.
   */
  validation: {
    required: "This field is required.",
    email: "Enter a valid email address.",
    url: "Enter a valid URL.",
    pattern: "Please match the requested format.",
    tooShort: "Please use at least {min} characters.",
    tooLong: "Please use {max} characters or fewer.",
    outOfRange: "Value is out of range.",
    invalidValue: "Please enter a valid value.",
    generic: "Please correct this field.",
    formIncomplete: "Please complete the required fields.",
    phone: "Enter a valid phone number.",
  },

  /**
   * Errors keyed by the **machine code** the API returns, not by its English
   * message. `src/app/api/embed/*` responds `{ error: "<code>", message: "…" }`
   * where `message` is English and debug-only (logged, never rendered) — so the
   * API stays language-agnostic and a visitor never sees a raw server string.
   *
   * `generic` catches any code with no entry here, which is what makes adding a
   * new route safe: an unmapped code degrades to a sensible sentence rather than
   * leaking "Missing formId or formGuid" to a congregant.
   */
  errors: {
    generic: "Something went wrong. Please try again.",
    network: "We could not reach the server. Check your connection and try again.",
    authRequired: "Please sign in to continue.",
    sessionExpired: "Your session has expired. Please sign in again.",
    forbidden: "You do not have permission to view this.",
    notFound: "We could not find what you were looking for.",
    rateLimited: "Too many requests. Please wait a moment and try again.",
    invalidRequest: "That request was not valid. Please try again.",
    saveFailed: "We could not save your changes. Please try again.",
    submitFailed: "Submission failed. Please try again.",
    // Route-specific codes.
    invalid_session: "Your session has expired. Please sign in again.",
    invalid_code: "That sign-in link is no longer valid. Please sign in again.",
    // `next-unsubscribe`, when a sealed `?t=` token has expired or been
    // tampered with and there is no `?cg=` to fall back to. Deliberately NOT
    // `invalid_code`, whose sentence is about signing in and which CLAUDE.md
    // names a protocol signal the SDK auth ladder reads. The sentence points at
    // the two ways out that actually exist: a newer email, or the manage link
    // the widget renders directly below it.
    link_expired:
      "That link is no longer valid. Please use the unsubscribe link in a recent email, or manage your preferences below.",
    // ── `next-prayer-feedback` (C69), shared with C70's opt-in ──
    //
    // The three `verification_*` sentences are written **neutrally**, because
    // more than one widget renders them: a message three widgets share cannot
    // be phrased for one of them. Widget-specific warmth belongs in the
    // widget's own namespace (`prayerFeedback.*`), not here.
    feedback_type_not_allowed: "That option is not available on this form.",
    feedback_type_not_found: "That option is no longer available. Please choose another.",
    template_not_configured: "This form is not fully configured. Please contact the church.",
    invalid_return_url: "That request was not valid. Please try again.",
    email_send_failed: "We could not send the confirmation email. Please try again.",
    verification_invalid: "This link is not valid. Please submit the form again.",
    verification_expired: "This link has expired. Please submit the form again.",
    verification_used: "This link has already been used.",
    feedback_save_failed: "We could not submit your request. Please try again.",
    user_not_found: "We could not find your account.",
    contact_not_found: "We could not find your contact record.",
    donor_not_found: "No donor record is linked to your account.",
    invoice_not_found: "We could not find that invoice.",
    invoice_not_payable: "That invoice is not available for payment.",
    event_not_found: "We could not find that event.",
    form_not_found: "We could not find that form.",
    group_not_found: "We could not find that group.",
    opportunity_not_found: "We could not find that opportunity.",
    // `next-subscribe-to-publication` (C70). Covers a publication that does
    // not exist **and** one that is not `Available_Online`, because the route
    // answers the same code for both — a distinguishable pair would let the
    // id space be probed for internal publications.
    publication_not_found: "We could not find that publication.",
    payment_declined: "The payment was declined. Please try another method.",
    campaign_not_found: "We could not find that giving campaign.",
    household_not_found: "We could not find your household.",
    profile_not_found: "We could not find your profile.",
    photo_not_found: "There is no photo on file.",
    not_head_of_household: "Only the head of household can make this change.",
    not_household_member: "That person is not part of your household.",
    directory_forbidden: "You do not have access to the member directory.",
    pledge_forbidden: "You do not have permission to change this pledge.",
    validation_failed: "Please check the highlighted fields and try again.",
    no_file: "Please choose a file first.",
    invalid_file_type: "Please upload a JPEG, PNG, GIF or WebP image.",
    // The two upload routes enforce different limits (5MB profile, 10MB
    // household), so the number stays in the server's English `message` for the
    // log and the rendered sentence is limit-free rather than sometimes wrong.
    file_too_large: "That file is too large. Please choose a smaller image.",
  },

  localeSelector: {
    label: "Language",
    /** Screen-reader name for the control when rendered without a visible label. */
    ariaLabel: "Choose a language",
  },
} as const;
