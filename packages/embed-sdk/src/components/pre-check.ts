import { MPNextWidget } from "../shared/base-widget";
import type { PreCheckMember } from "@mpnext/types";

/**
 * `<next-pre-check>` — a household checks itself in before Sunday (C78).
 *
 * The counterpart of legacy's `mpp-pre-check`, which had no `next-*`
 * equivalent at all. `next-event-details` handles registration for one event;
 * checking a family in for a service on a date is a different act, and it is
 * the one that keeps the Sunday-morning queue short.
 *
 * ## The client never sends an id
 *
 * Legacy encoded a six-part composite key into every checkbox `name`
 * (`check_{contactId}|{participantId}|{eventId}|…`), posted it back, and its
 * server `int.Parse`d all six straight into an `Event_Participants` write with
 * no check of any kind. This widget puts the server-computed `rowKey` in the
 * checkbox `value` purely as a stable identity, and the POST body is
 * `{ eventDate, selected }` — a **selection over a set the server computed**.
 * The server re-derives the whole legal set from the session and fails the
 * request on any key it did not issue. There is a test asserting the body
 * carries no ids.
 *
 * ## Signed-out is a state, not a failure
 *
 * Legacy rendered a dead `You need to log in` and **no login control at all** —
 * the C81/`CROSS-1` class in its purest form. Here a 401 paints the sign-in
 * panel, and it is **mode-aware**: `dual`/`hardened` get a real Sign In button
 * (a top-level redirect works there); `legacy` gets instructional copy naming
 * the page's own sign-in link and **no button**, because `AuthSession.login()`
 * is not the live path in that mode and a button that silently does nothing is
 * worse than none. `common.retry` is never rendered in this state.
 *
 * `CROSS-1`'s shared `renderSignInRequired()` helper has not landed yet, so the
 * panel is built here in the shape that plan specifies — the later extraction
 * should be a move, not a rewrite.
 *
 * ## Times are wall-clock and stay wall-clock
 *
 * `eventStart` arrives already converted to the congregation's zone, with no
 * zone marker, so it goes through `this.fmt.time(...)` — which parses the
 * calendar parts into a local `Date` and formats with **no** `timeZone`, so the
 * two cancel. The response's `timeZone` field is informational and is emitted
 * on `preCheckLoaded`; formatting with it would apply an offset to an instant
 * that never had one. Legacy hardcoded `toLocaleString("en-US", …)`, so a
 * Spanish visitor read `9:00 AM` where `9:00` is correct.
 *
 * ## Attributes
 *
 * Legacy took none and read the *host page's* `?eventDate=` query string, which
 * is a poor fit for a church's own CMS page. `event-date` is the supported
 * input; `read-query-string` opts back into the legacy fallback for a church
 * porting existing links; `allow-date-picker` is the honest replacement.
 */

type WidgetState =
  | "loading"
  | "needs-auth"
  | "list"
  | "no-events"
  | "no-household"
  | "error";

interface LoadedData {
  eventDate: string;
  timeZone: string;
  householdId: number;
  members: PreCheckMember[];
}

export class PreCheckWidget extends MPNextWidget {
  /**
   * Watched so a host page can move the widget to another day from script.
   *
   * **No `oldValue !== null` guard in `attributeChangedCallback`** (C39): that
   * guard is what makes several widgets in this repo ignore the *first* set.
   * `reconfigure()` is already a no-op before the first paint, which is the
   * correct place to make that decision.
   */
  static get observedAttributes(): string[] {
    return ["event-date", "read-query-string", "allow-date-picker"];
  }

  private state: WidgetState = "loading";
  private data: LoadedData | null = null;
  private errorPayload: unknown = null;
  /** The date currently being shown — the attribute, the query string, or the server's. */
  private activeDate: string | null = null;
  /** True once `render()` has run, so `reconfigure()` knows to reload. */
  private painted = false;
  /** Set on disconnect, so an in-flight request never paints a detached root. */
  private detached = false;

  connectedCallback() {
    this.detached = false;
    this.injectStyles(this.getStyles());

    // `initLocale()` before the first `render()`: a Spanish visitor must not
    // see English swap to Spanish. Nearly free, because the widget paints a
    // loading state while it fetches the household's events anyway.
    void this.initLocale().then(() => {
      this.render();
      this.painted = true;
      void this.load();
    });
  }

  disconnectedCallback(): void {
    // The base class unsubscribes the locale listener and disconnects the
    // `lang` MutationObserver here. Without this call each mount leaks one of
    // each.
    super.disconnectedCallback();
    this.detached = true;
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue !== newValue) this.reconfigure();
  }

  /** A no-op before the first paint; a full reload after it. */
  private reconfigure(): void {
    if (!this.painted || this.detached) return;
    this.data = null;
    this.errorPayload = null;
    this.activeDate = null;
    this.state = "loading";
    this.paint();
    void this.load();
  }

  // ── Attributes ───────────────────────────────────────────────────────────

  private boolAttr(name: string): boolean {
    const raw = this.getAttribute(name);
    return raw !== null && raw !== "false";
  }

  private get allowDatePicker(): boolean {
    return this.boolAttr("allow-date-picker");
  }

  /**
   * The date to request, or `null` to let the server decide.
   *
   * Order: `event-date` → `?eventDate=` (only with `read-query-string`) → the
   * server's domain-zone today. Reading an arbitrary URL parameter is off by
   * default because it is a surprise on a shared CMS page, where `?eventDate=`
   * may belong to something else entirely.
   *
   * Anything that is not exactly `YYYY-MM-DD` is dropped here rather than sent:
   * the route would answer `invalid_request`, and a malformed *attribute*
   * should degrade to "today", not to an error panel.
   */
  private resolveRequestedDate(): string | null {
    const attr = (this.getAttribute("event-date") ?? "").trim();
    if (this.isWallClockDate(attr)) return attr;

    if (this.boolAttr("read-query-string")) {
      try {
        const q = (new URL(window.location.href).searchParams.get("eventDate") ?? "").trim();
        if (this.isWallClockDate(q)) return q;
      } catch {
        /* no URL to read — nothing to recover */
      }
    }

    return null;
  }

  private isWallClockDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    const requested = this.activeDate ?? this.resolveRequestedDate();
    const query = requested ? `?eventDate=${encodeURIComponent(requested)}` : "";

    try {
      const res = await this.fetch(`/api/embed/pre-check${query}`);
      if (this.detached) return;

      const payload: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        this.errorPayload = payload;
        const code = (payload as { error?: string }).error ?? "";

        // Never inferred from a message string: the 401 status is the signal,
        // and the route only answers it for an absent or public subject.
        if (res.status === 401) {
          this.state = "needs-auth";
        } else if (code === "household_not_found") {
          this.state = "no-household";
        } else {
          this.state = "error";
        }

        this.emit("preCheckError", { code, status: res.status });
        this.paint();
        return;
      }

      const data = payload as LoadedData;
      this.data = data;
      this.activeDate = data.eventDate;
      this.state = data.members.length === 0 ? "no-events" : "list";
      this.emit("preCheckLoaded", {
        eventDate: data.eventDate,
        timeZone: data.timeZone,
        memberCount: data.members.length,
        rowCount: data.members.reduce((n, m) => n + m.rows.length, 0),
      });
    } catch {
      this.errorPayload = { error: "network" };
      this.state = "error";
      this.emit("preCheckError", { code: "network", status: 0 });
    }

    this.paint();
  }

  /**
   * Retry.
   *
   * Reachable only from the `error` state — deliberately **not** from
   * `needs-auth`, where re-issuing the same anonymous request fails
   * identically and the only honest control is a sign-in one (`CROSS-1`).
   */
  public retryLoad(): void {
    this.state = "loading";
    this.errorPayload = null;
    this.paint();
    void this.load();
  }

  /** Move to another day without a page load. */
  private showDate(date: string): void {
    if (!this.isWallClockDate(date)) return;
    this.activeDate = date;
    this.state = "loading";
    this.errorPayload = null;
    this.paint();
    void this.load();
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** Render, then re-attach the listeners the new markup needs. */
  private paint(): void {
    if (this.detached) return;
    this.render();
    this.painted = true;
    this.attachListeners();
  }

  render() {
    this.root.innerHTML = `<div class="pc">${this.renderHeader()}${this.renderState()}</div>`;
  }

  private renderHeader(): string {
    return `
      <div class="pc-head">
        <h2 class="pc-title">${this.escapeHtml(this.t("preCheck.title"))}</h2>
        <p class="pc-intro">${this.escapeHtml(this.t("preCheck.intro"))}</p>
      </div>`;
  }

  private renderState(): string {
    switch (this.state) {
      case "loading":
        return this.statusRegion(
          `<span class="pc-working">${this.spinnerSvg()}<span>${this.escapeHtml(
            this.t("preCheck.loading"),
          )}</span></span>`,
        );

      case "needs-auth":
        return this.renderSignInRequired();

      case "no-household":
        return this.statusRegion(
          `<p class="pc-msg pc-msg--warn">${this.escapeHtml(
            this.t("errors.household_not_found"),
          )}</p>`,
        );

      case "no-events":
        // Not an error, and it must not read like one: a Tuesday has no Sunday
        // classes, and MP's own check-in visibility rule legitimately hides a
        // household whose groups do not match the event's.
        return `${this.renderDateControl()}${this.statusRegion(
          `<p class="pc-msg">${this.escapeHtml(
            this.t("preCheck.emptyNoEvents", { date: this.formattedDate }),
          )}</p>`,
        )}`;

      case "list":
        return `${this.renderDateControl()}${this.renderMembers()}`;

      case "error":
        return `${this.statusRegion(`
          <p class="pc-msg pc-msg--warn">${this.escapeHtml(this.t("common.unableToLoad"))}</p>
          <p class="pc-msg">${this.escapeHtml(this.errorText(this.errorPayload))}</p>`)}
          <div class="pc-actions">
            <button class="pc-btn" type="button" data-action="retry">${this.escapeHtml(
              this.t("common.retry"),
            )}</button>
          </div>`;
    }
  }

  /**
   * The signed-out panel, in the shape `CROSS-1` phase 1 specifies.
   *
   * Mode-aware, and that is the whole point: in `legacy` the SDK cannot start a
   * sign-in — the host page does it through `<mpp-user-login>` /
   * `next-user-menu` — so a Sign In button there would silently no-op on every
   * customer we have today. Instructional copy naming the page's own control is
   * strictly better than legacy, which always drew a button whether or not it
   * could work.
   */
  private renderSignInRequired(): string {
    const mode = this.authSession.getMode();
    const canSignIn = mode !== null && mode !== "legacy";

    const body = this.escapeHtml(
      this.t(canSignIn ? "preCheck.signedOutPrompt" : "preCheck.signedOutLegacy"),
    );

    // No `[data-action="retry"]` in this state, ever: re-issuing the same
    // anonymous request fails identically, which is a loop with no exit.
    const action = canSignIn
      ? `<div class="pc-actions">
           <button class="pc-btn" type="button" data-action="login">${this.escapeHtml(
             this.t("common.signIn"),
           )}</button>
         </div>`
      : "";

    return `${this.statusRegion(`<p class="pc-msg">${body}</p>`)}${action}`;
  }

  private renderDateControl(): string {
    if (!this.allowDatePicker) {
      return `<p class="pc-date-label">${this.escapeHtml(this.formattedDate)}</p>`;
    }

    return `
      <div class="pc-datepick">
        <label class="pc-label" for="pc-date">${this.escapeHtml(
          this.t("fields.date"),
        )}</label>
        <input class="pc-input" id="pc-date" type="date" value="${this.escapeAttr(
          this.activeDate ?? "",
        )}">
      </div>`;
  }

  private renderMembers(): string {
    const members = this.data?.members ?? [];
    return `<div class="pc-members">${members
      .map((m) => this.renderMember(m))
      .join("")}</div>`;
  }

  private renderMember(member: PreCheckMember): string {
    return `
      <fieldset class="pc-member">
        <legend class="pc-member-name">${this.escapeHtml(member.participantName)}</legend>
        <ul class="pc-rows" aria-label="${this.escapeAttr(
          this.t("preCheck.memberEventsLabel", { name: member.participantName }),
        )}">
          ${member.rows.map((row) => this.renderRow(row)).join("")}
        </ul>
      </fieldset>`;
  }

  private renderRow(row: PreCheckMember["rows"][number]): string {
    const checked = row.isRegistered || row.isLocked ? " checked" : "";
    // Phase 2 is read-only: the rows show what MP holds, and there is no submit
    // control, so nothing on screen implies a write that does not happen yet.
    const locked = row.isLocked
      ? `<span class="pc-locked">${this.escapeHtml(this.t("preCheck.attendedLocked"))}</span>`
      : "";

    // Composed structurally rather than from one interpolated key: punctuation
    // and ordering differ across the three locales, and the event title, group
    // name and role are MP-authored and untranslatable by a file catalogue.
    const group = row.groupName
      ? `<span class="pc-group">${this.escapeHtml(row.groupName)}</span>`
      : "";
    const role = row.roleName
      ? `<span class="pc-role">${this.escapeHtml(row.roleName)}</span>`
      : "";

    return `
      <li class="pc-row">
        <label class="pc-check">
          <input type="checkbox" value="${this.escapeAttr(row.rowKey)}"${checked} disabled>
          <span class="pc-when">${this.escapeHtml(this.fmt.time(row.eventStart))}</span>
          <span class="pc-event">${this.escapeHtml(row.eventName)}</span>
          ${group}${role}${locked}
        </label>
      </li>`;
  }

  private statusRegion(inner: string): string {
    return `<div class="pc-status" role="status" aria-live="polite">${inner}</div>`;
  }

  /** The active date, rendered in the visitor's locale. */
  private get formattedDate(): string {
    const date = this.activeDate ?? this.data?.eventDate ?? "";
    // `fmt.date` parses the calendar parts into a local `Date` and formats with
    // no `timeZone`, so the wall clock survives. See the class note.
    return date ? this.fmt.date(date, "full") : "";
  }

  // ── Listeners ────────────────────────────────────────────────────────────

  private attachListeners(): void {
    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.requestLogin("pre-check"));

    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener("click", () => this.retryLoad());

    const date = this.root.querySelector<HTMLInputElement>("#pc-date");
    if (date) {
      date.addEventListener("change", () => this.showDate(date.value));
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private spinnerSvg(): string {
    return `<svg class="pc-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host {
        all: initial;
        display: block;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      }

      .pc {
        max-width: 640px;
        margin: 0 auto;
        padding: 28px 24px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        color: #2D2926;
        box-sizing: border-box;
      }

      .pc-head { margin-bottom: 20px; }

      .pc-title {
        margin: 0 0 6px;
        font-size: 22px;
        font-weight: 700;
        color: #004C97;
      }

      .pc-intro {
        margin: 0;
        font-size: 14px;
        color: #6b7280;
      }

      .pc-status {
        padding: 16px 0;
        font-size: 15px;
      }

      .pc-working {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: #6b7280;
      }

      .pc-spinner {
        width: 20px;
        height: 20px;
        animation: pc-spin 1s linear infinite;
        color: #004C97;
      }

      @keyframes pc-spin { to { transform: rotate(360deg); } }

      @media (prefers-reduced-motion: reduce) {
        .pc-spinner { animation: none; }
      }

      .pc-msg { margin: 0 0 8px; }
      .pc-msg:last-child { margin-bottom: 0; }
      .pc-msg--warn { font-weight: 600; color: #2D2926; }

      .pc-date-label {
        margin: 0 0 16px;
        font-size: 15px;
        font-weight: 600;
        color: #002855;
      }

      .pc-datepick { margin-bottom: 16px; }

      .pc-label {
        display: block;
        margin-bottom: 4px;
        font-size: 13px;
        font-weight: 600;
        color: #2D2926;
      }

      .pc-input {
        font: inherit;
        padding: 8px 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        color: inherit;
        background: white;
      }

      .pc-input:focus-visible {
        outline: 2px solid #009CDE;
        outline-offset: 1px;
      }

      .pc-members { display: flex; flex-direction: column; gap: 16px; }

      .pc-member {
        margin: 0;
        padding: 12px 14px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        min-width: 0;
      }

      .pc-member-name {
        padding: 0 6px;
        font-size: 15px;
        font-weight: 700;
        color: #002855;
      }

      .pc-rows { list-style: none; margin: 0; padding: 0; }

      .pc-row + .pc-row { margin-top: 6px; }

      .pc-check {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px;
        padding: 6px 4px;
        font-size: 14px;
        border-radius: 6px;
      }

      .pc-check input { margin: 0; }

      .pc-when { font-variant-numeric: tabular-nums; font-weight: 600; }
      .pc-event { color: #2D2926; }
      .pc-group { color: #6b7280; }
      .pc-group::before { content: "— "; }
      .pc-role { color: #6b7280; }
      .pc-role::before { content: "("; }
      .pc-role::after { content: ")"; }

      .pc-locked {
        font-size: 12px;
        font-weight: 600;
        color: #86AD3F;
        border: 1px solid currentColor;
        border-radius: 999px;
        padding: 1px 8px;
      }

      .pc-actions { margin-top: 12px; }

      .pc-btn {
        font: inherit;
        font-weight: 600;
        padding: 10px 18px;
        border: 0;
        border-radius: 8px;
        background: #004C97;
        color: white;
        cursor: pointer;
      }

      .pc-btn:hover { background: #002855; }

      .pc-btn:focus-visible {
        outline: 2px solid #009CDE;
        outline-offset: 2px;
      }
    `;
  }
}

customElements.define("next-pre-check", PreCheckWidget);
