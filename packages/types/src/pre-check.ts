/**
 * `next-pre-check` — the wire contract for household event pre-check (C78).
 *
 * A parent lists their household's check-in events for one day, ticks who is
 * coming, and the church's check-in station sees them in its *expected* list on
 * Sunday morning. Legacy called this `mpp-pre-check`; this contract is a
 * deliberate rewrite of its protocol rather than a port of it.
 *
 * ## The client never sends an id
 *
 * This is the single most important line in the file, and it is the whole
 * reason the contract looks the way it does.
 *
 * Legacy encoded a six-part composite key into each checkbox's `name`
 * (`check_{contactId}|{participantId}|{eventId}|{eventParticipantId}|{groupId}|{groupParticipantId}`),
 * posted it back as `FormData`, and its server `int.Parse`d all six fields
 * straight into an `Event_Participants` write with **no check of any kind**
 * (`EventParticipantTranslator.ToEventParticipants`). Any signed-in MP user
 * could therefore pre-check an arbitrary contact into an arbitrary event, or
 * cancel a stranger's registration, by editing one attribute in devtools.
 *
 * So: {@link PreCheckSaveRequest} carries a date and a list of **opaque row
 * keys**, and nothing else. The server re-derives the entire legal row set from
 * the caller's session, rebuilds the same keys, and treats the submission as a
 * *selection over a set it computed*. A key that is not in that set fails the
 * whole request. Every id that reaches MP comes from the server's own row.
 *
 * {@link PreCheckRow.rowKey} keeps legacy's composite *shape* purely so a
 * checkbox has a stable `value` across a reload. It is an identity, not a
 * capability: knowing one grants nothing, because membership in the
 * server-derived set is what authorises, not the string's contents.
 *
 * ## Dates are strings, and stay strings
 *
 * `eventDate` is a wall-clock `YYYY-MM-DD` in the MP domain's zone — no `T`, no
 * `Z`, no offset. Legacy did `new Date(queryDate).toISOString()` in the browser,
 * which is the classic MP day-shift: a visitor in `Pacific/Honolulu` at 9pm on
 * Saturday asked the server for Sunday. A wall-clock date is a string; turning
 * it into a `Date` is what breaks it.
 */

import { z } from "zod";

/**
 * `Participation_Statuses` ids this widget reads or writes.
 *
 * Confirmed against the live domain. Only `Registered` and `Cancelled` are ever
 * written; `Attended` and `Confirmed` are read-only guards — see
 * {@link PreCheckRow.isLocked}.
 */
export const PARTICIPATION_STATUS = {
  /** `02 Registered` — what ticking a box writes. */
  REGISTERED: 2,
  /** `03 Attended` — a station has scanned them in. Never overwritten. */
  ATTENDED: 3,
  /** `04 Confirmed` — a station has confirmed them. Never overwritten. */
  CONFIRMED: 4,
  /** `05 Cancelled` — what unticking a box writes. Rows are never deleted. */
  CANCELLED: 5,
} as const;

/**
 * A wall-clock date, exactly `YYYY-MM-DD`.
 *
 * The regex is the contract: anything else — an ISO instant, a `Date`
 * serialised by accident, a locale-formatted string — is rejected with
 * `invalid_request` rather than coerced. `z.iso.date()` would also accept the
 * shape, but a bare pattern states the intent (and the *refusal*) more plainly
 * to the next reader.
 */
export const EventDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "eventDate must be YYYY-MM-DD");

/**
 * Upper bound on a single submission's selection list.
 *
 * A household of 12 across a Sunday with 8 check-in events is under 100 rows;
 * 500 is generous headroom that still bounds the work a single request can ask
 * the server to do.
 */
export const PRE_CHECK_SELECTION_MAX = 500;

/**
 * How far from today a caller may steer the date.
 *
 * Not a business rule so much as a shape removal: without it, "walk the
 * calendar backwards writing `Cancelled` over a year of history" is a thing one
 * authenticated caller can do in a loop. One day back covers a late Sunday
 * afternoon; 90 forward covers any plausible planning horizon.
 */
export const PRE_CHECK_WINDOW_DAYS_PAST = 1;
export const PRE_CHECK_WINDOW_DAYS_FUTURE = 90;

/**
 * One (household member × check-in event × group participation) row.
 *
 * The cross product is the proc's, not ours: a member in two of an event's
 * groups legitimately produces two rows that share an `eventParticipantId` and
 * differ in `groupParticipantId`. The save path deduplicates on
 * `(eventId, participantId)` before writing so that never becomes two updates
 * to one `Event_Participant_ID`.
 */
export interface PreCheckRow {
  /**
   * Stable identity for this row: the legacy composite, server-computed.
   *
   * `{contactId}|{participantId}|{eventId}|{eventParticipantId}|{groupId}|{groupParticipantId}`,
   * with `0` standing in for each null. **Never trusted on the way back in** —
   * see the module comment.
   */
  rowKey: string;
  contactId: number;
  /**
   * `Contacts.Display_Name`, MP's `"Last, First"` form, trimmed.
   *
   * Carried on the row as well as on {@link PreCheckMember} so the row stays
   * self-describing: the save path builds a `Map<rowKey, PreCheckRow>` and
   * needs to name a member in an error without re-reading `Contacts`.
   */
  participantName: string;
  /** `Contacts.Participant_Record`. Null → the save path creates one. */
  participantId: number | null;
  eventId: number;
  eventName: string;
  /**
   * MP wall-clock, already converted to the **congregation's** zone by the
   * proc. No zone marker; format it with an explicit IANA zone, never by
   * letting the browser guess.
   */
  eventStart: string;
  groupId: number | null;
  groupName: string | null;
  groupParticipantId: number | null;
  roleName: string | null;
  eventParticipantId: number | null;
  participationStatusId: number | null;
  /** `participationStatusId === 2`. Drives the checkbox's initial state. */
  isRegistered: boolean;
  /**
   * `participationStatusId` is `3 Attended` or `4 Confirmed`.
   *
   * A station has already acted on this row, so unticking it must not write
   * `Cancelled` over the attendance record. Legacy had no such guard and would
   * happily erase a scan. The widget renders these checked and `disabled`.
   */
  isLocked: boolean;
}

/**
 * One household member and their rows for the day.
 *
 * Grouped **server-side**, which retires a real legacy bug: `mpp-pre-check.js`
 * grouped by watching `contactId` change between consecutive rows, silently
 * duplicating a name header if the proc's `ORDER BY` ever changed.
 */
export interface PreCheckMember {
  contactId: number;
  /** `Contacts.Display_Name`, MP's `"Last, First"` form. */
  participantName: string;
  rows: PreCheckRow[];
}

/** What `GET /api/embed/pre-check` answers. */
export interface PreCheckResponse {
  /** The date actually used — echoed because it may be the server's default. */
  eventDate: string;
  /**
   * IANA zone for rendering `eventStart`.
   *
   * Threaded explicitly because `i18n/formatters.ts` takes no `timeZone` by
   * design (see CLAUDE.md). Do not "fix" that asymmetry.
   */
  timeZone: string;
  /** Echo only. The widget never sends it back; the server owns it. */
  householdId: number;
  members: PreCheckMember[];
}

/**
 * `POST /api/embed/pre-check`'s body.
 *
 * A date and a set of row keys. No contact id, no participant id, no event id,
 * no event-participant id — the four things legacy accepted and wrote blind.
 *
 * Absence is meaningful: a row whose key is not in `selected` is *not
 * attending*, and the server derives the cancellation set from that. Legacy
 * relied on the same convention by accident, because `FormData` only carries
 * checked boxes.
 */
export const PreCheckSaveRequestSchema = z.object({
  eventDate: EventDateSchema,
  selected: z
    .array(z.string().min(1).max(120))
    .max(PRE_CHECK_SELECTION_MAX)
    .default([]),
});
export type PreCheckSaveRequest = z.input<typeof PreCheckSaveRequestSchema>;
export type ParsedPreCheckSaveRequest = z.output<typeof PreCheckSaveRequestSchema>;

/**
 * What `POST /api/embed/pre-check` answers.
 *
 * Counts, not records: the widget reloads from the server afterwards, because
 * the server is the truth about what is now registered and leaving stale
 * checkbox state on screen is how a parent comes to believe a save happened
 * that did not.
 *
 * `locked` names the rows a station had already acted on, so the widget can
 * explain why a box it just unticked is checked and disabled again rather than
 * appearing to have swallowed the change.
 */
export interface PreCheckSaveResponse {
  registered: number;
  cancelled: number;
  locked: string[];
}

/**
 * What `GET /api/embed/pre-check/qr` answers.
 *
 * SVG markup rather than a base64 PNG: `<img src>` cannot carry a `Bearer`
 * header, so an image response would force a blob URL and its revoke
 * lifecycle. We generate the markup ourselves, so putting it in the shadow root
 * is not an untrusted-HTML question.
 */
export interface PreCheckQrResponse {
  /** A complete, single-root `<svg>` element. */
  svg: string;
  eventDate: string;
  /** The encoded payload, for host pages that want to render their own code. */
  payload: string;
}

/**
 * Build the canonical row key.
 *
 * Exported so the service and its tests cannot disagree about the format, and
 * so a reviewer can see in one place that the order is fixed and every null
 * collapses to `0`. Kept as one template literal: CLAUDE.md forbids joining
 * template literals with `+`, because the production minifier folds such chains
 * and drops text.
 */
export function buildPreCheckRowKey(parts: {
  contactId: number;
  participantId: number | null;
  eventId: number;
  eventParticipantId: number | null;
  groupId: number | null;
  groupParticipantId: number | null;
}): string {
  return `${parts.contactId}|${parts.participantId ?? 0}|${parts.eventId}|${parts.eventParticipantId ?? 0}|${parts.groupId ?? 0}|${parts.groupParticipantId ?? 0}`;
}

/**
 * `pre|M/d/yyyy|householdId` — the exact payload legacy's QR carried
 * (`EventsApiController.cs:216`).
 *
 * **The date is derived by string surgery, never by `toLocaleDateString`.**
 * `.ToShortDateString()` on MP's own servers is en-US `M/d/yyyy` with no
 * leading zeros; `toLocaleDateString` follows the *Node process* locale, so a
 * container with a different `LANG` would silently emit `18/05/2025` and every
 * scan would fail with nothing in any log to explain it.
 */
export function buildPreCheckQrPayload(
  householdId: number,
  eventDate: string
): string {
  const [year, month, day] = eventDate.split("-");
  const shortDate = `${Number(month)}/${Number(day)}/${year}`;
  return `pre|${shortDate}|${householdId}`;
}
