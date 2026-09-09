import { describe, it, expect } from "vitest";
import {
  SUBSCRIBE_VERIFY_PARAM,
  SubscribePublicationResponseSchema,
  SubscribeVerificationRequestSchema,
  SubscribeVerificationResponseSchema,
  SubscribeVerifyRequestSchema,
  SubscribeVerifyResponseSchema,
  guardPublicationVerifyData,
} from "./subscribe-to-publication";

const validSubmission = {
  publicationId: 4,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
};

describe("SUBSCRIBE_VERIFY_PARAM", () => {
  it("is the nextwidgets_-prefixed name, not legacy's mpp- one", () => {
    // The `nextwidgets_*` convention covers every browser-visible key the SDK
    // owns, and a query parameter on the host page is one. A new widget
    // reintroducing `mpp-` would undo the rename deliberately.
    expect(SUBSCRIBE_VERIFY_PARAM).toBe("nextwidgets_verify");
    expect(SUBSCRIBE_VERIFY_PARAM.startsWith("mpp-")).toBe(false);
  });
});

describe("SubscribeVerificationRequestSchema", () => {
  it("accepts a minimal submission", () => {
    const parsed = SubscribeVerificationRequestSchema.safeParse(validSubmission);
    expect(parsed.success).toBe(true);
  });

  it("trims the names", () => {
    const parsed = SubscribeVerificationRequestSchema.parse({
      ...validSubmission,
      firstName: "  Ada  ",
      lastName: "  Lovelace ",
    });
    expect(parsed.firstName).toBe("Ada");
    expect(parsed.lastName).toBe("Lovelace");
  });

  it("rejects a name that is only whitespace", () => {
    const parsed = SubscribeVerificationRequestSchema.safeParse({
      ...validSubmission,
      firstName: "   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a name over the column length", () => {
    const parsed = SubscribeVerificationRequestSchema.safeParse({
      ...validSubmission,
      firstName: "a".repeat(51),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(Object.keys(z_fieldErrors(parsed.error))).toContain("firstName");
    }
  });

  it("rejects a malformed address", () => {
    expect(
      SubscribeVerificationRequestSchema.safeParse({
        ...validSubmission,
        email: "not-an-address",
      }).success
    ).toBe(false);
  });

  it("rejects an address over 254 characters", () => {
    const long = `${"a".repeat(250)}@example.com`;
    expect(
      SubscribeVerificationRequestSchema.safeParse({ ...validSubmission, email: long })
        .success
    ).toBe(false);
  });

  it("rejects a non-positive publication id", () => {
    for (const publicationId of [0, -4, 1.5]) {
      expect(
        SubscribeVerificationRequestSchema.safeParse({ ...validSubmission, publicationId })
          .success
      ).toBe(false);
    }
  });

  it("caps returnUrl length, since isReturnUrlAllowed checks shape not size", () => {
    const url = `https://church.example/${"a".repeat(2100)}`;
    expect(
      SubscribeVerificationRequestSchema.safeParse({ ...validSubmission, returnUrl: url })
        .success
    ).toBe(false);
  });

  it("restricts verifyParamName to a charset safe in a URL", () => {
    expect(
      SubscribeVerificationRequestSchema.safeParse({
        ...validSubmission,
        verifyParamName: "nextwidgets_verify",
      }).success
    ).toBe(true);
    expect(
      SubscribeVerificationRequestSchema.safeParse({
        ...validSubmission,
        verifyParamName: "a b&c",
      }).success
    ).toBe(false);
  });

  it("accepts no contactId — there is no field for one", () => {
    // The legacy takeover primitive was a client-bound `ContactId`. An extra
    // key is stripped rather than honoured, and the parsed output proves it.
    const parsed = SubscribeVerificationRequestSchema.parse({
      ...validSubmission,
      contactId: 12345,
    });
    expect(parsed).not.toHaveProperty("contactId");
  });
});

describe("SubscribeVerifyRequestSchema", () => {
  it("accepts a handle", () => {
    expect(SubscribeVerifyRequestSchema.safeParse({ token: "abc" }).success).toBe(true);
  });

  it("rejects an empty or oversized handle", () => {
    expect(SubscribeVerifyRequestSchema.safeParse({ token: "" }).success).toBe(false);
    expect(
      SubscribeVerifyRequestSchema.safeParse({ token: "a".repeat(1025) }).success
    ).toBe(false);
  });

  it("carries the handle and nothing else", () => {
    const parsed = SubscribeVerifyRequestSchema.parse({
      token: "abc",
      publicationId: 9,
      email: "attacker@evil.example",
    });
    expect(parsed).toEqual({ token: "abc" });
  });
});

describe("response schemas", () => {
  it("accepts the publication read's body", () => {
    expect(
      SubscribePublicationResponseSchema.safeParse({
        publication: { Publication_ID: 4, Title: "Weekly Newsletter", Description: null },
      }).success
    ).toBe(true);
  });

  it("has no Congregation_ID on the publication it returns", () => {
    const parsed = SubscribePublicationResponseSchema.parse({
      publication: {
        Publication_ID: 4,
        Title: "Weekly Newsletter",
        Description: "News",
        Congregation_ID: 7,
      },
    });
    expect(parsed.publication).not.toHaveProperty("Congregation_ID");
  });

  it("pins the send-verification body to exactly { ok: true }", () => {
    expect(SubscribeVerificationResponseSchema.safeParse({ ok: true }).success).toBe(true);
    expect(SubscribeVerificationResponseSchema.safeParse({ ok: false }).success).toBe(
      false
    );
  });

  it("accepts the verify body", () => {
    expect(
      SubscribeVerifyResponseSchema.safeParse({
        subscribed: true,
        publicationTitle: "Weekly Newsletter",
        email: "ada@example.com",
        alreadySubscribed: false,
      }).success
    ).toBe(true);
  });
});

describe("guardPublicationVerifyData", () => {
  const data = {
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    publicationId: 4,
    origin: "https://church.example",
  };

  it("accepts a well-formed sealed payload", () => {
    expect(guardPublicationVerifyData(data)).toEqual(data);
  });

  it("requires the origin claim", () => {
    // Without it a handle minted on one allowlisted church site redeems from
    // another — and `requireWidgetAuth` cannot catch that, because both origins
    // are legitimately allowlisted.
    const { origin: _origin, ...withoutOrigin } = data;
    expect(guardPublicationVerifyData(withoutOrigin)).toBeNull();
    expect(guardPublicationVerifyData({ ...data, origin: "  " })).toBeNull();
  });

  it("rejects a payload missing any other field", () => {
    for (const key of ["email", "firstName", "lastName", "publicationId"] as const) {
      const partial: Record<string, unknown> = { ...data };
      delete partial[key];
      expect(guardPublicationVerifyData(partial)).toBeNull();
    }
  });

  it("rejects a non-integer or non-positive publication id", () => {
    for (const publicationId of [0, -1, 1.5, "4"]) {
      expect(guardPublicationVerifyData({ ...data, publicationId })).toBeNull();
    }
  });

  it("rejects a non-object", () => {
    for (const value of [null, undefined, "x", 4, []]) {
      expect(guardPublicationVerifyData(value)).toBeNull();
    }
  });

  it("drops any extra key, including a contactId an older build might have sealed", () => {
    const guarded = guardPublicationVerifyData({ ...data, contactId: 99 });
    expect(guarded).not.toBeNull();
    expect(guarded).not.toHaveProperty("contactId");
  });
});

/** `z.flattenError`-free field-error extraction, so this file needs no zod import. */
function z_fieldErrors(error: { issues: { path: (string | number | symbol)[] }[] }): Record<
  string,
  true
> {
  const out: Record<string, true> = {};
  for (const issue of error.issues) {
    if (issue.path.length > 0) out[String(issue.path[0])] = true;
  }
  return out;
}
