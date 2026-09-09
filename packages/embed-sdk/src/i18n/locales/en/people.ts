/**
 * People widget namespaces. See `core.ts` for the shared namespaces and
 * `../../types.ts` for why this file is TypeScript rather than JSON.
 *
 * These three widgets are form-heavy and mostly field labels, so the great
 * majority of their copy is already in `fields.*` / `common.*`; what lands here
 * is only the wording that is genuinely specific to one widget.
 *
 * MP-authored content is deliberately absent: people's names, household names,
 * congregation names, household positions and the option labels of the
 * MP-driven dropdowns (prefix, suffix, gender, marital status) come from the
 * domain's own lookup tables and are rendered as the church typed them.
 */
export const people = {
  myHousehold: {
    title: "My Household",
    loading: "Loading household…",
    empty: "No household found for your account.",
    /** Fieldset legend, and the heading fallback when MP has no household name. */
    householdLabel: "Household",
    householdName: "Household Name",
    /** Form header and the pencil button's accessible name. */
    editHousehold: "Edit Household",
    primaryAddress: "Primary Address",
    /** Card label on the details view; the form's legend spells out both words. */
    seasonalAddress: "Seasonal Address",
    seasonalAddressSection: "Seasonal / Alternative Address",
    noAddress: "No address on file.",
    seasonStart: "Season Start",
    seasonEnd: "Season End",
    repeatAnnually: "Repeat Annually",
    /**
     * The seasonal date range. Four shapes rather than one with optional parts,
     * because the preposition and the word order differ per language.
     */
    seasonRangeAnnual: "{start} – {end} annually",
    seasonStartAnnual: "{start} annually",
    seasonFrom: "From {date}",
    seasonUntil: "Until {date}",
    homePhoneUnlisted: "Home Phone Unlisted",
    homeAddressUnlisted: "Home Address Unlisted",
    members: "Members",
    addMember: "+ Add Household Member",
    /** Heading fallback for a member MP gave us no name for. */
    memberFallbackName: "Member",
    addMemberTitle: "Add Member",
    editMemberTitle: "Edit {name}",
    householdPosition: "Household Position",
    contactInformation: "Contact Information",
    communicationPreferences: "Communication Preferences",
    emailUnlisted: "Email Unlisted",
    mobilePhoneUnlisted: "Mobile Phone Unlisted",
    doNotText: "Do Not Text",
    bulkEmailOptOut: "Bulk Email Opt Out",
    removeFromDirectory: "Remove From Directory",
    memberPhotoAlt: "Member photo",
    addPhoto: "Add Photo",
    changePhoto: "Change Photo",
    photoHint: "JPEG, PNG, GIF or WebP. Max 10MB.",
    photoTooLarge: "Photo must be under 10MB.",
    saveHousehold: "Save Household",
    saveMember: "Save Member",
    fixHighlighted: "Please fix the highlighted fields.",
    householdSaved: "Household saved successfully.",
    memberSaved: "Member saved successfully.",
  },

  profile: {
    loading: "Loading profile…",
    photoAlt: "Profile photo",
    greeting: "Hi, {name}!",
    intro:
      "Enter your information below, then click Save. This will only be visible to church staff unless you choose to share it with others.",
    /** Day-of-birth selects, which are three controls under one label. */
    month: "Month",
    day: "Day",
    year: "Year",
    contactInformation: "Contact Information",
    contactPrompt: "How should we contact you?",
    smsOptIn: "I agree to opt in to text messages from {org}",
    /** Stands in for the church name when the build configured none. */
    orgFallback: "our organization",
    smsRates:
      "Message and data rates may apply. Message frequency varies and you may opt out at any time.",
    bulkEmailOptOut: "Do not send me bulk email messages",
    saveProfile: "Save Profile",
    saved: "Profile saved successfully.",
    changePassword: "Change Password",
    currentPassword: "Current Password",
    newPassword: "New Password",
    confirmPassword: "Confirm New Password",
    passwordChanged: "Password changed successfully.",
    passwordsDoNotMatch: "Passwords do not match",
    photoTypeInvalid: "Please upload a JPEG, PNG, GIF, or WebP image.",
    photoTooLarge: "Photo must be under 5MB.",
    /**
     * MP holds first and last name separately, so a couple entered as
     * "Bob & Jane" corrupts both records downstream.
     */
    firstNameOnly: 'Please enter only your first name (no "&" or "and")',
    phoneFormat: "Use format: 999-999-9999",
  },

  onlineDirectory: {
    title: "Directory",
    loading: "Loading directory…",
    signInRequired: "Please sign in to view the directory.",
    accessDenied: "You do not have access to the directory.",
    loadFailed: "Unable to load the directory.",
    searchLabel: "Search by name, phone, or email",
    /** The minimum comes from the church's own directory configuration. */
    searchPlaceholder: {
      one: "Type at least {count} character…",
      other: "Type at least {count} characters…",
    },
    minLengthHint: {
      one: "Enter at least {count} character to search the directory.",
      other: "Enter at least {count} characters to search the directory.",
    },
    allCongregations: "All Congregations",
    searching: "Searching…",
    noResults: "No results found.",
    truncated:
      "Showing the first results — refine your search to narrow them down.",
    searchFailed: "Search failed.",
    /** The household filter chip; `{name}` is the MP household name. */
    familyChip: "{name} Family",
    clearFamilyFilter: "Clear family filter",
    family: "Family",
    viewFamily: "View family",
    map: "Map",
    addBirthday: "Add birthday to calendar",
    /** Title of the birthday `.ics` this widget generates. */
    birthdaySummary: "Happy Birthday {name}!",
    emailTitle: "Email {name}",
    subject: "Subject",
    send: "Send",
    sent: "Sent",
    sendFailed: "Unable to send the message.",
  },
} as const;
