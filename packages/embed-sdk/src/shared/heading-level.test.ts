import { describe, it, expect } from "vitest";
import { headingTag } from "./heading-level";

describe("headingTag (C35 heading-level)", () => {
  it("defaults to h2 when the attribute is absent or unparsable", () => {
    expect(headingTag(null)).toBe("h2");
    expect(headingTag("")).toBe("h2");
    expect(headingTag("banana")).toBe("h2");
    expect(headingTag("0")).toBe("h2");
    expect(headingTag("7")).toBe("h2");
  });

  it("uses the given level and steps down by offset, clamped to h6", () => {
    expect(headingTag("1")).toBe("h1");
    expect(headingTag("3", 1)).toBe("h4");
    expect(headingTag(null, 1)).toBe("h3");
    expect(headingTag("5", 3)).toBe("h6");
  });
});
