/**
 * `Contact_Attributes` for the signed-in congregant (C52, `next-contact-attributes`).
 *
 * The legacy counterpart was `mpp-about-me`, whose server half lived in
 * `PortalComponents/DataManagers/AttributeManager.cs`. Two of its names are
 * wrong and are not reproduced here: the grouping entity is **`Attribute_Types`**
 * (there is no `Attribute_Categories` table in MinistryPlatform — the legacy
 * `category_2_attribute_3` checkbox name interpolated an `Attribute_Type_ID`
 * into a local variable its author called `category`), and member visibility is
 * `Attribute_Types.Available_Online`, a **type**-level flag. `Attributes` has no
 * online column at all, so a church cannot hide one attribute inside a visible
 * type.
 *
 * ## The one behaviour that is deliberately not a port
 *
 * `AttributeManager.UpdateContactAttributes` took `attributesToAdd` straight off
 * the request body and wrote it. It read the contact's *existing* rows through
 * the `Available_Online` filter but never checked the *incoming* ids against
 * that same set, so a signed-in congregant with `curl` could give themselves any
 * attribute in any type staff had kept offline — "Allergies & Special Needs", a
 * check-in group tag — and the reads then hid the row again, so nobody could see
 * where it came from.
 *
 * `setForContact` recomputes the visible universe on every write and throws
 * {@link InvalidAttributeError} before touching MP if the requested set is not a
 * subset of it. That check is the authorization boundary for which rows may be
 * written; the widget rendering only visible types is a convenience, not a
 * control.
 *
 * Full reasoning: `.claude/TODO/Comparison/Plans/contact-attributes.md`.
 */

import { MPHelper } from "@/lib/providers/ministry-platform";
import { toNumberOrNull } from "@/services/_shared/mp-lookup";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type { ContactAttributeGroup } from "@mpnext/types";

/**
 * One member-visible attribute, joined to its type.
 *
 * The base columns are qualified in the `$select` and the `$filter` because the
 * query traverses `Attribute_Type_ID_Table` — MP answers 500 on an ambiguous
 * column name once a join is in play, the same trap `myPledgesService` and
 * `pledgeCampaignService` each carry a comment about.
 */
interface VisibleAttributeRow {
  AttributeId: number | string;
  AttributeName: string | null;
  AttributeTypeId: number | string;
  AttributeTypeName: string | null;
  OnlineSortOrder: number | string | null;
}

/** One of the contact's own rows, already scoped to a member-visible type. */
interface ContactAttributeRow {
  ContactAttributeId: number | string;
  AttributeId: number | string;
  EndDate: string | null;
}

/** The visible universe, flat, before grouping. */
interface VisibleAttribute {
  attributeId: number;
  attributeName: string;
  attributeTypeId: number;
  attributeTypeName: string;
  onlineSortOrder: number | null;
}

/**
 * A requested attribute is not in a member-visible type.
 *
 * Carries the offending ids for the route's log line only — the response is the
 * machine code `invalid_attribute` and nothing else, because echoing the ids
 * back would confirm which of them exist.
 */
export class InvalidAttributeError extends Error {
  public readonly attributeIds: number[];

  constructor(attributeIds: number[]) {
    super(
      `Attribute ids outside the member-visible universe: ${attributeIds.join(", ")}`
    );
    this.name = "InvalidAttributeError";
    this.attributeIds = attributeIds;
  }
}

/**
 * Normalise an MP datetime to the `YYYY-MM-DD HH:mm:ss` shape
 * `toMpSqlDatetime` produces, so two wall-clock values compare as strings.
 *
 * MP hands back `2026-09-11T14:00:00` from one endpoint and
 * `2026-09-11 14:00:00` from another. Both are wall clock in the domain's zone,
 * never UTC, so the comparison has to stay in wall-clock space — parsing either
 * side into a `Date` re-introduces exactly the day shift the boundary rule
 * exists to avoid.
 */
function normaliseMpDatetime(value: string): string {
  return value.trim().replace("T", " ").slice(0, 19);
}

export class ContactAttributeService {
  private static instance: ContactAttributeService;
  private mp: MPHelper | null = null;

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<ContactAttributeService> {
    if (!ContactAttributeService.instance) {
      ContactAttributeService.instance = new ContactAttributeService();
      await ContactAttributeService.instance.initialize();
    }
    return ContactAttributeService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  /** Resolve `dp_Users.User_GUID` to a `Contact_ID`. The only identity input. */
  public async getContactIdByUserGuid(userGuid: string): Promise<number | null> {
    const users = await this.mp!.getTableRecords<{ Contact_ID: number | string }>({
      table: "dp_Users",
      filter: `User_GUID = '${userGuid}'`,
      select: "Contact_ID",
      top: 1,
    });
    return users.length > 0 ? toNumberOrNull(users[0].Contact_ID) : null;
  }

  /**
   * Types with `Available_Online = 1`, their attributes, and which of them the
   * contact currently holds.
   *
   * An empty array is a legitimate answer, not an error: a fresh MP domain has
   * no online attribute type, and the widget renders an explanatory state.
   */
  public async getForContact(contactId: number): Promise<ContactAttributeGroup[]> {
    const [visible, rows, nowSql] = await Promise.all([
      this.readVisibleUniverse(),
      this.readContactRows(contactId),
      this.domainNow(),
    ]);

    const selected = new Set<number>();
    for (const row of rows) {
      const attributeId = toNumberOrNull(row.AttributeId);
      if (attributeId !== null && this.isActive(row, nowSql)) selected.add(attributeId);
    }

    return this.group(visible, selected);
  }

  /**
   * Replace the contact's selection within the member-visible universe.
   *
   * The caller sends the **complete** desired set, not legacy's add/remove
   * delta: that delta was computed on the client against a snapshot, so two open
   * tabs silently clobbered each other, and "absent from both arrays" was the
   * only encoding for both "leave this alone" and "the client forgot". The diff
   * belongs where the truth is.
   *
   * Rows in a type that is *not* `Available_Online` are never read here, so a
   * church can take a type offline without the next member save end-dating every
   * row in it.
   *
   * @throws {InvalidAttributeError} before any MP call, if a requested id is
   *   outside the visible universe.
   */
  public async setForContact(
    contactId: number,
    attributeIds: number[]
  ): Promise<ContactAttributeGroup[]> {
    const visible = await this.readVisibleUniverse();
    const visibleIds = new Set(visible.map((a) => a.attributeId));

    // Coerce before comparing, so a stringified id from a hand-rolled client is
    // measured against the same set the filters are built from — and so nothing
    // that is not a number can reach an MP filter.
    const requested = new Set<number>();
    const rejected: number[] = [];
    for (const raw of attributeIds) {
      const id = toNumberOrNull(raw);
      if (id === null || !visibleIds.has(id)) {
        rejected.push(id ?? Number.NaN);
        continue;
      }
      requested.add(id);
    }

    // D1's guard. Before the contact's rows are even read, and long before any
    // write: a rejected request must leave MP completely untouched.
    if (rejected.length > 0) throw new InvalidAttributeError(rejected);

    const [rows, nowSql] = await Promise.all([
      this.readContactRows(contactId),
      this.domainNow(),
    ]);

    // `Map<id, row[]>`, not `Map<id, row>`. `Contact_Attributes` has **no**
    // uniqueness constraint on (Contact_ID, Attribute_ID), and the reference
    // domain already violates the assumption: contacts 5 and 13 each hold two
    // active rows for attribute 1. Legacy's own writes kept one row per pair,
    // but data seeded by a conversion, an import or a staff user does not — and
    // a plain map would silently keep the last row and drop the rest, so a
    // deselection would end-date one of the two and leave the attribute live.
    const byAttribute = new Map<number, ContactAttributeRow[]>();
    for (const row of rows) {
      const attributeId = toNumberOrNull(row.AttributeId);
      if (attributeId === null) continue;
      const list = byAttribute.get(attributeId);
      if (list) list.push(row);
      else byAttribute.set(attributeId, [row]);
    }

    const toCreate: Record<string, unknown>[] = [];
    const toReactivate: Record<string, unknown>[] = [];
    const toEnd: Record<string, unknown>[] = [];

    for (const attributeId of requested) {
      const existing = byAttribute.get(attributeId) ?? [];
      if (existing.length === 0) {
        toCreate.push({
          Contact_ID: contactId,
          Attribute_ID: attributeId,
          Start_Date: nowSql,
        });
        continue;
      }
      // Already held: nothing to do. Re-sending an unchanged set is a no-op,
      // which is what makes a replay harmless rather than a resurrection.
      // `some`, not "the row", because a pair can legitimately have several.
      if (existing.some((row) => this.isActive(row, nowSql))) continue;

      // Held once and given up since — reactivate a row in place rather than
      // insert a second one for the same pair. MP's own convention for this
      // table, and legacy's `ReactivateAttributes`.
      //
      // Exactly **one** row is revived even when the pair has several end-dated
      // ones, and it is the lowest `Contact_Attribute_ID`: the oldest row, so
      // the choice is stable across calls and does not depend on the order MP
      // happened to return. Resurrecting all of them would turn a duplicate
      // seeded by an import into a duplicate this widget authored.
      const revived = existing
        .map((row) => toNumberOrNull(row.ContactAttributeId))
        .filter((id): id is number => id !== null)
        .sort((a, b) => a - b)[0];
      if (revived === undefined) continue;
      toReactivate.push({
        Contact_Attribute_ID: revived,
        Start_Date: nowSql,
        End_Date: null,
      });
    }

    // Iterating the **rows** rather than the attribute ids is what makes a
    // deselection end-date every active row for that attribute. With duplicates
    // in the data, ending only one leaves the attribute live and the visitor's
    // untick silently does nothing.
    for (const row of rows) {
      const attributeId = toNumberOrNull(row.AttributeId);
      if (attributeId === null || requested.has(attributeId)) continue;
      if (!this.isActive(row, nowSql)) continue;
      const id = toNumberOrNull(row.ContactAttributeId);
      if (id === null) continue;
      // Removal end-dates; it never deletes. The row is the contact's history.
      toEnd.push({ Contact_Attribute_ID: id, End_Date: nowSql });
    }

    // Two update calls rather than one merged set: a reactivation writes
    // `Start_Date` and `End_Date`, an end-date writes only `End_Date`, and MP's
    // update endpoint takes one column list for a whole record set.
    if (toReactivate.length > 0) {
      await this.mp!.updateTableRecords("Contact_Attributes", toReactivate);
    }
    if (toEnd.length > 0) {
      await this.mp!.updateTableRecords("Contact_Attributes", toEnd);
    }
    if (toCreate.length > 0) {
      await this.mp!.createTableRecords("Contact_Attributes", toCreate);
    }

    // Re-read rather than project what we hoped we wrote, so the widget renders
    // the server's truth.
    return this.getForContact(contactId);
  }

  // ── MP reads ─────────────────────────────────────────────────────────────

  /** Every attribute whose type is `Available_Online`, with that type. */
  private async readVisibleUniverse(): Promise<VisibleAttribute[]> {
    const rows = await this.mp!.getTableRecords<VisibleAttributeRow>({
      table: "Attributes",
      select: [
        "Attributes.Attribute_ID AS AttributeId",
        "Attributes.Attribute_Name AS AttributeName",
        "Attribute_Type_ID_Table.Attribute_Type_ID AS AttributeTypeId",
        "Attribute_Type_ID_Table.Attribute_Type AS AttributeTypeName",
        "Attribute_Type_ID_Table.Online_Sort_Order AS OnlineSortOrder",
      ].join(", "),
      filter: "Attribute_Type_ID_Table.Available_Online = 1",
    });

    const out: VisibleAttribute[] = [];
    for (const row of rows) {
      const attributeId = toNumberOrNull(row.AttributeId);
      const attributeTypeId = toNumberOrNull(row.AttributeTypeId);
      if (attributeId === null || attributeTypeId === null) continue;
      out.push({
        attributeId,
        attributeName: (row.AttributeName ?? "").trim(),
        attributeTypeId,
        attributeTypeName: (row.AttributeTypeName ?? "").trim(),
        onlineSortOrder: toNumberOrNull(row.OnlineSortOrder),
      });
    }
    return out;
  }

  /**
   * The contact's `Contact_Attributes` rows in member-visible types — active
   * **and** end-dated, because an end-dated row is what makes a re-selection a
   * reactivation instead of a duplicate.
   *
   * The filter is a two-hop traversal
   * (`Attribute_ID_Table_Attribute_Type_ID_Table`), and it is the guarantee that
   * a hidden type's rows are invisible to every operation in this file.
   *
   * **That guarantee has a live canary.** Every `Contact_Attributes` row on the
   * reference domain sits in a non-online type, and contact 3 (MPTrainer, a user
   * who can actually sign in) holds an active "Allergies & Special Needs" row.
   * Drop this hop and that user's first save end-dates real medical-flag data on
   * a shared domain. `setForContact` never sees a row this method did not
   * return, which is why the scoping lives here and nowhere else.
   */
  private async readContactRows(contactId: number): Promise<ContactAttributeRow[]> {
    const id = toNumberOrNull(contactId);
    if (id === null) return [];

    return this.mp!.getTableRecords<ContactAttributeRow>({
      table: "Contact_Attributes",
      select: [
        "Contact_Attributes.Contact_Attribute_ID AS ContactAttributeId",
        "Contact_Attributes.Attribute_ID AS AttributeId",
        "Contact_Attributes.End_Date AS EndDate",
      ].join(", "),
      filter: [
        `Contact_Attributes.Contact_ID = ${id}`,
        "Attribute_ID_Table_Attribute_Type_ID_Table.Available_Online = 1",
      ].join(" AND "),
    });
  }

  // ── Shaping ──────────────────────────────────────────────────────────────

  /**
   * Group the flat universe into wire order.
   *
   * Types sort by `Online_Sort_Order` with nulls last, then by name; attributes
   * sort by name case-insensitively (legacy's `sensitivity: "base"`). Legacy
   * ignored `Online_Sort_Order` entirely and rendered types in whatever order
   * the API happened to return, so a church that set one never saw it.
   *
   * A type left with no attributes is dropped, matching legacy's
   * `results.Where(r => r.Attributes.SafeAny())`.
   */
  private group(
    visible: VisibleAttribute[],
    selected: Set<number>
  ): ContactAttributeGroup[] {
    const groups = new Map<
      number,
      ContactAttributeGroup & { sortOrder: number | null }
    >();

    for (const attribute of visible) {
      let group = groups.get(attribute.attributeTypeId);
      if (!group) {
        group = {
          attributeTypeId: attribute.attributeTypeId,
          attributeTypeName: attribute.attributeTypeName,
          attributes: [],
          sortOrder: attribute.onlineSortOrder,
        };
        groups.set(attribute.attributeTypeId, group);
      }
      group.attributes.push({
        attributeId: attribute.attributeId,
        attributeName: attribute.attributeName,
        selected: selected.has(attribute.attributeId),
      });
    }

    const ordered = [...groups.values()].filter((g) => g.attributes.length > 0);

    ordered.sort((a, b) => {
      const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.attributeTypeName.localeCompare(b.attributeTypeName, undefined, {
        sensitivity: "base",
      });
    });

    return ordered.map(({ attributeTypeId, attributeTypeName, attributes }) => ({
      attributeTypeId,
      attributeTypeName,
      attributes: [...attributes].sort((a, b) =>
        a.attributeName.localeCompare(b.attributeName, undefined, {
          sensitivity: "base",
        })
      ),
    }));
  }

  /**
   * Is this row an active declaration?
   *
   * `End_Date` null, or in the future by the domain's wall clock — legacy's
   * `End_Date > GETDATE() OR End_Date IS NULL`, evaluated here rather than in
   * the filter because the write needs the end-dated rows too.
   */
  private isActive(row: ContactAttributeRow, nowSql: string): boolean {
    const endDate = row.EndDate;
    if (endDate === null || endDate === undefined || endDate === "") return true;
    return normaliseMpDatetime(String(endDate)) > nowSql;
  }

  /**
   * "Now", as MP stores it.
   *
   * `Start_Date` and `End_Date` are wall-clock datetimes in the domain's zone,
   * so `new Date().toISOString()` would end-date an attribute several hours out
   * — invisible until a report disagrees with the widget.
   */
  private async domainNow(): Promise<string> {
    const tz = DomainTimezoneService.getInstance();
    return tz.toMpSqlDatetime(new Date());
  }
}
