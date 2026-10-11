import { MPNextWidget } from "../shared/base-widget";
import { parseWallClock } from "../i18n";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  field,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

interface GroupContact {
  contactId: number;
  displayName: string | null;
  firstName: string | null;
  nickName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  emailAddress: string | null;
}

interface GroupDetail {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  noImageText: string | null;
  location: string | null;
  meetingDay: string | null;
  meetingTime: string | null;
  startDate: string | null;
  isFull: boolean;
  meetsOnline: boolean;
  totalParticipantsCount: number;
  targetSize: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  lifeStage: string | null;
  groupFocus: string | null;
  meetingFrequency: string | null;
  userHasInquired: boolean;
  userHasSignedUp: boolean;
  contacts: GroupContact[];
}

interface ContactOption {
  contactId: number;
  displayName: string;
  firstName?: string | null;
  nickname?: string | null;
}

interface CurrentContact {
  contactId: number;
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
  householdId: number | null;
  members: ContactOption[];
}

type Tab = "inquire" | "signup";

/**
 * `next-group-details` — single-group view + inquiry / sign-up flow.
 *
 * Ported from the legacy `mpp-group-details` portal widget. Shows the group
 * (image / meeting schedule / description / capacity / leaders / location / map)
 * and a tabbed form: "Contact this Group" (inquiry — anonymous allowed) and
 * "Sign Up for this Group" (requires sign-in). Honors the legacy attributes for
 * hiding tabs, inquiring about full groups, and showing the full address.
 *
 * Notification emails (C11): `inquiry-email-template`, `signup-email-template`
 * and `leader-signup-email-template` are `dp_Communications` message-template
 * ids, posted with the write. The server sends after the insert; a template
 * fault still reports success, with a sentence saying the email did not go.
 *
 * Sign-up offers the household plus "Someone else…" (C14), which finds or
 * creates the typed person server-side. Sign-up itself still requires sign-in,
 * exactly as legacy did, so no anonymous request can create a contact.
 */
export class GroupDetailsWidget extends MPNextWidget {
  private group: GroupDetail | null = null;
  private loading = true;
  private error: string | null = null;
  private message: { type: string; text: string } | null = null;

  private isAuthenticated = false;
  private contact: CurrentContact | null = null;

  private activeTab: Tab = "inquire";
  private inquireContactId = ""; // "" = Blank Form / anonymous
  private signupContactId = "";
  private inquireWarning = false;
  private signupWarning = false;

  static get observedAttributes() {
    return [
      "api-host",
      "group-id",
      "id-parameter-name",
      "return-url",
      "inquire-full-groups",
      "count-group-inquiries",
      "show-full-address",
      "hide-contact-tab",
      "hide-sign-up-tab",
      "inquiry-email-template",
      "signup-email-template",
      "leader-signup-email-template",
      "require-inquiry-phone",
    ];
  }

  /** Read at submit time, so a change needs no reload. */
  private static readonly SUBMIT_TIME_ATTRIBUTES = new Set([
    "inquiry-email-template",
    "signup-email-template",
    "leader-signup-email-template",
  ]);

  /**
   * C39: every other observed attribute reconfigures through the base class.
   * The old guard (`name === "group-id" && this.group`) ignored a `group-id`
   * set after a failed first load — exactly when a host most needs it — and
   * ignored every other attribute entirely.
   */
  override attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (GroupDetailsWidget.SUBMIT_TIME_ATTRIBUTES.has(name)) return;
    this.reconfigure();
  }

  protected override reload(): void {
    void this.init();
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it queries the API.
    void this.initLocale().then(() => {
      this.render();
      this.painted = true;
      void this.init();
    });
  }

  // ── Attribute helpers ──

  private get idParam(): string {
    return this.getAttribute("id-parameter-name") || "id";
  }
  private get returnUrl(): string {
    return this.getAttribute("return-url") || "";
  }
  private boolAttr(name: string): boolean {
    return this.getAttribute(name) === "true";
  }
  /** C16: the inquiry phone is required unless the page opts out. Default true. */
  private get requireInquiryPhone(): boolean {
    return this.getAttribute("require-inquiry-phone") !== "false";
  }

  private resolveGroupId(): string {
    const attr = this.getAttribute("group-id");
    if (attr) return attr;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get(this.idParam) || params.get("id") || "";
    } catch {
      return "";
    }
  }

  // ── Init / load ──

  private async init() {
    this.loading = true;
    this.error = null;
    this.message = null;
    this.group = null;
    this.render();

    const groupId = this.resolveGroupId();
    if (!groupId) {
      this.error = this.t("groupDetails.noGroupSpecified");
      this.loading = false;
      this.render();
      this.emit("groupDetailError", { error: this.error });
      return;
    }

    try {
      await this.loadCurrentContact();

      const params = new URLSearchParams();
      if (this.boolAttr("show-full-address")) params.set("showFullAddress", "true");
      if (this.boolAttr("count-group-inquiries")) params.set("countGroupInquiries", "true");
      const qs = params.toString();

      const res = await this.fetch(
        `/api/embed/group-details/${encodeURIComponent(groupId)}${qs ? `?${qs}` : ""}`
      );
      if (!res.ok) {
        if (res.status === 404) throw new Error(this.t("errors.group_not_found"));
        const body = await res.json().catch(() => ({}));
        throw new Error(this.errorText(body));
      }
      const data: { group: GroupDetail } = await res.json();
      if (!data || !data.group) throw new Error(this.t("errors.group_not_found"));
      this.group = data.group;

      // Seed dropdown selections + prior-activity warnings.
      if (this.contact) {
        this.inquireContactId = String(this.contact.contactId);
        this.signupContactId = String(this.contact.contactId);
      }
      this.inquireWarning = this.group.userHasInquired;
      this.signupWarning = this.group.userHasSignedUp;

      this.activeTab = this.defaultTab();
      this.emit("groupDetailLoaded", { groupId: this.group.id, title: this.group.title });
    } catch (err) {
      // `errorText` has already produced a translated sentence; a thrown
      // non-Error (a dropped connection) becomes the generic network message
      // rather than leaking English.
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.group = null;
      this.emit("groupDetailError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async loadCurrentContact() {
    try {
      const res = await this.fetch(`/api/embed/group-details/me`);
      if (res.status === 401) {
        this.isAuthenticated = false;
        this.contact = null;
        return;
      }
      if (!res.ok) {
        this.isAuthenticated = false;
        return;
      }
      const data: { contact: CurrentContact } = await res.json();
      this.contact = data.contact ?? null;
      this.isAuthenticated = !!this.contact;
    } catch {
      this.isAuthenticated = false;
      this.contact = null;
    }
  }

  // ── Tab visibility ──

  private get showInquireTab(): boolean {
    if (this.boolAttr("hide-contact-tab")) return false;
    if (this.group?.isFull && !this.boolAttr("inquire-full-groups")) return false;
    return true;
  }

  private get showSignupTab(): boolean {
    if (this.boolAttr("hide-sign-up-tab")) return false;
    if (this.group?.isFull) return false;
    return true;
  }

  private defaultTab(): Tab {
    if (this.showInquireTab) return "inquire";
    if (this.showSignupTab) return "signup";
    return "inquire";
  }

  // ── Submit ──

  private async submit(tab: Tab) {
    const form = this.root.querySelector<HTMLFormElement>(
      tab === "inquire" ? "#gd-inquire-form" : "#gd-signup-form"
    );
    if (!form || !this.group) return;

    if (!validateForm(form, { t: this.t }).valid) {
      this.setMessage("danger", this.t("validation.formIncomplete"));
      return;
    }

    const fd = new FormData(form);
    const contactRaw = String(fd.get("contactId") || "").trim();
    const contactId = contactRaw && contactRaw !== "blank" ? Number(contactRaw) : null;

    const payload = {
      targetId: this.group.id,
      contactId,
      firstName: String(fd.get("firstName") || "").trim() || null,
      lastName: String(fd.get("lastName") || "").trim() || null,
      emailAddress: String(fd.get("emailAddress") || "").trim() || null,
      mobilePhoneNumber: String(fd.get("mobilePhoneNumber") || "").trim() || null,
      message: String(fd.get("message") || "").trim() || null,
      ...this.emailTemplates(tab),
    };

    const endpoint =
      tab === "inquire"
        ? `/api/embed/group-details/inquire`
        : `/api/embed/group-details/signup`;

    this.setSubmitDisabled(true);
    try {
      const res = await this.fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: { success: boolean; message?: string; warning?: string } = await res
        .json()
        .catch(() => ({ success: false }));

      if (res.status === 401) {
        this.setMessage("warning", this.t("errors.authRequired"));
        this.requestLogin("group-details");
        this.setSubmitDisabled(false);
        return;
      }
      if (!data.success) {
        // The route's `message` is English and debug-only, so render the
        // translated sentence instead.
        this.setMessage("danger", this.errorText(data));
        this.setSubmitDisabled(false);
        return;
      }

      // Two whole sentences per outcome rather than one with an optional
      // clause: the greeting's punctuation and word order differ by language,
      // so splicing a name into the middle of a translated string does not
      // travel.
      const who = this.displayNameFor(tab, payload);
      let done: string;
      if (tab === "inquire") {
        this.emit("inquirySubmitted", { groupId: this.group.id });
        done = who
          ? this.t("groupDetails.inquirySentNamed", { name: who })
          : this.t("groupDetails.inquirySent");
      } else {
        this.emit("signupSubmitted", { groupId: this.group.id });
        done = who
          ? this.t("groupDetails.signedUpNamed", { name: who })
          : this.t("groupDetails.signedUp");
      }
      // The record is saved either way; a template fault (C11) is reported as
      // a second sentence rather than as a failure.
      if (data.warning === "email_not_sent") {
        this.setMessage("warning", [done, this.t("groupDetails.emailNotSent")].join(" "));
      } else {
        this.setMessage("success", done);
      }
      form.reset();
      this.setSubmitDisabled(false);
    } catch (err) {
      this.setMessage(
        "danger",
        err instanceof Error ? err.message : this.t("errors.submitFailed")
      );
      this.setSubmitDisabled(false);
    }
  }

  /** The configured template ids for this tab's write (C11). */
  private emailTemplates(tab: Tab): Record<string, number> {
    const id = (name: string): number | null => {
      const n = Number(this.getAttribute(name));
      return Number.isInteger(n) && n > 0 ? n : null;
    };
    const out: Record<string, number> = {};
    if (tab === "inquire") {
      const inquiry = id("inquiry-email-template");
      if (inquiry) out.inquiryEmailTemplate = inquiry;
    } else {
      const signup = id("signup-email-template");
      const leader = id("leader-signup-email-template");
      if (signup) out.signupEmailTemplate = signup;
      if (leader) out.leaderSignupEmailTemplate = leader;
    }
    return out;
  }

  /**
   * The name in the post-submit greeting: the first name alone — "Thanks,
   * Chris!" (C17). MP's `Display_Name` is "Last, First", and the greeting used
   * to strip its comma, producing "Thanks, Kehayias Chris!". Nickname wins over
   * First_Name, as it does everywhere MP addresses a person.
   */
  private displayNameFor(tab: Tab, payload: { firstName: string | null; lastName: string | null }): string {
    const id = tab === "inquire" ? this.inquireContactId : this.signupContactId;
    if (id && id !== "blank") {
      const member = this.contact?.members.find((m) => String(m.contactId) === id);
      if (member) {
        const first = member.nickname || member.firstName;
        if (first) return first;
        // An older server without the first-name columns: reorder
        // "Last, First" rather than deleting the comma.
        const [last, given] = member.displayName.split(",").map((p) => p.trim());
        return given || last || "";
      }
      if (this.contact && String(this.contact.contactId) === id) {
        return this.contact.firstName ?? "";
      }
    }
    return payload.firstName ?? "";
  }

  private setSubmitDisabled(disabled: boolean) {
    this.root.querySelectorAll<HTMLButtonElement>(".gd-submit").forEach((b) => (b.disabled = disabled));
  }

  // ── Already inquired / signed up check ──

  private async checkPriorActivity(tab: Tab, contactId: number | null) {
    if (!this.group || !contactId) {
      if (tab === "inquire") this.inquireWarning = false;
      else this.signupWarning = false;
      this.updateWarning(tab);
      return;
    }
    const path =
      tab === "inquire"
        ? `/api/embed/group-details/has-inquired`
        : `/api/embed/group-details/has-signed-up`;
    try {
      const res = await this.fetch(`${path}?groupId=${this.group.id}&contactId=${contactId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (tab === "inquire") this.inquireWarning = !!data.hasInquired;
      else this.signupWarning = !!data.hasSignedUp;
    } catch {
      /* best-effort */
    }
    this.updateWarning(tab);
  }

  private updateWarning(tab: Tab) {
    const el = this.root.querySelector<HTMLElement>(
      tab === "inquire" ? "#gd-inquire-warning" : "#gd-signup-warning"
    );
    const show = tab === "inquire" ? this.inquireWarning : this.signupWarning;
    if (el) el.style.display = show ? "" : "none";
  }

  private setMessage(type: string, text: string) {
    this.message = { type, text };
    const container = this.root.querySelector<HTMLElement>("#gd-message");
    if (container) {
      container.className = `gd-message gd-message--${type}`;
      container.textContent = text;
      container.style.display = "";
      container.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      this.render();
    }
  }

  // ── Listeners ──

  private attachListeners() {
    // Tab switching (C19): click, plus the ARIA tabs keyboard pattern —
    // Left/Right wrap between tabs, Home/End jump, activation follows focus.
    const tabs = Array.from(this.root.querySelectorAll<HTMLElement>('[role="tab"]'));
    tabs.forEach((el, index) => {
      el.addEventListener("click", () => this.selectTab(el.getAttribute("data-tab") as Tab));
      el.addEventListener("keydown", (e) => {
        let next = -1;
        if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        this.selectTab(tabs[next].getAttribute("data-tab") as Tab, true);
      });
    });

    // "As" dropdowns.
    const inquireAs = this.root.querySelector<HTMLSelectElement>("#gd-inquire-as");
    if (inquireAs) {
      inquireAs.addEventListener("change", () => {
        this.inquireContactId = inquireAs.value;
        this.toggleBlankFields("inquire");
        const id = inquireAs.value && inquireAs.value !== "blank" ? Number(inquireAs.value) : null;
        void this.checkPriorActivity("inquire", id);
      });
    }
    const signupAs = this.root.querySelector<HTMLSelectElement>("#gd-signup-as");
    if (signupAs) {
      signupAs.addEventListener("change", () => {
        this.signupContactId = signupAs.value;
        this.toggleBlankFields("signup");
        const id = signupAs.value && signupAs.value !== "blank" ? Number(signupAs.value) : null;
        void this.checkPriorActivity("signup", id);
      });
    }

    // Submit buttons.
    this.root.querySelectorAll<HTMLButtonElement>(".gd-submit").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.submit(btn.getAttribute("data-tab") as Tab);
      });
    });

    // Sync `required` on the identity blocks with their visibility.
    this.toggleBlankFields("inquire");
    this.toggleBlankFields("signup");

    const inquireForm = this.root.querySelector<HTMLFormElement>("#gd-inquire-form");
    if (inquireForm) bindLiveValidation(inquireForm);
    const signupForm = this.root.querySelector<HTMLFormElement>("#gd-signup-form");
    if (signupForm) bindLiveValidation(signupForm);
  }

  private selectTab(tab: Tab, focus = false) {
    if (tab && tab !== this.activeTab) {
      this.activeTab = tab;
      this.message = null;
      this.render();
    }
    if (focus) {
      this.root.querySelector<HTMLElement>(`[role="tab"][data-tab="${tab}"]`)?.focus();
    }
  }

  /** Show/hide the blank-form fields for the inquiry form based on the dropdown. */
  private toggleBlankFields(tab: Tab) {
    const blank = this.root.querySelector<HTMLElement>(
      tab === "inquire" ? "#gd-inquire-blank" : "#gd-signup-blank"
    );
    if (!blank) return;
    const id = tab === "inquire" ? this.inquireContactId : this.signupContactId;
    // Anonymous inquirers have no picker: the block is their only identity.
    const showBlank =
      tab === "inquire"
        ? !this.isAuthenticated || !id || id === "blank"
        : id === "blank";
    blank.style.display = showBlank ? "" : "none";
    blank.querySelectorAll<HTMLInputElement>("input[data-required]").forEach((input) => {
      if (showBlank) input.setAttribute("required", "");
      else input.removeAttribute("required");
    });
  }

  // ── Render ──

  /**
   * Paint, then re-bind the listeners the new markup needs. One method, so
   * every re-render re-binds: the base class re-renders through `render()`
   * alone on a page-wide locale or label-override change, and a paint that
   * left the binding to its caller came back with dead buttons.
   */
  render(): void {
    this.paintMarkup();
    this.attachListeners();
  }

  private paintMarkup(): void {
    if (this.loading) {
      this.root.innerHTML = `<div class="gd">${this.renderState(this.spinnerSvg(), this.t("groupDetails.loading"))}</div>`;
      return;
    }
    if (this.error || !this.group) {
      this.root.innerHTML = `
        <div class="gd">
          ${this.renderBackLink()}
          <div class="gd-state gd-error"><p>${this.escapeHtml(this.error || this.t("errors.group_not_found"))}</p></div>
        </div>`;
      return;
    }

    this.root.innerHTML = `
      <div class="gd">
        ${this.renderBackLink()}
        ${this.renderDetails()}
        ${this.renderForms()}
      </div>`;
  }

  private renderBackLink(): string {
    if (!this.returnUrl) return "";
    return `<div class="gd-back"><a href="${this.escapeAttr(this.returnUrl)}">&larr; ${this.escapeHtml(this.t("groupDetails.backToGroups"))}</a></div>`;
  }

  /**
   * The form-level message, rendered **inside the form, directly above the
   * submit row** (C19 row 10). At the top of the shadow root it sat above the
   * group's title and image — off-screen on a phone, so a press of Send Message
   * with a field missing looked like the button did nothing. `aria-live` so
   * the outcome is announced, not only painted.
   */
  private renderMessage(): string {
    if (!this.message) {
      return `<div id="gd-message" class="gd-message" aria-live="polite" style="display:none"></div>`;
    }
    return `<div id="gd-message" class="gd-message gd-message--${this.escapeAttr(this.message.type)}" aria-live="polite">${this.escapeHtml(this.message.text)}</div>`;
  }

  private renderDetails(): string {
    const g = this.group!;
    const img = g.imageUrl
      ? `<div class="gd-image" style="background-image:url('${this.escapeAttr(g.imageUrl)}')"></div>`
      : "";

    const schedule = [g.meetingFrequency, g.meetingDay, this.formatMeetingTime(g.meetingTime)]
      .filter(Boolean)
      .join(" · ");
    const scheduleHtml = schedule
      ? `<div class="gd-datetime">${this.escapeHtml(schedule)}</div>`
      : "";

    const description = g.description
      ? `<section class="gd-description">${this.sanitizeHtml(g.description)}</section>`
      : "";

    const capacity = this.capacityLabel(g);
    const capacityHtml = capacity
      ? this.specialText(this.t("groupDetails.capacity"), capacity)
      : "";

    const start = this.formatStart(g.startDate);
    const startHtml = start
      ? this.specialText(this.t("groupDetails.starts"), start)
      : "";

    // The focus, life-stage and location *values* are MP-authored and stay as
    // MP supplies them; only their labels are translated.
    const focus = g.groupFocus
      ? this.specialText(this.t("groupDetails.groupFocus"), g.groupFocus)
      : "";
    const life = g.lifeStage
      ? this.specialText(this.t("groupDetails.lifeStage"), g.lifeStage)
      : "";
    const location = g.location
      ? this.specialText(this.t("fields.location"), g.location)
      : "";

    return `
      <div class="gd-detail">
        ${img}
        <h1 class="gd-title">${this.escapeHtml(g.title)}</h1>
        ${g.meetsOnline ? `<span class="gd-badge">${this.escapeHtml(this.t("groupDetails.meetsOnline"))}</span>` : ""}
        ${scheduleHtml}
        ${description}
        ${focus}
        ${life}
        ${capacityHtml}
        ${startHtml}
        ${location}
        ${this.renderContacts()}
        ${this.renderMap()}
      </div>`;
  }

  private specialText(title: string, body: string): string {
    return `<div class="gd-special"><div class="gd-special-title">${this.escapeHtml(title)}</div><div class="gd-special-body">${this.escapeHtml(body)}</div></div>`;
  }

  private capacityLabel(g: GroupDetail): string {
    if (g.isFull || (g.targetSize != null && g.totalParticipantsCount >= g.targetSize)) {
      return this.t("groupDetails.full");
    }
    if (g.targetSize != null && g.totalParticipantsCount < g.targetSize) {
      return this.t("groupDetails.capacityOf", {
        filled: this.fmt.number(g.totalParticipantsCount),
        total: this.fmt.number(g.targetSize),
      });
    }
    return "";
  }

  private renderContacts(): string {
    const g = this.group!;
    if (!g.contacts || g.contacts.length === 0) return "";
    const items = g.contacts
      .map((c) => {
        const name = this.escapeHtml(this.contactName(c));
        const inner = c.emailAddress
          ? `<a href="mailto:${this.escapeAttr(c.emailAddress)}">${name}</a>`
          : name;
        const badge = c.imageUrl
          ? `<span class="gd-contact-badge" style="background-image:url('${this.escapeAttr(c.imageUrl)}')"></span>`
          : `<span class="gd-contact-badge">${name.charAt(0)}</span>`;
        return `<li class="gd-contact">${badge}<span>${inner}</span></li>`;
      })
      .join("");
    return `<div class="gd-special"><div class="gd-special-title">${this.escapeHtml(this.t("groupDetails.leaders"))}</div><ul class="gd-contacts">${items}</ul></div>`;
  }

  private contactName(c: GroupContact): string {
    if (c.displayName) return c.displayName;
    const first = c.nickName || c.firstName || "";
    return `${first} ${c.lastName || ""}`.trim();
  }

  private renderMap(): string {
    const g = this.group!;
    if (g.latitude == null || g.longitude == null) return "";
    const q = `${g.latitude},${g.longitude}`;
    const directions = `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
    const addr = g.address ? `<div class="gd-special-body">${this.escapeHtml(g.address)}</div>` : "";
    return `
      <div class="gd-map">
        <iframe
          title="${this.escapeAttr(this.t("groupDetails.mapTitle"))}"
          src="https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"></iframe>
        ${addr}
        <a class="gd-link" href="${this.escapeAttr(directions)}" target="_blank" rel="noopener">${this.escapeHtml(this.t("common.getDirections"))} &rsaquo;</a>
      </div>`;
  }

  // ── Render: forms ──

  private renderForms(): string {
    const g = this.group!;
    const showInquire = this.showInquireTab;
    const showSignup = this.showSignupTab;

    if (!showInquire && !showSignup) {
      if (g.isFull) {
        return `<div class="gd-form-wrap"><div class="gd-message gd-message--warning">${this.escapeHtml(this.t("groupDetails.groupFull"))}</div></div>`;
      }
      return "";
    }

    if (this.activeTab === "inquire" && !showInquire) this.activeTab = "signup";
    if (this.activeTab === "signup" && !showSignup) this.activeTab = "inquire";

    // Real tab semantics (C19 row 13): tablist / tab / tabpanel, with
    // aria-selected and a roving tabindex so Tab enters the strip once and
    // the arrow keys move within it.
    const panelId = `${this.instanceId}-gd-panel`;
    const tabId = (t: Tab) => `${this.instanceId}-gd-tab-${t}`;
    const tab = (t: Tab, labelKey: "groupDetails.contactTab" | "groupDetails.signupTab") => {
      const active = this.activeTab === t;
      return `<button type="button" role="tab" id="${tabId(t)}" class="gd-tab ${active ? "gd-tab--active" : ""}" data-tab="${t}" aria-selected="${active}" aria-controls="${panelId}" tabindex="${active ? "0" : "-1"}">${this.escapeHtml(this.t(labelKey))}</button>`;
    };
    const tabs: string[] = [];
    if (showInquire) tabs.push(tab("inquire", "groupDetails.contactTab"));
    if (showSignup) tabs.push(tab("signup", "groupDetails.signupTab"));

    const body = this.activeTab === "inquire" ? this.renderInquireForm() : this.renderSignupForm();

    return `
      <div class="gd-form-wrap">
        <div class="gd-tabs" role="tablist">${tabs.join("")}</div>
        <div class="gd-tab-body" role="tabpanel" id="${panelId}" aria-labelledby="${tabId(this.activeTab)}">${body}</div>
      </div>`;
  }

  private renderInquireForm(): string {
    const asPicker = this.renderAsPicker("inquire");
    const showBlank = !this.isAuthenticated || !this.inquireContactId || this.inquireContactId === "blank";
    return `
      <div id="gd-inquire-warning" class="gd-message gd-message--info" style="display:${this.inquireWarning ? "" : "none"}">
        ${this.escapeHtml(this.t("groupDetails.alreadyContacted"))}
      </div>
      <form id="gd-inquire-form" class="gd-form" novalidate>
        ${asPicker}
        <div id="gd-inquire-blank" style="display:${showBlank ? "" : "none"}">
          ${this.renderBlankFields("inquire")}
        </div>
        <div class="gd-field">
          <label for="gd-inquire-message">${this.escapeHtml(this.t("fields.message"))}</label>
          <textarea id="gd-inquire-message" class="gd-input" name="message" maxlength="500" rows="4"></textarea>
        </div>
        ${this.renderMessage()}
        <div class="gd-actions">
          <button type="button" class="gd-btn gd-btn--primary gd-submit" data-tab="inquire">${this.escapeHtml(this.t("groupDetails.sendMessage"))}</button>
        </div>
      </form>`;
  }

  private renderSignupForm(): string {
    if (!this.isAuthenticated) {
      // The shared, mode-aware panel (W0 / C81): a Sign In button where the
      // SDK can start a sign-in, the page's own sign-in link named in
      // `legacy` — where the old hand-rolled button did nothing visible. The
      // base class binds the button.
      return this.renderSignInRequired({
        subject: "group-details",
        message: this.t("groupDetails.signInToSignUp"),
        className: "gd-login-panel",
        buttonClass: "gd-btn gd-btn--primary",
      });
    }
    const showBlank = this.signupContactId === "blank";
    return `
      <div id="gd-signup-warning" class="gd-message gd-message--info" style="display:${this.signupWarning ? "" : "none"}">
        ${this.escapeHtml(this.t("groupDetails.alreadySignedUp"))}
      </div>
      <form id="gd-signup-form" class="gd-form" novalidate>
        ${this.renderAsPicker("signup")}
        <div id="gd-signup-blank" style="display:${showBlank ? "" : "none"}">
          ${this.renderBlankFields("signup")}
        </div>
        <div class="gd-field">
          <label for="gd-signup-message">${this.escapeHtml(this.t("fields.message"))} <span class="gd-optional">(${this.escapeHtml(this.t("common.optional"))})</span></label>
          <textarea id="gd-signup-message" class="gd-input" name="message" maxlength="500" rows="3"></textarea>
        </div>
        ${this.renderMessage()}
        <div class="gd-actions">
          <button type="button" class="gd-btn gd-btn--primary gd-submit" data-tab="signup">${this.escapeHtml(this.t("groupDetails.signUp"))}</button>
        </div>
      </form>`;
  }

  /** Render the "Inquire/Sign Up as" household-member picker (auth only). */
  private renderAsPicker(tab: Tab): string {
    if (!this.isAuthenticated || !this.contact) return "";
    const selected = tab === "inquire" ? this.inquireContactId : this.signupContactId;
    const members = this.contact.members.length
      ? this.contact.members
      : [
          {
            contactId: this.contact.contactId,
            firstName: this.contact.firstName,
            displayName:
              [this.contact.firstName, this.contact.lastName]
                .filter(Boolean)
                .join(" ") || this.t("groupDetails.myInfo"),
          },
        ];
    const opts = members
      .map(
        (m) =>
          `<option value="${m.contactId}" ${String(m.contactId) === selected ? "selected" : ""}>${this.escapeHtml(m.displayName)}</option>`
      )
      .join("");
    // "Someone else…" on both tabs (C14). Listed last, so the default stays
    // the signed-in contact — legacy listed "Blank Form" first (C19 row 7).
    const blankOpt = `<option value="blank" ${selected === "blank" ? "selected" : ""}>${this.escapeHtml(this.t("groupDetails.someoneElse"))}</option>`;
    const id = tab === "inquire" ? "gd-inquire-as" : "gd-signup-as";
    const label = this.t(
      tab === "inquire" ? "groupDetails.contactAs" : "groupDetails.signUpAs"
    );
    return `
      <div class="gd-field">
        <label for="${id}">${this.escapeHtml(label)}${requiredStar()}</label>
        <select id="${id}" class="gd-input" name="contactId">
          ${opts}
          ${blankOpt}
        </select>
      </div>`;
  }

  /**
   * The "Someone else…" identity block. Each control comes from the shared
   * `field()` (W0), so it has a real `<label for>` and a missing value reads
   * "{label} is required." (C19 row 9).
   *
   * Rendered `required` with its star, then {@link toggleBlankFields} strips
   * `required` while the block is hidden: rendering it non-required would
   * draw no star, and the star would then be missing when the block opens.
   *
   * The phone is required (C16) — on the inquiry tab unless the page sets
   * `require-inquiry-phone="false"`, and always on a sign-up, as legacy did.
   */
  private renderBlankFields(tab: Tab): string {
    const phoneRequired = tab === "signup" || this.requireInquiryPhone;
    const f = (
      name: string,
      label: string,
      opts: { type?: string; autocomplete?: string; required?: boolean } = {},
    ) => {
      const required = opts.required ?? true;
      return field({
        name,
        label,
        type: opts.type,
        autocomplete: opts.autocomplete,
        required,
        idPrefix: `${this.instanceId}-${tab}`,
        wrapperClass: "gd-field",
        inputClass: "gd-input",
        attrs: required ? { "data-required": true } : undefined,
      });
    };
    return `
      <div class="gd-grid2">
        ${f("firstName", this.t("fields.firstName"), { autocomplete: "given-name" })}
        ${f("lastName", this.t("fields.lastName"), { autocomplete: "family-name" })}
      </div>
      <div class="gd-grid2">
        ${f("emailAddress", this.t("fields.email"), { type: "email", autocomplete: "email" })}
        ${f("mobilePhoneNumber", this.t("fields.mobilePhone"), { type: "tel", required: phoneRequired })}
      </div>`;
  }

  private renderState(icon: string, text: string): string {
    return `<div class="gd-state">${icon}<span>${this.escapeHtml(text)}</span></div>`;
  }

  // ── Date / text helpers ──

  private formatStart(value: string | null): string {
    // `parseWallClock` is the same parse the deleted local `parseMpDate` did —
    // calendar parts into a local Date, no offset maths — so MP's wall clock
    // survives and `fmt` formats it with no time zone.
    const d = parseWallClock(value);
    if (!d) return "";
    if (d.getTime() < Date.now()) return this.t("groupDetails.alreadyMeeting");
    return this.fmt.date(d, "full");
  }

  /**
   * Format an MP time-of-day string ("18:30:00" or "1900-01-01T18:30:00").
   * Kept local rather than routed through `parseWallClock`, which needs a date
   * part; the hours/minutes go onto an arbitrary date so `fmt.time` can render
   * them in the visitor's locale.
   */
  private formatMeetingTime(value: string | null): string {
    if (!value) return "";
    const m = value.match(/(\d{2}):(\d{2})/);
    if (!m) return "";
    return this.fmt.time(new Date(1900, 0, 1, Number(m[1]), Number(m[2])));
  }

  private sanitizeHtml(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;
    const walk = (node: Element) => {
      const tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object" || tag === "embed") {
        node.remove();
        return;
      }
      for (const attr of Array.from(node.attributes)) {
        const n = attr.name.toLowerCase();
        if (n.startsWith("on") || (n === "href" && attr.value.trim().toLowerCase().startsWith("javascript:"))) {
          node.removeAttribute(attr.name);
        }
      }
      Array.from(node.children).forEach(walk);
    };
    Array.from(template.content.children).forEach((c) => walk(c as Element));
    return template.innerHTML;
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
    return `<svg class="gd-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: var(--_nw-font-family); color: var(--_nw-color-text); }
      .gd { max-width: 880px; margin: 0 auto; }

      .gd-back { margin-bottom: var(--_nw-space-3); }
      .gd-back a { color: var(--_nw-color-primary); text-decoration: none; font-weight: 600; font-size: var(--_nw-font-size-base); cursor: pointer; }
      .gd-back a:hover { text-decoration: underline; }

      .gd-message { padding: var(--_nw-space-3) var(--_nw-space-4); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); margin-bottom: var(--_nw-space-4); }
      .gd-message--success { background: #ecf6e0; color: #4d6b1f; }
      .gd-message--warning { background: #fdf6e3; color: #8a6d3b; }
      .gd-message--info { background: #e6f6fc; color: #015a7a; }
      .gd-message--danger { background: #ffe9e9; color: var(--_nw-color-error-text); }

      .gd-image { width: 100%; height: 260px; background-size: cover; background-position: center; border-radius: var(--_nw-radius-lg); margin-bottom: var(--_nw-space-4); }
      .gd-title { font-size: 28px; font-weight: 800; color: var(--_nw-color-secondary); margin: 0 0 10px; }
      .gd-badge { display: inline-block; background: var(--_nw-color-info); color: white; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: var(--_nw-space-3); }
      .gd-datetime { font-size: 16px; font-weight: 600; color: var(--_nw-color-primary); margin-bottom: var(--_nw-space-4); }
      .gd-description { font-size: 15px; line-height: 1.6; color: var(--_nw-color-text-subtle); margin-bottom: var(--_nw-space-4); }
      .gd-description img { max-width: 100%; height: auto; }

      .gd-special { margin-bottom: var(--_nw-space-4); }
      .gd-special-title { font-size: 13px; font-weight: var(--_nw-font-weight-heading); color: var(--_nw-color-secondary); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: var(--_nw-space-1); }
      .gd-special-body { font-size: 15px; color: var(--_nw-color-text-subtle); line-height: var(--_nw-line-height); }

      .gd-contacts { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: var(--_nw-space-4); }
      .gd-contact { display: flex; align-items: center; gap: var(--_nw-space-2); font-size: var(--_nw-font-size-base); }
      .gd-contact a { color: var(--_nw-color-primary); text-decoration: none; }
      .gd-contact a:hover { text-decoration: underline; }
      .gd-contact-badge { width: 36px; height: 36px; border-radius: 9999px; background: var(--_nw-color-primary); color: var(--_nw-color-on-primary); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; background-size: cover; background-position: center; }

      .gd-map { margin-bottom: var(--_nw-space-4); }
      .gd-map iframe { width: 100%; height: 280px; border: 0; border-radius: var(--_nw-radius-lg); margin-bottom: var(--_nw-space-2); }
      .gd-link { color: var(--_nw-color-primary); font-weight: 600; text-decoration: none; font-size: var(--_nw-font-size-base); }
      .gd-link:hover { text-decoration: underline; }

      .gd-form-wrap { background: var(--_nw-color-surface); border: var(--_nw-border-width) solid var(--_nw-color-border); border-radius: var(--_nw-radius-lg); padding: var(--_nw-space-5); box-shadow: var(--_nw-shadow); margin-top: var(--_nw-space-2); }
      .gd-tabs { display: flex; gap: var(--_nw-space-1); border-bottom: var(--_nw-border-width) solid var(--_nw-color-border); margin-bottom: var(--_nw-space-4); }
      .gd-tab { background: none; border: none; border-bottom: 3px solid transparent; padding: 10px 14px; font-size: var(--_nw-font-size-base); font-weight: 600; color: var(--_nw-color-muted); cursor: pointer; font-family: inherit; margin-bottom: -1px; }
      .gd-tab--active { color: var(--_nw-color-primary); border-bottom-color: var(--_nw-color-primary); }
      .gd-tab:focus-visible { outline: var(--_nw-focus-ring); outline-offset: 2px; }
      .gd-form .gd-message { margin: var(--_nw-space-1) 0 var(--_nw-space-3); }

      .gd-form { display: block; }
      .gd-field { display: flex; flex-direction: column; gap: var(--_nw-space-1); margin-bottom: var(--_nw-space-3); }
      .gd-field label { font-size: 13px; font-weight: 600; color: var(--_nw-color-muted); }
      .gd-optional { font-weight: 400; color: #9ca3af; }
      .gd-input { padding: 9px var(--_nw-space-3); border: var(--_nw-border-width) solid var(--_nw-color-border-strong); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); font-family: inherit; color: var(--_nw-color-text); background: var(--_nw-color-surface); outline: none; }
      .gd-input:focus { border-color: var(--_nw-color-primary); box-shadow: 0 0 0 1px var(--_nw-color-primary); }
      textarea.gd-input { resize: vertical; }
      .gd-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--_nw-space-3); }

      .gd-actions { margin-top: var(--_nw-space-1); }
      .gd-btn { padding: 10px 18px; border-radius: var(--_nw-button-radius); font-size: var(--_nw-font-size-base); font-weight: 600; cursor: pointer; font-family: inherit; border: none; }
      .gd-btn--primary { background: var(--_nw-button-bg); color: var(--_nw-button-fg); }
      .gd-btn--primary:hover { background: var(--_nw-button-bg-hover); }
      .gd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .gd-login-panel { text-align: center; padding: var(--_nw-space-3); }
      .gd-login-panel p { margin: 0 0 var(--_nw-space-3); font-size: 15px; }

      .gd-state { display: flex; align-items: center; justify-content: center; gap: var(--_nw-space-3); padding: 48px var(--_nw-space-4); color: var(--_nw-color-muted); font-size: 15px; }
      .gd-error { flex-direction: column; }
      .gd-error p { color: var(--_nw-color-error-text); }
      .gd-spinner { animation: gd-spin 1s linear infinite; color: var(--_nw-color-primary); }
      @keyframes gd-spin { to { transform: rotate(360deg); } }

      @media (max-width: 640px) {
        .gd-grid2 { grid-template-columns: 1fr; }
        .gd-image { height: 180px; }
        .gd-title { font-size: 22px; }
      }
    `;
  }
}

customElements.define("next-group-details", GroupDetailsWidget);
