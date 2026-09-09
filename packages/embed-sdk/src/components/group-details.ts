import { MPNextWidget } from "../shared/base-widget";
import { parseWallClock } from "../i18n";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
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
 * Simplifications relative to legacy (noted inline):
 *  - Optional inquiry/sign-up confirmation + leader-notification emails are not
 *    sent in v1; the Group_Inquiries / Group_Participants records are still
 *    created. The *-email-template attributes are accepted but currently no-op.
 *  - Sign-up uses a household-member contact (no anonymous "Blank Form" sign-up,
 *    which the backend cannot attribute to a participant).
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
    ];
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (name === "group-id" && this.group) this.init();
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it queries the API.
    void this.initLocale().then(() => {
      this.render();
      this.init();
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
      this.attachListeners();
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
      this.attachListeners();
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

    if (!validateForm(form).valid) {
      this.setMessage("danger", this.t("validation.formIncomplete"));
      return;
    }

    const fd = new FormData(form);
    const contactRaw = String(fd.get("contactId") || "").trim();
    const contactId = contactRaw && contactRaw !== "blank" ? Number(contactRaw) : null;

    if (tab === "signup" && (contactId == null || contactId <= 0)) {
      this.setMessage("danger", this.t("groupDetails.chooseSignup"));
      return;
    }

    const payload = {
      targetId: this.group.id,
      contactId,
      firstName: String(fd.get("firstName") || "").trim() || null,
      lastName: String(fd.get("lastName") || "").trim() || null,
      emailAddress: String(fd.get("emailAddress") || "").trim() || null,
      mobilePhoneNumber: String(fd.get("mobilePhoneNumber") || "").trim() || null,
      message: String(fd.get("message") || "").trim() || null,
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
      const data: { success: boolean; message?: string } = await res
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
      if (tab === "inquire") {
        this.emit("inquirySubmitted", { groupId: this.group.id });
        this.setMessage(
          "success",
          who
            ? this.t("groupDetails.inquirySentNamed", { name: who })
            : this.t("groupDetails.inquirySent")
        );
      } else {
        this.emit("signupSubmitted", { groupId: this.group.id });
        this.setMessage(
          "success",
          who
            ? this.t("groupDetails.signedUpNamed", { name: who })
            : this.t("groupDetails.signedUp")
        );
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

  private displayNameFor(tab: Tab, payload: { firstName: string | null; lastName: string | null }): string {
    const id = tab === "inquire" ? this.inquireContactId : this.signupContactId;
    if (id && id !== "blank") {
      const member = this.contact?.members.find((m) => String(m.contactId) === id);
      if (member) return member.displayName.replace(/,/g, "");
    }
    return [payload.firstName, payload.lastName].filter(Boolean).join(" ");
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
      this.attachListeners();
    }
  }

  // ── Listeners ──

  private attachListeners() {
    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.requestLogin("group-details"));

    // Tab switching.
    this.root.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        const tab = el.getAttribute("data-tab") as Tab;
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.message = null;
          this.render();
          this.attachListeners();
        }
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
        const id = signupAs.value ? Number(signupAs.value) : null;
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

    const inquireForm = this.root.querySelector<HTMLFormElement>("#gd-inquire-form");
    if (inquireForm) bindLiveValidation(inquireForm);
    const signupForm = this.root.querySelector<HTMLFormElement>("#gd-signup-form");
    if (signupForm) bindLiveValidation(signupForm);
  }

  /** Show/hide the blank-form fields for the inquiry form based on the dropdown. */
  private toggleBlankFields(tab: Tab) {
    const blank = this.root.querySelector<HTMLElement>(
      tab === "inquire" ? "#gd-inquire-blank" : "#gd-signup-blank"
    );
    if (!blank) return;
    const id = tab === "inquire" ? this.inquireContactId : this.signupContactId;
    const showBlank = !id || id === "blank";
    blank.style.display = showBlank ? "" : "none";
    blank.querySelectorAll<HTMLInputElement>("input[data-required]").forEach((input) => {
      if (showBlank) input.setAttribute("required", "");
      else input.removeAttribute("required");
    });
  }

  // ── Render ──

  render() {
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
        ${this.renderMessage()}
        ${this.renderDetails()}
        ${this.renderForms()}
      </div>`;
  }

  private renderBackLink(): string {
    if (!this.returnUrl) return "";
    return `<div class="gd-back"><a href="${this.escapeAttr(this.returnUrl)}">&larr; ${this.escapeHtml(this.t("groupDetails.backToGroups"))}</a></div>`;
  }

  private renderMessage(): string {
    if (!this.message) return `<div id="gd-message" class="gd-message" style="display:none"></div>`;
    return `<div id="gd-message" class="gd-message gd-message--${this.escapeAttr(this.message.type)}">${this.escapeHtml(this.message.text)}</div>`;
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

    const tabs: string[] = [];
    if (showInquire) {
      tabs.push(
        `<button type="button" class="gd-tab ${this.activeTab === "inquire" ? "gd-tab--active" : ""}" data-tab="inquire">${this.escapeHtml(this.t("groupDetails.contactTab"))}</button>`
      );
    }
    if (showSignup) {
      tabs.push(
        `<button type="button" class="gd-tab ${this.activeTab === "signup" ? "gd-tab--active" : ""}" data-tab="signup">${this.escapeHtml(this.t("groupDetails.signupTab"))}</button>`
      );
    }

    const body = this.activeTab === "inquire" ? this.renderInquireForm() : this.renderSignupForm();

    return `
      <div class="gd-form-wrap">
        <div class="gd-tabs">${tabs.join("")}</div>
        <div class="gd-tab-body">${body}</div>
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
          ${this.renderBlankFields(showBlank)}
        </div>
        <div class="gd-field">
          <label for="gd-inquire-message">${this.escapeHtml(this.t("fields.message"))}</label>
          <textarea id="gd-inquire-message" class="gd-input" name="message" maxlength="500" rows="4"></textarea>
        </div>
        <div class="gd-actions">
          <button type="button" class="gd-btn gd-btn--primary gd-submit" data-tab="inquire">${this.escapeHtml(this.t("groupDetails.sendMessage"))}</button>
        </div>
      </form>`;
  }

  private renderSignupForm(): string {
    if (!this.isAuthenticated) {
      return `
        <div class="gd-login-panel">
          <p>${this.escapeHtml(this.t("groupDetails.signInToSignUp"))}</p>
          <button class="gd-btn gd-btn--primary" type="button" data-action="login">${this.escapeHtml(this.t("common.signIn"))}</button>
        </div>`;
    }
    return `
      <div id="gd-signup-warning" class="gd-message gd-message--info" style="display:${this.signupWarning ? "" : "none"}">
        ${this.escapeHtml(this.t("groupDetails.alreadySignedUp"))}
      </div>
      <form id="gd-signup-form" class="gd-form" novalidate>
        ${this.renderAsPicker("signup")}
        <div class="gd-field">
          <label for="gd-signup-message">${this.escapeHtml(this.t("fields.message"))} <span class="gd-optional">(${this.escapeHtml(this.t("common.optional"))})</span></label>
          <textarea id="gd-signup-message" class="gd-input" name="message" maxlength="500" rows="3"></textarea>
        </div>
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
    // Inquiry permits an anonymous "Blank Form"; sign-up always needs a contact.
    const blankOpt =
      tab === "inquire"
        ? `<option value="blank" ${selected === "blank" ? "selected" : ""}>${this.escapeHtml(this.t("groupDetails.someoneElse"))}</option>`
        : "";
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

  private renderBlankFields(required: boolean): string {
    const req = required ? "required" : "";
    return `
      <div class="gd-grid2">
        <div class="gd-field"><label>${this.escapeHtml(this.t("fields.firstName"))}${requiredStar()}</label><input class="gd-input" name="firstName" data-required ${req}></div>
        <div class="gd-field"><label>${this.escapeHtml(this.t("fields.lastName"))}${requiredStar()}</label><input class="gd-input" name="lastName" data-required ${req}></div>
      </div>
      <div class="gd-grid2">
        <div class="gd-field"><label>${this.escapeHtml(this.t("fields.email"))}${requiredStar()}</label><input class="gd-input" type="email" name="emailAddress" data-required ${req}></div>
        <div class="gd-field"><label>${this.escapeHtml(this.t("fields.mobilePhone"))}</label><input class="gd-input" type="tel" name="mobilePhoneNumber"></div>
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
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .gd { max-width: 880px; margin: 0 auto; }

      .gd-back { margin-bottom: 12px; }
      .gd-back a { color: #004C97; text-decoration: none; font-weight: 600; font-size: 14px; cursor: pointer; }
      .gd-back a:hover { text-decoration: underline; }

      .gd-message { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
      .gd-message--success { background: #ecf6e0; color: #4d6b1f; }
      .gd-message--warning { background: #fdf6e3; color: #8a6d3b; }
      .gd-message--info { background: #e6f6fc; color: #015a7a; }
      .gd-message--danger { background: #ffe9e9; color: #b91c1c; }

      .gd-image { width: 100%; height: 260px; background-size: cover; background-position: center; border-radius: 12px; margin-bottom: 16px; }
      .gd-title { font-size: 28px; font-weight: 800; color: #002855; margin: 0 0 10px; }
      .gd-badge { display: inline-block; background: #009CDE; color: white; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 12px; }
      .gd-datetime { font-size: 16px; font-weight: 600; color: #004C97; margin-bottom: 16px; }
      .gd-description { font-size: 15px; line-height: 1.6; color: #474747; margin-bottom: 16px; }
      .gd-description img { max-width: 100%; height: auto; }

      .gd-special { margin-bottom: 16px; }
      .gd-special-title { font-size: 13px; font-weight: 700; color: #002855; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px; }
      .gd-special-body { font-size: 15px; color: #474747; line-height: 1.5; }

      .gd-contacts { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 16px; }
      .gd-contact { display: flex; align-items: center; gap: 8px; font-size: 14px; }
      .gd-contact a { color: #004C97; text-decoration: none; }
      .gd-contact a:hover { text-decoration: underline; }
      .gd-contact-badge { width: 36px; height: 36px; border-radius: 9999px; background: #004C97; color: white; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; background-size: cover; background-position: center; }

      .gd-map { margin-bottom: 16px; }
      .gd-map iframe { width: 100%; height: 280px; border: 0; border-radius: 12px; margin-bottom: 8px; }
      .gd-link { color: #004C97; font-weight: 600; text-decoration: none; font-size: 14px; }
      .gd-link:hover { text-decoration: underline; }

      .gd-form-wrap { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); margin-top: 8px; }
      .gd-tabs { display: flex; gap: 4px; border-bottom: 1px solid #e5e7eb; margin-bottom: 16px; }
      .gd-tab { background: none; border: none; border-bottom: 3px solid transparent; padding: 10px 14px; font-size: 14px; font-weight: 600; color: #6b7280; cursor: pointer; font-family: inherit; margin-bottom: -1px; }
      .gd-tab--active { color: #004C97; border-bottom-color: #004C97; }

      .gd-form { display: block; }
      .gd-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .gd-field label { font-size: 13px; font-weight: 600; color: #6b7280; }
      .gd-optional { font-weight: 400; color: #9ca3af; }
      .gd-input { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; }
      .gd-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      textarea.gd-input { resize: vertical; }
      .gd-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .gd-actions { margin-top: 4px; }
      .gd-btn { padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; border: none; }
      .gd-btn--primary { background: #004C97; color: white; }
      .gd-btn--primary:hover { background: #002855; }
      .gd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .gd-login-panel { text-align: center; padding: 12px; }
      .gd-login-panel p { margin: 0 0 12px; font-size: 15px; }

      .gd-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; font-size: 15px; }
      .gd-error { flex-direction: column; }
      .gd-error p { color: #b91c1c; }
      .gd-spinner { animation: gd-spin 1s linear infinite; color: #004C97; }
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
