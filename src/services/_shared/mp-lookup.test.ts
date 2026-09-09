import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MPHelper } from "@/lib/providers/ministry-platform";
import {
  clean,
  getIdByValue,
  sqlLiteral,
  toNumberOrNull,
} from "@/services/_shared/mp-lookup";

/**
 * The four helpers three services had their own copies of.
 *
 * `sqlLiteral` gets the most attention here because it is the one where a
 * divergence between copies would have been a SQL-injection bug rather than a
 * style inconsistency — which is the argument for there being one copy at all.
 */

/** A fake `MPHelper` exposing only the one method `getIdByValue` uses. */
function fakeMp(getTableRecords: ReturnType<typeof vi.fn>): MPHelper {
  return { getTableRecords } as unknown as MPHelper;
}

describe("sqlLiteral", () => {
  it("doubles a single quote", () => {
    expect(sqlLiteral("O'Brien")).toBe("O''Brien");
  });

  it("doubles every occurrence, not just the first", () => {
    // A partial escape is worse than none: it leaves a quote unbalanced in a
    // predictable place, which is exactly what a payload aims for.
    expect(sqlLiteral("'; DROP TABLE Contacts --'")).toBe(
      "''; DROP TABLE Contacts --''"
    );
  });

  it("leaves a value with no quote untouched", () => {
    expect(sqlLiteral("Head of Household")).toBe("Head of Household");
    expect(sqlLiteral("")).toBe("");
  });

  it("does not touch backslashes", () => {
    // T-SQL has no backslash escape, so mangling one would corrupt a legitimate
    // value (a Windows path in a note field) for no security gain.
    expect(sqlLiteral("a\\b")).toBe("a\\b");
  });
});

describe("clean", () => {
  it("trims", () => {
    expect(clean("  Website  ")).toBe("Website");
  });

  it("maps blank, whitespace, null and undefined to null", () => {
    expect(clean("")).toBeNull();
    expect(clean("   ")).toBeNull();
    expect(clean(null)).toBeNull();
    expect(clean(undefined)).toBeNull();
  });
});

describe("toNumberOrNull", () => {
  it("accepts both shapes MP returns an integer column in", () => {
    expect(toNumberOrNull(19)).toBe(19);
    expect(toNumberOrNull("19")).toBe(19);
  });

  it("returns null for empty, null and undefined", () => {
    expect(toNumberOrNull("")).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
  });

  it("returns null for a non-numeric string rather than NaN", () => {
    expect(toNumberOrNull("Website")).toBeNull();
  });

  it("keeps zero, which is a real id in some MP tables", () => {
    expect(toNumberOrNull(0)).toBe(0);
    expect(toNumberOrNull("0")).toBe(0);
  });
});

describe("getIdByValue", () => {
  let cache: Map<string, number | null>;

  beforeEach(() => {
    cache = new Map();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects the id column aliased to Id, filtered by value, top 1", async () => {
    const getTableRecords = vi.fn().mockResolvedValue([{ Id: 19 }]);
    const id = await getIdByValue(
      { mp: fakeMp(getTableRecords), cache, label: "TestService" },
      "Household_Sources",
      "Household_Source",
      "Website",
      "Household_Source_ID"
    );

    expect(id).toBe(19);
    expect(getTableRecords).toHaveBeenCalledWith({
      table: "Household_Sources",
      select: "Household_Source_ID AS Id",
      filter: "Household_Source = 'Website'",
      top: 1,
    });
  });

  it("escapes the value into the filter literal", async () => {
    const getTableRecords = vi.fn().mockResolvedValue([]);
    await getIdByValue(
      { mp: fakeMp(getTableRecords), cache, label: "TestService" },
      "Household_Sources",
      "Household_Source",
      "O'Brien' OR 1=1 --",
      "Household_Source_ID"
    );

    expect(getTableRecords.mock.calls[0][0].filter).toBe(
      "Household_Source = 'O''Brien'' OR 1=1 --'"
    );
  });

  it("caches a hit, so a second call performs no read", async () => {
    const getTableRecords = vi.fn().mockResolvedValue([{ Id: 1 }]);
    const source = { mp: fakeMp(getTableRecords), cache, label: "TestService" };

    await getIdByValue(source, "Contact_Statuses", "Contact_Status", "Active", "Contact_Status_ID");
    await getIdByValue(source, "Contact_Statuses", "Contact_Status", "Active", "Contact_Status_ID");

    expect(getTableRecords).toHaveBeenCalledTimes(1);
  });

  it("caches a miss too", async () => {
    // A domain that genuinely has no such lookup row must not pay a round-trip
    // per submission to rediscover that.
    const getTableRecords = vi.fn().mockResolvedValue([]);
    const source = { mp: fakeMp(getTableRecords), cache, label: "TestService" };

    expect(
      await getIdByValue(source, "Household_Sources", "Household_Source", "Nope", "Household_Source_ID")
    ).toBeNull();
    expect(
      await getIdByValue(source, "Household_Sources", "Household_Source", "Nope", "Household_Source_ID")
    ).toBeNull();

    expect(getTableRecords).toHaveBeenCalledTimes(1);
    expect(cache.get("Household_Sources:Household_Source:Nope")).toBeNull();
  });

  it("caches per table, column and value rather than per table", async () => {
    const getTableRecords = vi
      .fn()
      .mockResolvedValueOnce([{ Id: 1 }])
      .mockResolvedValueOnce([{ Id: 2 }]);
    const source = { mp: fakeMp(getTableRecords), cache, label: "TestService" };

    const head = await getIdByValue(
      source, "Household_Positions", "Household_Position", "Head of Household", "Household_Position_ID"
    );
    const minor = await getIdByValue(
      source, "Household_Positions", "Household_Position", "Minor Child", "Household_Position_ID"
    );

    expect(head).toBe(1);
    expect(minor).toBe(2);
    expect(getTableRecords).toHaveBeenCalledTimes(2);
  });

  it("swallows an MP failure, warns with the caller's label, and caches null", async () => {
    // Callers treat `null` as "omit the column" or "fail this one write", both
    // of which beat taking a whole submission down over a lookup table.
    const getTableRecords = vi.fn().mockRejectedValue(new Error("MP is down"));
    const source = { mp: fakeMp(getTableRecords), cache, label: "TestService" };

    expect(
      await getIdByValue(source, "Contact_Statuses", "Contact_Status", "Active", "Contact_Status_ID")
    ).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "TestService: getIdByValue Contact_Statuses.Contact_Status failed:",
      "MP is down"
    );
  });

  it("coerces a string id, as MP sometimes returns one", async () => {
    const getTableRecords = vi.fn().mockResolvedValue([{ Id: "36" }]);
    expect(
      await getIdByValue(
        { mp: fakeMp(getTableRecords), cache, label: "TestService" },
        "Household_Sources",
        "Household_Source",
        "Plan a Visit Widget",
        "Household_Source_ID"
      )
    ).toBe(36);
  });
});
