import { MPHelper } from "@/lib/providers/ministry-platform";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import {
  buildPreCheckQrPayload,
  buildPreCheckRowKey,
  PARTICIPATION_STATUS,
  type PreCheckMember,
  type PreCheckRow,
} from "@mpnext/types";
import { toNumberOrNull } from "@/services/_shared/mp-lookup";

/**
 * Group the flat proc output by member, preserving the proc's row order.
 *
 * Server-side on purpose, and it lives here rather than in the route because a
 * Next.js `route.ts` may only export HTTP handlers.
 *
 * `mpp-pre-check.js:98` grouped in the *browser* by watching `contactId` change
 * between consecutive rows — correct only while the proc's
 * `ORDER BY C.Participant_Record` holds, and silently emitting a duplicate name
 * header the day it did not. A `Map` keyed by `contactId` cannot have that bug
 * whatever order the rows arrive in.
 */
export function groupByMember(rows: PreCheckRow[]): PreCheckMember[] {
  const members = new Map<number, PreCheckMember>();

  for (const row of rows) {
    let member = members.get(row.contactId);
    if (!member) {
      member = {
        contactId: row.contactId,
        participantName: row.participantName,
        rows: [],
      };
      members.set(row.contactId, member);
    }
    member.rows.push(row);
  }

  return [...members.values()];
}

/**
 * Backend for `next-pre-check` (C78) — household event pre-check.
 *
 * Ported from the legacy .NET `EventsApiController` / `EventsManager` /
 * `EventParticipantTranslator` trio, with the legacy **protocol** deliberately
 * not ported. See `@mpnext/types`' `pre-check.ts` for why: legacy accepted six
 * client-supplied ints and wrote them to `Event_Participants` unchecked. The
 * read below is the same proc legacy called; the write (phase 3) re-derives
 * every id from the caller's own household.
 *
 * ## The proc is real, installed, and API-granted
 *
 * `api_MPPW_GetPreCheckEvents` ships in MP's own `DatabaseScripts` alongside
 * eight `api_MPPW_*` procs this repo already calls in production
 * (`api_MPPW_GetMyPledges`, `api_MPPW_GetEvents`, …). Confirmed present on the
 * reference domain, with the row shape {@link RawPreCheckRow} describes,
 * measured rather than inferred.
 *
 * ## What the proc's visibility rule does, and why a day can be legitimately empty
 *
 * The proc cross-joins the household against the day's `[Allow_Check-in]`
 * events, then filters on a column it *aliases* `Prohibit_Guests` — which is
 * **not** `Events.Prohibit_Guests`. It is `Search_Results = 3`, i.e.
 * `Checkin_Search_Results_Types` "Allow Expected Only (Show Expected Only)".
 * For such an event a household member appears only if they already participate
 * in one of the event's groups or already have an `Event_Participant` row.
 *
 * That is why an empty result is **normal, not an error**: on the reference
 * domain, household 5's members belong to groups 2/39/43 while the Sunday
 * classes' `Event_Groups` are the graded groups 10-16, so those events
 * correctly show nobody. A Tuesday having no Sunday classes is the same shape.
 * The route answers 200 with an empty `members`, and the widget says so.
 */

/** Exactly what `api_MPPW_GetPreCheckEvents` returns, measured on the domain. */
interface RawPreCheckRow {
  Contact_ID: number | string;
  /** `Contacts.Participant_Record`. Nullable — a contact need not be a participant. */
  Participant_Record: number | string | null;
  Display_Name: string | null;
  Event_ID: number | string;
  Event_Title: string | null;
  /** Congregation-zone wall clock, e.g. `"2018-06-12T17:00:00"`. No zone marker. */
  Event_Start_Date: string | null;
  /** The `Search_Results = 3` alias. Read for nothing here; the proc has applied it. */
  Prohibit_Guests?: boolean | null;
  Group_Participant_ID: number | string | null;
  Group_ID: number | string | null;
  Group_Name: string | null;
  Role_Title: string | null;
  Event_Participant_ID: number | string | null;
  Participation_Status_ID: number | string | null;
}

/**
 * The proc's exact name.
 *
 * A constant because it is used twice — to call it and to probe for it — and
 * those two **must** agree. See {@link PreCheckService.isAvailable}.
 */
const PRE_CHECK_PROC = "api_MPPW_GetPreCheckEvents";

export class PreCheckService {
  private static instance: PreCheckService;
  private mp: MPHelper | null = null;

  /**
   * Memoised answer to "is the proc installed here?".
   *
   * `undefined` = not yet asked. A negative is cached too: a domain that has
   * genuinely not run MP's widget database scripts should not pay a `/procs`
   * round-trip on every page load to rediscover that.
   */
  private available: boolean | undefined;

  private constructor() {
    this.mp = new MPHelper();
  }

  public static async getInstance(): Promise<PreCheckService> {
    if (!PreCheckService.instance) {
      PreCheckService.instance = new PreCheckService();
    }
    return PreCheckService.instance;
  }

  /**
   * Is `api_MPPW_GetPreCheckEvents` installed and granted to the API client?
   *
   * **`/procs?$search=` is an exact-name match, not a substring search.** That
   * is measured, and it is the one thing about this probe worth knowing: on a
   * domain where the proc *is* installed, `getProcedures("PreCheck")` returns
   * `[]` and so does `getProcedures("api_MPPW")`, while
   * `getProcedures("api_MPPW_GetPreCheckEvents")` returns the one row. A probe
   * written with a friendly partial term would report "unavailable" on every
   * domain in the world, and the widget would be permanently dark for a reason
   * no log would explain. Hence {@link PRE_CHECK_PROC}, used verbatim.
   *
   * Fails **open** on a transport error: a `/procs` blip should degrade to
   * "try the call and see", not to a hard `precheck_unavailable` on a domain
   * where the widget works. A genuinely missing proc still surfaces, because
   * the empty list is a successful response, not an error.
   */
  public async isAvailable(): Promise<boolean> {
    if (this.available !== undefined) return this.available;

    try {
      const procs = await this.mp!.getProcedures(PRE_CHECK_PROC);
      this.available = procs.some((p) => p.Name === PRE_CHECK_PROC);
    } catch (error) {
      console.warn(
        "PreCheckService: /procs probe failed; assuming the proc is present:",
        error instanceof Error ? error.message : error
      );
      // Deliberately not cached: a transient failure must not pin the answer
      // for the lifetime of the process.
      return true;
    }

    return this.available;
  }

  /**
   * Today, as the MP domain reckons it: `YYYY-MM-DD`.
   *
   * `Intl.DateTimeFormat("en-CA")` yields exactly `YYYY-MM-DD`, and the
   * `timeZone` is the domain's IANA zone — so the answer is the church's idea
   * of today, not the server process's and not the visitor's.
   *
   * This is a straight fix of a legacy defect rather than a new feature.
   * `mpp-pre-check.js:16` defaulted to `new Date().toISOString()` **in the
   * browser**: at 9pm on a Saturday in `Pacific/Honolulu` that is already
   * Sunday in UTC, so the widget silently asked for the wrong day. Never
   * `new Date().toISOString().slice(0, 10)` here, for the same reason.
   */
  public async resolveDefaultEventDate(): Promise<string> {
    const timeZone = await DomainTimezoneService.getInstance().getMpTimezone();
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  /**
   * The MP domain's IANA zone, for the widget's `Intl.DateTimeFormat`.
   *
   * The route threads this to the client rather than letting the browser guess,
   * because `eventStart` is a wall-clock string with no zone marker: formatted
   * without an explicit zone it would read correctly only for visitors who
   * happen to live in the church's. Legacy hardcoded `en-US` here and got the
   * language wrong as well as the zone.
   */
  public async getTimeZone(): Promise<string> {
    return DomainTimezoneService.getInstance().getMpTimezone();
  }

  /**
   * Every (member × check-in event × group) row for one household on one day.
   *
   * `eventDate` is the raw `YYYY-MM-DD` string. The proc's `@EventDate` is a
   * `datetime` and it `CAST(… AS date)`s both sides, so the bare wall-clock
   * date is exactly right — and passing a `Date` or an ISO instant instead is
   * precisely the day-shift this widget exists to stop doing.
   */
  public async getPreCheckRows(
    householdId: number,
    eventDate: string
  ): Promise<PreCheckRow[]> {
    const result = await this.mp!.executeProcedure(PRE_CHECK_PROC, {
      "@HouseholdID": householdId,
      "@EventDate": eventDate,
    });

    const rows = (result?.[0] as RawPreCheckRow[] | undefined) ?? [];
    return rows.map((row) => this.toPreCheckRow(row));
  }

  /**
   * One raw proc row → one {@link PreCheckRow}.
   *
   * **Nullable columns become `null`, never `0`.** Legacy did
   * `(int)result[...].ToObject<long>()` on every id, which yields `0` for a
   * null — which is why its composite keys are full of zeroes and why its
   * server had to special-case `participantId == 0` and
   * `eventParticipantId != 0` to recover the distinction it had just destroyed.
   * Keeping the null means "this contact has no participant record" and "this
   * participant has no row for this event" stay expressible.
   */
  private toPreCheckRow(row: RawPreCheckRow): PreCheckRow {
    const contactId = Number(row.Contact_ID);
    const participantId = toNumberOrNull(row.Participant_Record);
    const eventId = Number(row.Event_ID);
    const eventParticipantId = toNumberOrNull(row.Event_Participant_ID);
    const groupId = toNumberOrNull(row.Group_ID);
    const groupParticipantId = toNumberOrNull(row.Group_Participant_ID);
    const participationStatusId = toNumberOrNull(row.Participation_Status_ID);

    return {
      rowKey: buildPreCheckRowKey({
        contactId,
        participantId,
        eventId,
        eventParticipantId,
        groupId,
        groupParticipantId,
      }),
      contactId,
      // MP pads `Display_Name` and `Event_Title` in the sample data
      // (`"Check-me-in, Daddy "`); trimming once here keeps it out of every
      // render site and out of the grouping key.
      participantName: (row.Display_Name ?? "").trim(),
      participantId,
      eventId,
      eventName: (row.Event_Title ?? "").trim(),
      eventStart: row.Event_Start_Date ?? "",
      groupId,
      groupName: row.Group_Name?.trim() ?? null,
      groupParticipantId,
      roleName: row.Role_Title?.trim() ?? null,
      eventParticipantId,
      participationStatusId,
      isRegistered: participationStatusId === PARTICIPATION_STATUS.REGISTERED,
      isLocked:
        participationStatusId === PARTICIPATION_STATUS.ATTENDED ||
        participationStatusId === PARTICIPATION_STATUS.CONFIRMED,
    };
  }

  /**
   * `pre|M/d/yyyy|householdId`.
   *
   * The household id comes from the caller's session at every call site, so a
   * QR can only ever be minted for the caller's own household.
   */
  public buildQrPayload(householdId: number, eventDate: string): string {
    return buildPreCheckQrPayload(householdId, eventDate);
  }
}
