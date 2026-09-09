/**
 * `POST /api/embed/unsubscribe` — the one-click unsubscribe landing endpoint (C72).
 *
 * A recipient of a bulk email has no login, so this is the second route in the
 * tree that accepts `claims.sub === "public"` (the first is
 * `plan-your-visit/send-verification`, for the same reason: the person the
 * request is *about* has no MP account yet, or is not being asked to prove they
 * have one). Do not "fix" that by requiring a real subject — a compliance
 * unsubscribe that demands a sign-in is the defect C72 filed.
 *
 * ## `cg` is accepted here and nowhere else
 *
 * The capability is `Contacts.Contact_GUID`, which MP's merge engine writes into
 * an email as `[Contact_GUID]` and which MP's own Portal already treats as a
 * URL-borne capability (`my_user_account.aspx?dg=…&cg=…`). It is ~122 bits of
 * unguessable bearer capability, not the `contactId=1,2,3…` enumeration hazard
 * — but it also **never expires**, and it is the same GUID used elsewhere in MP.
 * That trade is acceptable only because of how narrow this route is: it
 * unsubscribes one contact from one publication or from bulk email, undoes
 * that, and returns a masked address. It mints no session and reads nothing
 * else. **Do not generalise the pattern to another route.**
 *
 * Why not a sealed token alone, as C72 proposed? Because MP's template merge
 * substitutes field tokens and cannot compute an HMAC or an AES-GCM seal, so
 * for a bulk send — which MP performs, not us — `[Contact_GUID]` is the only
 * per-recipient unguessable value that can reach the link. A sealed-token-only
 * route would be incompatible with the merge engine, with MP's own house link
 * shape, and with every unsubscribe link already sitting in an inbox.
 *
 * ## No `GET` export, deliberately
 *
 * Legacy's transport was `Ajax.Get` against `[HttpGet] [AllowAnonymous]`, i.e.
 * a state-changing GET reachable from an emailed URL. Mailbox link scanners,
 * URL-rewriting gateways (Proofpoint, Mimecast) and link previews fetch those,
 * which is how a congregation gets silently unsubscribed with no trace. The
 * structural fix, rather than a mitigation: the emailed link is a navigation to
 * the church's HTML *page* (a GET that only renders), and the write is a POST
 * the mounted widget issues — which needs a widget JWT, which needs a
 * `/api/embed/session` call from an origin in `EMBED_ALLOWED_ORIGINS`. Two
 * independent reasons a scanner cannot trip it.
 *
 * ## The response is uniform on purpose
 *
 * Success, an unknown-but-well-formed GUID, and an already-opted-out contact
 * share one shape and one status. A distinguishable 404 would make this an
 * oracle for "is this GUID a live contact", and it is also simply the right
 * thing to show: either we unsubscribed them, or that address was never
 * subscribed, and in both cases they will not receive the email. A *malformed*
 * `cg` is a different thing — a broken link, not a wrong one — and the widget
 * separates it client-side with no request at all.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildOptionsResponse, getClientIp } from "@/lib/embed/auth";
import { withAnonymousWrite, errorResponse } from "@/lib/embed/anonymous-write";
import { sha256Hex } from "@/lib/embed/crypto";
import { verifyActionToken } from "@/lib/embed/action-token";
import {
  SubscriptionService,
  isContactGuid,
  type UnsubscribeOutcome,
} from "@/services/subscriptionService";
import {
  UnsubscribeRequestSchema,
  resolvePublicationId,
  unsubscribeScope,
  type UnsubscribeResponse,
} from "@mpnext/types";

/**
 * Machine codes this route can answer with.
 *
 * Written as object literals rather than bare `errorResponse(...)` arguments so
 * `packages/embed-sdk/src/i18n/error-codes.test.ts` — which greps
 * `src/app/api/embed/**` for `error: "…"` object properties — can see them and
 * fail the build if any lacks a catalogue sentence in all three locales.
 */
const ERRORS = {
  /** No capability at all, or a `cg` that is not GUID-shaped. */
  invalidRequest: { error: "invalid_request", message: "A valid unsubscribe capability is required.", status: 422 },
  /** Zod rejected the body: an unknown `action`, or a non-numeric `pubid`. */
  validationFailed: { error: "validation_failed", message: "The request body was not valid.", status: 400 },
  /**
   * MP accepted the read but refused the write.
   *
   * `500`, not the `502` a bad upstream would suggest. The machine code already
   * carries the meaning — the widget branches on `save_failed`, never on the
   * status — so a second, partially-overlapping signal used by 3 routes out of
   * 30 buys no information and costs a future reader the question "does a 500
   * elsewhere mean something different?". If this repo wants an
   * upstream-failure convention it belongs across every embed route as its own
   * cross-cutting change, not started here.
   */
  saveFailed: { error: "save_failed", message: "MinistryPlatform rejected the subscription update.", status: 500 },
  /**
   * A sealed `t` that is expired, tampered with, or minted for another flow —
   * **and** no usable `cg` to fall back to.
   *
   * One code for all three, deliberately. `verifyActionToken` distinguishes
   * `wrong-type`, but reporting that back would tell the bearer that the token
   * they hold is valid for *something else*, which is a hint about what else
   * they hold. Not reused: `invalid_code`, whose sentence is about signing in
   * and which the SDK's auth ladder reads as a protocol signal.
   */
  linkExpired: { error: "link_expired", message: "That unsubscribe link is no longer valid.", status: 422 },
} as const;

type RouteError = (typeof ERRORS)[keyof typeof ERRORS];

function fail(spec: RouteError, cors: HeadersInit): NextResponse {
  return errorResponse(spec.error, spec.message, spec.status, cors);
}

/** What a `typ: "unsubscribe"` action token is allowed to carry. */
interface UnsubscribeTokenPayload {
  contactGuid: string;
  publicationId: number | null;
}

/**
 * Narrow a verified token's payload, or reject it.
 *
 * Runs after the signature and `typ` checks, so this is not a trust boundary
 * for provenance — it is a shape check against deploy skew, plus one real
 * guard: the GUID inside a token we signed still goes through `isContactGuid`
 * before it can reach an MP filter. A token whose payload we no longer
 * recognise is reported as invalid rather than half-trusted.
 */
function guardUnsubscribeToken(
  payload: Record<string, unknown>
): UnsubscribeTokenPayload | null {
  const { contactGuid, publicationId } = payload;
  if (!isContactGuid(contactGuid)) return null;

  if (publicationId === undefined || publicationId === null) {
    return { contactGuid, publicationId: null };
  }
  if (typeof publicationId !== "number" || !Number.isInteger(publicationId)) return null;
  if (publicationId < 0) return null;
  // `0` is the bulk sentinel here as everywhere else on this route.
  return { contactGuid, publicationId: publicationId > 0 ? publicationId : null };
}

/** Body as sent, or `{}`. A malformed body becomes `validation_failed` below. */
async function readJsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/**
 * The capability string the per-capability rate limit is keyed on.
 *
 * Read from the raw body **before** validation, because the limit has to be in
 * place for a caller who is sending garbage too. The sealed token wins over
 * `cg` for the same reason it wins in the handler: it is the narrower
 * capability, so it is the one to meter.
 */
function capabilityValue(raw: unknown): string {
  const body = (raw ?? {}) as { cg?: unknown; token?: unknown };
  if (typeof body.token === "string" && body.token) return body.token;
  if (typeof body.cg === "string" && body.cg) return body.cg;
  return "";
}

export async function POST(req: NextRequest) {
  // The body is read (and hashed) ahead of `withAnonymousWrite` because the
  // per-capability limit key depends on it, and every limit must be checked
  // before the handler runs. A JSON parse and one SHA-256 is the whole cost of
  // that ordering.
  const raw = await readJsonBody(req);
  const capability = capabilityValue(raw);
  // Hashed so a Contact_GUID never reaches Redis in cleartext, and truncated
  // again before it reaches a log line.
  const capHash = capability ? await sha256Hex(capability) : "none";

  return withAnonymousWrite(
    req,
    {
      // Least privilege, not `"*"`: `next-subscriptions` needs this for its
      // future "stop all bulk email" affordance (C55); nothing else does.
      widget: ["unsubscribe", "subscriptions"],
      limits: [
        // 10/min/IP: generous for a household behind one NAT plus a re-click,
        // tight enough that an IP is not a bulk tool.
        { key: `unsub:ip:${getClientIp(req)}`, limit: 10 },
        // 5/min per hashed capability. This is the one that matters: an
        // attacker holding one scraped GUID and a botnet defeats an IP limit,
        // and this caps them at "unsubscribed, undone, unsubscribed" — already
        // the honest outcome of holding the link.
        { key: `unsub:cap:${capHash}`, limit: 5 },
      ],
      // The helper defaults to fail-*closed*, which is right for a route that
      // sends email. It is wrong here: a Redis blip must not break the one path
      // a recipient is legally entitled to. Failing open costs an attacker
      // nothing they do not already have (they hold the capability; the write
      // is idempotent and confined to their own record), whereas failing closed
      // turns a store outage into "this church has no working unsubscribe" and
      // the recipient's only remaining move is to report the mail as spam.
      failClosed: false,
    },
    async ({ cors }) => {
      const parsed = UnsubscribeRequestSchema.safeParse(raw);
      if (!parsed.success) return fail(ERRORS.validationFailed, cors);

      const { action } = parsed.data;

      // ── Which capability wins ────────────────────────────────────────────
      //
      // A **valid `t` beats `cg`**: it is the narrower capability, it carries
      // its own publication (so a tampered `pubid` in the URL cannot widen what
      // it authorises), and it is revocable by rotating the secret.
      //
      // An **expired or tampered `t` falls back to `cg`** when `cg` is present.
      // That fallback is the sharpest argument for two paths rather than one:
      // `cg` is the path with no expiry, and expiry is exactly why a sealed
      // token cannot be the only path — a recipient digging up a six-month-old
      // email must still be able to get off the list.
      let contactGuid: string | undefined;
      let publicationId = resolvePublicationId(parsed.data.pubid);
      let tokenRejected = false;

      if (parsed.data.token) {
        const verified = await verifyActionToken(
          "unsubscribe",
          parsed.data.token,
          guardUnsubscribeToken
        );
        if (verified.ok) {
          contactGuid = verified.data.contactGuid;
          publicationId = verified.data.publicationId;
        } else {
          // All three reasons — invalid, expired, wrong-type — collapse here.
          tokenRejected = true;
        }
      }

      if (contactGuid === undefined) {
        // Validated before it is interpolated into any MP filter. A legitimate
        // visitor never reaches the failure branch — the widget checks the
        // URL's shape and renders its bad-link state without fetching.
        if (isContactGuid(parsed.data.cg)) {
          contactGuid = parsed.data.cg;
        } else {
          return fail(tokenRejected ? ERRORS.linkExpired : ERRORS.invalidRequest, cors);
        }
      }

      const scope = unsubscribeScope(publicationId);
      const service = await SubscriptionService.getInstance();

      let outcome: UnsubscribeOutcome;
      try {
        outcome =
          action === "resubscribe"
            ? await service.resubscribeByContactGuid({ contactGuid, publicationId })
            : await service.unsubscribeByContactGuid({ contactGuid, publicationId });
      } catch (error) {
        // Never the GUID and never the address: a `cg` is bearer capability, so
        // CLAUDE.md's "never log token material" covers it. A short hash prefix
        // is enough to correlate a burst of failures.
        console.error(
          `[unsubscribe] MP update failed (cap ${capHash.slice(0, 8)}, scope ${scope}, action ${action}):`,
          error instanceof Error ? error.message : error
        );
        return fail(ERRORS.saveFailed, cors);
      }

      const body: UnsubscribeResponse = {
        success: true,
        scope,
        publicationId,
        email: outcome.emailMasked,
        // Undo is offered only when there is something to undo. `false` covers
        // "already opted out" and "unknown capability" identically, and it is
        // the structural fix for legacy's undo opting people back in. A
        // resubscribe never offers one: the next step back would be another
        // unsubscribe, which is not an undo.
        canUndo:
          action === "unsubscribe" && outcome.matched && !outcome.wasAlreadyOptedOut,
      };

      return NextResponse.json(body, { status: 200, headers: cors });
    }
  );
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
