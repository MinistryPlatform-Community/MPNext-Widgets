import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpClient } from "@/lib/providers/ministry-platform/utils/http-client";

/**
 * C50: every directory search failed because the query string MPHelper built was
 * longer than IIS's default `maxQueryString` (2048), which MP answers with an
 * HTML 404 before ASP.NET sees the request. These tests rebuild the URL exactly
 * as `HttpClient` does and pin the query-string length under that limit.
 */

const IIS_MAX_QUERY_STRING = 2048;

// A deliberately long base URL: the old `$select` inlined it, so the overflow
// scaled with the host name. It must no longer matter.
const LONG_BASE =
  "https://a-very-long-church-subdomain-name.ministryplatform.example.org/ministryplatformapi";

const mockGetTableRecords = vi.fn();

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: (name: string) => (name === "MINISTRY_PLATFORM_BASE_URL" ? LONG_BASE : ""),
}));

const { OnlineDirectoryService, fitKeyword } = await import("@/services/onlineDirectoryService");

/** The query string exactly as HttpClient.get would send it. */
function queryStringFor(call: Record<string, unknown>): string {
  const http = new HttpClient(LONG_BASE, () => "token");
  const url = http.buildUrl("/tables/Contacts", {
    $select: call.select as string,
    $filter: call.filter as string,
    $orderby: call.orderBy as string,
    $top: call.top as number,
  });
  return url.slice(url.indexOf("?") + 1);
}

async function searchAndCapture(keyword: string, congregationId: number | null = null) {
  mockGetTableRecords.mockResolvedValueOnce([]);
  const svc = await OnlineDirectoryService.getInstance();
  await svc.search({ keyword, congregationId });
  const call = mockGetTableRecords.mock.calls.at(-1)![0] as Record<string, unknown>;
  return { call, qs: queryStringFor(call) };
}

describe("OnlineDirectoryService.search query length (C50)", () => {
  beforeEach(() => {
    mockGetTableRecords.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (OnlineDirectoryService as any).instance = undefined;
  });

  it.each([
    ["3-char keyword", "Keh"],
    ["longer keyword", "Kehayias"],
    ["display name", "Chris Kehayias"],
    ["last, first", "Kehayias, Chris"],
    ["household chip", "hh 85"],
    ["empty keyword", ""],
  ])("%s stays under IIS maxQueryString with a long base URL", async (_label, keyword) => {
    const { qs } = await searchAndCapture(keyword, 12);
    expect(qs.length).toBeLessThan(IIS_MAX_QUERY_STRING);
  });

  it("keeps headroom for a realistic 20-char keyword with a congregation filter", async () => {
    const { qs } = await searchAndCapture("abcdefghijklmnopqrst", 12345);
    expect(qs.length).toBeLessThan(IIS_MAX_QUERY_STRING);
  });

  it.each([
    ["long ASCII", "x".repeat(200)],
    ["long accented (6 encoded bytes per char)", "é".repeat(80)],
    ["quotes (doubled for SQL)", "O'Brien O'Brien O'Brien O'Brien O'Brien"],
    ["long display name", "Bartholomew Montgomery-Fitzwilliam"],
    ["long last, first", "Montgomery-Fitzwilliam, Bartholomew"],
  ])("a %s keyword is fitted so the query still stays under the limit", async (_label, keyword) => {
    const { qs } = await searchAndCapture(keyword, 99999);
    expect(qs.length).toBeLessThan(IIS_MAX_QUERY_STRING);
  });

  it("does not put the base URL (or any absolute URL) in the $select", async () => {
    const { call } = await searchAndCapture("Keh");
    expect(String(call.select)).not.toContain("http");
    expect(String(call.select)).not.toContain(LONG_BASE);
  });

  it("builds the image URL from the file GUID after the read", async () => {
    mockGetTableRecords.mockResolvedValueOnce([
      { ContactId: 98, NicknameOrFirstName: "Chris", LastName: "Kehayias", ImageGuid: "abc-123" },
      { ContactId: 99, NicknameOrFirstName: "Sarah", LastName: "Kehayias", ImageGuid: null },
    ]);
    const svc = await OnlineDirectoryService.getInstance();
    const members = await svc.search({ keyword: "Keh", congregationId: null });
    expect(members[0].contactImageUrl).toBe(`${LONG_BASE}/files/abc-123`);
    expect(members[1].contactImageUrl).toBeNull();
  });

  it("still nulls unlisted fields and never returns an email address (privacy)", async () => {
    mockGetTableRecords.mockResolvedValueOnce([
      {
        ContactId: 98,
        NicknameOrFirstName: "Chris",
        LastName: "K",
        MobilePhone: "321-555-0100",
        MobilePhoneUnlisted: 1,
        HomePhone: "321-555-0101",
        HomePhoneUnlisted: true,
        EmailAddress: "c@example.org",
        EmailUnlisted: 0,
        HomeAddressUnlisted: 1,
        AddressId: 5,
        AddressLine1: "1 Main St",
        DateofBirth: "1980-03-04T00:00:00",
      },
    ]);
    const svc = await OnlineDirectoryService.getInstance();
    const [m] = await svc.search({ keyword: "Chr", congregationId: null });
    expect(m.mobilePhone).toBeNull();
    expect(m.homePhone).toBeNull();
    expect(m.address).toBeNull();
    expect(m.canEmail).toBe(true);
    expect(JSON.stringify(m)).not.toContain("c@example.org");
    expect(JSON.stringify(m)).not.toContain("1980");
  });
});

describe("fitKeyword", () => {
  it("leaves an ordinary keyword alone", () => {
    expect(fitKeyword("Kehayias")).toBe("Kehayias");
    expect(fitKeyword("hh 85")).toBe("hh 85");
  });

  it("truncates by code point, never splitting a character", () => {
    const out = fitKeyword("é".repeat(40));
    expect(out).toMatch(/^é+$/);
    expect(out.length).toBeLessThan(40);
  });
});
