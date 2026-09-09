import { MPHelper } from "@/lib/providers/ministry-platform";
import {
  cap,
  clean,
  getIdByValue,
  sqlLiteral,
  toNumberOrNull,
} from "@/services/_shared/mp-lookup";
import type { SubscriptionItem } from "@mpnext/types";

interface PublicationRow {
  Publication_ID: number;
  Title: string;
  Description: string | null;
  Online_Sort_Order: number | null;
}

interface ContactPublicationRow {
  Contact_Publication_ID: number;
  Publication_ID: number;
  Unsubscribed: boolean;
}

/**
 * One publication offered for anonymous opt-in (C70).
 *
 * `Congregation_ID` is on the service's shape but **not** on the wire shape
 * (`OnlinePublication` in `@mpnext/types`): a created household's congregation
 * is seeded from it, and the widget has no use for it.
 */
export interface PublicationSummary {
  Publication_ID: number;
  Title: string;
  Description: string | null;
  Congregation_ID: number | null;
}

/**
 * `Contact_Statuses.Contact_Status_ID` for Deceased.
 *
 * The one lookup id in this file that is a literal rather than resolved by
 * name, matching the convention `mp_query` itself documents (`AND
 * Contact_Status_ID <> 3` to exclude the deceased). It is only ever used to
 * *exclude* a row, so a domain that renumbered it would widen a match rather
 * than write a null into a required column — the failure mode that makes
 * name-resolution mandatory for the two ids `createSubscriberContact` writes.
 */
const DECEASED_CONTACT_STATUS_ID = 3;

/** `Households.Household_Name` when the form gave no surname to use. */
const SUBSCRIBER_HOUSEHOLD_NAME = "Subscriber";

/** One `dp_Contact_Publications` row reached through the contact's GUID. */
interface ContactPublicationByGuidRow {
  Contact_Publication_ID: number;
  Unsubscribed: boolean;
  /** Joined from `Contact_ID_TABLE`, so it is the contact's address. */
  Email_Address: string | null;
}

/**
 * Is `value` a canonical GUID string?
 *
 * **This is the injection control for the anonymous unsubscribe path.** The
 * `Contact_GUID` arrives from a query string in an emailed link and is
 * interpolated into an MP `$filter`, so nothing but hex digits and hyphens may
 * ever reach that string. Legacy's equivalent was a `.Clean()` call; a
 * whitelist of the exact shape is stronger, because it cannot be defeated by an
 * escaping edge case.
 *
 * It also makes the route's malformed-vs-unknown split possible: a value that
 * fails here is a *broken* link (`invalid_request`, and the widget decides it
 * client-side before it ever fetches), whereas a well-formed GUID with no
 * matching contact is answered exactly like a successful unsubscribe so the
 * route is not an existence oracle.
 *
 * The check is RFC 4122 §3's string form — 8-4-4-4-12 hex — and deliberately
 * does **not** assert the version or variant nibbles. MP domains routinely carry
 * GUIDs seeded by data conversion from other church systems, which are not all
 * `NEWID()`-shaped v4 values, and rejecting one of those would leave a real
 * recipient with a permanently broken unsubscribe link — a worse outcome than
 * accepting a slightly wider hex space that is still 122-plus bits of
 * unguessable capability. The all-zero GUID is refused because it is the
 * sentinel a caller reaches for when guessing.
 */
export function isContactGuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return false;
  }
  return value !== "00000000-0000-0000-0000-000000000000";
}

/**
 * Mask an email address for display: `john.doe@gmail.com` → `j•••@g•••.com`.
 *
 * Legacy wrote the full address into `innerHTML`, which turned a leaked or
 * forwarded unsubscribe link into an email-address lookup keyed by a
 * never-expiring GUID. Dropping the address entirely would lose something real
 * though — the reveal answers *"is this the address they have for me?"*, which
 * is why the recipient clicked. Keeping the first character of the local part,
 * the first character of the domain label and the TLD answers that for someone
 * who knows their own addresses and tells a link-holder almost nothing.
 *
 * Masking happens here, in the service, so the full address never leaves the
 * server: masking in the widget would still leave it in a response body sitting
 * in an HTTP cache.
 */
export function maskEmailForDisplay(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  // No local part or no domain: nothing safe to show, so show nothing.
  if (at < 1 || at === trimmed.length - 1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  // Single template literal, never a `+` chain — the production minifier folds
  // those and drops literal text (see CLAUDE.md, "Toolchain & Pinned Versions").
  if (dot < 1) return `${local[0]}•••@${domain[0]}•••`;
  return `${local[0]}•••@${domain[0]}•••${domain.slice(dot)}`;
}

/**
 * What one anonymous unsubscribe / resubscribe call did.
 *
 * `matched` and `changed` are for the server's own log line and for deciding
 * `canUndo`; **neither is serialised to the client**, because "we found this
 * contact" is exactly the existence disclosure the uniform response exists to
 * prevent.
 */
export interface UnsubscribeOutcome {
  /** A contact (or a subscription row) matched the capability. Never sent. */
  matched: boolean;
  /** Masked for display, or `null`. Masked here, before it leaves the server. */
  emailMasked: string | null;
  /** The opt-out was already in place before this call — nothing to undo. */
  wasAlreadyOptedOut: boolean;
  /** Rows / fields actually written. For the log line, not the response. */
  changed: number;
}

/** Nothing matched: the shape an unknown capability produces. */
const NO_MATCH: UnsubscribeOutcome = {
  matched: false,
  emailMasked: null,
  wasAlreadyOptedOut: false,
  changed: 0,
};

export class SubscriptionService {
  private static instance: SubscriptionService;
  private mp: MPHelper | null = null;
  /** Lookup-table ids resolved by name, cached per instance. */
  private idCache = new Map<string, number | null>();

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<SubscriptionService> {
    if (!SubscriptionService.instance) {
      SubscriptionService.instance = new SubscriptionService();
      await SubscriptionService.instance.initialize();
    }
    return SubscriptionService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  /**
   * Resolve User_GUID → Contact_ID
   */
  public async getContactIdByUserGuid(userGuid: string): Promise<number | null> {
    const users = await this.mp!.getTableRecords<{ User_ID: number; Contact_ID: number }>({
      table: "dp_Users",
      filter: `User_GUID = '${userGuid}'`,
      select: "User_ID,Contact_ID",
      top: 1,
    });
    return users.length > 0 ? users[0].Contact_ID : null;
  }

  /**
   * Get all available publications for given congregations, merged with the
   * contact's subscription state. Sorted by Online_Sort_Order then Title.
   */
  public async getSubscriptions(
    contactId: number
  ): Promise<SubscriptionItem[]> {
    const [publications, contactPubs] = await Promise.all([
      this.mp!.getTableRecords<PublicationRow>({
        table: "dp_Publications",
        filter: `Available_Online = 1 OR Available_Online IS NULL`,
        select: "Publication_ID,Title,Description,Online_Sort_Order",
      }),
      this.mp!.getTableRecords<ContactPublicationRow>({
        table: "dp_Contact_Publications",
        filter: `Contact_ID = ${contactId}`,
        select: "Contact_Publication_ID,Publication_ID,Unsubscribed",
      }),
    ]);

    // Build lookup: Publication_ID → subscription state
    const subMap = new Map<number, ContactPublicationRow>();
    for (const cp of contactPubs) {
      subMap.set(cp.Publication_ID, cp);
    }

    // Merge and determine subscribed state
    const items: SubscriptionItem[] = publications.map((pub) => {
      const cp = subMap.get(pub.Publication_ID);
      // Subscribed = has a Contact_Publication record AND Unsubscribed is false
      const subscribed = cp ? !cp.Unsubscribed : false;

      return {
        Publication_ID: pub.Publication_ID,
        Title: pub.Title,
        Description: pub.Description,
        Online_Sort_Order: pub.Online_Sort_Order,
        subscribed,
      };
    });

    // Sort by Online_Sort_Order (nulls last), then alphabetically by Title
    items.sort((a, b) => {
      const orderA = a.Online_Sort_Order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.Online_Sort_Order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.Title.localeCompare(b.Title);
    });

    return items;
  }

  /**
   * Update a contact's subscriptions. Takes the full list of Publication_IDs
   * the user wants to be subscribed to. Creates/updates dp_Contact_Publications
   * records accordingly.
   */
  public async updateSubscriptions(
    contactId: number,
    subscribedIds: number[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get all available publications
      const publications = await this.mp!.getTableRecords<PublicationRow>({
        table: "dp_Publications",
        filter: `Available_Online = 1 OR Available_Online IS NULL`,
        select: "Publication_ID",
      });
      const validPubIds = new Set(publications.map((p) => p.Publication_ID));

      // Get the contact's existing subscription records
      const existing = await this.mp!.getTableRecords<ContactPublicationRow>({
        table: "dp_Contact_Publications",
        filter: `Contact_ID = ${contactId}`,
        select: "Contact_Publication_ID,Publication_ID,Unsubscribed",
      });

      const existingMap = new Map<number, ContactPublicationRow>();
      for (const cp of existing) {
        existingMap.set(cp.Publication_ID, cp);
      }

      const subscribedSet = new Set(subscribedIds);
      const toCreate: Record<string, unknown>[] = [];
      const toUpdate: Record<string, unknown>[] = [];

      for (const pubId of validPubIds) {
        const wantSubscribed = subscribedSet.has(pubId);
        const existingRecord = existingMap.get(pubId);

        if (existingRecord) {
          // Record exists — update Unsubscribed flag if it changed
          const currentlySubscribed = !existingRecord.Unsubscribed;
          if (wantSubscribed !== currentlySubscribed) {
            toUpdate.push({
              Contact_Publication_ID: existingRecord.Contact_Publication_ID,
              Unsubscribed: !wantSubscribed,
            });
          }
        } else if (wantSubscribed) {
          // No record yet and user wants to subscribe — create one
          toCreate.push({
            Contact_ID: contactId,
            Publication_ID: pubId,
            Unsubscribed: false,
          });
        }
        // If no record and not subscribing, do nothing
      }

      // Batch updates and creates
      if (toUpdate.length > 0) {
        await this.mp!.updateTableRecords(
          "dp_Contact_Publications",
          toUpdate
        );
      }
      if (toCreate.length > 0) {
        await this.mp!.createTableRecords(
          "dp_Contact_Publications",
          toCreate
        );
      }

      return { success: true };
    } catch (error) {
      console.error("Error updating subscriptions:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update subscriptions",
      };
    }
  }

  // ── Anonymous, capability-addressed unsubscribe (C72) ───────────────────
  //
  // These three are the only methods on this service that identify a person by
  // `Contacts.Contact_GUID` rather than by a signed-in `dp_Users.User_GUID`.
  // The distinction is the whole point of the name difference with
  // `getContactIdByUserGuid` above: that one resolves a *login*, these resolve
  // a *bearer capability* pasted out of an emailed link. Every caller must have
  // put the value through `isContactGuid` first.

  /**
   * `Contacts.Contact_GUID` → contact id, address and current bulk-email flag.
   *
   * Read-only, and used by the bulk path (the per-publication path reaches the
   * address through `Contact_ID_TABLE` in one round trip instead, matching
   * legacy). Returns `null` for a GUID with no contact, which callers must
   * answer identically to success.
   */
  public async getContactByContactGuid(
    contactGuid: string
  ): Promise<{ contactId: number; email: string | null; bulkEmailOptOut: boolean } | null> {
    if (!isContactGuid(contactGuid)) {
      throw new Error("getContactByContactGuid: malformed Contact_GUID");
    }

    const contacts = await this.mp!.getTableRecords<{
      Contact_ID: number;
      Email_Address: string | null;
      Bulk_Email_Opt_Out: boolean | null;
    }>({
      table: "Contacts",
      filter: `Contact_GUID = '${contactGuid}'`,
      select: "Contact_ID,Email_Address,Bulk_Email_Opt_Out",
      top: 1,
    });

    if (contacts.length === 0) return null;
    const contact = contacts[0];
    return {
      contactId: contact.Contact_ID,
      email: contact.Email_Address ?? null,
      bulkEmailOptOut: contact.Bulk_Email_Opt_Out === true,
    };
  }

  /**
   * Honour an unsubscribe capability.
   *
   * `publicationId > 0` sets `dp_Contact_Publications.Unsubscribed = true` on
   * **every** row matching `(Contact_GUID, Publication_ID)` — duplicates of
   * that pair occur in the field, and legacy's undo touched only the first,
   * which left a contact unsubscribable but not fully undoable. No row is
   * created when none exists: legacy creates none either, and creating an
   * `Unsubscribed = true` row on demand would let a link-holder write rows for
   * a contact who never subscribed. "Never subscribed" and "unsubscribed" are
   * the same outcome for the recipient anyway.
   *
   * `publicationId` absent or `0` sets `Contacts.Bulk_Email_Opt_Out = true`.
   */
  public async unsubscribeByContactGuid(args: {
    contactGuid: string;
    publicationId?: number | null;
  }): Promise<UnsubscribeOutcome> {
    return this.setOptOutByContactGuid(args.contactGuid, args.publicationId ?? null, true);
  }

  /**
   * The undo.
   *
   * Takes no "prior state" argument and **only ever writes `false`**. Undo
   * happens in a second HTTP request, so restoring the previous value would
   * need it to survive — either echoed by the client (which can lie) or stored
   * server-side (state, for a 30-second affordance). Neither is needed, because
   * undo may only ever *reduce* an opt-out: the route offers the button at all
   * only when `matched && !wasAlreadyOptedOut`, so someone who was already
   * opted out before they clicked is never offered a control that would opt
   * them back in. That is legacy bug (2), structurally absent rather than
   * patched.
   */
  public async resubscribeByContactGuid(args: {
    contactGuid: string;
    publicationId?: number | null;
  }): Promise<UnsubscribeOutcome> {
    return this.setOptOutByContactGuid(args.contactGuid, args.publicationId ?? null, false);
  }

  /**
   * Both directions, so every guard and the shape of the outcome are written
   * once. `unsubscribed` is the value to write.
   *
   * Exactly one MP read happens on either path whether or not the capability
   * matches anything, which is what keeps the unknown-GUID path from being
   * measurably faster than the known one. No datetime crosses the MP boundary
   * here, so `DomainTimezoneService` deliberately does not appear — do not add
   * a `new Date().toISOString()` "audit" field.
   */
  private async setOptOutByContactGuid(
    contactGuid: string,
    publicationId: number | null,
    unsubscribed: boolean
  ): Promise<UnsubscribeOutcome> {
    if (!isContactGuid(contactGuid)) {
      // Unreachable from the route, which validates first. Kept as a hard stop
      // so a future caller cannot reach the filter interpolation below.
      throw new Error("setOptOutByContactGuid: malformed Contact_GUID");
    }

    // `0` is legacy's bulk sentinel, not publication number zero: its
    // controller defaulted the parameter to `0` and its widget read
    // `urlParams.get("pubid") || 0`, so links already in inboxes carry it.
    // `resolvePublicationId` in `@mpnext/types` collapses it for the route, and
    // this guard makes the service safe for any other caller.
    if (publicationId !== null && publicationId > 0) {
      return this.setPublicationOptOut(contactGuid, publicationId, unsubscribed);
    }
    return this.setBulkEmailOptOut(contactGuid, unsubscribed);
  }

  private async setPublicationOptOut(
    contactGuid: string,
    publicationId: number,
    unsubscribed: boolean
  ): Promise<UnsubscribeOutcome> {
    // `_TABLE` traversal appears in the filter, so every base-table column in
    // the select must be qualified — otherwise the join makes shared column
    // names ambiguous and MP answers 500. See
    // .claude/references/ministryplatform.query-syntax.md, Rule 1.
    const rows = await this.mp!.getTableRecords<ContactPublicationByGuidRow>({
      table: "dp_Contact_Publications",
      filter: `Contact_ID_TABLE.Contact_GUID = '${contactGuid}' AND dp_Contact_Publications.Publication_ID = ${publicationId}`,
      select: [
        "dp_Contact_Publications.Contact_Publication_ID",
        "dp_Contact_Publications.Unsubscribed",
        "Contact_ID_TABLE.Email_Address AS Email_Address",
      ].join(","),
    });

    if (rows.length === 0) return NO_MATCH;

    const wasAlreadyOptedOut = rows.every((row) => row.Unsubscribed === true);
    const stale = rows.filter((row) => row.Unsubscribed !== unsubscribed);

    if (stale.length > 0) {
      await this.mp!.updateTableRecords(
        "dp_Contact_Publications",
        stale.map((row) => ({
          Contact_Publication_ID: row.Contact_Publication_ID,
          Unsubscribed: unsubscribed,
        }))
      );
    }

    return {
      matched: true,
      emailMasked: maskEmailForDisplay(rows[0].Email_Address),
      wasAlreadyOptedOut,
      changed: stale.length,
    };
  }

  private async setBulkEmailOptOut(
    contactGuid: string,
    unsubscribed: boolean
  ): Promise<UnsubscribeOutcome> {
    const contact = await this.getContactByContactGuid(contactGuid);
    if (!contact) return NO_MATCH;

    const wasAlreadyOptedOut = contact.bulkEmailOptOut;
    const needsWrite = wasAlreadyOptedOut !== unsubscribed;

    if (needsWrite) {
      // `Contact_ID` plus the one field — never a whole-record write, which
      // would round-trip and re-save every column MP happened to return.
      await this.mp!.updateTableRecords("Contacts", [
        { Contact_ID: contact.contactId, Bulk_Email_Opt_Out: unsubscribed },
      ]);
    }

    return {
      matched: true,
      emailMasked: maskEmailForDisplay(contact.email),
      wasAlreadyOptedOut,
      changed: needsWrite ? 1 : 0,
    };
  }

  // ── Anonymous, email-verified opt-in (C70) ──────────────────────────────
  //
  // The mirror image of the three methods above: those identify a person by a
  // capability pasted out of an emailed link, these by an **email address the
  // caller has proved they can read** — the route only reaches them after
  // `consumePendingAction` has burned a one-time handle sent to that address.
  //
  // Neither path accepts a contact id from a caller, and **neither writes
  // `Contacts.Email_Address`**. Legacy's subscribe flow did both: an
  // `[AllowAnonymous]` endpoint took `ContactId` off the form, sealed it into
  // its token, and on redemption set that contact's address to whatever the
  // form held (`SubscriptionsService.cs:144-150`) — an account-takeover
  // primitive on an email-identified IdP. "Restore parity with legacy" is the
  // obvious way to reintroduce it, so there is a regression test naming it.

  /**
   * One publication a host page may offer for anonymous opt-in.
   *
   * `Available_Online = 1` **strictly** — no `OR Available_Online IS NULL`, and
   * that deliberately disagrees with `getSubscriptions` above. Do not tidy the
   * two into agreement: they are different trust surfaces. `getSubscriptions`
   * backs a signed-in management view of publications the member may already be
   * on, where an unflagged row showing up is at worst untidy. This is an
   * **anonymous write** that puts a stranger onto a mailing list, and treating
   * an unset flag as "yes, publish this" is the wrong default on that side of
   * the line. Legacy's own signed-in proc agrees
   * (`api_MPPW_SearchSubscriptions.sql:38`); its `GetPublication` is the
   * outlier, and it is a bare primary-key fetch that checks nothing at all.
   *
   * The failure mode is benign here in a way it is not there, too: this widget
   * takes one explicit `publication-id` from host markup, so a NULL flag
   * surfaces as a `publication_not_found` the church can see and fix rather
   * than as a silent exposure.
   *
   * Returns `null` for a missing id **and** for one that is not
   * `Available_Online`. A caller must not be able to tell those apart, or the
   * id space becomes probeable for internal publications.
   */
  public async getOnlinePublication(
    publicationId: number
  ): Promise<PublicationSummary | null> {
    if (!Number.isInteger(publicationId) || publicationId <= 0) return null;

    const rows = await this.mp!.getTableRecords<{
      Publication_ID: number | string;
      Title: string | null;
      Description: string | null;
      Congregation_ID: number | string | null;
    }>({
      table: "dp_Publications",
      filter: `Publication_ID = ${publicationId} AND Available_Online = 1`,
      select: "Publication_ID,Title,Description,Congregation_ID",
      top: 1,
    });

    const row = rows[0];
    const id = toNumberOrNull(row?.Publication_ID ?? null);
    if (!row || id == null) return null;

    return {
      Publication_ID: id,
      Title: clean(row.Title) ?? "",
      Description: clean(row.Description),
      Congregation_ID: toNumberOrNull(row.Congregation_ID),
    };
  }

  /**
   * The `Contacts.Contact_ID` owning `email`, or `null`.
   *
   * **Email alone**, deliberately, where legacy's `FindContact` required first
   * name, last name *and* address to agree (`ContactManager.cs:540-562`). A
   * subscription is keyed to a mailbox, not to a spelling: under legacy's rule
   * "Bob Smith" signing up when MP holds "Robert Smith" at the same address
   * created a duplicate contact, and churches have years of those.
   *
   * Deterministic — lowest `Contact_ID` wins when a domain holds duplicates —
   * so re-running the flow for one address always lands on the same row.
   * Companies are excluded (a company record is not a person to subscribe) and
   * so is MP's Deceased status.
   *
   * **Never called on the send-verification hop.** That is the anti-enumeration
   * invariant, and a route test asserts it: an address is only ever looked up
   * after its owner has opened a link sent to it.
   */
  public async findContactIdByEmail(email: string): Promise<number | null> {
    const address = clean(email);
    if (address == null) return null;

    const rows = await this.mp!.getTableRecords<{ Contact_ID: number | string }>({
      table: "Contacts",
      filter: `Email_Address = '${sqlLiteral(address)}' AND Company = 0 AND Contact_Status_ID <> ${DECEASED_CONTACT_STATUS_ID}`,
      select: "Contact_ID",
      orderBy: "Contact_ID",
      top: 1,
    });

    return rows[0] ? toNumberOrNull(rows[0].Contact_ID) : null;
  }

  /**
   * Resolve-or-create the contact owning `email`, then subscribe it.
   *
   * Called **only** from the verify hop, i.e. only for an address whose owner
   * has opened a one-time link. That round-trip is the whole reason creating a
   * `Contacts` row here is safe: without it an unauthenticated POST would mint
   * rows in a church's CRM as fast as a script could manage, and MP has no good
   * bulk undo.
   *
   * Idempotent in the subscribe direction (see `upsertContactPublication`), and
   * the returned booleans are for the server's log line and a host page's
   * analytics — **never for a branch in the visitor-facing copy**, which says
   * the same thing either way.
   */
  public async subscribeEmailToPublication(args: {
    email: string;
    firstName: string;
    lastName: string;
    publicationId: number;
  }): Promise<{
    contactId: number;
    contactCreated: boolean;
    alreadySubscribed: boolean;
  }> {
    const email = (clean(args.email) ?? "").toLowerCase();
    if (email === "") throw new Error("subscribeEmailToPublication: email is required");

    const existing = await this.findContactIdByEmail(email);
    const contactId =
      existing ??
      (await this.createSubscriberContact({
        email,
        firstName: clean(args.firstName) ?? "",
        lastName: clean(args.lastName) ?? "",
        publicationId: args.publicationId,
      }));

    const alreadySubscribed = await this.upsertContactPublication(
      contactId,
      args.publicationId
    );

    return { contactId, contactCreated: existing == null, alreadySubscribed };
  }

  /**
   * Mint a minimal `Contacts` row plus the `Households` row it heads.
   *
   * The column set is checked against the live schema rather than ported from
   * legacy's `ContactManager.CreateContact`, which writes a `Status` column
   * that **does not exist on `Contacts`** (filed as C83). The real column is
   * `Contact_Status_ID`.
   *
   * Three deliberate improvements on legacy:
   *
   * - **`Email_Verified: true`.** A double opt-in is precisely the evidence
   *   that column exists to record, and legacy leaves it at its default.
   * - **`Household_Source_ID`** resolved from `'Website'` by name, so staff can
   *   tell a widget-created contact from a hand-typed one. Omitted when the
   *   domain has no such row rather than demanding a new lookup value.
   * - **`Congregation_ID`** seeded from the publication's own, when it has one.
   *   Legacy passes both null (`SubscriptionsManager.cs:315-318`).
   *
   * Not written, and each for a reason: `Mobile_Phone` (not collected — a
   * newsletter opt-in has no business deciding texting consent), `Gender_ID`,
   * `Date_of_Birth`, and the schema-required-but-MP-defaulted set
   * (`Contact_GUID`, `_Contact_Setup_Date`, `Texting_Opt_In_Type_ID`,
   * `Email_Unlisted`, `Do_Not_Text`, `Mobile_Phone_Unlisted`,
   * `Mobile_Phone_Verified`, `Remove_From_Directory`).
   *
   * Contact, then household, then the association: a failure part-way leaves a
   * findable contact rather than an orphan household, so a retry resolves the
   * same address to the same row and links it, where the other order would
   * accumulate one household per attempt. MP has no combined create.
   */
  private async createSubscriberContact(c: {
    email: string;
    firstName: string;
    lastName: string;
    publicationId: number;
  }): Promise<number> {
    const [activeStatusId, headPositionId] = await Promise.all([
      this.getIdByValue("Contact_Statuses", "Contact_Status", "Active", "Contact_Status_ID"),
      this.getIdByValue(
        "Household_Positions",
        "Household_Position",
        "Head of Household",
        "Household_Position_ID"
      ),
    ]);

    // `Contact_Status_ID` is required on `Contacts`, so a null would be an MP
    // rejection of the whole insert carrying MP's own error text. Failing here
    // instead is what lets the route answer a clean `save_failed`.
    if (activeStatusId == null || headPositionId == null) {
      throw new Error(
        "subscribeEmailToPublication: the Contact_Statuses / Household_Positions lookup did not resolve"
      );
    }

    const created = await this.mp!.createTableRecords<{ Contact_ID: number }>("Contacts", [
      {
        Company: false,
        Display_Name: cap(`${c.lastName}, ${c.firstName}`, 125),
        First_Name: cap(c.firstName, 50),
        Last_Name: cap(c.lastName, 50),
        Nickname: cap(c.firstName, 50),
        Email_Address: cap(c.email, 254),
        Contact_Status_ID: activeStatusId,
        Household_Position_ID: headPositionId,
        Bulk_Email_Opt_Out: false,
        Email_Verified: true,
      } as unknown as { Contact_ID: number },
    ]);

    const contactId = toNumberOrNull(created[0]?.Contact_ID ?? null);
    if (contactId == null) throw new Error("Failed to create subscriber contact.");

    const householdId = await this.createSubscriberHousehold(c.lastName, c.publicationId);
    await this.mp!.updateTableRecords("Contacts", [
      { Contact_ID: contactId, Household_ID: householdId },
    ]);

    return contactId;
  }

  /** The household a created subscriber heads. One per created contact. */
  private async createSubscriberHousehold(
    lastName: string,
    publicationId: number
  ): Promise<number> {
    const sourceId = await this.getIdByValue(
      "Household_Sources",
      "Household_Source",
      "Website",
      "Household_Source_ID"
    );

    const record: Record<string, unknown> = {
      // `Household_Name` is NOT NULL, and a surname is the one thing this form
      // reliably has. A word beats an empty string for staff working the list.
      Household_Name: cap(lastName || SUBSCRIBER_HOUSEHOLD_NAME, 75),
      Bulk_Mail_Opt_Out: false,
    };

    // Both optional columns are **omitted** rather than nulled: a domain with
    // no 'Website' source, or a publication with no congregation, should get no
    // value at all instead of a null overwriting whatever MP would default.
    if (sourceId != null) record.Household_Source_ID = sourceId;

    const congregationId = await this.getPublicationCongregationId(publicationId);
    if (congregationId != null) record.Congregation_ID = congregationId;

    const created = await this.mp!.createTableRecords<{ Household_ID: number }>(
      "Households",
      [record as unknown as { Household_ID: number }]
    );
    const householdId = toNumberOrNull(created[0]?.Household_ID ?? null);
    if (householdId == null) throw new Error("Failed to create subscriber household.");
    return householdId;
  }

  /**
   * The publication's congregation, for seeding a created household.
   *
   * A second read of a row the route has already loaded, and deliberately so:
   * it happens only on the rare create path, and threading a congregation id
   * through `subscribeEmailToPublication`'s signature would let a caller supply
   * one — a small version of exactly the "caller names the record" pattern this
   * widget exists to avoid.
   *
   * `dp_Publications` relates to congregations through a plain `Congregation_ID`
   * column, not a join table (`api_MPPW_SearchSubscriptions.sql:26-35`).
   */
  private async getPublicationCongregationId(
    publicationId: number
  ): Promise<number | null> {
    const publication = await this.getOnlinePublication(publicationId);
    return publication?.Congregation_ID ?? null;
  }

  /**
   * Set this contact's `dp_Contact_Publications` row for `publicationId` to
   * subscribed, and report whether it already was.
   *
   * Three cases, one of which writes nothing:
   *
   * - no row → create `{ Contact_ID, Publication_ID, Unsubscribed: false }`
   * - every row `Unsubscribed: true` → update them to `false`
   * - any row already `Unsubscribed: false` → **no write**, `true` returned
   *
   * Every matching row, not just the first: duplicates of the
   * `(Contact_ID, Publication_ID)` pair occur in the field, and C72 found that
   * legacy's opt-out touched only one of them.
   *
   * `_Synced_List_Name` and `_Unsubscribe_Sync_Pending` are never written —
   * underscore-prefixed columns are MP-managed, and the MailChimp sync owns
   * those two.
   */
  private async upsertContactPublication(
    contactId: number,
    publicationId: number
  ): Promise<boolean> {
    const rows = await this.mp!.getTableRecords<ContactPublicationRow>({
      table: "dp_Contact_Publications",
      filter: `Contact_ID = ${contactId} AND Publication_ID = ${publicationId}`,
      select: "Contact_Publication_ID,Publication_ID,Unsubscribed",
    });

    if (rows.length === 0) {
      await this.mp!.createTableRecords("dp_Contact_Publications", [
        { Contact_ID: contactId, Publication_ID: publicationId, Unsubscribed: false },
      ]);
      return false;
    }

    const stale = rows.filter((row) => row.Unsubscribed === true);
    if (stale.length === rows.length) {
      await this.mp!.updateTableRecords(
        "dp_Contact_Publications",
        stale.map((row) => ({
          Contact_Publication_ID: row.Contact_Publication_ID,
          Unsubscribed: false,
        }))
      );
      return false;
    }

    // Already subscribed on at least one row. Nothing to write, and the visitor
    // is told the same thing either way.
    return true;
  }

  /** Lookup-table id by value, cached on this instance. */
  private getIdByValue(
    table: string,
    columnName: string,
    value: string,
    idColumn: string
  ): Promise<number | null> {
    return getIdByValue(
      { mp: this.mp!, cache: this.idCache, label: "SubscriptionService" },
      table,
      columnName,
      value,
      idColumn
    );
  }
}
