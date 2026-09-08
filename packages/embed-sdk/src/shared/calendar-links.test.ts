import { describe, it, expect } from "vitest";
import {
  buildGoogleCalendarUrl,
  buildIcsContent,
  buildOutlookUrl,
  buildYahooCalendarUrl,
  escapeIcsText,
  foldIcsLine,
  icsFileName,
  mpDateToUtc,
  parseMpWallClock,
  stripHtml,
  toIsoUtcStamp,
  toUtcStamp,
  wallClockToUtc,
  type CalendarEventInput,
} from "./calendar-links";

/**
 * These builders replaced the `add-to-calendar-button` CDN script. The whole
 * point of the replacement is that the arithmetic is ours and therefore
 * testable, so the timezone cases below are the load-bearing ones.
 */

const CHICAGO = "America/Chicago";

const event: CalendarEventInput = {
  title: "Sunday Worship",
  start: "2026-05-17T09:00:00",
  end: "2026-05-17T10:30:00",
  timeZone: CHICAGO,
  description: "Weekly worship service",
  location: "Main Sanctuary, 123 Church Lane, Anywhere, TX, 75001",
  uid: "next-event-12345@mpnext.church",
};

describe("parseMpWallClock", () => {
  it("reads an MP datetime as a wall clock with no zone maths", () => {
    expect(parseMpWallClock("2026-05-17T09:00:00")).toEqual({
      year: 2026,
      month: 5,
      day: 17,
      hour: 9,
      minute: 0,
      second: 0,
    });
  });

  it("accepts the space-separated SQL form", () => {
    expect(parseMpWallClock("2026-05-17 14:30:00")).toMatchObject({
      hour: 14,
      minute: 30,
    });
  });

  it("accepts a date-only value as midnight", () => {
    expect(parseMpWallClock("2026-05-17")).toMatchObject({
      day: 17,
      hour: 0,
      minute: 0,
    });
  });

  it("ignores a trailing Z rather than treating the value as UTC", () => {
    // MP tags some wall-clock values with Z even though they are not UTC.
    // Honouring the tag is the documented date-shifting bug.
    expect(parseMpWallClock("2026-05-17T09:00:00.000Z")).toMatchObject({
      day: 17,
      hour: 9,
    });
  });

  it("returns null for empty and malformed input", () => {
    expect(parseMpWallClock(null)).toBeNull();
    expect(parseMpWallClock("")).toBeNull();
    expect(parseMpWallClock("not a date")).toBeNull();
    expect(parseMpWallClock("2026-13-01T00:00:00")).toBeNull();
    expect(parseMpWallClock("2026-05-17T25:00:00")).toBeNull();
  });
});

describe("wallClockToUtc", () => {
  it("applies the daylight-saving offset (CDT, UTC-5)", () => {
    const utc = wallClockToUtc(
      { year: 2026, month: 5, day: 17, hour: 9, minute: 0, second: 0 },
      CHICAGO,
    );
    expect(utc.toISOString()).toBe("2026-05-17T14:00:00.000Z");
  });

  it("applies the standard-time offset (CST, UTC-6)", () => {
    const utc = wallClockToUtc(
      { year: 2026, month: 1, day: 17, hour: 9, minute: 0, second: 0 },
      CHICAGO,
    );
    expect(utc.toISOString()).toBe("2026-01-17T15:00:00.000Z");
  });

  it("resolves a wall clock on the far side of a spring-forward transition", () => {
    // US DST began 2026-03-08. A naive single-pass offset lookup reads the
    // 03:00 wall clock as if it were UTC, lands on the pre-transition side,
    // and picks CST (-6) instead of CDT (-5).
    const utc = wallClockToUtc(
      { year: 2026, month: 3, day: 8, hour: 3, minute: 0, second: 0 },
      CHICAGO,
    );
    expect(utc.toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("handles a zone east of Greenwich", () => {
    const utc = wallClockToUtc(
      { year: 2026, month: 5, day: 17, hour: 9, minute: 0, second: 0 },
      "Europe/Berlin",
    );
    expect(utc.toISOString()).toBe("2026-05-17T07:00:00.000Z");
  });

  it("falls back to UTC for an unusable zone instead of throwing", () => {
    const utc = wallClockToUtc(
      { year: 2026, month: 5, day: 17, hour: 9, minute: 0, second: 0 },
      "Not/AZone",
    );
    expect(utc.toISOString()).toBe("2026-05-17T09:00:00.000Z");
  });
});

describe("mpDateToUtc", () => {
  it("parses and converts in one step", () => {
    expect(mpDateToUtc("2026-05-17T09:00:00", CHICAGO)?.toISOString()).toBe(
      "2026-05-17T14:00:00.000Z",
    );
  });

  it("returns null when the value cannot be parsed", () => {
    expect(mpDateToUtc("garbage", CHICAGO)).toBeNull();
  });
});

describe("stamps", () => {
  const instant = new Date("2026-05-17T14:00:00.000Z");

  it("formats the basic ICS/Google form", () => {
    expect(toUtcStamp(instant)).toBe("20260517T140000Z");
  });

  it("formats the extended form Outlook wants", () => {
    expect(toIsoUtcStamp(instant)).toBe("2026-05-17T14:00:00Z");
  });
});

describe("stripHtml", () => {
  it("returns an empty string for nullish input", () => {
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });

  it("turns block markup into newlines and drops tags", () => {
    expect(stripHtml("<p>Line one</p><p>Line two</p>")).toBe("Line one\nLine two");
    expect(stripHtml("First<br>Second")).toBe("First\nSecond");
  });

  it("decodes named and numeric entities", () => {
    expect(stripHtml("Bread &amp; Wine")).toBe("Bread & Wine");
    expect(stripHtml("Kids&#39; Club")).toBe("Kids' Club");
  });

  it("bullets list items", () => {
    expect(stripHtml("<ul><li>One</li><li>Two</li></ul>")).toBe("• One\n• Two");
  });
});

describe("escapeIcsText", () => {
  it("escapes the RFC 5545 separators", () => {
    // Commas are the failure that mattered: an unescaped address parses as a
    // multi-value list and clients render only part of it.
    expect(escapeIcsText("Main Sanctuary, 123 Church Lane")).toBe(
      "Main Sanctuary\\, 123 Church Lane",
    );
    expect(escapeIcsText("a;b")).toBe("a\\;b");
    expect(escapeIcsText("a\nb")).toBe("a\\nb");
  });

  it("escapes backslashes before the separators, not after", () => {
    expect(escapeIcsText("C:\\path, x")).toBe("C:\\\\path\\, x");
  });
});

describe("foldIcsLine", () => {
  it("leaves a short line alone", () => {
    expect(foldIcsLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds a long line with CRLF and a leading space", () => {
    const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
    const segments = folded.split("\r\n");
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].length).toBeLessThanOrEqual(75);
    for (const segment of segments.slice(1)) {
      expect(segment.startsWith(" ")).toBe(true);
      expect(segment.length).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the original.
    expect(segments.map((s, i) => (i ? s.slice(1) : s)).join("")).toBe(
      `SUMMARY:${"x".repeat(200)}`,
    );
  });

  it("counts octets, not characters, and never splits a multi-byte char", () => {
    const folded = foldIcsLine(`SUMMARY:${"é".repeat(60)}`);
    const encoder = new TextEncoder();
    for (const segment of folded.split("\r\n")) {
      expect(encoder.encode(segment).length).toBeLessThanOrEqual(75);
    }
    expect(folded).not.toContain("\uFFFD");
  });
});

describe("buildIcsContent", () => {
  const ics = buildIcsContent(event);

  it("emits a well-formed VCALENDAR with CRLF endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
  });

  it("writes UTC instants, so no TZID or VTIMEZONE is needed", () => {
    expect(ics).toContain("DTSTART:20260517T140000Z");
    expect(ics).toContain("DTEND:20260517T153000Z");
    expect(ics).not.toContain("TZID");
    expect(ics).not.toContain("VTIMEZONE");
  });

  it("escapes the location commas", () => {
    expect(ics).toContain(
      "LOCATION:Main Sanctuary\\, 123 Church Lane\\, Anywhere\\, TX\\, 75001",
    );
  });

  it("carries a stable UID", () => {
    expect(ics).toContain("UID:next-event-12345@mpnext.church");
  });

  it("omits DESCRIPTION and LOCATION when absent", () => {
    const bare = buildIcsContent({
      ...event,
      description: null,
      location: null,
    });
    expect(bare).not.toContain("DESCRIPTION:");
    expect(bare).not.toContain("LOCATION:");
  });

  it("omits DTEND when the end date is unusable", () => {
    const noEnd = buildIcsContent({ ...event, end: "" });
    expect(noEnd).toContain("DTSTART:");
    expect(noEnd).not.toContain("DTEND:");
  });

  it("throws when the start date is unusable", () => {
    expect(() => buildIcsContent({ ...event, start: "nope" })).toThrow(
      /unparseable start/,
    );
  });
});

describe("icsFileName", () => {
  it("slugifies the title", () => {
    expect(icsFileName("Sunday Worship")).toBe("sunday-worship.ics");
    expect(icsFileName("Kids' Club — 2026!")).toBe("kids-club-2026.ics");
  });

  it("falls back for a title with nothing slugifiable", () => {
    expect(icsFileName("!!!")).toBe("event.ics");
  });
});

describe("buildGoogleCalendarUrl", () => {
  const url = new URL(buildGoogleCalendarUrl(event));

  it("targets the render template", () => {
    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
  });

  it("sends the UTC instant pair", () => {
    expect(url.searchParams.get("dates")).toBe(
      "20260517T140000Z/20260517T153000Z",
    );
  });

  it("sends title, details and location", () => {
    expect(url.searchParams.get("text")).toBe("Sunday Worship");
    expect(url.searchParams.get("details")).toBe("Weekly worship service");
    expect(url.searchParams.get("location")).toContain("Main Sanctuary");
  });

  it("defaults a missing end to one hour after the start", () => {
    const oneHour = new URL(buildGoogleCalendarUrl({ ...event, end: "" }));
    expect(oneHour.searchParams.get("dates")).toBe(
      "20260517T140000Z/20260517T150000Z",
    );
  });
});

describe("buildOutlookUrl", () => {
  it("uses the outlook.live.com host for personal accounts", () => {
    const url = new URL(buildOutlookUrl(event, "live"));
    expect(url.origin).toBe("https://outlook.live.com");
    expect(url.pathname).toBe("/calendar/0/action/compose");
  });

  it("uses the outlook.office.com host for Microsoft 365", () => {
    expect(new URL(buildOutlookUrl(event, "office")).origin).toBe(
      "https://outlook.office.com",
    );
  });

  it("defaults to the personal host", () => {
    expect(new URL(buildOutlookUrl(event)).origin).toBe(
      "https://outlook.live.com",
    );
  });

  it("sends the params the compose route requires", () => {
    const params = new URL(buildOutlookUrl(event)).searchParams;
    // `path` alongside `rru` is not optional -- without it the route 404s.
    expect(params.get("path")).toBe("/calendar/action/compose");
    expect(params.get("rru")).toBe("addevent");
    expect(params.get("subject")).toBe("Sunday Worship");
    expect(params.get("startdt")).toBe("2026-05-17T14:00:00Z");
    expect(params.get("enddt")).toBe("2026-05-17T15:30:00Z");
  });
});

describe("buildYahooCalendarUrl", () => {
  it("sends v=60 and the UTC stamps", () => {
    const params = new URL(buildYahooCalendarUrl(event)).searchParams;
    expect(params.get("v")).toBe("60");
    expect(params.get("title")).toBe("Sunday Worship");
    expect(params.get("st")).toBe("20260517T140000Z");
    expect(params.get("et")).toBe("20260517T153000Z");
    expect(params.get("in_loc")).toContain("Main Sanctuary");
  });
});

describe("cross-provider consistency", () => {
  it("agrees on the instant across every target", () => {
    const google = new URL(buildGoogleCalendarUrl(event)).searchParams.get("dates");
    const yahoo = new URL(buildYahooCalendarUrl(event)).searchParams.get("st");
    const outlook = new URL(buildOutlookUrl(event)).searchParams.get("startdt");
    const ics = buildIcsContent(event);

    expect(google?.split("/")[0]).toBe("20260517T140000Z");
    expect(yahoo).toBe("20260517T140000Z");
    expect(outlook).toBe("2026-05-17T14:00:00Z");
    expect(ics).toContain("DTSTART:20260517T140000Z");
  });
});
