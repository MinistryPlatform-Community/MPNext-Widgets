import { MPHelper } from "@/lib/providers/ministry-platform";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import { HouseholdService } from "@/services/householdService";
import {
  FEEDBACK_DESCRIPTION_MAX,
  FEEDBACK_SUMMARY_MAX,
  VISIBILITY_PUBLIC,
  VISIBILITY_STAFF_ONLY,
  type FeedbackTypeOption,
  type SubmitterOption,
} from "@mpnext/types";

/**
 * Backend for `next-prayer-feedback` (C69) — MP data access for prayer,
 * praise-report and general-feedback intake.
 *
 * Ported from the legacy .NET `PrayerFeedbackService` / `PrayerFeedbackManager`,
 * with four of legacy's defects deliberately **not** ported:
 *
 * 1. **The email cannon.** Legacy's `SendVerificationEmail` was `[AllowAnonymous]`
 *    and took `ContactId` straight off the form: post someone else's id and the
 *    server harvested their real name and address and mailed them a link that
 *    would file a prayer entry against them. Nothing here accepts a contact id
 *    from an unauthenticated caller — that is the route's job, and this service
 *    simply never has an entry point for it.
 * 2. **The duplicate guard.** Legacy interpolated `Entry_Title` and
 *    `Description` into a `$filter` and then compared an *untruncated* value
 *    against a column it had truncated, so entries over 1000 characters never
 *    matched their own guard. Replaced wholesale by the single-use pending
 *    action: the token can only be redeemed once, by construction.
 * 3. **The disagreeing length limits.** Legacy's textarea allowed 2000 and both
 *    its token and its insert cut at 1000. All 2000 characters survive here.
 * 4. **The unconditional email overwrite.** See `backfillContactEmail`.
 *
 * `createFeedbackEntry` is the only method here that writes, and the route only
 * reaches it once an identity is established — a session for a signed-in
 * submitter, or a redeemed emailed link for everyone else.
 */

/** `Feedback_Types.Feedback_Type_ID` for `User Removal Request` on a stock domain. */
const REMOVAL_TYPE_ID = 5;

/**
 * Names that mean "this is an erasure request, not a prayer request".
 *
 * Belt and braces alongside `REMOVAL_TYPE_ID`: `Feedback_Types` is a per-tenant
 * lookup, so a church that renumbered or re-seeded it would defeat an id-only
 * check, and the default must stay safe on *every* domain rather than only the
 * reference one.
 */
const REMOVAL_NAME = /removal/i;

interface FeedbackTypeRow {
  Feedback_Type_ID: number | string;
  Feedback_Type: string | null;
  Description: string | null;
}

interface ContactSummaryRow {
  Contact_ID: number | string;
  First_Name: string | null;
  Last_Name: string | null;
  Display_Name: string | null;
  Nickname: string | null;
  Email_Address: string | null;
  Household_ID: number | string | null;
}

/** Everything needed to write one `Feedback_Entries` row. */
export interface PendingFeedback {
  /** Signed-in path only. `null` for anonymous, where the Contact is resolved on redemption. */
  contactId: number | null;
  firstName: string;
  lastName: string;
  email: string;
  mobilePhone: string | null;
  feedbackTypeId: number;
  /** → `Entry_Title`, capped at 50. */
  summary: string;
  /** → `Description`, capped at 2000. */
  description: string | null;
  isPrivate: boolean;
  programId: number | null;
}

export interface CreatedFeedbackEntry {
  feedbackEntryId: number;
  contactId: number;
  /** A new `Households` + `Contacts` pair was minted for this submission. */
  contactCreated: boolean;
}

/** One person's name and address, for the acknowledgement email. */
export interface ContactSummary {
  contactId: number;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str === "" ? null : str;
}

/** Escape a value for safe inclusion inside an MP `LIKE '...'` filter literal. */
function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Cap a value at a column's length, so MP never rejects the whole insert. */
function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export class PrayerFeedbackService {
  private static instance: PrayerFeedbackService;
  private mp: MPHelper | null = null;
  private idCache = new Map<string, number | null>();
  private typeCache: FeedbackTypeOption[] | null = null;
  private warnedRemovalTypes = false;

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<PrayerFeedbackService> {
    if (!PrayerFeedbackService.instance) {
      PrayerFeedbackService.instance = new PrayerFeedbackService();
      await PrayerFeedbackService.instance.initialize();
    }
    return PrayerFeedbackService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── Feedback types ───────────────────────────────────────────────────────

  /**
   * Every `Feedback_Types` row, read once and cached.
   *
   * The whole (five-row, on a stock domain) table is cached rather than a
   * filtered slice of it, because `getFeedbackTypes`, `isKnownFeedbackType` and
   * `getRemovalTypeIds` all need to answer from the same data and a query
   * narrowed to one caller's allowlist could not serve the next caller's. Both
   * removal predicates are therefore applied in TypeScript — the id check as
   * well as the name check, which MP's `$filter` could not express anyway.
   */
  private async allFeedbackTypes(): Promise<FeedbackTypeOption[]> {
    if (this.typeCache) return this.typeCache;

    const rows = await this.mp!.getTableRecords<FeedbackTypeRow>({
      table: "Feedback_Types",
      select: "Feedback_Type_ID, Feedback_Type, Description",
      orderBy: "Feedback_Type_ID",
      top: 200,
    });

    this.typeCache = rows
      .map((r) => ({
        id: toNumberOrNull(r.Feedback_Type_ID) ?? 0,
        name: clean(r.Feedback_Type) ?? "",
        description: clean(r.Description),
      }))
      .filter((t) => t.id > 0 && t.name !== "");

    return this.typeCache;
  }

  /**
   * Options for the Feedback Type dropdown.
   *
   * `allowedIds` empty or absent ⇒ **every row except the removal type**. That
   * is a deliberate divergence from legacy, which offered all five including
   * `User Removal Request` — a GDPR erasure workflow wearing a prayer-form
   * costume, which no church should offer visitors by accident. It is a *safety
   * default*, not a control: a caller can still post the id directly, because
   * MP's own FK accepts it and it is a legitimate value in the table.
   *
   * `allowedIds` non-empty ⇒ exactly those ids, **removal type included if
   * listed**, with one `console.warn` naming it. An explicit configuration is a
   * church's deliberate choice and not ours to override; only the default has to
   * be safe. The warning is there so a copy-pasted snippet gets noticed.
   */
  public async getFeedbackTypes(allowedIds?: number[]): Promise<FeedbackTypeOption[]> {
    const all = await this.allFeedbackTypes();

    if (!allowedIds || allowedIds.length === 0) {
      const removal = await this.getRemovalTypeIds();
      return all.filter((t) => !removal.includes(t.id));
    }

    const requested = new Set(allowedIds);
    const selected = all.filter((t) => requested.has(t.id));

    const removal = await this.getRemovalTypeIds();
    const explicitRemoval = selected.filter((t) => removal.includes(t.id));
    if (explicitRemoval.length > 0 && !this.warnedRemovalTypes) {
      this.warnedRemovalTypes = true;
      const named = explicitRemoval.map((t) => `${t.id} (${t.name})`).join(", ");
      console.warn(
        `PrayerFeedbackService: feedback-type-ids explicitly includes the user-removal type ${named}; offering it on a public form is a data-erasure request channel. Remove it from the attribute unless that is intended.`
      );
    }

    return selected;
  }

  /** The removal-type ids on this domain: the stock id, plus any `/removal/i` name. */
  public async getRemovalTypeIds(): Promise<number[]> {
    const all = await this.allFeedbackTypes();
    const ids = all
      .filter((t) => t.id === REMOVAL_TYPE_ID || REMOVAL_NAME.test(t.name))
      .map((t) => t.id);
    // The stock id counts even on a domain whose table does not contain it, so
    // a posted `5` can never slip past the default on a re-seeded lookup.
    return ids.includes(REMOVAL_TYPE_ID) ? ids : [REMOVAL_TYPE_ID, ...ids];
  }

  /**
   * Does this id exist in `Feedback_Types`?
   *
   * The real guard against a bogus FK, as distinct from the `allowedTypeIds`
   * echo, which is host-page markup and therefore only a correctness check.
   */
  public async isKnownFeedbackType(id: number): Promise<boolean> {
    const all = await this.allFeedbackTypes();
    return all.some((t) => t.id === id);
  }

  // ── Identity ─────────────────────────────────────────────────────────────

  /** `dp_Users.User_GUID` → `Contacts.Contact_ID`. */
  public async getContactIdByUserGuid(userGuid: string): Promise<number | null> {
    const rows = await this.mp!.getTableRecords<{ Contact_ID: number | string }>({
      table: "dp_Users",
      select: "User_ID,Contact_ID",
      filter: `User_GUID = '${sqlLiteral(userGuid)}'`,
      top: 1,
    });
    return rows[0] ? toNumberOrNull(rows[0].Contact_ID) : null;
  }

  /**
   * Find an existing contact by last name AND (first name OR nickname) AND email.
   *
   * `planYourVisitService.findContact`'s exact predicate rather than a second
   * one. It is deliberately narrow: an email match alone would let anyone file
   * against a known address, and a name match alone would collide constantly in
   * any congregation with two Smiths.
   */
  public async findContact(
    firstName: string,
    lastName: string,
    email: string
  ): Promise<number | null> {
    const f = clean(firstName);
    const l = clean(lastName);
    const e = clean(email);
    if (!f || !l || !e) return null;

    const rows = await this.mp!.getTableRecords<{ Contact_ID: number | string }>({
      table: "Contacts",
      select: "Contacts.Contact_ID AS Contact_ID",
      filter: [
        `Contacts.Last_Name LIKE '${sqlLiteral(l)}'`,
        `AND (Contacts.First_Name LIKE '${sqlLiteral(f)}' OR Contacts.Nickname LIKE '${sqlLiteral(f)}')`,
        `AND Contacts.Email_Address LIKE '${sqlLiteral(e)}'`,
      ].join(" "),
      top: 1,
    });
    return rows[0] ? toNumberOrNull(rows[0].Contact_ID) : null;
  }

  /** One contact's name and address. `null` when the id does not exist. */
  public async getContactSummary(contactId: number): Promise<ContactSummary | null> {
    const row = await this.getContactRow(contactId);
    if (!row) return null;

    const firstName = clean(row.First_Name) ?? clean(row.Nickname) ?? "";
    const lastName = clean(row.Last_Name) ?? "";
    return {
      contactId,
      firstName,
      lastName,
      displayName: clean(row.Display_Name) ?? `${firstName} ${lastName}`.trim(),
      email: clean(row.Email_Address),
    };
  }

  /**
   * The people a signed-in submitter may file on behalf of.
   *
   * Legacy's *"Provide Feedback As"* dropdown, kept: it is the one legacy
   * affordance a member actually uses, and the alternative is a spouse's prayer
   * request filed against the wrong contact. Household membership comes from
   * `HouseholdService.getMembers`, which already excludes deceased contacts
   * (`Contact_Status_ID <> 3`) — there is no second member query in this repo
   * and there should not be.
   */
  public async getSubmitterOptions(contactId: number): Promise<{
    self: SubmitterOption;
    household: SubmitterOption[];
  }> {
    const row = await this.getContactRow(contactId);
    const displayName =
      clean(row?.Display_Name) ??
      `${clean(row?.Last_Name) ?? ""}, ${clean(row?.First_Name) ?? ""}`.replace(
        /^,\s*|,\s*$/g,
        ""
      );

    const self: SubmitterOption = {
      contactId,
      displayName,
      hasEmail: clean(row?.Email_Address) !== null,
    };

    const householdId = toNumberOrNull(row?.Household_ID ?? null);
    if (householdId == null) return { self, household: [] };

    const households = await HouseholdService.getInstance();
    const members = await households.getMembers(householdId);

    const household: SubmitterOption[] = members
      .filter((m) => m.contactId !== contactId)
      .map((m) => ({
        contactId: m.contactId,
        displayName:
          clean(m.displayName) ??
          `${clean(m.lastName) ?? ""}, ${clean(m.firstName) ?? ""}`.replace(
            /^,\s*|,\s*$/g,
            ""
          ),
        hasEmail: clean(m.emailAddress) !== null,
      }));

    return { self, household };
  }

  /**
   * Server-side guard for a posted "on behalf of" target.
   *
   * The client's dropdown is a convenience; this is the boundary. Two contacts
   * are in the same household only when both carry the *same non-null*
   * `Household_ID` — a pair of contacts with no household must never be treated
   * as related, which a naive equality check on `null === null` would do.
   */
  public async isInSameHousehold(
    callerContactId: number,
    targetContactId: number
  ): Promise<boolean> {
    if (callerContactId === targetContactId) return true;

    const [caller, target] = await Promise.all([
      this.getContactRow(callerContactId),
      this.getContactRow(targetContactId),
    ]);

    const callerHousehold = toNumberOrNull(caller?.Household_ID ?? null);
    const targetHousehold = toNumberOrNull(target?.Household_ID ?? null);
    if (callerHousehold == null || targetHousehold == null) return false;
    return callerHousehold === targetHousehold;
  }

  // ── The write ────────────────────────────────────────────────────────────

  /**
   * Match-or-create the Contact, then insert exactly one `Feedback_Entries` row.
   *
   * The only writing method in this file. `Feedback_Entries.Contact_ID` is
   * `NOT NULL`, and a signed-out visitor has no contact — so match-then-create
   * is the only option that neither collapses every public prayer request onto
   * one shared "anonymous" contact (destroying the one thing the record is for:
   * knowing who to pray for) nor rejects a first-time visitor because MP has
   * never heard of them.
   *
   * Creating is safe here **only** because of where this method is called from:
   * the anonymous path reaches it after an emailed link has been redeemed, so a
   * row is only ever minted by someone who demonstrably controls the mailbox.
   */
  public async createFeedbackEntry(input: PendingFeedback): Promise<CreatedFeedbackEntry> {
    const firstName = clean(input.firstName) ?? "";
    const lastName = clean(input.lastName) ?? "";
    const email = clean(input.email) ?? "";

    let contactId = input.contactId;
    let contactCreated = false;

    if (contactId == null) {
      contactId = await this.findContact(firstName, lastName, email);
    }
    if (contactId == null) {
      contactId = await this.createContactWithHousehold({
        firstName,
        lastName,
        email,
        mobilePhone: clean(input.mobilePhone),
      });
      contactCreated = true;
    }

    const record: Record<string, unknown> = {
      Contact_ID: contactId,
      Entry_Title: cap(clean(input.summary) ?? "", FEEDBACK_SUMMARY_MAX),
      Feedback_Type_ID: input.feedbackTypeId,
      Date_Submitted: await this.now(),
      // Legacy's mapping, and correct: a private request is Staff Only, and
      // everything else is Public *visibility* — which publishes nothing on its
      // own, because `Approved` is always false. A church building a prayer wall
      // must filter on `Approved = 1 AND Visibility_Level_ID = 4`, never on
      // visibility alone.
      Visibility_Level_ID: input.isPrivate ? VISIBILITY_STAFF_ONLY : VISIBILITY_PUBLIC,
      // Staff triage fields, never exposed. `Approved: false` is the safety
      // interlock behind public visibility: nothing a stranger typed is
      // publishable until staff have looked at it. There is deliberately no
      // attribute to change it — an `auto-approve` flag would be a one-attribute
      // path to unmoderated text on a church's prayer wall.
      Ongoing_Need: false,
      Approved: false,
    };

    const programId = input.programId;
    if (programId != null && programId > 0) record.Program_ID = programId;

    const description = clean(input.description);
    if (description !== null) {
      record.Description = cap(description, FEEDBACK_DESCRIPTION_MAX);
    }

    const created = await this.mp!.createTableRecords<{ Feedback_Entry_ID: number }>(
      "Feedback_Entries",
      [record as unknown as { Feedback_Entry_ID: number }]
    );
    const feedbackEntryId = toNumberOrNull(created[0]?.Feedback_Entry_ID ?? null);
    if (feedbackEntryId == null) throw new Error("Failed to create feedback entry.");

    return { feedbackEntryId, contactId, contactCreated };
  }

  /**
   * Write the submitted address onto a contact **only when they have none**.
   *
   * Legacy overwrote `Email_Address` unconditionally
   * (`PrayerFeedbackService.cs:189`), which means a typo in a public prayer form
   * silently breaks a member's giving statements and every other email MP sends
   * them. Narrowing it to the empty case is also the case legacy's own UI was
   * built for: the email field only appeared when the selected household member
   * had no address on file.
   *
   * Best-effort by design — the `Feedback_Entries` row is already written by the
   * time this runs, and a failure to backfill a convenience field must not
   * report failure to the congregant.
   */
  public async backfillContactEmail(contactId: number, email: string): Promise<void> {
    const address = clean(email);
    if (!address) return;

    try {
      const row = await this.getContactRow(contactId);
      if (!row) return;
      if (clean(row.Email_Address) !== null) return;

      await this.mp!.updateTableRecords("Contacts", [
        { Contact_ID: contactId, Email_Address: address },
      ]);
    } catch (error) {
      console.warn(
        "PrayerFeedbackService: backfilling the contact email failed:",
        error instanceof Error ? error.message : error
      );
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async getContactRow(contactId: number): Promise<ContactSummaryRow | null> {
    const rows = await this.mp!.getTableRecords<ContactSummaryRow>({
      table: "Contacts",
      select:
        "Contact_ID,First_Name,Last_Name,Display_Name,Nickname,Email_Address,Household_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    return rows[0] ?? null;
  }

  /**
   * Mint a `Households` row and a `Contacts` row for a verified new submitter.
   *
   * Legacy's shape, with two corrections it omits:
   *
   * - **`Household_Source_ID`**, resolved by *name*. Legacy sets none, which
   *   makes a widget-created household indistinguishable from a staff-entered
   *   one. `Website` is the honest existing value, and a domain without it
   *   simply gets no source rather than a new lookup row it did not ask for.
   * - **`Household_Position_ID`**, also by name. Legacy sets no position at all,
   *   which leaves the new contact orphaned from every household tool in the
   *   Platform.
   *
   * `Contact_Status_ID`, not `Status`: legacy's `ContactManager.CreateContact`
   * writes `{"Status", …}` and **`Contacts` has no such column** (filed as C83).
   */
  private async createContactWithHousehold(c: {
    firstName: string;
    lastName: string;
    email: string;
    mobilePhone: string | null;
  }): Promise<number> {
    const [sourceId, activeStatusId, headPositionId] = await Promise.all([
      this.getIdByValue("Household_Sources", "Household_Source", "Website", "Household_Source_ID"),
      this.getIdByValue("Contact_Statuses", "Contact_Status", "Active", "Contact_Status_ID"),
      this.getIdByValue(
        "Household_Positions",
        "Household_Position",
        "Head of Household",
        "Household_Position_ID"
      ),
    ]);

    // The surname, or the local part of the address when the form gave none —
    // `Household_Name` is `NOT NULL`, and "Household" for everyone is worse for
    // staff than an email handle they can recognise.
    const householdName = c.lastName || c.email.split("@")[0] || c.firstName;

    const householdRecord: Record<string, unknown> = {
      Household_Name: cap(householdName, 75),
    };
    if (sourceId != null) householdRecord.Household_Source_ID = sourceId;

    const households = await this.mp!.createTableRecords<{ Household_ID: number }>(
      "Households",
      [householdRecord as unknown as { Household_ID: number }]
    );
    const householdId = toNumberOrNull(households[0]?.Household_ID ?? null);
    if (householdId == null) throw new Error("Failed to create household.");

    const contactRecord: Record<string, unknown> = {
      Company: false,
      Contact_Status_ID: activeStatusId,
      Household_ID: householdId,
      Household_Position_ID: headPositionId,
      First_Name: cap(c.firstName, 50),
      Last_Name: cap(c.lastName, 50),
      Nickname: cap(c.firstName, 50),
      Display_Name: cap(`${c.lastName}, ${c.firstName}`, 125),
      Email_Address: c.email,
      Mobile_Phone: c.mobilePhone,
    };

    const contacts = await this.mp!.createTableRecords<{ Contact_ID: number }>("Contacts", [
      contactRecord as unknown as { Contact_ID: number },
    ]);
    const contactId = toNumberOrNull(contacts[0]?.Contact_ID ?? null);
    if (contactId == null) throw new Error("Failed to create contact.");
    return contactId;
  }

  /**
   * Look up a lookup-table row's numeric id by one of its column values.
   *
   * Cached, and a failure caches `null` — the callers all treat `null` as "omit
   * the column", so a domain missing a lookup value degrades rather than
   * failing the whole submission.
   */
  private async getIdByValue(
    table: string,
    columnName: string,
    value: string,
    idColumn: string
  ): Promise<number | null> {
    const cacheKey = `${table}:${columnName}:${value}`;
    if (this.idCache.has(cacheKey)) return this.idCache.get(cacheKey)!;

    let id: number | null = null;
    try {
      const rows = await this.mp!.getTableRecords<Record<string, number | string | null>>({
        table,
        select: `${idColumn} AS Id`,
        filter: `${columnName} = '${sqlLiteral(value)}'`,
        top: 1,
      });
      id = toNumberOrNull(rows[0]?.Id ?? null);
    } catch (error) {
      console.warn(
        `PrayerFeedbackService: getIdByValue ${table}.${columnName} failed:`,
        error instanceof Error ? error.message : error
      );
    }
    this.idCache.set(cacheKey, id);
    return id;
  }

  /**
   * Now, as MP stores it: the **domain's wall clock**, `YYYY-MM-DD HH:mm:ss`.
   *
   * Never `new Date().toISOString()` on its own. MP stores wall-clock values in
   * the domain's zone rather than UTC, so a raw ISO string shifts an evening
   * submission in any negative-offset zone into the following day — which puts
   * a prayer request in the wrong day's queue.
   */
  private async now(): Promise<string> {
    const tz = DomainTimezoneService.getInstance();
    return tz.toMpSqlDatetime(new Date().toISOString());
  }
}
