/**
 * Mission trips (C76) — `next-mission-trip-finder` and `next-my-mission-trips`.
 *
 * **Two elements, not the three legacy tags.** `api_MPPW_GetPledgeCampaign`
 * declares `@IsMissionTrip bit` and never references it in the body, so
 * `mpp-mission-trip` and `mpp-pledge-campaign` fetch identical data; both also
 * share the household "apply as" picker, the custom form, the has-pledged check
 * and the confirmation email. `next-pledge-campaign` is already a functional
 * superset and serves as the details page — it gains only the registration
 * window and capacity fields in `pledge-campaign.ts`.
 *
 * Mission trips are `Pledge_Campaigns` with `Pledge_Campaign_Type_ID = 2`
 * ("Mission Project/Trip"). Participants are `Pledges` rows; fundraising is
 * `Donation_Distributions` joined on `Pledge_ID`.
 *
 * Every date on the wire here is an MP **wall-clock string, passed through
 * verbatim**. Do not re-serialise through `Date` on either side: the widgets
 * parse the calendar parts into a local `Date` and format with no zone, and the
 * two cancel out. See CLAUDE.md, "Widget Localisation".
 *
 * Full reasoning: `.claude/TODO/Comparison/Plans/mission-trips.md`.
 */

import { z } from "zod";

// ── Finder ──

/** One card in `next-mission-trip-finder`. Anonymous-readable. */
export const MissionTripCardSchema = z.object({
  pledgeCampaignId: z.number().int(),
  campaignName: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  congregationName: z.string().nullable(),
  programName: z.string().nullable(),
  ministryName: z.string().nullable(),
  eventId: z.number().int().nullable(),
  eventStartDate: z.string().nullable(),
  eventEndDate: z.string().nullable(),
  registrationStart: z.string().nullable(),
  registrationEnd: z.string().nullable(),
  /** Seat cap. `null` or `0` both mean uncapped. */
  maximumRegistrants: z.number().int().nullable(),
  currentRegistrants: z.number().int(),
  /**
   * `currentRegistrants >= maximumRegistrants` for a capped campaign.
   *
   * Full trips are still *rendered*, with a badge, when `show-full-trips` is on.
   * The legacy `@ShowFullTrips = 0` branch is inverted — it keeps
   * `Current_Registrants >= Maximum_Registrants`, i.e. exactly the full ones —
   * so the filter is applied in TypeScript rather than by shipping corrected
   * SQL that every church would have to install.
   */
  isFull: z.boolean(),
});
export type MissionTripCard = z.infer<typeof MissionTripCardSchema>;

export const MissionTripSearchResponseSchema = z.object({
  trips: z.array(MissionTripCardSchema),
});
export type MissionTripSearchResponse = z.infer<typeof MissionTripSearchResponseSchema>;

// ── My trips ──

/**
 * One of the caller's (or their household's) mission trips.
 *
 * Scope is legacy's household rule: a head of household sees every member of
 * their household, everyone else sees only themselves. `isMine` distinguishes
 * the caller's own row from a household member's so the widget can label the
 * "Family Mission Trips" section the way legacy did.
 */
export const MyMissionTripSchema = z.object({
  pledgeId: z.number().int(),
  pledgeCampaignId: z.number().int(),
  campaignName: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  campaignGoal: z.number(),
  totalPledge: z.number(),
  /** Sum of `Donation_Distributions.Amount` for this pledge. */
  raised: z.number(),
  pledgeStatusId: z.number().int(),
  pledgeStatus: z.string().nullable(),
  /**
   * `Pledges.Trip_Leader`. **Read-only everywhere.** Nothing in the legacy stack
   * writes it and nothing here does either — staff tick the box in the Platform.
   */
  tripLeader: z.boolean(),
  /** False for a household member's trip that is not the caller's own. */
  isMine: z.boolean(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  eventStartDate: z.string().nullable(),
  eventEndDate: z.string().nullable(),
});
export type MyMissionTrip = z.infer<typeof MyMissionTripSchema>;

export const MyMissionTripsResponseSchema = z.object({
  trips: z.array(MyMissionTripSchema),
});
export type MyMissionTripsResponse = z.infer<typeof MyMissionTripsResponseSchema>;

// ── Donors ──

/**
 * A donor's postal address, or `null` when `Home_Address_Unlisted` is set.
 *
 * Whole-object null rather than per-field nulls: an address is suppressed as a
 * unit, and a half-rendered address block is worse than none. Legacy emitted
 * the sentinel strings `"--"` and `""` for suppressed parts, which is a display
 * concern that leaked into the data layer.
 */
export const MissionDonorAddressSchema = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  stateRegion: z.string().nullable(),
  postalCode: z.string().nullable(),
  foreignCountry: z.string().nullable(),
});
export type MissionDonorAddress = z.infer<typeof MissionDonorAddressSchema>;

/**
 * One donation toward a participant's trip — what a participant uses to write
 * thank-you notes.
 *
 * Privacy is legacy parity, and legacy was careful here: `Donations.Anonymous`
 * collapses the donor to the anonymous label with no contact data at all, and
 * `Home_Address_Unlisted` / `Mobile_Phone_Unlisted` / `Email_Unlisted` each
 * suppress their field independently. Those flags are the church's own setting,
 * so honouring them is the contract — not a judgement call this widget makes.
 */
export const MissionDonorSchema = z.object({
  pledgeId: z.number().int(),
  pledgeCampaignId: z.number().int(),
  campaignName: z.string().nullable(),
  /** Already collapsed to the anonymous label when `anonymous` is true. */
  donorName: z.string(),
  anonymous: z.boolean(),
  amount: z.number(),
  currency: z.string().nullable(),
  /** Includes legacy's "still being processed" note for an unbatched donation. */
  notes: z.string().nullable(),
  donationDate: z.string().nullable(),
  address: MissionDonorAddressSchema.nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type MissionDonor = z.infer<typeof MissionDonorSchema>;

export const MissionDonorsResponseSchema = z.object({
  donors: z.array(MissionDonorSchema),
});
export type MissionDonorsResponse = z.infer<typeof MissionDonorsResponseSchema>;

// ── Team progress ──

/**
 * One teammate's fundraising position, for a trip leader.
 *
 * **This is the payload behind the one real security fix in C76.**
 * `api_MPPW_GetMyMissionTripTeamProgress` has no `Trip_Leader` predicate at all
 * and hands every teammate's email, mobile phone and fundraising position to
 * any participant who calls it; both of legacy's gates (the `showteamprogress`
 * attribute and a `tripLeader === true` array filter) run in the browser. The
 * server now answers `not_trip_leader` unless a **visible** pledge on the
 * campaign leads it — visible in the household sense, so a head of household
 * managing a teenager's trip is not locked out of a widget legacy showed them.
 *
 * `email` and `phone` are `null` when `Email_Unlisted` / `Mobile_Phone_Unlisted`
 * are set. The roster procedure ignores those flags even though the donors
 * procedure honours them — two answers about the same person's privacy in one
 * widget. A trip leader is not staff.
 */
export const MissionTeamMemberSchema = z.object({
  pledgeId: z.number().int(),
  pledgeCampaignId: z.number().int(),
  campaignName: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  pledgeStatusId: z.number().int(),
  pledgeStatus: z.string().nullable(),
  campaignGoal: z.number(),
  totalPledge: z.number(),
  raised: z.number(),
  tripLeader: z.boolean(),
  /** `null` when the teammate's `Email_Unlisted` is set. */
  email: z.string().nullable(),
  /** `null` when the teammate's `Mobile_Phone_Unlisted` is set. */
  phone: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type MissionTeamMember = z.infer<typeof MissionTeamMemberSchema>;

export const MissionTeamResponseSchema = z.object({
  team: z.array(MissionTeamMemberSchema),
});
export type MissionTeamResponse = z.infer<typeof MissionTeamResponseSchema>;

// ── Search request ──

/**
 * Finder query parameters.
 *
 * A GET with query parameters, unlike legacy's `[HttpPost] [FromForm]` search —
 * cacheable and linkable, matching `next-opportunity-finder`.
 *
 * `congregationId` filters on the **Program's** congregation, not
 * `Pledge_Campaigns.Congregation_ID`, which also exists. That is legacy
 * behaviour and it is kept deliberately: a campaign's own congregation is
 * frequently null while its program's is set.
 */
export const MissionTripSearchSchema = z.object({
  /** `Pledge_Campaign_Type_ID`. 2 = "Mission Project/Trip" on a stock domain. */
  campaignTypeId: z.number().int(),
  congregationId: z.number().int().nullable().optional(),
  ministryId: z.number().int().nullable().optional(),
  programId: z.number().int().nullable().optional(),
  /** Matches campaign name, description, program name or ministry name. */
  keyword: z.string().nullable().optional(),
  showFullTrips: z.boolean().optional(),
  maxResults: z.number().int().optional(),
});
export type MissionTripSearchParams = z.infer<typeof MissionTripSearchSchema>;
