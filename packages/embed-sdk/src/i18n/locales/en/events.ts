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
} as const;
