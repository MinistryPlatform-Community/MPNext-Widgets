import { describe, expect, it } from "vitest";
import { publicEventFilter, publicEventPredicate } from "./public-events";

describe("publicEventFilter", () => {
  it("ANDs the public, non-cancelled predicate onto the clause", () => {
    expect(publicEventFilter("Event_ID = 7")).toBe(
      "(Event_ID = 7) AND Cancelled = 0 AND Visibility_Level_ID = 4",
    );
  });

  it("parenthesises the clause so an OR inside it cannot bypass the predicate", () => {
    expect(publicEventFilter("Event_ID = 1 OR Event_ID = 2")).toBe(
      "(Event_ID = 1 OR Event_ID = 2) AND Cancelled = 0 AND Visibility_Level_ID = 4",
    );
  });

  it("qualifies the columns when given a table prefix", () => {
    expect(publicEventPredicate("Events.")).toBe(
      "Events.Cancelled = 0 AND Events.Visibility_Level_ID = 4",
    );
  });
});
