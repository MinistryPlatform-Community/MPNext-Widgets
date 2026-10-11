import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ContactAttributeService,
  InvalidAttributeError,
} from "@/services/contactAttributeService";

/**
 * `ContactAttributeService` — C52's read shape and, mostly, its write guard.
 *
 * ## What is being defended against
 *
 * Legacy's `AttributeManager.UpdateContactAttributes` read the contact's
 * existing rows through the `Available_Online` filter and then wrote
 * `attributesToAdd` **without checking it against that same set**. A signed-in
 * congregant could therefore give themselves any attribute in any type the
 * church had deliberately kept offline — on a stock domain that includes
 * "Allergies & Special Needs" and every check-in group tag — and the reads then
 * hid the row again, so neither the user nor staff could see where it came
 * from. "rejects an id outside the visible universe" below is that hole proved
 * closed, and it asserts on the *absence* of MP writes rather than on the
 * thrown error, because the error is the easy half.
 *
 * ## Two hazards that came out of the live reference domain
 *
 * - **Duplicate (Contact_ID, Attribute_ID) rows exist.** `Contact_Attributes`
 *   has no uniqueness constraint; contacts 5 and 13 each hold two active rows
 *   for attribute 1. Legacy's own writes kept one row per pair, but conversion
 *   and import data does not. A `Map<attributeId, row>` would keep the last row
 *   and drop the rest, so a deselection would end-date one of the two and leave
 *   the attribute live — the visitor's untick doing nothing at all.
 * - **Every row on the reference domain is in an offline type**, and contact 3
 *   (MPTrainer) — a user who can sign in — holds an active "Allergies & Special
 *   Needs" row. Get the write scoping wrong and that user's first save
 *   end-dates real medical-flag data on a shared domain. The "hidden type"
 *   tests are that canary.
 */

const mockGetTableRecords = vi.fn();
const mockCreateTableRecords = vi.fn();
const mockUpdateTableRecords = vi.fn();

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = mockCreateTableRecords;
    updateTableRecords = mockUpdateTableRecords;
  },
}));

/**
 * The domain clock, frozen.
 *
 * `toMpSqlDatetime` is mocked rather than stubbed out so the "no `toISOString`"
 * assertion has something to observe: the value it returns carries no `T` and
 * no `Z`, which an ISO string always would.
 */
const NOW_SQL = "2026-09-11 09:00:00";
const mockToMpSqlDatetime = vi.fn(async () => NOW_SQL);

vi.mock("@/services/domainTimezoneService", () => ({
  DomainTimezoneService: {
    getInstance: () => ({
      getMpTimezone: async () => "America/New_York",
      toMpSqlDatetime: mockToMpSqlDatetime,
    }),
  },
}));

const CONTACT_ID = 98;

/** One row of the visible-universe read, in its aliased shape. */
function attr(
  attributeId: number,
  attributeName: string,
  typeId: number,
  typeName: string,
  sortOrder: number | null = null
) {
  return {
    AttributeId: attributeId,
    AttributeName: attributeName,
    AttributeTypeId: typeId,
    AttributeTypeName: typeName,
    OnlineSortOrder: sortOrder,
  };
}

/** One of the contact's rows, in its aliased shape. */
function row(contactAttributeId: number, attributeId: number, endDate: string | null = null) {
  return {
    ContactAttributeId: contactAttributeId,
    AttributeId: attributeId,
    EndDate: endDate,
  };
}

/** The reference domain's two online types, trimmed to four attributes. */
const UNIVERSE = [
  attr(6, "Carpenter", 2, "Occupation", 2),
  attr(8, "doctor", 2, "Occupation", 2),
  attr(11, "Teaching", 3, "Spiritual Gifts", 1),
  attr(14, "Administration", 3, "Spiritual Gifts", 1),
];

/**
 * Route each `getTableRecords` call by table.
 *
 * `Attributes` is the visible universe, `Contact_Attributes` the contact's rows.
 * Anything else fails loudly rather than returning `[]`, so a query this service
 * should not be making cannot pass silently.
 */
function mpReturns(universe = UNIVERSE, rows: ReturnType<typeof row>[] = []) {
  mockGetTableRecords.mockImplementation(async (params: { table: string }) => {
    if (params.table === "Attributes") return universe;
    if (params.table === "Contact_Attributes") return rows;
    if (params.table === "dp_Users") return [{ Contact_ID: CONTACT_ID }];
    throw new Error(`unexpected table: ${params.table}`);
  });
}

/** The params of the one `Contact_Attributes` read, for filter assertions. */
function contactReadParams(): { table: string; select: string; filter: string } {
  const call = mockGetTableRecords.mock.calls.find(
    ([p]) => (p as { table: string }).table === "Contact_Attributes"
  );
  expect(call, "expected a Contact_Attributes read").toBeDefined();
  return call![0];
}

function universeReadParams(): { table: string; select: string; filter: string } {
  const call = mockGetTableRecords.mock.calls.find(
    ([p]) => (p as { table: string }).table === "Attributes"
  );
  expect(call, "expected an Attributes read").toBeDefined();
  return call![0];
}

/** Every record passed to `updateTableRecords`, flattened across calls. */
function updatedRecords(): Record<string, unknown>[] {
  return mockUpdateTableRecords.mock.calls.flatMap(
    ([, records]) => records as Record<string, unknown>[]
  );
}

function createdRecords(): Record<string, unknown>[] {
  return mockCreateTableRecords.mock.calls.flatMap(
    ([, records]) => records as Record<string, unknown>[]
  );
}

async function service(): Promise<ContactAttributeService> {
  return ContactAttributeService.getInstance();
}

describe("ContactAttributeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ContactAttributeService as any).instance = undefined;
    mockCreateTableRecords.mockResolvedValue([]);
    mockUpdateTableRecords.mockResolvedValue([]);
    mockToMpSqlDatetime.mockResolvedValue(NOW_SQL);
    mpReturns();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("the visible universe", () => {
    it("filters on Available_Online and qualifies its base columns", async () => {
      await (await service()).getForContact(CONTACT_ID);

      const params = universeReadParams();
      expect(params.filter).toBe("Attribute_Type_ID_Table.Available_Online = 1");
      // Unqualified base columns make MP 500 once a join is in play.
      expect(params.select).toContain("Attributes.Attribute_ID");
      expect(params.select).toContain("Attributes.Attribute_Name");
      expect(params.select).toContain("Attribute_Type_ID_Table.Attribute_Type");
      expect(params.select).toContain("Attribute_Type_ID_Table.Online_Sort_Order");
    });

    it("scopes the contact's rows with the two-hop traversal", async () => {
      await (await service()).getForContact(CONTACT_ID);

      const params = contactReadParams();
      expect(params.filter).toContain(`Contact_Attributes.Contact_ID = ${CONTACT_ID}`);
      expect(params.filter).toContain(
        "Attribute_ID_Table_Attribute_Type_ID_Table.Available_Online = 1"
      );
      expect(params.select).toContain("Contact_Attributes.Contact_Attribute_ID");
    });

    it("builds the contact filter from a coerced number, never a raw string", async () => {
      // MP returns integer columns as strings from some endpoints, so a
      // stringified id has to survive; a SQL fragment must not.
      await (await service()).getForContact("98" as unknown as number);
      expect(contactReadParams().filter).toContain("Contact_Attributes.Contact_ID = 98");

      vi.clearAllMocks();
      mpReturns();

      await (await service()).getForContact("98; DROP TABLE" as unknown as number);
      // `toNumberOrNull` refuses it, so the query is never issued at all —
      // there is nothing for a `sqlLiteral` to have failed to escape.
      const reads = mockGetTableRecords.mock.calls.filter(
        ([p]) => (p as { table: string }).table === "Contact_Attributes"
      );
      expect(reads).toHaveLength(0);
    });
  });

  describe("grouping and ordering", () => {
    it("sorts types by Online_Sort_Order, then by name, with nulls last", async () => {
      mpReturns([
        attr(1, "A", 4, "Zulu", null),
        attr(2, "B", 2, "Occupation", 2),
        attr(3, "C", 3, "Spiritual Gifts", 1),
        attr(4, "D", 5, "Alpha", null),
      ]);

      const groups = await (await service()).getForContact(CONTACT_ID);

      expect(groups.map((g) => g.attributeTypeName)).toEqual([
        "Spiritual Gifts",
        "Occupation",
        "Alpha",
        "Zulu",
      ]);
    });

    it("sorts attributes by name case-insensitively", async () => {
      const groups = await (await service()).getForContact(CONTACT_ID);
      const occupation = groups.find((g) => g.attributeTypeName === "Occupation")!;

      // "doctor" is lowercase; a case-sensitive sort would put it after
      // "Carpenter" for the wrong reason and before an "Engineer" it should
      // follow. Legacy used `sensitivity: "base"`.
      expect(occupation.attributes.map((a) => a.attributeName)).toEqual([
        "Carpenter",
        "doctor",
      ]);
    });

    it("drops a type left with no attributes", async () => {
      // MP cannot return an attribute-less row from this join, but the filter
      // above can leave one behind once a name fails to coerce.
      mpReturns([
        attr(6, "Carpenter", 2, "Occupation", 1),
        { ...attr(0, "Broken", 9, "Ghost", 2), AttributeId: null as unknown as number },
      ]);

      const groups = await (await service()).getForContact(CONTACT_ID);

      expect(groups.map((g) => g.attributeTypeName)).toEqual(["Occupation"]);
    });

    it("returns an empty array when no type is Available_Online", async () => {
      mpReturns([]);

      // Not an error: a fresh MP domain looks exactly like this, and the widget
      // renders an explanatory state.
      await expect((await service()).getForContact(CONTACT_ID)).resolves.toEqual([]);
    });
  });

  describe("selected", () => {
    it("is true for a null End_Date and for one in the future, false for a past one", async () => {
      mpReturns(UNIVERSE, [
        row(1, 6, null),
        row(2, 8, "2099-01-01T00:00:00"),
        row(3, 11, "2020-01-01T00:00:00"),
      ]);

      const groups = await (await service()).getForContact(CONTACT_ID);
      const selected = new Map(
        groups.flatMap((g) => g.attributes.map((a) => [a.attributeId, a.selected]))
      );

      expect(selected.get(6)).toBe(true);
      expect(selected.get(8)).toBe(true);
      expect(selected.get(11)).toBe(false);
      expect(selected.get(14)).toBe(false);
    });

    it("is true when any of several duplicate rows is active", async () => {
      // Contacts 5 and 13 on the reference domain, in miniature.
      mpReturns(UNIVERSE, [row(2, 6, "2020-01-01T00:00:00"), row(3, 6, null)]);

      const groups = await (await service()).getForContact(CONTACT_ID);
      const carpenter = groups
        .flatMap((g) => g.attributes)
        .find((a) => a.attributeId === 6)!;

      expect(carpenter.selected).toBe(true);
    });
  });

  describe("the write guard (D1)", () => {
    it("rejects an id outside the visible universe and performs zero MP writes", async () => {
      // Attribute 1 is "Allergies & Special Needs" — type 1, Available_Online
      // false. Legacy would have written it.
      await expect(
        (await service()).setForContact(CONTACT_ID, [6, 1])
      ).rejects.toBeInstanceOf(InvalidAttributeError);

      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });

    it("rejects before it even reads the contact's rows", async () => {
      await expect(
        (await service()).setForContact(CONTACT_ID, [999])
      ).rejects.toBeInstanceOf(InvalidAttributeError);

      const read = mockGetTableRecords.mock.calls.filter(
        ([p]) => (p as { table: string }).table === "Contact_Attributes"
      );
      expect(read).toHaveLength(0);
    });

    it("rejects a non-numeric id rather than coercing it into a filter", async () => {
      await expect(
        (await service()).setForContact(CONTACT_ID, ["6 OR 1=1"] as unknown as number[])
      ).rejects.toBeInstanceOf(InvalidAttributeError);

      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });

    it("names the offending ids on the error, for the log only", async () => {
      const error = await (await service())
        .setForContact(CONTACT_ID, [6, 1, 4])
        .catch((e: unknown) => e as InvalidAttributeError);

      expect(error).toBeInstanceOf(InvalidAttributeError);
      expect((error as InvalidAttributeError).attributeIds).toEqual([1, 4]);
    });
  });

  describe("the write", () => {
    it("creates a row with a Start_Date and no End_Date", async () => {
      mpReturns(UNIVERSE, []);

      await (await service()).setForContact(CONTACT_ID, [6]);

      expect(createdRecords()).toEqual([
        { Contact_ID: CONTACT_ID, Attribute_ID: 6, Start_Date: NOW_SQL },
      ]);
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });

    it("reactivates an end-dated row in place instead of inserting a duplicate", async () => {
      mpReturns(UNIVERSE, [row(41, 6, "2020-01-01T00:00:00")]);

      await (await service()).setForContact(CONTACT_ID, [6]);

      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(updatedRecords()).toEqual([
        { Contact_Attribute_ID: 41, Start_Date: NOW_SQL, End_Date: null },
      ]);
    });

    it("reactivates exactly one row — the lowest id — when the pair has several", async () => {
      mpReturns(UNIVERSE, [
        row(52, 6, "2021-01-01T00:00:00"),
        row(41, 6, "2020-01-01T00:00:00"),
      ]);

      await (await service()).setForContact(CONTACT_ID, [6]);

      // Resurrecting both would turn a duplicate seeded by an import into one
      // this widget authored.
      expect(updatedRecords()).toEqual([
        { Contact_Attribute_ID: 41, Start_Date: NOW_SQL, End_Date: null },
      ]);
    });

    it("end-dates a removal rather than deleting it", async () => {
      mpReturns(UNIVERSE, [row(41, 6, null)]);

      await (await service()).setForContact(CONTACT_ID, []);

      expect(updatedRecords()).toEqual([
        { Contact_Attribute_ID: 41, End_Date: NOW_SQL },
      ]);
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
    });

    it("end-dates EVERY active duplicate row when the attribute is deselected", async () => {
      // The reference domain's contact 5: rows 2 and 3, both attribute 1, both
      // active. End only one and the attribute stays selected on the next read,
      // so the visitor's untick silently does nothing.
      mpReturns(UNIVERSE, [row(2, 6, null), row(3, 6, null)]);

      await (await service()).setForContact(CONTACT_ID, []);

      expect(updatedRecords()).toEqual([
        { Contact_Attribute_ID: 2, End_Date: NOW_SQL },
        { Contact_Attribute_ID: 3, End_Date: NOW_SQL },
      ]);
    });

    it("is a no-op when the requested set matches what is already active", async () => {
      mpReturns(UNIVERSE, [row(41, 6, null), row(42, 11, null)]);

      await (await service()).setForContact(CONTACT_ID, [6, 11]);

      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });

    it("does all three operations in one call", async () => {
      mpReturns(UNIVERSE, [
        row(41, 6, null), // active, not requested  -> end-date
        row(42, 8, "2020-01-01T00:00:00"), // end-dated, requested -> reactivate
        // 11 has no row at all, and is requested   -> create
      ]);

      await (await service()).setForContact(CONTACT_ID, [8, 11]);

      expect(updatedRecords()).toEqual(
        expect.arrayContaining([
          { Contact_Attribute_ID: 42, Start_Date: NOW_SQL, End_Date: null },
          { Contact_Attribute_ID: 41, End_Date: NOW_SQL },
        ])
      );
      expect(createdRecords()).toEqual([
        { Contact_ID: CONTACT_ID, Attribute_ID: 11, Start_Date: NOW_SQL },
      ]);
    });

    it("returns the recomputed read payload, not a success flag", async () => {
      mpReturns(UNIVERSE, [row(41, 6, null)]);

      const result = await (await service()).setForContact(CONTACT_ID, [6]);

      expect(result.map((g) => g.attributeTypeName)).toEqual([
        "Spiritual Gifts",
        "Occupation",
      ]);
      const carpenter = result
        .flatMap((g) => g.attributes)
        .find((a) => a.attributeId === 6)!;
      expect(carpenter.selected).toBe(true);
    });
  });

  describe("hidden types are untouchable", () => {
    it("never reads a row outside a member-visible type", async () => {
      // The scoping lives in one place — this filter — so this is the assertion
      // that keeps contact 3's "Allergies & Special Needs" row safe.
      await (await service()).setForContact(CONTACT_ID, [6]);

      for (const [params] of mockGetTableRecords.mock.calls) {
        if ((params as { table: string }).table !== "Contact_Attributes") continue;
        expect((params as { filter: string }).filter).toContain(
          "Attribute_ID_Table_Attribute_Type_ID_Table.Available_Online = 1"
        );
      }
    });

    it("leaves a hidden-type row alone when the whole set is cleared", async () => {
      // The read is scoped, so the hidden row is simply not among `rows`. The
      // point of the test is that clearing everything still writes nothing: an
      // implementation that end-dated "every row the contact has" would wipe it.
      mpReturns(UNIVERSE, []);

      await (await service()).setForContact(CONTACT_ID, []);

      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
    });

    it("cannot be asked to write into a hidden type even by id", async () => {
      mpReturns(UNIVERSE, []);

      await expect(
        // Attribute 1 belongs to a hidden type on the reference domain.
        (await service()).setForContact(CONTACT_ID, [1])
      ).rejects.toBeInstanceOf(InvalidAttributeError);

      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
    });
  });

  describe("dates", () => {
    it("writes wall-clock datetimes from toMpSqlDatetime, never toISOString", async () => {
      mpReturns(UNIVERSE, [row(41, 6, null)]);

      await (await service()).setForContact(CONTACT_ID, [11]);

      expect(mockToMpSqlDatetime).toHaveBeenCalled();
      const written = [...createdRecords(), ...updatedRecords()];
      expect(written.length).toBeGreaterThan(0);
      for (const record of written) {
        for (const value of Object.values(record)) {
          if (typeof value !== "string") continue;
          // An ISO instant would carry both, and would land in MP hours out.
          expect(value).not.toContain("T");
          expect(value).not.toContain("Z");
        }
      }
    });
  });
});
