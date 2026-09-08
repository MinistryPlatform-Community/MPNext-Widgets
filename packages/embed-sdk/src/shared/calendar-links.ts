/**
 * Calendar link builders — the in-house replacement for
 * `add-to-calendar-button` (ELv2-licensed, and its jsDelivr `dist/atcb.min.js`
 * was a CDN-minified artifact that never existed in the npm tarball; see
 * `.claude/TODO/15-atcb-jsdelivr-autominify.md`).
 *
 * Everything a calendar handoff needs is either a query-string template or an
 * RFC 5545 text file, so there is no CDN script, no SRI hash and no custom
 * element from another vendor rendering inside our Shadow DOM.
 *
 * ## The timezone contract
 *
 * MP returns datetimes as **wall-clock strings in the domain's timezone with no
 * zone marker** (`"2026-05-17T09:00:00"`). Two consequences drive this module:
 *
 * - `new Date(mpValue)` parses such a string as *browser-local* (ES spec: a
 *   date-time form without an offset is local time). Reading it back with
 *   `getUTCHours()` therefore returns the value shifted by the browser's own
 *   offset. We parse with a regex instead — never `new Date` — so the wall
 *   clock survives intact.
 * - Every provider wants a real instant, so the wall clock is resolved against
 *   the domain IANA zone (supplied by the API, not hardcoded) and emitted as
 *   UTC. That keeps `DTSTART` free of a `TZID` parameter, which in turn means
 *   the ICS needs no `VTIMEZONE` component to be valid.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface CalendarEventInput {
  title: string;
  /** MP wall-clock start, e.g. `"2026-05-17T09:00:00"`. */
  start: string;
  /** MP wall-clock end, same form as `start`. */
  end: string;
  /** IANA zone the wall-clock values are expressed in, e.g. `"America/Chicago"`. */
  timeZone: string;
  description?: string | null;
  location?: string | null;
  /** Stable identity for the ICS `UID`; falls back to a timestamp. */
  uid?: string;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export type OutlookFlavor = "live" | "office";

// ── Wall-clock parsing ─────────────────────────────────────────────────────

/**
 * `YYYY-MM-DD` optionally followed by a time, and optionally followed by a zone
 * marker we deliberately ignore: MP sometimes tags a wall-clock value with `Z`
 * even though the value is not UTC, and honouring that tag is precisely the
 * bug described in `.claude/references/ministryplatform.datetimehandling.md`.
 */
const MP_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Read an MP datetime string as a wall clock, with no timezone maths applied.
 * Returns `null` for anything unparseable so callers can degrade rather than
 * render `NaN`.
 */
export function parseMpWallClock(value: string | null | undefined): WallClock | null {
  if (!value) return null;
  const m = MP_DATETIME_RE.exec(value.trim());
  if (!m) return null;

  const wall: WallClock = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
    second: m[6] ? Number(m[6]) : 0,
  };

  if (wall.month < 1 || wall.month > 12) return null;
  if (wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) return null;

  return wall;
}

// ── Zone resolution ────────────────────────────────────────────────────────

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = offsetFormatters.get(timeZone);
  if (!fmt) {
    // `hourCycle: "h23"` rather than `hour12: false`: the latter can yield an
    // hour of "24" for midnight in en-US on some engines.
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    offsetFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Milliseconds that `timeZone` is ahead of UTC at a given instant.
 * Positive east of Greenwich.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = offsetFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );
  return asIfUtc - instant.getTime();
}

/**
 * Resolve a wall clock in `timeZone` to the real UTC instant.
 *
 * Two passes: the first offset is looked up using the wall clock read as if it
 * were UTC, which is off by up to the offset itself; re-checking at the
 * corrected instant catches the case where the naive guess landed on the far
 * side of a DST transition. Invalid `timeZone` values fall back to UTC rather
 * than throwing — a bad domain setting should not take the widget down.
 */
export function wallClockToUtc(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );

  try {
    const firstOffset = zoneOffsetMs(new Date(naive), timeZone);
    let resolved = naive - firstOffset;
    const secondOffset = zoneOffsetMs(new Date(resolved), timeZone);
    if (secondOffset !== firstOffset) resolved = naive - secondOffset;
    return new Date(resolved);
  } catch {
    return new Date(naive);
  }
}

/** Parse an MP wall-clock string straight to a UTC instant. */
export function mpDateToUtc(value: string, timeZone: string): Date | null {
  const wall = parseMpWallClock(value);
  return wall ? wallClockToUtc(wall, timeZone) : null;
}

// ── Formatting ─────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** `YYYYMMDDTHHMMSSZ` — the basic-format UTC stamp used by ICS, Google, Yahoo. */
export function toUtcStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

/** `YYYY-MM-DDTHH:MM:SSZ` — the extended form Outlook's compose route wants. */
export function toIsoUtcStamp(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Flatten the HTML MP allows in an event description to plain text.
 *
 * Calendar targets disagree on markup (ICS `DESCRIPTION` is plain text by spec,
 * Google renders a subset, Outlook's compose `body` is plain), so plain text is
 * the only thing that looks right everywhere.
 */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── ICS ────────────────────────────────────────────────────────────────────

/**
 * Escape a value for an RFC 5545 TEXT property: backslash first, then the
 * field/list separators. Missing the comma escape is what mangles addresses —
 * `LOCATION:Main Campus, 123 Main St` parses as a two-value list.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line to RFC 5545's 75-**octet** limit, continuing with CRLF +
 * a single space. Counting is by UTF-8 length, and a multi-byte character is
 * never split across the fold.
 */
export function foldIcsLine(line: string): string {
  const LIMIT = 75;
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const octets = (s: string): number =>
    encoder ? encoder.encode(s).length : s.length;

  if (octets(line) <= LIMIT) return line;

  const out: string[] = [];
  let current = "";
  // A continuation line spends one octet on its leading space.
  let limit = LIMIT;

  for (const char of line) {
    if (octets(current + char) > limit) {
      out.push(current);
      current = char;
      limit = LIMIT - 1;
    } else {
      current += char;
    }
  }
  if (current) out.push(current);

  return out.join("\r\n ");
}

/** Build a complete VCALENDAR document for a single event. */
export function buildIcsContent(event: CalendarEventInput): string {
  const start = mpDateToUtc(event.start, event.timeZone);
  const end = mpDateToUtc(event.end, event.timeZone);
  if (!start) throw new Error(`buildIcsContent: unparseable start "${event.start}"`);

  const uid = event.uid || `mpnext-${Date.now()}@mpnext.church`;
  const description = stripHtml(event.description);
  const location = event.location?.trim() || "";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MPNext//Add to Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toUtcStamp(start)}`,
    ...(end ? [`DTEND:${toUtcStamp(end)}`] : []),
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // RFC 5545 requires CRLF line endings and a trailing break.
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Filesystem-safe `.ics` filename derived from the event title. */
export function icsFileName(title: string): string {
  const slug = title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug || "event"}.ics`;
}

// ── Provider URLs ──────────────────────────────────────────────────────────

function requireInstants(event: CalendarEventInput): { start: Date; end: Date } {
  const start = mpDateToUtc(event.start, event.timeZone);
  if (!start) throw new Error(`unparseable start "${event.start}"`);
  // A missing or unparseable end becomes a one-hour block rather than an
  // invalid URL the provider would silently reject.
  const end =
    mpDateToUtc(event.end, event.timeZone) ??
    new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

/** Google Calendar event-creation template. */
export function buildGoogleCalendarUrl(event: CalendarEventInput): string {
  const { start, end } = requireInstants(event);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toUtcStamp(start)}/${toUtcStamp(end)}`,
  });

  const description = stripHtml(event.description);
  if (description) params.set("details", description);
  if (event.location) params.set("location", event.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Outlook.com (`live`) or Microsoft 365 (`office`) compose route. Same query
 * shape, different host — the two Outlook entries in the menu differ only here.
 */
export function buildOutlookUrl(
  event: CalendarEventInput,
  flavor: OutlookFlavor = "live",
): string {
  const { start, end } = requireInstants(event);
  const host =
    flavor === "office" ? "https://outlook.office.com" : "https://outlook.live.com";

  const params = new URLSearchParams({
    // `path` is required alongside `rru` or the route 404s.
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: toIsoUtcStamp(start),
    enddt: toIsoUtcStamp(end),
  });

  const description = stripHtml(event.description);
  if (description) params.set("body", description);
  if (event.location) params.set("location", event.location);

  return `${host}/calendar/0/action/compose?${params.toString()}`;
}

/** Yahoo Calendar. `v=60` is the only version its endpoint accepts. */
export function buildYahooCalendarUrl(event: CalendarEventInput): string {
  const { start, end } = requireInstants(event);
  const params = new URLSearchParams({
    v: "60",
    title: event.title,
    st: toUtcStamp(start),
    et: toUtcStamp(end),
  });

  const description = stripHtml(event.description);
  if (description) params.set("desc", description);
  if (event.location) params.set("in_loc", event.location);

  return `https://calendar.yahoo.com/?${params.toString()}`;
}
