import { MPNextWidget } from "../shared/base-widget";

/**
 * `<next-unsubscribe>` — the landing page for the unsubscribe link in a bulk
 * email (C72).
 *
 * The recipient is identified by what is in the URL, not by markup and not by a
 * session: `?cg=<Contact_GUID>` (what MP's merge engine can produce, and what
 * every link already sitting in an inbox uses), optionally `&pubid=<n>`, or
 * `?t=<sealed token>` for links we mint ourselves. A valid `t` wins; an expired
 * or tampered one falls back to `cg` when `cg` is also there, because `cg` is
 * the path with no expiry and expiry is exactly why a sealed token cannot be the
 * only path.
 *
 * ## It acts on load, and that is the point
 *
 * No confirm click. RFC 8058 and every mailbox provider's expectation is that
 * following the link completes the opt-out, and a confirmation step is
 * measurable drop-off on the one flow we are obliged to make easy. Legacy's UX
 * was right about this; only its transport was wrong (a state-changing `GET`,
 * which mail scanners fetch). The write here is a `POST` carrying a widget JWT,
 * so a scanner that fetches this page runs no JavaScript and changes nothing.
 *
 * ## Six states, and one of them never reaches the network
 *
 * `bad-link` is decided from the URL's *shape*, client-side, with zero fetches.
 * That is what keeps "this link is broken" distinguishable from "this GUID
 * matched nothing" — the latter must be, and is, byte-identical to success.
 */

/**
 * Canonical GUID shape, mirroring `isContactGuid` in
 * `src/services/subscriptionService.ts`.
 *
 * Deliberately duplicated rather than shared: the SDK is a standalone browser
 * bundle and cannot import server code, and the check has to happen here or the
 * `bad-link` state would need a round trip to discover that the link was
 * malformed. Keep the two in step — the server's copy is the authority, and the
 * only consequence of drift is a widget that fetches once and shows an error
 * where it could have shown `badLink`.
 */
const CONTACT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_GUID = "00000000-0000-0000-0000-000000000000";

type UnsubscribeState =
  | "working"
  | "done"
  | "done-final"
  | "undone"
  | "error"
  | "bad-link";

/** What the widget holds onto so Undo can replay it. */
interface Capability {
  cg?: string;
  token?: string;
  publicationId: number | null;
}

interface UnsubscribeApiResponse {
  success: true;
  scope: "publication" | "bulk";
  publicationId: number | null;
  email: string | null;
  canUndo: boolean;
}

export class UnsubscribeWidget extends MPNextWidget {
  private state: UnsubscribeState = "working";
  /**
   * The capability read out of the URL, kept in a private field so Undo can
   * replay it. Undo mints nothing new and there is no undo link in the email.
   */
  private capability: Capability | null = null;
  private scope: "publication" | "bulk" = "bulk";
  private publicationId: number | null = null;
  private emailMasked: string | null = null;
  private errorPayload: unknown = null;
  /** An undo failure, shown under the headline without losing it. */
  private inlineMessage: string | null = null;
  private busy = false;
  /** Set on disconnect so an in-flight POST does not paint a detached root. */
  private detached = false;
  /** CROSS-4: a declared attribute we refuse to honour must warn — once. */
  private warnedManageUrl = false;

  connectedCallback() {
    this.detached = false;
    this.injectStyles(this.getStyles());
    // Read and strip the capability synchronously, before anything awaits: the
    // GUID must leave the address bar immediately (it would otherwise survive
    // in the visible URL, in whatever the host page's analytics reads from
    // `location.search`, and in the `Referer` of any later same-page
    // navigation), and the `bad-link` decision must not wait on a catalogue.
    this.readCapability();
    // `initLocale()` before the first `render()` — this widget is the strongest
    // case for that ordering in the catalogue, because it paints exactly one
    // sentence and then stops, so an English-then-Spanish swap would be the
    // entire visible experience.
    void this.initLocale().then(() => {
      this.render();
      this.init();
    });
  }

  disconnectedCallback(): void {
    // The base class unsubscribes the locale listener and disconnects the
    // `lang` MutationObserver here. Without this call each mount leaks one of
    // each.
    super.disconnectedCallback();
    this.detached = true;
  }

  /** Retry after an error. Also the demo page's re-run hook. */
  public retryLoad(): void {
    if (!this.capability) return;
    this.state = "working";
    this.errorPayload = null;
    this.inlineMessage = null;
    this.render();
    void this.send("unsubscribe");
  }

  // ── URL capability ───────────────────────────────────────────────────────

  private readCapability(): void {
    const cgParam = this.getAttribute("cg-param") || "cg";
    const pubidParam = this.getAttribute("pubid-param") || "pubid";
    const tokenParam = this.getAttribute("token-param") || "t";

    let url: URL | null = null;
    try {
      url = new URL(window.location.href);
    } catch {
      url = null;
    }

    const read = (name: string) => (url?.searchParams.get(name) ?? "").trim();
    const token = read(tokenParam);
    const cg = read(cgParam);
    const pubidRaw = read(pubidParam);

    // MP's Portal templates also pass `dg=[Domain_GUID]`. This deployment is
    // single-domain, so it is neither read nor stripped — a church can paste an
    // MP-shaped link unchanged. No warning: it is a URL parameter we chose to
    // tolerate, not a declared attribute we failed to honour.
    this.stripFromUrl(url, [cgParam, pubidParam, tokenParam]);

    // Absent, empty and `0` all mean the bulk-email path, exactly as legacy.
    const pubid = /^\d+$/.test(pubidRaw) ? Number(pubidRaw) : 0;
    this.publicationId = pubid > 0 ? pubid : null;
    this.scope = this.publicationId === null ? "bulk" : "publication";

    if (token) {
      this.capability = { token, publicationId: this.publicationId };
      return;
    }
    if (CONTACT_GUID.test(cg) && cg.toLowerCase() !== NIL_GUID) {
      this.capability = { cg, publicationId: this.publicationId };
      return;
    }

    this.capability = null;
    this.state = "bad-link";
  }

  private stripFromUrl(url: URL | null, names: string[]): void {
    if (!url) return;
    try {
      let touched = false;
      for (const name of names) {
        if (url.searchParams.has(name)) {
          url.searchParams.delete(name);
          touched = true;
        }
      }
      if (touched) history.replaceState(null, "", url.toString());
    } catch {
      /* no history API, or a sandboxed frame — nothing to recover */
    }
  }

  // ── Network ──────────────────────────────────────────────────────────────

  private init(): void {
    // `bad-link` reaches the network zero times.
    if (this.state !== "working" || !this.capability) return;
    void this.send("unsubscribe");
  }

  private async send(action: "unsubscribe" | "resubscribe"): Promise<void> {
    const capability = this.capability;
    if (!capability || this.busy) return;

    this.busy = true;
    if (action === "resubscribe") {
      this.inlineMessage = null;
      this.render();
    }

    try {
      const res = await this.fetch("/api/embed/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(capability.token ? { token: capability.token } : { cg: capability.cg }),
          ...(capability.publicationId !== null
            ? { pubid: capability.publicationId }
            : {}),
          action,
        }),
      });

      const payload: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        this.handleFailure(action, payload);
        return;
      }

      const data = payload as UnsubscribeApiResponse;
      this.scope = data.scope ?? this.scope;
      this.publicationId = data.publicationId ?? null;

      if (action === "resubscribe") {
        this.state = "undone";
        this.emit("resubscribed", {
          scope: this.scope,
          publicationId: this.publicationId,
        });
      } else {
        this.emailMasked = data.email ?? null;
        this.state = data.canUndo ? "done" : "done-final";
        this.emit("unsubscribed", {
          scope: this.scope,
          publicationId: this.publicationId,
        });
      }
    } catch {
      this.handleFailure(action, { error: "network" });
    } finally {
      this.busy = false;
      if (!this.detached) {
        this.render();
        this.attachListeners();
      }
    }
  }

  /**
   * An unsubscribe failure replaces the whole view; an undo failure does not.
   * Losing the "you have been unsubscribed" headline because the *undo* failed
   * would be the worst of both — the visitor is still unsubscribed and would no
   * longer be told so.
   */
  private handleFailure(action: "unsubscribe" | "resubscribe", payload: unknown): void {
    const detail = this.errorText(payload);
    if (action === "resubscribe") {
      this.inlineMessage = this.t("unsubscribe.undoFailed");
    } else {
      this.errorPayload = payload;
      this.state = "error";
    }
    this.emit("unsubscribeError", { action, error: detail });
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private attachListeners(): void {
    const undo = this.root.querySelector('[data-action="undo"]');
    if (undo) undo.addEventListener("click", () => void this.send("resubscribe"));

    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener("click", () => this.retryLoad());
  }

  /**
   * The configured "manage all my preferences" destination, or `null`.
   *
   * Scheme-restricted to `http:` / `https:` so the attribute cannot be turned
   * into a `javascript:` sink by whoever edits the church's page template, and
   * anything refused warns once naming the attribute (CROSS-4).
   */
  private manageUrl(): string | null {
    const raw = (this.getAttribute("my-subscriptions-url") ?? "").trim();
    if (!raw) return null;

    try {
      const url = new URL(raw, window.location.href);
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {
      /* fall through to the warning */
    }

    if (!this.warnedManageUrl) {
      this.warnedManageUrl = true;
      console.warn(
        "[mpnext] <next-unsubscribe> ignored my-subscriptions-url: only http: and https: URLs are honoured.",
      );
    }
    return null;
  }

  private showEmail(): boolean {
    return (this.getAttribute("show-email") ?? "true") !== "false";
  }

  render() {
    const manage = this.manageUrl();
    const manageMarkup = manage
      ? `<a class="manage" href="${this.escapeAttr(manage)}">${this.escapeHtml(
          this.t("unsubscribe.manageLink"),
        )}</a>`
      : "";

    if (this.state === "working") {
      this.root.innerHTML = `
        <div class="nw-unsub">
          ${this.statusRegion(
            `<span class="working">${this.spinnerSvg()}<span>${this.escapeHtml(
              this.t("unsubscribe.working"),
            )}</span></span>`,
          )}
        </div>`;
      return;
    }

    if (this.state === "bad-link") {
      this.root.innerHTML = `
        <div class="nw-unsub">
          ${this.statusRegion(
            `<p class="headline headline--warn">${this.escapeHtml(
              this.t("unsubscribe.badLink"),
            )}</p>`,
          )}
          ${manageMarkup}
        </div>`;
      return;
    }

    if (this.state === "error") {
      this.root.innerHTML = `
        <div class="nw-unsub">
          ${this.statusRegion(
            `<p class="headline headline--warn">${this.escapeHtml(
              this.errorText(this.errorPayload),
            )}</p>`,
          )}
          <button class="btn" type="button" data-action="retry">${this.escapeHtml(
            this.t("common.retry"),
          )}</button>
          ${manageMarkup}
        </div>`;
      return;
    }

    if (this.state === "undone") {
      this.root.innerHTML = `
        <div class="nw-unsub">
          ${this.statusRegion(
            `<p class="headline">${this.escapeHtml(this.t("unsubscribe.undone"))}</p>`,
          )}
          ${manageMarkup}
        </div>`;
      return;
    }

    // `done` and `done-final` share their headline and differ only in whether
    // Undo is offered — "already opted out" and "unknown capability" both land
    // in `done-final`, indistinguishable by design.
    const headlineKey =
      this.scope === "publication"
        ? "unsubscribe.donePublication"
        : "unsubscribe.doneBulk";

    const emailLine =
      this.showEmail() && this.emailMasked
        ? `<p class="email"><span class="email-label">${this.escapeHtml(
            this.t("fields.email"),
          )}</span> <span class="email-value">${this.escapeHtml(
            this.emailMasked,
          )}</span></p>`
        : "";

    const undoButton =
      this.state === "done"
        ? `<button class="btn" type="button" data-action="undo"${
            this.busy ? " disabled" : ""
          }>${this.escapeHtml(this.t("unsubscribe.undoButton"))}</button>`
        : "";

    const inline = this.inlineMessage
      ? `<p class="inline-error">${this.escapeHtml(this.inlineMessage)}</p>`
      : "";

    this.root.innerHTML = `
      <div class="nw-unsub">
        ${this.statusRegion(
          `<p class="headline">${this.escapeHtml(this.t(headlineKey))}</p>`,
        )}
        ${emailLine}
        ${inline}
        <div class="actions">
          ${undoButton}
          ${manageMarkup}
        </div>
      </div>`;
  }

  /**
   * The one live region on the page, so `working → done` is announced (CROSS-3).
   * The headline *is* the announcement — no extra catalogue key — and
   * `unsubscribe.title` gives the region its accessible name.
   */
  private statusRegion(inner: string): string {
    return `<div class="status" role="status" aria-live="polite" aria-label="${this.escapeAttr(
      this.t("unsubscribe.title"),
    )}">${inner}</div>`;
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private spinnerSvg(): string {
    return `<svg class="spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

      .nw-unsub {
        max-width: 560px;
        margin: 0 auto;
        padding: 28px 24px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.06);
        text-align: center;
        color: #2D2926;
      }

      .working {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 16px;
        color: #2D2926;
      }
      .spinner {
        width: 20px;
        height: 20px;
        color: #004C97;
        animation: spin 1s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      .headline {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.45;
        color: #002855;
      }
      .headline--warn { color: #2D2926; font-weight: 500; }

      .email {
        margin: 14px 0 0;
        font-size: 14px;
        color: #6b7280;
      }
      .email-label { font-weight: 600; color: #2D2926; }
      .email-value { font-variant-numeric: tabular-nums; }

      .inline-error {
        margin: 14px 0 0;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
        background: rgba(255, 109, 106, 0.15);
        color: #b91c1c;
        border: 1px solid rgba(255, 109, 106, 0.4);
      }

      .actions {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        margin-top: 20px;
      }

      .btn {
        display: inline-block;
        margin-top: 20px;
        padding: 10px 24px;
        background: #004C97;
        color: white;
        font-weight: 600;
        font-size: 14px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .actions .btn { margin-top: 0; }
      .btn:hover { background: #002855; }
      .btn:focus-visible { outline: 3px solid rgba(0, 156, 222, 0.6); outline-offset: 2px; }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }

      .manage {
        display: inline-block;
        margin-top: 18px;
        color: #004C97;
        font-size: 14px;
        text-decoration: underline;
      }
      .actions .manage { margin-top: 0; }
      .manage:hover { color: #002855; }

      @media (max-width: 480px) {
        .nw-unsub { padding: 20px 16px; }
        .headline { font-size: 16px; }
      }
    `;
  }
}

customElements.define("next-unsubscribe", UnsubscribeWidget);
