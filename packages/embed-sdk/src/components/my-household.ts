import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

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

// Module-level guard so the Google Maps Places script is only loaded once.
let googleMapsPromise: Promise<boolean> | null = null;

function loadGoogleMaps(key: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (
    typeof (window as any).google !== "undefined" &&
    (window as any).google?.maps?.places
  ) {
    return Promise.resolve(true);
  }
  if ((window as any).__nextGoogleMapsPromise) {
    return (window as any).__nextGoogleMapsPromise;
  }
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise<boolean>((resolve) => {
    try {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-next-google-maps="1"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(true));
        existing.addEventListener("error", () => resolve(false));
        return;
      }
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        key,
      )}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.dataset.nextGoogleMaps = "1";
      script.addEventListener("load", () => resolve(true));
      script.addEventListener("error", () => resolve(false));
      document.head.appendChild(script);
    } catch {
      resolve(false);
    }
  });
  (window as any).__nextGoogleMapsPromise = googleMapsPromise;
  return googleMapsPromise;
}

export class MyHouseholdWidget extends MPNextWidget {
  private data: HouseholdData | null = null;
  private loading = true;
  private error: string | null = null;
  private view: View = "details";
  private editingMember: HouseholdMember | null = null;
  private saving = false;
  private householdAlert: AlertMsg | null = null;
  private memberAlert: AlertMsg | null = null;
  private photoFile: File | null = null;
  private photoPreviewUrl: string | null = null;

  static get observedAttributes() {
    return ["hideaddhouseholdmember"];
  }

  private get hideAddMember(): boolean {
    return (
      (this.getAttribute("hideaddhouseholdmember") || "").toLowerCase() ===
      "true"
    );
  }

  // Shared validation options: this widget wraps every input in `.nw-field`.
  private static VALIDATION_OPTS = { wrapperSelector: ".nw-field" } as const;

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
    this.render();
    this.loadHousehold();
  }

  disconnectedCallback() {
    if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
  }

  public retryLoad() {
    this.error = null;
    this.view = "details";
    this.loadHousehold();
  }

  private async loadHousehold() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch("/api/embed/household");
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Failed to load household (${res.status})`);
      }
      const data: HouseholdData = await res.json();
      this.data = data;
      this.loading = false;
      this.render();
      this.attachListeners();
      this.emit("householdLoaded", { memberCount: data.members?.length ?? 0 });
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load household";
      this.render();
      this.attachListeners();
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

  private static MONTHS_SHORT = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  /** "MMM D" (no year), defensively parsed. */
  private formatMonthDay(value: string | null): string {
    const p = this.parseYmd(value);
    if (!p || p.m < 1 || p.m > 12) return "";
    return `${MyHouseholdWidget.MONTHS_SHORT[p.m - 1]} ${p.d}`;
  }

  /** "M/D/YYYY" defensively parsed. */
  private formatSlashDate(value: string | null): string {
    const p = this.parseYmd(value);
    if (!p) return "";
    return `${p.m}/${p.d}/${p.y}`;
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
      const s = this.formatMonthDay(h.alternativeAddressStart);
      const e = this.formatMonthDay(h.alternativeAddressEnd);
      if (s && e) return `${s} – ${e} annually`;
      if (s) return `${s} annually`;
      return "";
    }
    const s = this.formatSlashDate(h.alternativeAddressStart);
    const e = this.formatSlashDate(h.alternativeAddressEnd);
    if (s && e) return `${s} – ${e}`;
    if (s) return `From ${s}`;
    if (e) return `Until ${e}`;
    return "";
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  render() {
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-household">
          <div class="header"><div class="title">My Household</div></div>
          <div class="body">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>Loading household...</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.error && !this.data) {
      this.root.innerHTML = `
        <div class="nw-household">
          <div class="header"><div class="title">My Household</div></div>
          <div class="body">
            <div class="error-box">
              <p>${this.escapeHtml(this.error)}</p>
              <button class="nw-btn nw-btn-primary" data-action="retry">Try Again</button>
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
          <div class="header"><div class="title">My Household</div></div>
          <div class="body">
            <div class="empty-state">No household found for your account.</div>
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
    if (!addr) return `<div class="addr-empty">No address on file.</div>`;
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
    if (lines.length === 0)
      return `<div class="addr-empty">No address on file.</div>`;
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
      "Member";
    const dob = this.formatMonthDay(m.dateOfBirth);
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
            ? `<button class="member-edit-btn" data-action="edit-member" data-contact-id="${m.contactId}">Edit</button>`
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

    return `
      <div class="nw-household">
        <div class="header">
          <div class="title">My Household</div>
        </div>
        <div class="body">
          ${this.renderAlert(this.householdAlert)}
          ${this.renderAlert(this.memberAlert)}

          <div class="section">
            <div class="section-titlebar">
              <h3 class="household-name">${this.escapeHtml(
                h.name || "Household",
              )}</h3>
              ${
                head
                  ? `<button class="icon-btn" data-action="edit-household" title="Edit household" aria-label="Edit household">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>`
                  : ""
              }
            </div>
            ${
              h.congregationName
                ? `<div class="meta-row"><span class="meta-label">Congregation</span><span class="meta-value">${this.escapeHtml(
                    h.congregationName,
                  )}</span></div>`
                : ""
            }
            ${
              h.homePhone
                ? `<div class="meta-row"><span class="meta-label">Home Phone</span><span class="meta-value">${this.escapeHtml(
                    h.homePhone,
                  )}</span></div>`
                : ""
            }
          </div>

          <div class="address-grid">
            <div class="address-card">
              <div class="address-card-label">Primary Address</div>
              ${this.renderAddressBlock(h.address)}
            </div>
            ${
              showAlt
                ? `<div class="address-card">
                    <div class="address-card-label">Seasonal Address</div>
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
              <div class="section-label">Members</div>
              ${
                showAddMember
                  ? `<button class="nw-btn nw-btn-secondary" data-action="add-member">+ Add Household Member</button>`
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
          <label for="${prefix}-country">Country</label>
          <select id="${prefix}-country" name="${prefix}-country">
            ${this.countryOptions(countries, a.countryCode)}
          </select>
        </div>
        <div class="nw-field nw-field-full">
          <label for="${prefix}-line1">Address Line 1</label>
          <input id="${prefix}-line1" name="${prefix}-line1" type="text" value="${this.escapeHtml(
            a.addressLine1 || "",
          )}" autocomplete="off" />
        </div>
        <div class="nw-field nw-field-full">
          <label for="${prefix}-line2">Address Line 2</label>
          <input id="${prefix}-line2" name="${prefix}-line2" type="text" value="${this.escapeHtml(
            a.addressLine2 || "",
          )}" autocomplete="off" />
        </div>
        <div class="nw-field">
          <label for="${prefix}-city">City</label>
          <input id="${prefix}-city" name="${prefix}-city" type="text" value="${this.escapeHtml(
            a.city || "",
          )}" autocomplete="off" />
        </div>
        <div class="nw-field">
          <label for="${prefix}-state">State / Region</label>
          <input id="${prefix}-state" name="${prefix}-state" type="text" value="${this.escapeHtml(
            a.stateRegion || "",
          )}" autocomplete="off" />
        </div>
        <div class="nw-field">
          <label for="${prefix}-postal">Postal Code</label>
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
        <div class="header"><div class="title">Edit Household</div></div>
        <div class="body">
          ${this.renderAlert(this.householdAlert)}
          <form id="household-form" novalidate>
            <fieldset class="nw-section">
              <legend class="nw-section-label">Household</legend>
              <div class="nw-grid">
                <div class="nw-field nw-field-full">
                  <label for="hh-name">Household Name${requiredStar()}</label>
                  <input id="hh-name" name="hh-name" type="text" value="${this.escapeHtml(
                    h.name || "",
                  )}" required />
                </div>
                <div class="nw-field">
                  <label for="hh-phone">Home Phone</label>
                  <input id="hh-phone" name="hh-phone" type="tel" value="${this.escapeHtml(
                    h.homePhone || "",
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="hh-congregation">Congregation</label>
                  <select id="hh-congregation" name="hh-congregation">
                    ${this.selectOptions(l.congregations, h.congregationId)}
                  </select>
                </div>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">Primary Address</legend>
              ${this.renderAddressFields("primary", h.address, l.countries)}
              <div class="nw-checkrow">
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="hh-phone-unlisted" ${
                    h.homePhoneUnlisted ? "checked" : ""
                  } />
                  <span>Home Phone Unlisted</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="hh-address-unlisted" ${
                    h.homeAddressUnlisted ? "checked" : ""
                  } />
                  <span>Home Address Unlisted</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">Seasonal / Alternative Address</legend>
              ${this.renderAddressFields(
                "alt",
                h.alternativeAddress,
                l.countries,
              )}
              <div class="nw-grid">
                <div class="nw-field">
                  <label for="alt-start">Season Start</label>
                  <input id="alt-start" name="alt-start" type="date" value="${this.ymdToInputValue(
                    h.alternativeAddressStart,
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="alt-end">Season End</label>
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
                  <span>Repeat Annually</span>
                </label>
              </div>
            </fieldset>

            <div class="nw-actions">
              <button type="submit" class="nw-btn nw-btn-primary" ${
                this.saving ? "disabled" : ""
              }>
                ${
                  this.saving
                    ? '<span class="nw-spinner-sm"></span> Saving...'
                    : "Save Household"
                }
              </button>
              <button type="button" class="nw-btn nw-btn-text" data-action="cancel-household">Cancel</button>
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
        "Member"
      : "";
    const title = isEdit ? `Edit ${headerName}` : "Add Member";

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
                      )}" alt="Member photo" />`
                    : `<div class="member-photo-preview member-photo-fallback">${this.personSvg()}</div>`
                }
              </div>
              <div>
                <button type="button" class="nw-btn nw-btn-secondary" data-action="pick-photo">
                  ${hasPhoto ? "Change Photo" : "Add Photo"}
                </button>
                <input type="file" id="member-photo-input" accept="image/*" style="display:none" />
                <p class="photo-hint">JPEG, PNG, GIF or WebP. Max 10MB.</p>
              </div>
            </div>

            <fieldset class="nw-section">
              <legend class="nw-section-label">Name</legend>
              <div class="nw-grid">
                <div class="nw-field">
                  <label for="mb-prefix">Prefix</label>
                  <select id="mb-prefix">${this.selectOptions(
                    l.prefixes,
                    m?.prefixId ?? null,
                  )}</select>
                </div>
                <div class="nw-field">
                  <label for="mb-suffix">Suffix</label>
                  <select id="mb-suffix">${this.selectOptions(
                    l.suffixes,
                    m?.suffixId ?? null,
                  )}</select>
                </div>
                <div class="nw-field">
                  <label for="mb-first">First Name${requiredStar()}</label>
                  <input id="mb-first" name="mb-first" type="text" value="${this.escapeHtml(
                    m?.firstName || "",
                  )}" required />
                </div>
                <div class="nw-field">
                  <label for="mb-middle">Middle Name</label>
                  <input id="mb-middle" type="text" value="${this.escapeHtml(
                    m?.middleName || "",
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="mb-last">Last Name${requiredStar()}</label>
                  <input id="mb-last" name="mb-last" type="text" value="${this.escapeHtml(
                    m?.lastName || "",
                  )}" required />
                </div>
                <div class="nw-field">
                  <label for="mb-nick">Nickname</label>
                  <input id="mb-nick" type="text" value="${this.escapeHtml(
                    m?.nickName || "",
                  )}" />
                </div>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">Personal Details</legend>
              <div class="nw-grid">
                <div class="nw-field">
                  <label for="mb-gender">Gender</label>
                  <select id="mb-gender">${this.selectOptions(
                    l.genders,
                    m?.genderId ?? null,
                  )}</select>
                </div>
                <div class="nw-field">
                  <label for="mb-dob">Date of Birth</label>
                  <input id="mb-dob" type="date" value="${this.ymdToInputValue(
                    m?.dateOfBirth ?? null,
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="mb-marital">Marital Status</label>
                  <select id="mb-marital">${this.selectOptions(
                    l.maritalStatuses,
                    m?.maritalStatusId ?? null,
                  )}</select>
                </div>
                <div class="nw-field">
                  <label for="mb-position">Household Position</label>
                  <select id="mb-position">${this.selectOptions(
                    l.householdPositions,
                    m?.householdPositionId ?? null,
                  )}</select>
                </div>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">Contact Information</legend>
              <div class="nw-grid">
                <div class="nw-field nw-field-full">
                  <label for="mb-email">Email Address</label>
                  <input id="mb-email" type="email" value="${this.escapeHtml(
                    m?.emailAddress || "",
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="mb-mobile">Mobile Phone</label>
                  <input id="mb-mobile" type="tel" value="${this.escapeHtml(
                    m?.mobilePhoneNumber || "",
                  )}" />
                </div>
                <div class="nw-field">
                  <label for="mb-work">Work Phone</label>
                  <input id="mb-work" type="tel" value="${this.escapeHtml(
                    m?.workPhoneNumber || "",
                  )}" />
                </div>
              </div>
            </fieldset>

            <fieldset class="nw-section">
              <legend class="nw-section-label">Communication Preferences</legend>
              <div class="nw-comm-prefs">
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-email-unlisted" ${
                    m?.emailUnlisted ? "checked" : ""
                  } />
                  <span>Email Unlisted</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-mobile-unlisted" ${
                    m?.mobilePhoneUnlisted ? "checked" : ""
                  } />
                  <span>Mobile Phone Unlisted</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-do-not-text" ${
                    m?.doNotText ? "checked" : ""
                  } />
                  <span>Do Not Text</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-bulk-opt-out" ${
                    m?.bulkEmailOptOut ? "checked" : ""
                  } />
                  <span>Bulk Email Opt Out</span>
                </label>
                <label class="nw-checkbox-label">
                  <input type="checkbox" id="mb-remove-directory" ${
                    m?.removeFromDirectory ? "checked" : ""
                  } />
                  <span>Remove From Directory</span>
                </label>
              </div>
            </fieldset>

            <div class="nw-actions">
              <button type="submit" class="nw-btn nw-btn-primary" ${
                this.saving ? "disabled" : ""
              }>
                ${
                  this.saving
                    ? '<span class="nw-spinner-sm"></span> Saving...'
                    : "Save Member"
                }
              </button>
              <button type="button" class="nw-btn nw-btn-text" data-action="cancel-member">Cancel</button>
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
      bindLiveValidation(householdForm, MyHouseholdWidget.VALIDATION_OPTS);
    }

    const memberForm = this.root.querySelector(
      "#member-form",
    ) as HTMLFormElement | null;
    if (memberForm) {
      memberForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitMember();
      });
      bindLiveValidation(memberForm, MyHouseholdWidget.VALIDATION_OPTS);
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
      this.memberAlert = { kind: "warning", text: "Photo must be under 10MB." };
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
    try {
      const g = (window as any).google;
      if (!g?.maps?.places?.Autocomplete) return;
      const input = this.root.querySelector(
        `#${prefix}-line1`,
      ) as HTMLInputElement | null;
      if (!input) return;

      const autocomplete = new g.maps.places.Autocomplete(input, {
        types: ["address"],
        fields: ["address_components"],
      });

      autocomplete.addListener("place_changed", () => {
        try {
          const place = autocomplete.getPlace();
          if (!place || !place.address_components) return;
          this.fillAddressFromPlace(prefix, place.address_components);
        } catch {
          /* graceful fallback */
        }
      });
    } catch {
      /* graceful fallback — manual entry */
    }
  }

  private fillAddressFromPlace(
    prefix: string,
    components: Array<{ long_name: string; short_name: string; types: string[] }>,
  ) {
    const get = (type: string, useShort = false): string => {
      const c = components.find((comp) => comp.types.includes(type));
      if (!c) return "";
      return useShort ? c.short_name : c.long_name;
    };

    const streetNumber = get("street_number");
    const route = get("route");
    const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();
    const city =
      get("locality") ||
      get("postal_town") ||
      get("sublocality") ||
      get("administrative_area_level_2");
    const state = get("administrative_area_level_1", true);
    const postal = get("postal_code");
    const countryCode = get("country", true);

    const setVal = (id: string, value: string) => {
      const el = this.root.querySelector(`#${id}`) as HTMLInputElement | null;
      if (el && value) el.value = value;
    };

    if (line1) setVal(`${prefix}-line1`, line1);
    if (city) setVal(`${prefix}-city`, city);
    if (state) setVal(`${prefix}-state`, state);
    if (postal) setVal(`${prefix}-postal`, postal);

    if (countryCode) {
      const match = this.data?.lookups.countries.find(
        (c) => c.code.toUpperCase() === countryCode.toUpperCase(),
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
      const opts = {
        ...MyHouseholdWidget.VALIDATION_OPTS,
        messages: { "hh-name": "Household Name is required." },
      };
      if (!validateForm(form, opts).valid) {
        // Field-level errors are the primary feedback; keep a summary banner.
        // Re-apply inline errors after render() rebuilds the form markup.
        this.householdAlert = {
          kind: "warning",
          text: "Please fix the highlighted fields.",
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
        throw new Error(data.error || `Failed to save household (${res.status})`);
      }

      if (this.data && data.household) {
        this.data.household = data.household;
      }

      this.saving = false;
      this.view = "details";
      this.householdAlert = {
        kind: "success",
        text: "Household saved successfully.",
      };
      this.render();
      this.emit("householdUpdated", { household: data.household });
    } catch (err) {
      this.saving = false;
      this.householdAlert = {
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to save household",
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
      const opts = {
        ...MyHouseholdWidget.VALIDATION_OPTS,
        messages: {
          "mb-first": "First Name is required.",
          "mb-last": "Last Name is required.",
        },
      };
      if (!validateForm(form, opts).valid) {
        // Field-level errors are the primary feedback; keep a summary banner.
        // Re-apply inline errors after render() rebuilds the form markup.
        this.memberAlert = {
          kind: "warning",
          text: "Please fix the highlighted fields.",
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
        throw new Error(data.error || `Failed to save member (${res.status})`);
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
        text: "Member saved successfully.",
      };
      this.render();
      this.emit("memberSaved", { contactId: returnedContactId });
    } catch (err) {
      this.saving = false;
      this.memberAlert = {
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to save member",
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
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: #2D2926;
        font-size: 14px;
        line-height: 1.5;
      }
      *, *::before, *::after { box-sizing: border-box; }

      .nw-household {
        max-width: 800px;
        margin: 0 auto;
        background: white;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .header {
        background: #002855;
        color: white;
        padding: 24px;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        text-align: center;
      }

      .body { padding: 24px; }

      .loading-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-size: 16px;
        color: #9E9E9E;
        padding: 24px;
      }
      .spinner {
        width: 22px;
        height: 22px;
        color: #004C97;
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
        border-radius: 8px;
      }
      .error-box button { margin-top: 12px; }
      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #9E9E9E;
        font-size: 14px;
      }

      .nw-toast {
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 16px;
      }
      .nw-toast-success {
        background: #ecfdf5;
        color: #065f46;
        border: 1px solid #86AD3F;
      }
      .nw-toast-error {
        background: #fef2f2;
        color: #991b1b;
        border: 1px solid #FF6D6A;
      }
      .nw-toast-warning {
        background: #fffbeb;
        color: #92700c;
        border: 1px solid #F1BE48;
      }

      .section { margin-bottom: 28px; }
      .section-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .household-name {
        font-size: 20px;
        font-weight: 700;
        color: #002855;
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
        border: 1px solid #004C97;
        background: white;
        color: #004C97;
        cursor: pointer;
        transition: background 0.15s;
      }
      .icon-btn:hover { background: rgba(0,76,151,0.06); }

      .meta-row {
        display: flex;
        gap: 8px;
        font-size: 14px;
        margin-top: 4px;
      }
      .meta-label {
        font-weight: 600;
        color: #002855;
        min-width: 110px;
      }
      .meta-value { color: #474747; }

      .address-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-bottom: 28px;
      }
      .address-card {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 16px;
        background: #f9fafb;
      }
      .address-card-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #004C97;
        margin-bottom: 8px;
      }
      .addr-lines div { font-size: 14px; color: #2D2926; }
      .addr-empty { font-size: 13px; color: #9E9E9E; }
      .address-daterange {
        margin-top: 8px;
        font-size: 12px;
        font-weight: 600;
        color: #92700c;
        background: rgba(241, 190, 72, 0.18);
        border-radius: 6px;
        padding: 4px 8px;
        display: inline-block;
      }

      .members-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 16px;
      }
      .member-card {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 16px;
        text-align: center;
        background: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
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
        background: #f3f4f6;
      }
      .member-name {
        font-size: 15px;
        font-weight: 700;
        color: #2D2926;
      }
      .member-position {
        font-size: 12px;
        color: #004C97;
        font-weight: 600;
      }
      .member-dob { font-size: 12px; color: #9E9E9E; }
      .member-edit-btn {
        margin-top: 8px;
        background: none;
        border: 1px solid #004C97;
        color: #004C97;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 14px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .member-edit-btn:hover { background: rgba(0,76,151,0.06); }

      /* Forms */
      .nw-section {
        border: none;
        padding: 0;
        margin: 0 0 24px 0;
      }
      .nw-section-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9E9E9E;
        margin-bottom: 12px;
        padding-bottom: 8px;
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
        color: #474747;
        margin-bottom: 4px;
      }
      .nw-field input[type="text"],
      .nw-field input[type="email"],
      .nw-field input[type="tel"],
      .nw-field input[type="date"],
      .nw-field select {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        font-family: inherit;
        color: #2D2926;
        background: white;
        transition: border-color 0.15s;
      }
      .nw-field input:focus,
      .nw-field select:focus {
        outline: none;
        border-color: #004C97;
        box-shadow: 0 0 0 2px rgba(0, 76, 151, 0.15);
      }

      .nw-checkrow {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
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
        gap: 8px;
        font-weight: 400;
        font-size: 14px;
        color: #2D2926;
        cursor: pointer;
      }
      .nw-checkbox-label input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: #004C97;
        flex-shrink: 0;
      }

      .member-photo-section {
        display: flex;
        align-items: center;
        gap: 20px;
        margin-bottom: 24px;
        padding-bottom: 24px;
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
        margin: 8px 0 0 0;
      }

      .nw-actions {
        padding-top: 8px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .nw-btn {
        padding: 10px 24px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .nw-btn:disabled { opacity: 0.65; cursor: not-allowed; }
      .nw-btn-primary { background: #004C97; color: white; }
      .nw-btn-primary:hover:not(:disabled) { background: #002855; }
      .nw-btn-secondary {
        background: white;
        color: #004C97;
        border: 1px solid #004C97;
      }
      .nw-btn-secondary:hover:not(:disabled) { background: rgba(0,76,151,0.06); }
      .nw-btn-text {
        background: none;
        color: #474747;
        padding: 10px 12px;
      }
      .nw-btn-text:hover:not(:disabled) { color: #002855; }

      @media (max-width: 640px) {
        .header, .body { padding: 16px; }
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
