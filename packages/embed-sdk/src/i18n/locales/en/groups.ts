/**
 * Groups & serving widget namespaces: `next-group-finder`,
 * `next-group-details`, `next-my-groups`, `next-opportunity-finder`,
 * `next-opportunity-details`, `next-plan-your-visit` and `next-custom-form`
 * (whose shared renderer, `shared/custom-form.ts`, draws from the same
 * `customForm` namespace).
 *
 * `meetsOnline`, `full` and `alreadyMeeting` appear in more than one namespace
 * here. That is deliberate: the wording is per-widget copy a church may want to
 * override on one widget without moving the others, and the surrounding
 * sentence differs ("Already meeting" as a card subtitle vs. as a labelled
 * detail row). Promote them to `core.ts` only if a third widget group needs the
 * same string.
 *
 * See `core.ts` for the shared namespaces and `../../types.ts` for why this
 * file is TypeScript rather than JSON.
 */
export const groups = {
  groupFinder: {
    searchPlaceholder: "Search groups…",
    /** Accessible name for the keyword input, which has no visible label. */
    searchLabel: "Search groups",
    showAdvanced: "Advanced Search",
    hideAdvanced: "Hide Advanced Search",
    allCongregations: "All Congregations",
    /** MP models a neighborhood as the group's parent group. */
    neighborhood: "Neighborhood",
    allNeighborhoods: "All Neighborhoods",
    cityOrPostalCode: "City or Postal Code",
    groupFocus: "Group Focus",
    allFocuses: "All Focuses",
    lifeStage: "Life Stage",
    allLifeStages: "All Life Stages",
    meetingDays: "Meeting Days",
    meetingTimes: "Meeting Times",
    meetsOnline: "Meets Online",
    morning: "Morning",
    lunchtime: "Lunchtime",
    afternoon: "Afternoon",
    evening: "Evening",
    loading: "Loading groups…",
    empty: "No groups found.",
    /** Shown when the result set was capped rather than exhausted. */
    truncated:
      "Showing the first results — refine your search to narrow them down.",
    /** Card placeholder when the group has no image and MP supplies no caption. */
    imagePlaceholder: "Group",
    full: "Full",
    capacity: "{filled} of {total}",
    alreadyMeeting: "Already meeting",
    startsOn: "Starts {date}",
    suggestGroup: "Suggest a Group",
    backToResults: "Back to results",
    groupName: "Group Name",
    description: "Description",
    selectCongregation: "Select a congregation",
    none: "None",
    anyDay: "Any Day",
    meetingDay: "Meeting Day",
    meetingTime: "Meeting Time",
    submitSuggestion: "Submit Suggestion",
    signInToSuggest: "Please sign in to suggest a group.",
    suggestFailed: "Unable to submit your suggestion.",
    suggestSuccess: "Thanks! Your group suggestion has been submitted.",
  },

  groupDetails: {
    loading: "Loading group…",
    backToGroups: "Back to groups",
    noGroupSpecified: "No group specified.",
    meetsOnline: "Meets Online",
    groupFocus: "Group Focus",
    lifeStage: "Life Stage",
    capacity: "Capacity",
    capacityOf: "{filled} of {total}",
    full: "Full",
    starts: "Starts",
    alreadyMeeting: "Already meeting",
    leaders: "Group Leader(s)",
    mapTitle: "Group location map",
    groupFull: "This group is currently full.",
    contactTab: "Contact this Group",
    signupTab: "Sign Up for this Group",
    alreadyContacted: "You have already contacted this group.",
    sendMessage: "Send Message",
    signInToSignUp: "Please sign in to sign up for this group.",
    alreadySignedUp: "You are already signed up for this group.",
    signUp: "Sign Up",
    contactAs: "Contact as",
    signUpAs: "Sign up as",
    /** The anonymous "Blank Form" option in the household-member picker. */
    someoneElse: "Someone else…",
    /** Fallback name for the signed-in contact when MP has no display name. */
    myInfo: "My Info",
    chooseSignup: "Please choose who is signing up.",
    inquirySent: "Thanks! Your message has been sent to the group.",
    inquirySentNamed: "Thanks, {name}! Your message has been sent to the group.",
    signedUp: "You're signed up! The group leader will be in touch.",
    signedUpNamed:
      "You're signed up, {name}! The group leader will be in touch.",
  },

  myGroups: {
    title: "My Groups",
    loading: "Loading groups…",
    empty: "You are not currently in any groups.",
    leader: "Leader",
    meetsOnline: "Meets Online",
    /** One badge carries both facts, so it is one string rather than a join. */
    leaderAndOnline: "Leader · Meets Online",
    /** Accessible name for the placeholder icon on a group with no image. */
    imageLabel: "Group",
    dayAtTime: "{day} @ {time}",
    alreadyMeeting: "Already Meeting",
    startsOn: "Starts: {date}",
    /** MinistryPlatform product names — intentionally the same in every locale. */
    groupConnect: "Group Connect",
    volunteerConnect: "Volunteer Connect",
  },

  opportunityFinder: {
    searchPlaceholder: "Search opportunities…",
    /** Accessible name for the keyword input, which has no visible label. */
    searchLabel: "Search opportunities",
    showAdvanced: "Advanced Search",
    hideAdvanced: "Hide Advanced Search",
    allCongregations: "All Congregations",
    allMinistries: "All Ministries",
    anyGender: "Any Gender",
    minimumAge: "Minimum Age",
    anyAge: "Any",
    frequency: "Frequency",
    allOpportunities: "All Opportunities",
    ongoing: "Ongoing",
    oneTime: "One Time",
    attributes: "Attributes",
    loading: "Loading opportunities…",
    empty: "No opportunities found.",
    featured: "Featured",
    /** Weekly recurrence around an MP-authored day name ("Mondays"). */
    everyDay: "{day}s",
  },

  opportunityDetails: {
    loading: "Loading opportunity…",
    backToOpportunities: "Back to opportunities",
    noOpportunitySpecified: "No opportunity specified.",
    ongoing: "Ongoing",
    /** Weekly recurrence around an MP-authored day name ("Mondays"). */
    everyDay: "{day}s",
    volunteersNeeded: "Volunteers Needed",
    mapTitle: "Opportunity location map",
    respondTitle: "Respond",
    respondAs: "Respond As",
    someoneElse: "Someone Else (Blank Form)",
    /** Fallback name for the signed-in contact when MP has no display name. */
    myInfo: "My Info",
    yourInformation: "Your Information",
    messagePlaceholder: "Anything you'd like the contact to know?",
    additionalInformation: "Additional Information",
    submitResponse: "Submit Response",
    submitAnother: "Submit Another Response",
    alreadyResponded: "You have already responded to this opportunity.",
    maximumReached: "The maximum number of volunteers has been reached.",
    signInToRespond: "Please sign in to respond to this opportunity.",
    verifyDetails: "Please verify the response details.",
    responseFailed: "Unable to save your response.",
    responseReceived: "Thank you! Your response has been received.",
    responseReceivedNamed: "Thank you, {name}! Your response has been received.",
  },

  planYourVisit: {
    title: "Plan Your Visit",
    lead: "Tell us a little about you and we'll email you a link to finish planning your first visit.",
    sendVerification: "Send Verification Email",
    accountExists: "An account already exists for that email.",
    verificationFailed: "We couldn't send the verification email.",
    verificationSent:
      "Check your email — we've sent you a link to finish planning your visit.",
    linkAccountExists:
      "An account already exists for this email. Please sign in instead.",
    linkInvalid: "This link is invalid or has expired. Please start again.",
    detailsLead:
      "Please fill out the information below so we can make your visit special.",
    visitDetails: "Visit Details",
    selectCongregation: "Select a congregation",
    whenCanWeExpectYou: "When can we expect you?",
    yourDetails: "Your Details",
    /** Narrower than `fields.stateRegion`: this form asks for a US/CA address. */
    stateProvince: "State / Province",
    zipPostalCode: "Zip / Postal Code",
    familyMembers: "Additional Family Members",
    spouse: "Spouse",
    child: "Child",
    addChild: "Add child",
    removeChild: "Remove child",
    ageOrGradeGroup: "Age or Grade Group",
    selectGroup: "Select a group",
    saveFailed: "We couldn't save your information.",
    submitted:
      "Thank you! Your visit details have been received. We can't wait to meet you.",
  },

  customForm: {
    loading: "Loading form…",
    noFormSpecified: "No form specified.",
    expired: "This form is no longer available.",
    /** Used only when the form definition carries no completion message. */
    completed: "Thank you! Your form has been submitted.",
    signInToComplete: "Please sign in to complete this form.",
    yourInformation: "Your Information",
    /** Empty first option of an MP dropdown field. */
    selectOption: "-- Select --",
    fileUploadUnsupported: "File uploads are not submitted in this version.",
  },
} as const;
