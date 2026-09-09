import { MPNextWidget } from "../shared/base-widget";
import {
  renderCustomFormFields,
  bindCustomFormDependsOn,
  CUSTOM_FORM_STYLES,
  type CustomFormField,
} from "../shared/custom-form";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";
import {
  loadGoogleMaps,
  attachAddressAutocomplete,
} from "../shared/google-places";

interface CustomFormHeader {
  formId: number;
  formGuid: string | null;
  title: string | null;
  instructions: string | null;
  completeMessage: string | null;
  getContactInfo: boolean;
  getAddressInfo: boolean;
  forceLogin: boolean;
  productId: number | null;
  standaloneOnly: boolean;
  isExpired: boolean;
  imageUrl: string | null;
  googleMapsApiKey: string | null;
}

/** Subset of the basic-contact response used to prefill the form for signed-in users. */
interface PrefillContact {
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateRegion?: string | null;
  postalCode?: string | null;
}

/**
 * `next-custom-form` — standalone MinistryPlatform custom form.
 *
 * Renders a form's fields (via the shared custom-form module that
 * `next-event-details` also uses) plus optional contact/address blocks, and
 * submits a Form_Response. Ported from the legacy `mpp-custom-form`.
 *
 * Note: forms with a Product_ID (paid forms → checkout) collect + save the
 * response here; the checkout hand-off is handled by the checkout widget.
 */
export class CustomFormWidget extends MPNextWidget {
  private header: CustomFormHeader | null = null;
  private fields: CustomFormField[] = [];
  private loading = true;
  private error: string | null = null;
  private submitted = false;
  private isAuthenticated = false;
  private contact: PrefillContact | null = null;

  static get observedAttributes() {
    return ["api-host", "form-id", "form-guid", "id-parameter-name", "checkout-url"];
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if ((name === "form-id" || name === "form-guid") && !this.loading) {
      this.init();
    }
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + CUSTOM_FORM_STYLES + FORM_VALIDATION_STYLES);
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it fetches the form definition.
    void this.initLocale().then(() => {
      this.render();
      this.init();
    });
  }

  public retryLoad() {
    this.error = null;
    this.init();
  }

  private resolveFormRef(): { formId?: string; formGuid?: string } {
    const formId = this.getAttribute("form-id");
    if (formId) return { formId };
    const formGuid = this.getAttribute("form-guid");
    if (formGuid) return { formGuid };
    // Fall back to the URL query param (legacy default "id").
    try {
      const idParam = this.getAttribute("id-parameter-name") || "id";
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get(idParam) || params.get("id");
      if (fromUrl) {
        // GUIDs contain hyphens; numeric ids do not.
        return /\D/.test(fromUrl) ? { formGuid: fromUrl } : { formId: fromUrl };
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  private async init() {
    this.loading = true;
    this.error = null;
    this.submitted = false;
    this.render();

    const ref = this.resolveFormRef();
    if (!ref.formId && !ref.formGuid) {
      this.error = this.t("customForm.noFormSpecified");
      this.loading = false;
      this.render();
      this.attachListeners();
      this.emit("formError", { error: this.error });
      return;
    }

    try {
      const params = new URLSearchParams(ref as Record<string, string>);
      const res = await this.fetch(`/api/embed/custom-form?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(this.errorText(body, "errors.form_not_found"));
      }
      const data: { header: CustomFormHeader; fields: CustomFormField[] } = await res.json();
      this.header = data.header;
      this.fields = data.fields || [];
      await this.detectAuth();
      this.emit("formLoaded", { formId: this.header.formId });
    } catch (err) {
      // `errorText` has already produced a translated sentence; a thrown
      // non-Error (a dropped connection) becomes the generic network message
      // rather than leaking English.
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.emit("formError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
      this.prefillContact();
    }
  }

  private async detectAuth() {
    // Reuse the shared basic-contact endpoint to know auth state AND prefill the
    // signed-in contact's info. The form works anonymously, so failures are non-fatal.
    try {
      const res = await this.fetch(`/api/embed/event-details/basic-contact`);
      this.isAuthenticated = res.ok;
      if (res.ok) {
        const data: { contact?: PrefillContact } = await res.json().catch(() => ({}));
        this.contact = data.contact ?? null;
      } else {
        this.contact = null;
      }
    } catch {
      this.isAuthenticated = false;
      this.contact = null;
    }
  }

  /**
   * Prefill the contact/address inputs from the signed-in contact. Only fills
   * empty fields, so it never clobbers anything the user has already typed.
   */
  private prefillContact() {
    if (!this.contact) return;
    const map: Record<string, string | null | undefined> = {
      FirstName: this.contact.firstName,
      LastName: this.contact.lastName,
      EmailAddress: this.contact.emailAddress,
      MobilePhoneNumber: this.contact.mobilePhoneNumber,
      AddressLine1: this.contact.addressLine1,
      AddressLine2: this.contact.addressLine2,
      City: this.contact.city,
      StateRegion: this.contact.stateRegion,
      PostalCode: this.contact.postalCode,
    };
    for (const [name, value] of Object.entries(map)) {
      if (!value) continue;
      const input = this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input && !input.value) input.value = value;
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  private async submit() {
    const form = this.root.querySelector<HTMLFormElement>("#cf-form");
    if (!form || !this.header) return;
    if (!validateForm(form).valid) return;

    const fd = new FormData(form);
    const payload: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v === "string") payload[k] = v;
    }
    payload.mp_customformformid = String(this.header.formId);

    this.setSubmitDisabled(true);
    try {
      const res = await this.fetch(`/api/embed/custom-form/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: { success: boolean; message?: string } = await res
        .json()
        .catch(() => ({ success: false }));
      if (!data.success) {
        // The route's `message` is English and debug-only, so render the
        // translated sentence instead.
        const msg = this.errorText(data, "errors.submitFailed");
        this.error = msg;
        this.emit("formError", { error: msg });
        this.setSubmitDisabled(false);
        this.render();
        this.attachListeners();
        return;
      }
      this.submitted = true;
      this.emit("formSubmitted", { formId: this.header.formId });
      this.render();
      this.attachListeners();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : this.t("errors.submitFailed");
      this.error = msg;
      this.emit("formError", { error: msg });
      this.setSubmitDisabled(false);
    }
  }

  private setSubmitDisabled(disabled: boolean) {
    const btn = this.root.querySelector<HTMLButtonElement>(".cf-submit");
    if (btn) btn.disabled = disabled;
  }

  // ── Listeners ─────────────────────────────────────────────────────────

  private attachListeners() {
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener("click", () => this.retryLoad());

    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.requestLogin("custom-form"));

    const submit = this.root.querySelector(".cf-submit");
    if (submit) {
      submit.addEventListener("click", (e) => {
        e.preventDefault();
        this.submit();
      });
    }

    const form = this.root.querySelector<HTMLFormElement>("#cf-form");
    if (form) {
      bindCustomFormDependsOn(form, this.fields);
      bindLiveValidation(form);
      this.initGooglePlaces();
    }
  }

  /**
   * Wire Google Places autocomplete onto the address block. No-op unless the
   * form collects an address and the tenant has a Google Maps key configured.
   * Fills only Line 1/City/State/Postal — the fields the submit endpoint
   * persists (Form_Responses has no country column).
   */
  private async initGooglePlaces() {
    const key = this.header?.googleMapsApiKey;
    if (!this.header?.getAddressInfo || !key || key.trim() === "") return;

    const line1 = this.root.querySelector<HTMLInputElement>("#cf-line1");
    if (!line1) return;

    let loaded = false;
    try {
      loaded = await loadGoogleMaps(key);
    } catch {
      loaded = false;
    }
    if (!loaded) return;
    // Form may have been torn down (re-render) while the script loaded.
    if (!line1.isConnected) return;

    attachAddressAutocomplete(line1, (addr) => {
      const setVal = (id: string, value: string) => {
        const el = this.root.querySelector<HTMLInputElement>(`#${id}`);
        if (el && value) {
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };
      setVal("cf-line1", addr.line1);
      setVal("cf-city", addr.city);
      setVal("cf-state", addr.state);
      setVal("cf-postal", addr.postalCode);
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────

  render() {
    if (this.loading) {
      this.root.innerHTML = `<div class="cf">${this.stateRow(this.spinner(), this.t("customForm.loading"))}</div>`;
      return;
    }
    if (this.error && !this.header) {
      this.root.innerHTML = `
        <div class="cf">
          <div class="cf-state cf-error"><p>${this.escapeHtml(this.error)}</p>
            <button class="cf-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button></div>
        </div>`;
      return;
    }

    const h = this.header!;
    if (h.isExpired) {
      this.root.innerHTML = `<div class="cf"><div class="cf-card"><p class="cf-expired">${this.escapeHtml(this.t("customForm.expired"))}</p></div></div>`;
      return;
    }
    if (this.submitted) {
      // `completeMessage` is MP-authored copy from the church's own form
      // definition, so it renders as written; only the fallback is translated.
      const msg = h.completeMessage || this.t("customForm.completed");
      this.root.innerHTML = `<div class="cf"><div class="cf-card"><div class="cf-complete">${this.escapeHtml(msg)}</div></div></div>`;
      return;
    }
    if (h.forceLogin && !this.isAuthenticated) {
      this.root.innerHTML = `
        <div class="cf"><div class="cf-card cf-login">
          <p>${this.escapeHtml(this.t("customForm.signInToComplete"))}</p>
          <button class="cf-btn cf-btn--primary" type="button" data-action="login">${this.escapeHtml(this.t("common.signIn"))}</button>
        </div></div>`;
      return;
    }

    const img = h.imageUrl
      ? `<div class="cf-image" style="background-image:url('${this.escapeAttr(h.imageUrl)}')"></div>`
      : "";
    const instructions = h.instructions
      ? `<div class="cf-instructions-block">${this.sanitize(h.instructions)}</div>`
      : "";
    const errorBanner = this.error
      ? `<div class="cf-message cf-message--danger">${this.escapeHtml(this.error)}</div>`
      : "";

    this.root.innerHTML = `
      <div class="cf">
        <div class="cf-card">
          ${img}
          ${h.title ? `<h1 class="cf-title">${this.escapeHtml(h.title)}</h1>` : ""}
          ${instructions}
          ${errorBanner}
          <form id="cf-form" class="cf-form" novalidate>
            ${h.getContactInfo ? this.renderContactBlock() : ""}
            ${h.getAddressInfo ? this.renderAddressBlock() : ""}
            ${renderCustomFormFields(this.fields, { formId: h.formId, t: this.t })}
            <div class="cf-actions">
              <button class="cf-btn cf-btn--primary cf-submit" type="button">${this.escapeHtml(this.t("common.submit"))}</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  private renderContactBlock(): string {
    return `
      <fieldset class="cf-fieldset">
        <legend>${this.escapeHtml(this.t("customForm.yourInformation"))}</legend>
        <div class="cf-grid2">
          <div class="cf-field"><label>${this.escapeHtml(this.t("fields.firstName"))}${requiredStar()}</label><input class="cf-input" name="FirstName" required></div>
          <div class="cf-field"><label>${this.escapeHtml(this.t("fields.lastName"))}${requiredStar()}</label><input class="cf-input" name="LastName" required></div>
        </div>
        <div class="cf-grid2">
          <div class="cf-field"><label>${this.escapeHtml(this.t("fields.email"))}${requiredStar()}</label><input class="cf-input" type="email" name="EmailAddress" required></div>
          <div class="cf-field"><label>${this.escapeHtml(this.t("fields.mobilePhone"))}</label><input class="cf-input" name="MobilePhoneNumber"></div>
        </div>
      </fieldset>`;
  }

  private renderAddressBlock(): string {
    return `
      <fieldset class="cf-fieldset">
        <legend>${this.escapeHtml(this.t("fields.address"))}</legend>
        <div class="cf-field"><label>${this.escapeHtml(this.t("fields.addressLine1"))}${requiredStar()}</label><input class="cf-input" id="cf-line1" name="AddressLine1" autocomplete="off" required></div>
        <div class="cf-field"><label>${this.escapeHtml(this.t("fields.addressLine2"))}</label><input class="cf-input" id="cf-line2" name="AddressLine2" autocomplete="off"></div>
        <div class="cf-grid3">
          <div class="cf-field"><label>${this.escapeHtml(this.t("fields.city"))}${requiredStar()}</label><input class="cf-input" id="cf-city" name="City" autocomplete="off" required></div>
          <div class="cf-field"><label>${this.escapeHtml(this.t("fields.stateRegion"))}${requiredStar()}</label><input class="cf-input" id="cf-state" name="StateRegion" autocomplete="off" required></div>
          <div class="cf-field"><label>${this.escapeHtml(this.t("fields.postalCode"))}${requiredStar()}</label><input class="cf-input" id="cf-postal" name="PostalCode" autocomplete="off" required></div>
        </div>
      </fieldset>`;
  }

  private stateRow(icon: string, text: string): string {
    return `<div class="cf-state">${icon}<span>${this.escapeHtml(text)}</span></div>`;
  }

  private spinner(): string {
    return `<svg class="cf-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text ?? "";
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private sanitize(html: string): string {
    const t = document.createElement("template");
    t.innerHTML = html;
    t.content.querySelectorAll("script,style,iframe,object,embed").forEach((n) => n.remove());
    t.content.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
      }
    });
    return t.innerHTML;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .cf { max-width: 720px; margin: 0 auto; }
      .cf-card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .cf-image { width: 100%; height: 200px; background-size: cover; background-position: center; border-radius: 12px; margin-bottom: 16px; }
      .cf-title { font-size: 24px; font-weight: 800; color: #002855; margin: 0 0 12px; }
      .cf-instructions-block { font-size: 15px; line-height: 1.6; color: #474747; margin-bottom: 16px; }
      .cf-form { display: block; }
      .cf-fieldset { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px 4px; margin: 0 0 16px; }
      .cf-fieldset legend { font-size: 13px; font-weight: 700; color: #002855; padding: 0 6px; }
      .cf-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .cf-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
      .cf-actions { margin-top: 16px; }
      .cf-btn { padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; border: none; }
      .cf-btn--primary { background: #004C97; color: white; }
      .cf-btn--primary:hover { background: #002855; }
      .cf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .cf-message { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
      .cf-message--danger { background: #ffe9e9; color: #b91c1c; }
      .cf-complete { font-size: 16px; line-height: 1.6; color: #2D6B1F; }
      .cf-expired { color: #8a6d3b; font-size: 15px; margin: 0; }
      .cf-login { text-align: center; }
      .cf-login p { margin: 0 0 12px; }
      .cf-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; flex-direction: column; }
      .cf-error p { color: #b91c1c; }
      .cf-spinner { animation: cf-spin 1s linear infinite; color: #004C97; }
      @keyframes cf-spin { to { transform: rotate(360deg); } }
      @media (max-width: 640px) { .cf-grid2, .cf-grid3 { grid-template-columns: 1fr; } }
    `;
  }
}

customElements.define("next-custom-form", CustomFormWidget);
