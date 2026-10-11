import { MPNextWidget, WidgetError, SIGN_IN_REQUIRED_STYLES } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";
import {
  loadGoogleMaps,
  attachAddressAutocomplete,
  type ParsedAddress,
} from "../shared/google-places";

interface LookupOption {
  id: number;
  label: string;
}

interface CountryOption {
  code: string;
  name: string;
}

interface HouseholdAddress {
  addressId: number | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  country: string | null;
  countryCode: string | null;
}

interface Household {
  householdId: number;
  name: string | null;
  homePhone: string | null;
  congregationId: number | null;
  congregationName: string | null;
  address: HouseholdAddress | null;
  alternativeAddress: HouseholdAddress | null;
  alternativeAddressStart: string | null;
  alternativeAddressEnd: string | null;
  alternativeAddressRepeatAnnually: boolean;
  homePhoneUnlisted: boolean;
  homeAddressUnlisted: boolean;
}

interface HouseholdMember {
  contactId: number;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  displayName: string | null;
  nickName: string | null;
  prefixId: number | null;
  suffixId: number | null;
  suffixName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
  workPhoneNumber: string | null;
  homePhoneNumber: string | null;
  householdId: number | null;
  householdPositionId: number | null;
  householdPositionName: string | null;
  dateOfBirth: string | null;
  genderId: number | null;
  maritalStatusId: number | null;
  bulkEmailOptOut: boolean;
  emailUnlisted: boolean;
  doNotText: boolean;
  mobilePhoneUnlisted: boolean;
  removeFromDirectory: boolean;
  congregationId: number | null;
  imageUrl: string | null;
}

interface HouseholdLookups {
  prefixes: LookupOption[];
  suffixes: LookupOption[];
  genders: LookupOption[];
  maritalStatuses: LookupOption[];
  householdPositions: LookupOption[];
  congregations: LookupOption[];
  countries: CountryOption[];
}

interface HouseholdData {
  household: Household | null;
  members: HouseholdMember[];
  isHeadOfHousehold: boolean;
  lookups: HouseholdLookups;
  googleMapsApiKey: string | null;
}

type View = "details" | "household-form" | "member-form";

type AlertKind = "success" | "error" | "warning";
interface AlertMsg {
  kind: AlertKind;
  text: string;
}

export class MyHouseholdWidget extends MPNextWidget {
  private data: HouseholdData | null = null;
  private loading = true;
  /** Signed out: a prompt with Sign In, never the Try Again error state (C53). */
  private needsAuth = false;
  private error: string | null = null;
  private view: View = "details";
  private editingMember: HouseholdMember | null = null;
  private saving = false;
  private householdAlert: AlertMsg | null = null;
  private memberAlert: AlertMsg | null = null;
  private photoFile: File | null = null;
  private photoPreviewUrl: string | null = null;

  /** C79: kebab-case name; legacy `hideaddhouseholdmember` is read for one release. */
  static readonly attributeAliases = {
    "hide-add-household-member": "hideaddhouseholdmember",
  };

  static get observedAttributes() {
    return ["hide-add-household-member", ...Object.values(this.attributeAliases)];
  }

  private get hideAddMember(): boolean {
    return (this.readAttr("hide-add-household-member") || "").toLowerCase() === "true";
  }

  /**
   * C39: a late `hide-add-household-member` must take effect. The attribute
   * only changes what is drawn, so a loaded household is re-rendered rather than
   * re-fetched; an open edit form is left alone (re-rendering it would discard
   * what the visitor typed) and the details view picks the change up on return.
   * With nothing loaded yet (a failed first load), it loads.
   */
  protected override reload(): void {
    if (!this.data) {
      this.loadHousehold();
      return;
    }
    if (this.view !== "details") return;
    this.render(); // render() re-binds its own listeners
  }

  /**
   * Shared validation options: this widget wraps every input in `.nw-field`.
   * Per-instance rather than static so the built-in constraint messages come
   * from *this* element's locale.
   */
  private validationOpts() {
    return { wrapperSelector: ".nw-field", t: this.t } as const;
  }

  connectedCallback() {
    // The shared sign-in sheet goes first so this widget's own button classes win.
    this.injectStyles(SIGN_IN_REQUIRED_STYLES + this.getStyles() + FORM_VALIDATION_STYLES);
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget paints anyway while it queries the API.
    void this.initLocale().then(() => {
      this.render();
      this.painted = true;
      this.loadHousehold();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
  }

  public retryLoad() {
    this.error = null;
    this.view = "details";
    this.loadHousehold();
  }

  private async loadHousehold() {
    this.loading = true;
    this.needsAuth = false;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch("/api/embed/household");
      if (this.isNeedsAuth(res)) {
        this.loading = false;
        this.needsAuth = true;
        this.render();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new WidgetError(this.errorText(body));
      }
      const data: HouseholdData = await res.json();
      this.data = data;
      this.loading = false;
      this.render(); // render() re-binds its own listeners
      this.emit("householdLoaded", { memberCount: data.members?.length ?? 0 });
    } catch (err) {
      this.loading = false;
      // `errorText` has already translated an API code; anything else (a
      // dropped connection) becomes the generic network message.
      this.error =
        this.caughtText(err, "errors.network");
      this.render(); // render() re-binds its own listeners
      this.emit("householdError", { error: this.error });
    }
  }

  // ---------------------------------------------------------------------------
  // Date helpers — parse YYYY-MM-DD defensively (no timezone day-shift).
  // ---------------------------------------------------------------------------
  private parseYmd(
    value: string | null,
  ): { y: number; m: number; d: number } | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return {
      y: parseInt(match[1], 10),
      m: parseInt(match[2], 10),
      d: parseInt(match[3], 10),
    };
  }

  private ymdToInputValue(value: string | null): string {
    const p = this.parseYmd(value);
    if (!p) return "";
    return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(
      2,
      "0",
    )}-${String(p.d).padStart(2, "0")}`;
  }

  /**
   * Mirror legacy validity logic for the alternative/seasonal address:
   * show it when it is currently active or upcoming. If repeatAnnually, the
   * year is ignored (always potentially valid). Otherwise it must not be
   * entirely in the past.
   */
  private isAltAddressCurrentlyValid(h: Household): boolean {
    if (!h.alternativeAddress) return false;
    if (h.alternativeAddressRepeatAnnually) return true;

    const end = this.parseYmd(h.alternativeAddressEnd);
    if (!end) {
      // No end date — treat as ongoing if a start exists or address present.
      return true;
    }
    const now = new Date();
    const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    // Valid when end date is today or in the future.
    if (end.y !== today.y) return end.y > today.y;
    if (end.m !== today.m) return end.m > today.m;
    return end.d >= today.d;
  }

  private formatAltDateRange(h: Household): string {
    if (h.alternativeAddressRepeatAnnually) {
      // The year is meaningless for a range that recurs, so month and day only.
      const s = this.fmt.date(h.alternativeAddressStart, "monthDay");
      const e = this.fmt.date(h.alternativeAddressEnd, "monthDay");
      if (s && e)
        return this.t("myHousehold.seasonRangeAnnual", { start: s, end: e });
      if (s) return this.t("myHousehold.seasonStartAnnual", { start: s });
      return "";
    }
    const s = this.fmt.date(h.alternativeAddressStart, "numeric");
    const e = this.fmt.date(h.alternativeAddressEnd, "numeric");
    if (s && e) return `${s} – ${e}`;
    if (s) return this.t("myHousehold.seasonFrom", { date: s });
    if (e) return this.t("myHousehold.seasonUntil", { date: e });
    return "";
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  render() {
    const title = this.escapeHtml(this.t("myHousehold.title"));

    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-household">
          <div class="header"><div class="title">${title}</div></div>
          <div class="body">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>${this.escapeHtml(this.t("myHousehold.loading"))}</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.needsAuth) {
      this.root.innerHTML = `
        <div class="nw-household">
          <div class="header"><div class="title">${title}</div></div>
          <div class="body">${this.renderSignInRequired({
            subject: "my-household",
            message: this.t("myHousehold.signInPrompt"),
            buttonClass: "nw-btn nw-btn-primary",
          })}</div>
        </div>`;
      return;
    }

    if (this.error && !this.data) {
      this.root.innerHTML = `
        <div class="nw-household">
          <div class="header"><div class="title">${title}</div></div>
          <div class="body">
            <div class="error-box">
              <p>${this.escapeHtml(this.error)}</p>
              <button class="nw-btn nw-btn-primary" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>
            </div>
          </div>
        </div>`;
      this.attachListeners();
      return;
    }

    if (!this.data) return;

    if (!this.data.household) {
      this.root.innerHTML = `
        <div class="nw-household">
          <div class="header"><div class="title">${title}</div></div>
          <div class="body">
            <div class="empty-state">${this.escapeHtml(this.t("myHousehold.empty"))}</div>
          </div>
        </div>`;
      this.attachListeners();
      return;
    }

    if (this.view === "household-form") {
      this.root.innerHTML = this.renderHouseholdForm();
    } else if (this.view === "member-form") {
      this.root.innerHTML = this.renderMemberForm();
    } else {
      this.root.innerHTML = this.renderDetails();
    }
    this.attachListeners();
  }

  private renderAlert(a: AlertMsg | null): string {
    if (!a) return "";
    return `<div class="nw-toast nw-toast-${a.kind}">${this.escapeHtml(
      a.text,
    )}</div>`;
  }

  private renderAddressBlock(addr: HouseholdAddress | null): string {
    const empty = `<div class="addr-empty">${this.escapeHtml(
      this.t("myHousehold.noAddress"),
    )}</div>`;
    if (!addr) return empty;
    const lines: string[] = [];
    if (addr.country) lines.push(this.escapeHtml(addr.country));
    if (addr.addressLine1) lines.push(this.escapeHtml(addr.addressLine1));
    if (addr.addressLine2) lines.push(this.escapeHtml(addr.addressLine2));
    const cityLine = [
      addr.city ? `${addr.city}` : "",
      addr.stateRegion ? `${addr.city ? ", " : ""}${addr.stateRegion}` : "",
      addr.postalCode ? ` ${addr.postalCode}` : "",
    ]
      .join("")
      .trim();
    if (cityLine) lines.push(this.escapeHtml(cityLine));
    if (lines.length === 0) return empty;
    return `<div class="addr-lines">${lines
      .map((l) => `<div>${l}</div>`)
      .join("")}</div>`;
  }

  private personSvg(): string {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" stroke-width="1.5" width="40" height="40"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }

  private renderMemberCard(m: HouseholdMember, canEdit: boolean): string {
    const name =
      m.displayName ||
      [m.firstName, m.lastName].filter(Boolean).join(" ") ||
      this.t("myHousehold.memberFallbackName");
    // Month and day only: the card celebrates a birthday, not an age.
    const dob = this.fmt.date(m.dateOfBirth, "monthDay");
    const photo = m.imageUrl
      ? `<img class="member-photo" src="${this.escapeHtml(
          m.imageUrl,
        )}" alt="${this.escapeHtml(name)}" />`
      : `<div class="member-photo member-photo-fallback">${this.personSvg()}</div>`;
    return `
      <div class="member-card">
        ${photo}
        <div class="member-name">${this.escapeHtml(name)}</div>
        ${
          m.householdPositionName
            ? `<div class="member-position">${this.escapeHtml(
                m.householdPositionName,
              )}</div>`
            : ""
        }
        ${dob ? `<div class="member-dob">${this.escapeHtml(dob)}</div>` : ""}
        ${
          canEdit
            ? `<button class="member-edit-btn" data-action="edit-member" data-contact-id="${m.contactId}">${this.escapeHtml(this.t("common.edit"))}</button>`
            : ""
        }
      </div>`;
  }

  private renderDetails(): string {
    const d = this.data!;
    const h = d.household!;
    const head = d.isHeadOfHousehold;
    const showAlt = this.isAltAddressCurrentlyValid(h);
    const altRange = showAlt ? this.formatAltDateRange(h) : "";

    const showAddMember = !this.hideAddMember && head;
    const editLabel = this.escapeHtml(this.t("myHousehold.editHousehold"));

    return `
      <div class="nw-household">
        <div class="header">
          <div class="title">${this.escapeHtml(this.t("myHousehold.title"))}</div>
        </div>
        <div class="body">
          ${this.renderAlert(this.householdAlert)}
          ${this.renderAlert(this.memberAlert)}

          <div class="section">
            <div class="section-titlebar">
              <h3 class="household-name">${this.escapeHtml(
                h.name || this.t("myHousehold.householdLabel"),
              )}</h3>
              ${
                head
                  ? `<button class="icon-btn" data-action="edit-household" title="${editLabel}" aria-label="${editLabel}">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>`
                  : ""
              }
            </div>
            ${
              h.congregationName
                ? `<div class="meta-row"><span class="meta-label">${this.escapeHtml(
                    this.t("fields.congregation"),
                  )}</span><span class="meta-value">${this.escapeHtml(
                    h.congregationName,
                  )}</span></div>`
                : ""
            }
            ${
              h.homePhone
                ? `<div class="meta-row"><span class="meta-label">${this.escapeHtml(
                    this.t("fields.homePhone"),
                  )}</span><span class="meta-value">${this.escapeHtml(
                    h.homePhone,
                  )}</span></div>`
                : ""
            }
          </div>

          <div class="address-grid">
            <div class="address-card">
              <div class="address-card-label">${this.escapeHtml(
                this.t("myHousehold.primaryAddress"),
              )}</div>
              ${this.renderAddressBlock(h.address)}
            </div>
            ${
              showAlt
                ? `<div class="address-card">
                    <div class="address-card-label">${this.escapeHtml(
                      this.t("myHousehold.seasonalAddress"),
                    )}</div>
                    ${this.renderAddressBlock(h.alternativeAddress)}
                    ${
                      altRange
                        ? `<div class="address-daterange">${this.escapeHtml(
                            altRange,
                          )}</div>`
                        : ""
                    }
                  </div>`
                : ""
            }
          </div>

          <div class="section">
            <div class="section-titlebar">
              <div class="section-label">${this.escapeHtml(this.t("myHousehold.members"))}</div>
              ${
                showAddMember
                  ? `<button class="nw-btn nw-btn-secondary" data-action="add-member">${this.escapeHtml(this.t("myHousehold.addMember"))}</button>`
                  : ""
              }
            </div>
            <div class="members-grid">
              ${d.members
                .map((m) => this.renderMemberCard(m, head))
                .join("")}
            </div>
          </div>
        </div>
      </div>`;
  }

  private selectOptions(
    options: LookupOption[],
    selectedId: number | null,
  ): string {
    return (
      `<option value="">—</option>` +
      options
        .map(
          (o) =>
            `<option value="${o.id}"${
              selectedId !== null && Number(selectedId) === o.id
                ? " selected"
                : ""
            }>${this.escapeHtml(o.label)}</option>`,
        )
        .join("")
    );
  }

  private countryOptions(
    countries: CountryOption[],
    selectedCode: string | null,
  ): string {
    return (
      `<option value="">—</option>` +
      countries
        .map(
          (c) =>
            `<option value="${this.escapeHtml(c.code)}"${
              selectedCode && selectedCode === c.code ? " selected" : ""
            }>${this.escapeHtml(c.name)}</option>`,
        )
        .join("")
    );
  }

  private renderAddressFields(
    prefix: string,
    addr: HouseholdAddress | null,
    countries: CountryOption[],
  ): string {
    const a = addr || {
      addressId: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      stateRegion: null,
      postalCode: null,
      country: null,
      countryCode: null,
    };
    return `
      <div class="nw-grid">
        <div class="nw-field nw-field-full">
          <label for="${prefix}-country">${this.escapeHtml(this.t("fields.country"))}</label>
          <select id="${prefix}-country" name="${prefix}-country">
            ${this.countryOptions(countries, a.countryCode)}
          </select>
        </div>
        <div class="nw-field nw-field-full">
          <label for="${prefix}-line1">${this.escapeHtml(this.t("fields.addressLine1"))}</label>
          <input id="${prefix}-line1" name="${prefix}-line1" type="text" value="${this.escapeHtml(
            a.addressLine1 || "",
          )}" autocomplete="off" />
        </div>
        <div class="nw-field nw-field-full">
          <label for="${prefix}-line2">${this.escapeHtml(this.t("fields.addressLine2"))}</label>
          <input id="${prefix}-line2" name="${prefix}-line2" type="text" value="${this.escapeHtml(
            a.addressLine2 || "",
          )}" autocomplete="off" />
        </div>
        <div class="nw-field">
          <label for="${prefix}-city">${this.escapeHtml(this.t("fields.city"))}</label>
          <input id="${prefix}-city" name="${prefix}-city" type="text" value="${this.escapeHtml(
            a.city || "",
          )}" autocomplete="off" />
        </div>
        <div class="nw-field">
          <label for="${prefix}-state">${this.escapeHtml(this.t("fields.stateRegion"))}</label>
          <input id="${prefix}-state" name="${prefix}-state" type="text" value="${this.escapeHtml(
            a.stateRegion || "",
          )}" autocomplete="off" />
        </div>
        <div class="nw-field">
          <label for="${prefix}-postal">${this.escapeHtml(this.t("fields.postalCode"))}</label>
          <input id="${prefix}-postal" name="${prefix}-postal" type="text" value="${this.escapeHtml(
            a.postalCode || "",
          )}" autocomplete="off" />
        </div>
      </div>`;
  }

  private renderHouseholdForm(): string {
    const d = this.data!;
    const h = d.household!;
    const l = d.lookups;
    return `
      <div class="nw-household">
        <div class="header"><div class="title">${this.escapeHtml(this.t("myHousehold.editHousehold"))}</div></div>
        <div class="body">
          ${this.renderAlert(this.householdAlert)}
          <form id="household-form" novalidate>
            <fieldset class="nw-section">
              <legend class="nw-section-label">${this.escapeHtml(this.t("myHousehold.householdLabel"))}</legend>
              <div class="nw-grid">
                <div class="nw-field nw-field-full">
                  <label for="hh-name">${this.escapeHtml(this.t("myHousehold.householdName"))}${requiredStar()}</label>
                  <input id="hh-name" name="hh-name" type="text" value="${this.escapeHtml(
                    h.name || "",
                  )}" required />
                </div>
                <div class="nw-field">
                  <label for="hh-phone">${this.escapeHtml(this.t("fields.homePhone"))}</label>
                  <input id="hh-phone" name="hh-phone" type="tel" value="${this.escapeHtml(
                    h.homePhone || "",
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="hh-congregation">${this.escapeHtml(this.t("fields.congregation"))}</label>
                  <select id="hh-congregation" name="hh-congregation">
                    ${this.selectOptions(l.congregations, h.congregationId)}
                  </select>
                </div>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">${this.escapeHtml(this.t("myHousehold.primaryAddress"))}</legend>
              ${this.renderAddressFields("primary", h.address, l.countries)}
              <div class="nw-checkrow">
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="hh-phone-unlisted" ${
                    h.homePhoneUnlisted ? "checked" : ""
                  } />
                  <span>${this.escapeHtml(this.t("myHousehold.homePhoneUnlisted"))}</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="hh-address-unlisted" ${
                    h.homeAddressUnlisted ? "checked" : ""
                  } />
                  <span>${this.escapeHtml(this.t("myHousehold.homeAddressUnlisted"))}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">${this.escapeHtml(this.t("myHousehold.seasonalAddressSection"))}</legend>
              ${this.renderAddressFields(
                "alt",
                h.alternativeAddress,
                l.countries,
              )}
              <div class="nw-grid">
                <div class="nw-field">
                  <label for="alt-start">${this.escapeHtml(this.t("myHousehold.seasonStart"))}</label>
                  <input id="alt-start" name="alt-start" type="date" value="${this.ymdToInputValue(
                    h.alternativeAddressStart,
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="alt-end">${this.escapeHtml(this.t("myHousehold.seasonEnd"))}</label>
                  <input id="alt-end" name="alt-end" type="date" value="${this.ymdToInputValue(
                    h.alternativeAddressEnd,
                  )}" />
                </div>
              </div>
              <div class="nw-checkrow">
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="alt-repeat" ${
                    h.alternativeAddressRepeatAnnually ? "checked" : ""
                  } />
                  <span>${this.escapeHtml(this.t("myHousehold.repeatAnnually"))}</span>
                </label>
              </div>
            </fieldset>

            <div class="nw-actions">
              <button type="submit" class="nw-btn nw-btn-primary" ${
                this.saving ? "disabled" : ""
              }>
                ${
                  this.saving
                    ? `<span class="nw-spinner-sm"></span> ${this.escapeHtml(this.t("common.saving"))}`
                    : this.escapeHtml(this.t("myHousehold.saveHousehold"))
                }
              </button>
              <button type="button" class="nw-btn nw-btn-text" data-action="cancel-household">${this.escapeHtml(this.t("common.cancel"))}</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  private renderMemberForm(): string {
    const d = this.data!;
    const l = d.lookups;
    const m = this.editingMember;
    const isEdit = !!m;
    const headerName = m
      ? m.displayName ||
        [m.firstName, m.lastName].filter(Boolean).join(" ") ||
        this.t("myHousehold.memberFallbackName")
      : "";
    const title = isEdit
      ? this.t("myHousehold.editMemberTitle", { name: headerName })
      : this.t("myHousehold.addMemberTitle");

    const previewSrc =
      this.photoPreviewUrl || (m && m.imageUrl ? m.imageUrl : "");
    const hasPhoto = !!previewSrc;

    return `
      <div class="nw-household">
        <div class="header"><div class="title">${this.escapeHtml(
          title,
        )}</div></div>
        <div class="body">
          ${this.renderAlert(this.memberAlert)}
          <form id="member-form" novalidate>
            <div class="member-photo-section">
              <div class="member-photo-wrap">
                ${
                  hasPhoto
                    ? `<img class="member-photo-preview" src="${this.escapeHtml(
                        previewSrc,
                      )}" alt="${this.escapeHtml(this.t("myHousehold.memberPhotoAlt"))}" />`
                    : `<div class="member-photo-preview member-photo-fallback">${this.personSvg()}</div>`
                }
              </div>
              <div>
                <button type="button" class="nw-btn nw-btn-secondary" data-action="pick-photo">
                  ${this.escapeHtml(
                    this.t(
                      hasPhoto
                        ? "myHousehold.changePhoto"
                        : "myHousehold.addPhoto",
                    ),
                  )}
                </button>
                <input type="file" id="member-photo-input" accept="image/*" style="display:none" />
                <p class="photo-hint">${this.escapeHtml(this.t("myHousehold.photoHint"))}</p>
              </div>
            </div>

            <fieldset class="nw-section">
              <legend class="nw-section-label">${this.escapeHtml(this.t("fields.name"))}</legend>
              <div class="nw-grid">
                <div class="nw-field">
                  <label for="mb-prefix">${this.escapeHtml(this.t("fields.prefix"))}</label>
                  <select id="mb-prefix">${this.selectOptions(
                    l.prefixes,
                    m?.prefixId ?? null,
                  )}</select>
                </div>
                <div class="nw-field">
                  <label for="mb-suffix">${this.escapeHtml(this.t("fields.suffix"))}</label>
                  <select id="mb-suffix">${this.selectOptions(
                    l.suffixes,
                    m?.suffixId ?? null,
                  )}</select>
                </div>
                <div class="nw-field">
                  <label for="mb-first">${this.escapeHtml(this.t("fields.firstName"))}${requiredStar()}</label>
                  <input id="mb-first" name="mb-first" type="text" value="${this.escapeHtml(
                    m?.firstName || "",
                  )}" required />
                </div>
                <div class="nw-field">
                  <label for="mb-middle">${this.escapeHtml(this.t("fields.middleName"))}</label>
                  <input id="mb-middle" type="text" value="${this.escapeHtml(
                    m?.middleName || "",
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="mb-last">${this.escapeHtml(this.t("fields.lastName"))}${requiredStar()}</label>
                  <input id="mb-last" name="mb-last" type="text" value="${this.escapeHtml(
                    m?.lastName || "",
                  )}" required />
                </div>
                <div class="nw-field">
                  <label for="mb-nick">${this.escapeHtml(this.t("fields.nickname"))}</label>
                  <input id="mb-nick" type="text" value="${this.escapeHtml(
                    m?.nickName || "",
                  )}" />
                </div>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">${this.escapeHtml(this.t("fields.personalDetails"))}</legend>
              <div class="nw-grid">
                <div class="nw-field">
                  <label for="mb-gender">${this.escapeHtml(this.t("fields.gender"))}</label>
                  <select id="mb-gender">${this.selectOptions(
                    l.genders,
                    m?.genderId ?? null,
                  )}</select>
                </div>
                <div class="nw-field">
                  <label for="mb-dob">${this.escapeHtml(this.t("fields.dateOfBirth"))}</label>
                  <input id="mb-dob" type="date" value="${this.ymdToInputValue(
                    m?.dateOfBirth ?? null,
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="mb-marital">${this.escapeHtml(this.t("fields.maritalStatus"))}</label>
                  <select id="mb-marital">${this.selectOptions(
                    l.maritalStatuses,
                    m?.maritalStatusId ?? null,
                  )}</select>
                </div>
                <div class="nw-field">
                  <label for="mb-position">${this.escapeHtml(this.t("myHousehold.householdPosition"))}</label>
                  <select id="mb-position">${this.selectOptions(
                    l.householdPositions,
                    m?.householdPositionId ?? null,
                  )}</select>
                </div>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">${this.escapeHtml(this.t("myHousehold.contactInformation"))}</legend>
              <div class="nw-grid">
                <div class="nw-field nw-field-full">
                  <label for="mb-email">${this.escapeHtml(this.t("fields.email"))}</label>
                  <input id="mb-email" type="email" value="${this.escapeHtml(
                    m?.emailAddress || "",
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="mb-mobile">${this.escapeHtml(this.t("fields.mobilePhone"))}</label>
                  <input id="mb-mobile" type="tel" value="${this.escapeHtml(
                    m?.mobilePhoneNumber || "",
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="mb-work">${this.escapeHtml(this.t("fields.workPhone"))}</label>
                  <input id="mb-work" type="tel" value="${this.escapeHtml(
                    m?.workPhoneNumber || "",
                  )}" />
                </div>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">${this.escapeHtml(this.t("myHousehold.communicationPreferences"))}</legend>
              <div class="nw-comm-prefs">
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-email-unlisted" ${
                    m?.emailUnlisted ? "checked" : ""
                  } />
                  <span>${this.escapeHtml(this.t("myHousehold.emailUnlisted"))}</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-mobile-unlisted" ${
                    m?.mobilePhoneUnlisted ? "checked" : ""
                  } />
                  <span>${this.escapeHtml(this.t("myHousehold.mobilePhoneUnlisted"))}</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-do-not-text" ${
                    m?.doNotText ? "checked" : ""
                  } />
                  <span>${this.escapeHtml(this.t("myHousehold.doNotText"))}</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-bulk-opt-out" ${
                    m?.bulkEmailOptOut ? "checked" : ""
                  } />
                  <span>${this.escapeHtml(this.t("myHousehold.bulkEmailOptOut"))}</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-remove-directory" ${
                    m?.removeFromDirectory ? "checked" : ""
                  } />
                  <span>${this.escapeHtml(this.t("myHousehold.removeFromDirectory"))}</span>
                </label>
              </div>
            </fieldset>

            <div class="nw-actions">
              <button type="submit" class="nw-btn nw-btn-primary" ${
                this.saving ? "disabled" : ""
              }>
                ${
                  this.saving
                    ? `<span class="nw-spinner-sm"></span> ${this.escapeHtml(this.t("common.saving"))}`
                    : this.escapeHtml(this.t("myHousehold.saveMember"))
                }
              </button>
              <button type="button" class="nw-btn nw-btn-text" data-action="cancel-member">${this.escapeHtml(this.t("common.cancel"))}</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Listeners
  // ---------------------------------------------------------------------------
  private attachListeners() {
    this.root
      .querySelector('[data-action="retry"]')
      ?.addEventListener("click", () => this.retryLoad());

    this.root
      .querySelector('[data-action="edit-household"]')
      ?.addEventListener("click", () => {
        this.householdAlert = null;
        this.view = "household-form";
        this.render();
      });

    this.root
      .querySelector('[data-action="add-member"]')
      ?.addEventListener("click", () => {
        this.openMemberForm(null);
      });

    this.root
      .querySelectorAll('[data-action="edit-member"]')
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = parseInt(
            (btn as HTMLElement).dataset.contactId || "0",
            10,
          );
          const member =
            this.data?.members.find((m) => m.contactId === id) || null;
          this.openMemberForm(member);
        });
      });

    this.root
      .querySelector('[data-action="cancel-household"]')
      ?.addEventListener("click", () => {
        this.view = "details";
        this.render();
      });

    this.root
      .querySelector('[data-action="cancel-member"]')
      ?.addEventListener("click", () => {
        this.clearPhotoSelection();
        this.editingMember = null;
        this.view = "details";
        this.render();
      });

    const householdForm = this.root.querySelector(
      "#household-form",
    ) as HTMLFormElement | null;
    if (householdForm) {
      householdForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitHousehold();
      });
      bindLiveValidation(householdForm, this.validationOpts());
    }

    const memberForm = this.root.querySelector(
      "#member-form",
    ) as HTMLFormElement | null;
    if (memberForm) {
      memberForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitMember();
      });
      bindLiveValidation(memberForm, this.validationOpts());
    }

    // Photo picker
    const pickBtn = this.root.querySelector('[data-action="pick-photo"]');
    const photoInput = this.root.querySelector(
      "#member-photo-input",
    ) as HTMLInputElement | null;
    pickBtn?.addEventListener("click", () => photoInput?.click());
    photoInput?.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (file) this.handlePhotoSelect(file);
    });

    // Google Places (only relevant on the household form)
    if (this.view === "household-form") {
      this.initGooglePlaces();
    }
  }

  private openMemberForm(member: HouseholdMember | null) {
    this.clearPhotoSelection();
    this.memberAlert = null;
    this.editingMember = member;
    this.view = "member-form";
    this.render();
  }

  private clearPhotoSelection() {
    this.photoFile = null;
    if (this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
      this.photoPreviewUrl = null;
    }
  }

  private handlePhotoSelect(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      this.memberAlert = {
        kind: "warning",
        text: this.t("myHousehold.photoTooLarge"),
      };
      this.render();
      return;
    }
    this.photoFile = file;
    if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
    this.photoPreviewUrl = URL.createObjectURL(file);
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Google Places (optional, graceful)
  // ---------------------------------------------------------------------------
  private async initGooglePlaces() {
    const key = this.data?.googleMapsApiKey;
    if (!key || typeof key !== "string" || key.trim() === "") return;

    let loaded = false;
    try {
      loaded = await loadGoogleMaps(key);
    } catch {
      loaded = false;
    }
    if (!loaded) return;
    if (typeof (window as any).google === "undefined") return;
    // Form may have been torn down while loading.
    if (this.view !== "household-form") return;

    this.attachAutocomplete("primary");
    this.attachAutocomplete("alt");
  }

  private attachAutocomplete(prefix: string) {
    const input = this.root.querySelector(
      `#${prefix}-line1`,
    ) as HTMLInputElement | null;
    if (!input) return;
    attachAddressAutocomplete(input, (addr) =>
      this.fillAddressFromPlace(prefix, addr),
    );
  }

  private fillAddressFromPlace(prefix: string, addr: ParsedAddress) {
    const setVal = (id: string, value: string) => {
      const el = this.root.querySelector(`#${id}`) as HTMLInputElement | null;
      if (el && value) el.value = value;
    };

    if (addr.line1) setVal(`${prefix}-line1`, addr.line1);
    if (addr.city) setVal(`${prefix}-city`, addr.city);
    if (addr.state) setVal(`${prefix}-state`, addr.state);
    if (addr.postalCode) setVal(`${prefix}-postal`, addr.postalCode);

    if (addr.countryCode) {
      const match = this.data?.lookups.countries.find(
        (c) => c.code.toUpperCase() === addr.countryCode.toUpperCase(),
      );
      if (match) {
        const sel = this.root.querySelector(
          `#${prefix}-country`,
        ) as HTMLSelectElement | null;
        if (sel) sel.value = match.code;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Submit handlers
  // ---------------------------------------------------------------------------
  private getVal(id: string): string {
    const el = this.root.querySelector(`#${id}`) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    return el?.value?.trim() ?? "";
  }

  private getChecked(id: string): boolean {
    const el = this.root.querySelector(`#${id}`) as HTMLInputElement | null;
    return el?.checked ?? false;
  }

  private collectAddress(prefix: string): Record<string, unknown> {
    const countryCode = this.getVal(`${prefix}-country`) || null;
    const countryName = countryCode
      ? this.data?.lookups.countries.find((c) => c.code === countryCode)?.name ||
        null
      : null;
    return {
      addressLine1: this.getVal(`${prefix}-line1`) || null,
      addressLine2: this.getVal(`${prefix}-line2`) || null,
      city: this.getVal(`${prefix}-city`) || null,
      stateRegion: this.getVal(`${prefix}-state`) || null,
      postalCode: this.getVal(`${prefix}-postal`) || null,
      countryCode,
      country: countryName,
    };
  }

  private async submitHousehold() {
    this.householdAlert = null;

    const form = this.root.querySelector(
      "#household-form",
    ) as HTMLFormElement | null;
    if (form) {
      // No per-field message overrides any more: they only restated the
      // shared layer's own `validation.required`, which is translated.
      const opts = this.validationOpts();
      if (!validateForm(form, opts).valid) {
        // Field-level errors are the primary feedback; keep a summary banner.
        // Re-apply inline errors after render() rebuilds the form markup.
        this.householdAlert = {
          kind: "warning",
          text: this.t("myHousehold.fixHighlighted"),
        };
        this.render();
        const reRendered = this.root.querySelector(
          "#household-form",
        ) as HTMLFormElement | null;
        if (reRendered) validateForm(reRendered, opts);
        return;
      }
    }

    const name = this.getVal("hh-name");
    const congregationId = this.getVal("hh-congregation");
    const body: Record<string, unknown> = {
      name,
      homePhone: this.getVal("hh-phone") || null,
      congregationId: congregationId ? Number(congregationId) : null,
      address: this.collectAddress("primary"),
      alternativeAddress: this.collectAddress("alt"),
      alternativeAddressStart: this.getVal("alt-start") || null,
      alternativeAddressEnd: this.getVal("alt-end") || null,
      alternativeAddressRepeatAnnually: this.getChecked("alt-repeat"),
      homePhoneUnlisted: this.getChecked("hh-phone-unlisted"),
      homeAddressUnlisted: this.getChecked("hh-address-unlisted"),
    };

    this.saving = true;
    this.render();

    try {
      const res = await this.fetch("/api/embed/household", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new WidgetError(this.errorText(data, "errors.saveFailed"));
      }

      if (this.data && data.household) {
        this.data.household = data.household;
      }

      this.saving = false;
      this.view = "details";
      this.householdAlert = {
        kind: "success",
        text: this.t("myHousehold.householdSaved"),
      };
      this.render();
      this.emit("householdUpdated", { household: data.household });
    } catch (err) {
      this.saving = false;
      this.householdAlert = {
        kind: "error",
        text:
          this.caughtText(err, "errors.saveFailed"),
      };
      this.render();
      this.emit("householdError", { error: this.householdAlert.text });
    }
  }

  private async submitMember() {
    this.memberAlert = null;

    const form = this.root.querySelector(
      "#member-form",
    ) as HTMLFormElement | null;
    if (form) {
      const opts = this.validationOpts();
      if (!validateForm(form, opts).valid) {
        // Field-level errors are the primary feedback; keep a summary banner.
        // Re-apply inline errors after render() rebuilds the form markup.
        this.memberAlert = {
          kind: "warning",
          text: this.t("myHousehold.fixHighlighted"),
        };
        this.render();
        const reRendered = this.root.querySelector(
          "#member-form",
        ) as HTMLFormElement | null;
        if (reRendered) validateForm(reRendered, opts);
        return;
      }
    }

    const firstName = this.getVal("mb-first");
    const lastName = this.getVal("mb-last");
    const prefixId = this.getVal("mb-prefix");
    const suffixId = this.getVal("mb-suffix");
    const genderId = this.getVal("mb-gender");
    const maritalStatusId = this.getVal("mb-marital");
    const householdPositionId = this.getVal("mb-position");

    const body: Record<string, unknown> = {
      firstName,
      lastName,
      middleName: this.getVal("mb-middle") || null,
      nickName: this.getVal("mb-nick") || null,
      prefixId: prefixId ? Number(prefixId) : null,
      suffixId: suffixId ? Number(suffixId) : null,
      emailAddress: this.getVal("mb-email") || null,
      mobilePhoneNumber: this.getVal("mb-mobile") || null,
      workPhoneNumber: this.getVal("mb-work") || null,
      householdPositionId: householdPositionId
        ? Number(householdPositionId)
        : null,
      dateOfBirth: this.getVal("mb-dob") || null,
      genderId: genderId ? Number(genderId) : null,
      maritalStatusId: maritalStatusId ? Number(maritalStatusId) : null,
      emailUnlisted: this.getChecked("mb-email-unlisted"),
      mobilePhoneUnlisted: this.getChecked("mb-mobile-unlisted"),
      doNotText: this.getChecked("mb-do-not-text"),
      bulkEmailOptOut: this.getChecked("mb-bulk-opt-out"),
      removeFromDirectory: this.getChecked("mb-remove-directory"),
    };

    if (this.editingMember) {
      body.contactId = this.editingMember.contactId;
    }

    this.saving = true;
    this.render();

    try {
      const res = await this.fetch("/api/embed/household/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new WidgetError(this.errorText(data, "errors.saveFailed"));
      }

      const returnedContactId: number | undefined = data.contactId;

      // Upload photo if one was selected.
      if (this.photoFile && returnedContactId) {
        try {
          const formData = new FormData();
          formData.append("photo", this.photoFile);
          await this.fetch(
            `/api/embed/household/members/${returnedContactId}/photo`,
            {
              method: "POST",
              body: formData,
            },
          );
        } catch {
          // Photo failure is non-fatal; member was already saved.
        }
      }

      if (this.data && Array.isArray(data.members)) {
        this.data.members = data.members;
      }

      this.clearPhotoSelection();
      this.editingMember = null;
      this.saving = false;
      this.view = "details";
      this.memberAlert = {
        kind: "success",
        text: this.t("myHousehold.memberSaved"),
      };
      this.render();
      this.emit("memberSaved", { contactId: returnedContactId });
    } catch (err) {
      this.saving = false;
      this.memberAlert = {
        kind: "error",
        text:
          this.caughtText(err, "errors.saveFailed"),
      };
      this.render();
      this.emit("householdError", { error: this.memberAlert.text });
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private spinnerSvg(): string {
    return `<svg class="spinner" viewBox="0 0 24 24" fill="none">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  // ALL STYLES
  private getStyles(): string {
    return `
      :host {
        all: initial;
        display: block;
        font-family: var(--_nw-font-family);
        color: var(--_nw-color-text);
        font-size: var(--_nw-font-size-base);
        line-height: var(--_nw-line-height);
      }
      *, *::before, *::after { box-sizing: border-box; }

      .nw-household {
        max-width: 800px;
        margin: 0 auto;
        background: var(--_nw-color-surface);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .header {
        background: var(--_nw-color-secondary);
        color: var(--_nw-color-on-primary);
        padding: var(--_nw-space-6);
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        text-align: center;
      }

      .body { padding: var(--_nw-space-6); }

      .loading-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--_nw-space-3);
        font-size: 16px;
        color: #9E9E9E;
        padding: var(--_nw-space-6);
      }
      .spinner {
        width: 22px;
        height: 22px;
        color: var(--_nw-color-primary);
        animation: nw-spin 1s linear infinite;
      }
      .nw-spinner-sm {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.4);
        border-top-color: white;
        border-radius: 50%;
        animation: nw-spin 0.8s linear infinite;
        vertical-align: middle;
        margin-right: 6px;
      }
      @keyframes nw-spin { to { transform: rotate(360deg); } }

      .error-box {
        text-align: center;
        padding: 32px;
        color: #991b1b;
        background: #fee2e2;
        border-radius: var(--_nw-radius);
      }
      .error-box button { margin-top: var(--_nw-space-3); }
      .empty-state {
        text-align: center;
        padding: 40px var(--_nw-space-5);
        color: #9E9E9E;
        font-size: var(--_nw-font-size-base);
      }

      .nw-toast {
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: var(--_nw-space-4);
      }
      .nw-toast-success {
        background: #ecfdf5;
        color: #065f46;
        border: var(--_nw-border-width) solid var(--_nw-color-success);
      }
      .nw-toast-error {
        background: #fef2f2;
        color: #991b1b;
        border: var(--_nw-border-width) solid var(--_nw-color-error);
      }
      .nw-toast-warning {
        background: #fffbeb;
        color: #92700c;
        border: var(--_nw-border-width) solid var(--_nw-color-warning);
      }

      .section { margin-bottom: 28px; }
      .section-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_nw-space-3);
        margin-bottom: var(--_nw-space-3);
      }
      .household-name {
        font-size: 20px;
        font-weight: var(--_nw-font-weight-heading);
        color: var(--_nw-color-secondary);
        margin: 0;
      }
      .section-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9E9E9E;
      }
      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: var(--_nw-border-width) solid var(--_nw-color-primary);
        background: var(--_nw-color-surface);
        color: var(--_nw-color-primary);
        cursor: pointer;
        transition: background 0.15s;
      }
      .icon-btn:hover { background: rgba(0,76,151,0.06); }

      .meta-row {
        display: flex;
        gap: var(--_nw-space-2);
        font-size: var(--_nw-font-size-base);
        margin-top: var(--_nw-space-1);
      }
      .meta-label {
        font-weight: 600;
        color: var(--_nw-color-secondary);
        min-width: 110px;
      }
      .meta-value { color: var(--_nw-color-text-subtle); }

      .address-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--_nw-space-4);
        margin-bottom: 28px;
      }
      .address-card {
        border: var(--_nw-border-width) solid var(--_nw-color-border);
        border-radius: 10px;
        padding: var(--_nw-space-4);
        background: #f9fafb;
      }
      .address-card-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--_nw-color-primary);
        margin-bottom: var(--_nw-space-2);
      }
      .addr-lines div { font-size: var(--_nw-font-size-base); color: var(--_nw-color-text); }
      .addr-empty { font-size: 13px; color: #9E9E9E; }
      .address-daterange {
        margin-top: var(--_nw-space-2);
        font-size: 12px;
        font-weight: 600;
        color: #92700c;
        background: rgba(241, 190, 72, 0.18);
        border-radius: 6px;
        padding: var(--_nw-space-1) var(--_nw-space-2);
        display: inline-block;
      }

      .members-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--_nw-space-4);
      }
      .member-card {
        border: var(--_nw-border-width) solid var(--_nw-color-border);
        border-radius: var(--_nw-radius-lg);
        padding: var(--_nw-space-4);
        text-align: center;
        background: var(--_nw-color-surface);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--_nw-space-1);
      }
      .member-photo {
        width: 72px;
        height: 72px;
        border-radius: 50%;
        object-fit: cover;
        border: 3px solid #E0E0E0;
        margin-bottom: 6px;
      }
      .member-photo-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--_nw-color-surface-muted);
      }
      .member-name {
        font-size: 15px;
        font-weight: var(--_nw-font-weight-heading);
        color: var(--_nw-color-text);
      }
      .member-position {
        font-size: 12px;
        color: var(--_nw-color-primary);
        font-weight: 600;
      }
      .member-dob { font-size: 12px; color: #9E9E9E; }
      .member-edit-btn {
        margin-top: var(--_nw-space-2);
        background: none;
        border: var(--_nw-border-width) solid var(--_nw-color-primary);
        color: var(--_nw-color-primary);
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        padding: var(--_nw-space-1) 14px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .member-edit-btn:hover { background: rgba(0,76,151,0.06); }

      /* Forms */
      .nw-section {
        border: none;
        padding: 0;
        margin: 0 0 var(--_nw-space-6) 0;
      }
      .nw-section-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9E9E9E;
        margin-bottom: var(--_nw-space-3);
        padding-bottom: var(--_nw-space-2);
        border-bottom: 1px solid #E0E0E0;
      }
      .nw-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .nw-field-full { grid-column: 1 / -1; }
      .nw-field label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: var(--_nw-color-text-subtle);
        margin-bottom: var(--_nw-space-1);
      }
      .nw-field input[type="text"],
      .nw-field input[type="email"],
      .nw-field input[type="tel"],
      .nw-field input[type="date"],
      .nw-field select {
        width: 100%;
        padding: var(--_nw-space-2) 10px;
        border: var(--_nw-border-width) solid var(--_nw-color-border-strong);
        border-radius: 6px;
        font-size: var(--_nw-font-size-base);
        font-family: inherit;
        color: var(--_nw-color-text);
        background: var(--_nw-color-surface);
        transition: border-color 0.15s;
      }
      .nw-field input:focus,
      .nw-field select:focus {
        outline: none;
        border-color: var(--_nw-color-primary);
        box-shadow: 0 0 0 2px rgba(0, 76, 151, 0.15);
      }

      .nw-checkrow {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_nw-space-4);
        margin-top: 14px;
      }
      .nw-comm-prefs {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .nw-checkbox-label {
        display: flex;
        align-items: center;
        gap: var(--_nw-space-2);
        font-weight: 400;
        font-size: var(--_nw-font-size-base);
        color: var(--_nw-color-text);
        cursor: pointer;
      }
      .nw-checkbox-label input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--_nw-color-primary);
        flex-shrink: 0;
      }

      .member-photo-section {
        display: flex;
        align-items: center;
        gap: var(--_nw-space-5);
        margin-bottom: var(--_nw-space-6);
        padding-bottom: var(--_nw-space-6);
        border-bottom: 1px solid #E0E0E0;
      }
      .member-photo-wrap { flex-shrink: 0; }
      .member-photo-preview {
        width: 96px;
        height: 96px;
        border-radius: 50%;
        object-fit: cover;
        border: 3px solid #E0E0E0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .photo-hint {
        font-size: 11px;
        color: #9E9E9E;
        margin: var(--_nw-space-2) 0 0 0;
      }

      .nw-actions {
        padding-top: var(--_nw-space-2);
        display: flex;
        align-items: center;
        gap: var(--_nw-space-3);
      }
      .nw-btn {
        padding: 10px var(--_nw-space-6);
        border: none;
        border-radius: 6px;
        font-size: var(--_nw-font-size-base);
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .nw-btn:disabled { opacity: 0.65; cursor: not-allowed; }
      .nw-btn-primary { background: var(--_nw-button-bg); color: var(--_nw-button-fg); }
      .nw-btn-primary:hover:not(:disabled) { background: var(--_nw-button-bg-hover); }
      .nw-btn-secondary {
        background: var(--_nw-color-surface);
        color: var(--_nw-color-primary);
        border: var(--_nw-border-width) solid var(--_nw-color-primary);
      }
      .nw-btn-secondary:hover:not(:disabled) { background: rgba(0,76,151,0.06); }
      .nw-btn-text {
        background: none;
        color: var(--_nw-color-text-subtle);
        padding: 10px var(--_nw-space-3);
      }
      .nw-btn-text:hover:not(:disabled) { color: var(--_nw-color-secondary); }

      @media (max-width: 640px) {
        .header, .body { padding: var(--_nw-space-4); }
        .nw-grid { grid-template-columns: 1fr; }
        .address-grid { grid-template-columns: 1fr; }
        .members-grid {
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        }
      }
    `;
  }
}

if (!customElements.get("next-my-household")) {
  customElements.define("next-my-household", MyHouseholdWidget);
}
