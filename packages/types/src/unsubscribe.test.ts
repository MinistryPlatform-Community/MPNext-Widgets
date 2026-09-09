import { describe, expect, it } from "vitest";
import {
  UnsubscribeRequestSchema,
  UnsubscribeResponseSchema,
  resolvePublicationId,
  unsubscribeScope,
} from "./unsubscribe";

const CG = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("UnsubscribeRequestSchema", () => {
  it("round-trips a per-publication request", () => {
    const parsed = UnsubscribeRequestSchema.parse({ cg: CG, pubid: 4 });
    expect(parsed).toEqual({ cg: CG, pubid: 4, action: "unsubscribe" });
  });

  it("defaults action to unsubscribe", () => {
    expect(UnsubscribeRequestSchema.parse({ cg: CG }).action).toBe("unsubscribe");
  });

  it("accepts resubscribe and rejects any other action", () => {
    expect(UnsubscribeRequestSchema.parse({ cg: CG, action: "resubscribe" }).action).toBe(
      "resubscribe"
    );
    expect(UnsubscribeRequestSchema.safeParse({ cg: CG, action: "delete" }).success).toBe(
      false
    );
  });

  it("accepts a token-only request (no cg)", () => {
    const parsed = UnsubscribeRequestSchema.parse({ token: "a.b.c" });
    expect(parsed).toEqual({ token: "a.b.c", action: "unsubscribe" });
  });

  it("does not validate the GUID shape — that is the route's job", () => {
    // A malformed `cg` and a missing one are the same `invalid_request`, so the
    // schema deliberately lets "nope" through to `isContactGuid`.
    expect(UnsubscribeRequestSchema.safeParse({ cg: "nope" }).success).toBe(true);
  });

  it("rejects a cg long enough to be a payload rather than a GUID", () => {
    expect(UnsubscribeRequestSchema.safeParse({ cg: "a".repeat(65) }).success).toBe(false);
  });

  describe("pubid", () => {
    it("accepts a numeric string as well as a number", () => {
      expect(UnsubscribeRequestSchema.parse({ cg: CG, pubid: "4" }).pubid).toBe("4");
      expect(resolvePublicationId(UnsubscribeRequestSchema.parse({ cg: CG, pubid: "4" }).pubid)).toBe(4);
    });

    it("resolves absent, empty and 0 to the bulk path identically", () => {
      const variants = [
        UnsubscribeRequestSchema.parse({ cg: CG }),
        UnsubscribeRequestSchema.parse({ cg: CG, pubid: "" }),
        UnsubscribeRequestSchema.parse({ cg: CG, pubid: 0 }),
        UnsubscribeRequestSchema.parse({ cg: CG, pubid: "0" }),
        UnsubscribeRequestSchema.parse({ cg: CG, pubid: null }),
      ];
      const resolved = variants.map((v) => resolvePublicationId(v.pubid));
      expect(resolved).toEqual([null, null, null, null, null]);
      expect(resolved.map(unsubscribeScope)).toEqual([
        "bulk",
        "bulk",
        "bulk",
        "bulk",
        "bulk",
      ]);
    });

    it("rejects a malformed pubid rather than degrading to the bulk path", () => {
      // The dangerous silent failure: a typo'd `pubid` must never unsubscribe
      // someone from *everything*.
      for (const pubid of ["abc", "4a", -1, 1.5, "-1", " 4 "]) {
        expect(
          UnsubscribeRequestSchema.safeParse({ cg: CG, pubid }).success,
          `pubid ${JSON.stringify(pubid)} should be rejected`
        ).toBe(false);
      }
    });
  });
});

describe("resolvePublicationId", () => {
  it("keeps a positive integer", () => {
    expect(resolvePublicationId(4)).toBe(4);
    expect(resolvePublicationId("12")).toBe(12);
  });

  it("treats anything non-positive or non-integer as bulk", () => {
    expect(resolvePublicationId(-1)).toBeNull();
    expect(resolvePublicationId(1.5)).toBeNull();
    expect(resolvePublicationId("abc")).toBeNull();
  });
});

describe("unsubscribeScope", () => {
  it("maps null to bulk and a number to publication", () => {
    expect(unsubscribeScope(null)).toBe("bulk");
    expect(unsubscribeScope(4)).toBe("publication");
  });
});

describe("UnsubscribeResponseSchema", () => {
  it("round-trips a successful per-publication response", () => {
    const body = {
      success: true as const,
      scope: "publication" as const,
      publicationId: 4,
      email: "j•••@g•••.com",
      canUndo: true,
    };
    expect(UnsubscribeResponseSchema.parse(body)).toEqual(body);
  });

  it("round-trips the indistinguishable unknown-capability response", () => {
    const body = {
      success: true as const,
      scope: "bulk" as const,
      publicationId: null,
      email: null,
      canUndo: false,
    };
    expect(UnsubscribeResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects success: false — failures use the { error, message } envelope", () => {
    expect(
      UnsubscribeResponseSchema.safeParse({
        success: false,
        scope: "bulk",
        publicationId: null,
        email: null,
        canUndo: false,
      }).success
    ).toBe(false);
  });
});
