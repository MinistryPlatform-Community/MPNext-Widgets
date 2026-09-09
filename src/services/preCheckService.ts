import { MPHelper } from "@/lib/providers/ministry-platform";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import { ConfigSettingsService } from "@/services/configSettingsService";
import {
  buildPreCheckQrPayload,
  buildPreCheckRowKey,
  PARTICIPATION_STATUS,
  type PreCheckMember,
  type PreCheckRow,
  type PreCheckSaveResponse,
} from "@mpnext/types";
import { getIdByValue, toNumberOrNull } from "@/services/_shared/mp-lookup";

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

  /**
   * Memoised `Participant_Type_ID` for a widget-created participant.
   * `undefined` = not yet asked; `null` = asked, and this domain has none.
   */
  private participantTypeId: number | null | undefined;

  /**
   * Lookup-id cache for {@link getIdByValue}, owned by this singleton so a
   * reset service starts with cold lookups. Keyed `table:column:value`.
   */
  private idCache = new Map<string, number | null>();

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

  // ── The write ────────────────────────────────────────────────────────────

  /**
   * Apply a household's pre-check selection for one day.
   *
   * **This method is the authorisation boundary, and the shape of it is the
   * point.** `selected` is a set of opaque row keys. Nothing in it is parsed,
   * split, or coerced into an id. What it can do is *name* a row that this
   * method itself derived, one line earlier, from `(householdId, eventDate)` —
   * and `householdId` came from the caller's session, never from the request.
   *
   * Compare legacy. `EventParticipantTranslator.ToEventParticipants` split the
   * client's string on `_` then `|` and `int.Parse`d six fields straight into
   * an `Event_Participants` write with no check of any kind, so any signed-in
   * MP user could pre-check an arbitrary contact into an arbitrary event, or
   * cancel a stranger's registration, by editing one checkbox attribute. The
   * feature is ported; the protocol is not.
   *
   * The rules, in the order they run:
   *
   * 1. **Re-derive.** One fresh read of the same `(householdId, eventDate)`,
   *    keyed by `rowKey`. This map is the entire universe of legal writes.
   * 2. **Whole-key membership, and fail the whole request.** Every submitted
   *    string must be a key of that map, or nothing at all is written. Partial
   *    filtering is wrong here: a mismatch means an attack or a stale page, and
   *    both deserve a visible outcome rather than a save that silently did
   *    something other than what the visitor saw. Whole-key matching is what
   *    stops a caller keeping their own `contactId` and swapping in another
   *    event's `eventId` — the resulting key is not in the map.
   * 3. **Every written id comes from the map's row.** After step 2 the client's
   *    contribution is reduced to a set of booleans. `preCheckService.save.test.ts`
   *    asserts this by mutating the ids *inside* an accepted key's string and
   *    checking the write is unchanged.
   * 4. **Locked rows are never written, in either direction.** A row at
   *    `3 Attended` or `4 Confirmed` has been acted on by a check-in station.
   *    Legacy would overwrite it with `5 Cancelled` when a parent unticked the
   *    box, destroying attendance history — the one legacy defect that must be
   *    fixed rather than ported. Registering over an `Attended` row would lose
   *    the same information, so neither direction touches it. They come back in
   *    `locked` so the widget can explain the disabled checkbox.
   * 5. **Cancellations are derived, never submitted**, and never deletes: rows
   *    with an existing `Event_Participant_ID` that nothing selected go to
   *    `5 Cancelled`.
   * 6. **One write per `(eventId, contactId)`.** The proc emits one row per
   *    group participation, so a member in two of an event's groups yields two
   *    rows sharing one `Event_Participant_ID`. Two updates to one primary key
   *    in a batch is at best wasted and at worst a lost update.
   * 7. **`$userId` on every write**, so MP's audit trail names the parent
   *    rather than the API service account.
   */
  public async savePreCheck(args: {
    householdId: number;
    /** `dp_Users.User_ID`, resolved from the JWT. Audit only — never authorisation. */
    userId: number;
    eventDate: string;
    selected: string[];
  }): Promise<PreCheckSaveResponse> {
    const { householdId, userId, eventDate, selected } = args;

    // Rule 1 — the authoritative set, derived here, from the session's
    // household. The request contributed the date and nothing else.
    const rows = await this.getPreCheckRows(householdId, eventDate);
    const byKey = new Map(rows.map((row) => [row.rowKey, row]));

    // Rule 2 — membership, then all-or-nothing.
    const submitted = [...new Set(selected)];
    const unknown = submitted.filter((key) => !byKey.has(key));
    if (unknown.length > 0) {
      throw new PreCheckSelectionError(unknown.length);
    }

    const selectedRows = submitted.map((key) => byKey.get(key)!);

    // Rule 4 — locked rows are reported and then dropped from both paths.
    const locked = rows.filter((row) => row.isLocked).map((row) => row.rowKey);
    const lockedEventParticipantIds = new Set(
      rows
        .filter((row) => row.isLocked && row.eventParticipantId !== null)
        .map((row) => row.eventParticipantId as number)
    );

    // Rule 6 — one write per (event, member). `contactId` rather than
    // `participantId` because the latter is null for a contact with no
    // `Participant_Record`, and null is not a usable map key; the two are 1:1,
    // so this is the same partition, total.
    const pairKey = (row: PreCheckRow) => `${row.eventId}:${row.contactId}`;

    const toRegister = new Map<string, PreCheckRow>();
    for (const row of selectedRows) {
      if (row.isLocked) continue;
      // "Take the first in the server's order" — the rows disagree only about
      // which group the member is being checked in under.
      if (!toRegister.has(pairKey(row))) toRegister.set(pairKey(row), row);
    }

    // Rule 5 — the cancellation set. An `Event_Participant_ID` survives if any
    // row that shares it was selected, which is what makes the two-group case
    // safe: unticking one group's row must not cancel a registration the other
    // group's row is holding open.
    const keptEventParticipantIds = new Set(
      selectedRows
        .filter((row) => row.eventParticipantId !== null)
        .map((row) => row.eventParticipantId as number)
    );

    const toCancel = new Map<number, PreCheckRow>();
    for (const row of rows) {
      const epId = row.eventParticipantId;
      if (epId === null) continue;
      if (keptEventParticipantIds.has(epId)) continue;
      if (lockedEventParticipantIds.has(epId)) continue;
      if (row.participationStatusId === PARTICIPATION_STATUS.CANCELLED) continue;
      if (!toCancel.has(epId)) toCancel.set(epId, row);
    }

    let registered = 0;
    let cancelled = 0;

    for (const row of toRegister.values()) {
      // Rule 3 — `row` is the server's, and every id below comes off it.
      const participantId = row.participantId ?? (await this.createParticipant(row, userId));
      if (participantId === null) continue;

      if (row.eventParticipantId !== null) {
        await this.mp!.updateTableRecords(
          "Event_Participants",
          [
            {
              Event_Participant_ID: row.eventParticipantId,
              Event_ID: row.eventId,
              Participant_ID: participantId,
              Participation_Status_ID: PARTICIPATION_STATUS.REGISTERED,
              ...this.groupColumns(row),
            },
          ],
          { $userId: userId }
        );
      } else {
        await this.mp!.createTableRecords(
          "Event_Participants",
          [
            {
              Event_ID: row.eventId,
              Participant_ID: participantId,
              Participation_Status_ID: PARTICIPATION_STATUS.REGISTERED,
              ...this.groupColumns(row),
              // `mp_lookup` marks these three NOT NULL on `Event_Participants`.
              // Written explicitly rather than left to a database default,
              // because "no confirmation email has been sent" and "not
              // attending online" are the correct values for a fresh pre-check
              // either way — so being explicit costs nothing and removes a
              // dependency on a default this code cannot see.
              Registrant_Message_Sent: false,
              Attendee_Message_Sent: false,
              Attending_Online: false,
            },
          ],
          { $userId: userId }
        );
      }
      registered++;
    }

    for (const row of toCancel.values()) {
      // Status only. **Never a delete** — legacy never deleted either, and a
      // deleted row loses the fact that the family had planned to come.
      // `Time_In`, `Room_ID` and `Check-in_Station` are the station's to write
      // and are not touched here.
      await this.mp!.updateTableRecords(
        "Event_Participants",
        [
          {
            Event_Participant_ID: row.eventParticipantId as number,
            Participation_Status_ID: PARTICIPATION_STATUS.CANCELLED,
          },
        ],
        { $userId: userId }
      );
      cancelled++;
    }

    return { registered, cancelled, locked };
  }

  /**
   * `Group_ID` / `Group_Participant_ID`, present only when the row has them.
   *
   * Legacy wrote them "when non-zero", which is the same rule expressed through
   * the zeroes its own null-coercion had created. Omitting the key entirely is
   * better than writing `null`: an update that sets `Group_ID = null` would
   * *clear* a group a station had already assigned.
   */
  private groupColumns(row: PreCheckRow): Record<string, number> {
    const columns: Record<string, number> = {};
    if (row.groupId !== null) columns.Group_ID = row.groupId;
    if (row.groupParticipantId !== null) {
      columns.Group_Participant_ID = row.groupParticipantId;
    }
    return columns;
  }

  /**
   * Create the `Participants` row a contact does not yet have.
   *
   * **Household-scoped by construction**: `row` came out of the map this
   * service derived from the caller's own `Household_ID`, so there is no path
   * by which a contact outside the household reaches this method. That is the
   * invariant, and it is worth more than any check that could be added here.
   *
   * Mirrors legacy `ContactManager.CreateParticipant` — including its
   * `"Created by Web Widget"` note, so church staff see the provenance they
   * already recognise. `Participant_Start_Date` goes through
   * `toMpSqlDatetime`, never `new Date().toISOString()`: MP stores wall-clock
   * in the domain's zone, so an ISO instant shifts an evening save into the
   * next day.
   */
  private async createParticipant(
    row: PreCheckRow,
    userId: number
  ): Promise<number | null> {
    const participantTypeId = await this.resolveDefaultParticipantTypeId();
    if (participantTypeId === null) {
      console.warn(
        "PreCheckService: no default Participant_Type_ID; skipping participant creation for contact",
        row.contactId
      );
      return null;
    }

    const startDate = await DomainTimezoneService.getInstance().toMpSqlDatetime(
      new Date()
    );

    const created = await this.mp!.createTableRecords<{ Participant_ID: number }>(
      "Participants",
      [
        {
          Contact_ID: row.contactId,
          Participant_Type_ID: participantTypeId,
          Participant_Start_Date: startDate,
          Notes: "Created by Web Widget",
        } as unknown as { Participant_ID: number },
      ],
      { $userId: userId }
    );

    return toNumberOrNull(created[0]?.Participant_ID ?? null);
  }

  /**
   * `Participant_Types.Participant_Type_ID` for a widget-created participant.
   *
   * Legacy read a `defaultParticipantType` config setting
   * (`ContactManager.cs:42`). The MP equivalent is
   * `dp_Configuration_Settings` `PORTAL` / `DefaultParticipantTypeID`, which is
   * present and set to `4` (`Guest`) on the reference domain — confirmed, not
   * assumed. A domain that has cleared it falls back to resolving `Guest` by
   * name, because lookup ids are only stable on a stock instance and a data
   * conversion can renumber them. Both misses return `null`, and the caller
   * then skips creating the participant rather than inventing a type.
   */
  private async resolveDefaultParticipantTypeId(): Promise<number | null> {
    if (this.participantTypeId !== undefined) return this.participantTypeId;

    const config = await ConfigSettingsService.getInstance();
    const configured = toNumberOrNull(
      await config.getSetting("PORTAL", "DefaultParticipantTypeID")
    );

    this.participantTypeId =
      configured ??
      (await this.getIdByValue(
        "Participant_Types",
        "Participant_Type",
        "Guest",
        "Participant_Type_ID"
      ));

    return this.participantTypeId;
  }

  /**
   * Look up a lookup-table row's numeric id by one of its column values.
   *
   * The four-argument delegate onto `_shared/mp-lookup`, matching
   * `prayerFeedbackService`: the cache and the `MPHelper` stay owned by this
   * singleton, the query and the caching rule are shared.
   */
  private getIdByValue(
    table: string,
    columnName: string,
    value: string,
    idColumn: string
  ): Promise<number | null> {
    return getIdByValue(
      { mp: this.mp!, cache: this.idCache, label: "PreCheckService" },
      table,
      columnName,
      value,
      idColumn
    );
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

/**
 * A submitted `rowKey` the server did not issue for this household and date.
 *
 * Its own class so the route can answer `403 invalid_pre_check_selection`
 * without string-matching an error message. The count is carried for the log;
 * **the keys themselves are not**, because echoing them back would confirm to a
 * prober which of their guesses were well-formed.
 */
export class PreCheckSelectionError extends Error {
  public readonly unknownCount: number;

  constructor(unknownCount: number) {
    super(`Pre-check selection contained ${unknownCount} unrecognised row(s).`);
    this.name = "PreCheckSelectionError";
    this.unknownCount = unknownCount;
  }
}
