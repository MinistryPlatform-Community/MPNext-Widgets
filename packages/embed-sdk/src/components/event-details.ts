import { MPNextWidget } from "../shared/base-widget";
import {
  renderCustomFormFields,
  bindCustomFormDependsOn,
  CUSTOM_FORM_STYLES,
  type CustomFormField,
} from "../shared/custom-form";

// ─────────────────────────────────────────────────────────────────────────
// Local type declarations (mirrors @mpnext/types events.ts — this package
// does not import that workspace package, so the shapes are redeclared here).
// ─────────────────────────────────────────────────────────────────────────

interface EventRoom {
  buildingName: string | null;
  roomName: string | null;
  roomNumber: string | null;
  cancelled: boolean;
  roomInfo: string | null;
}

interface EventContact {
  displayName: string | null;
  imageUrl: string | null;
  emailAddress: string | null;
}

interface EventDetail {
  id: number;
  eventId: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  location: string | null;
  address: string | null;
  startDate: string;
  endDate: string;
  startDateUTC: string | null;
  endDateUTC: string | null;
  latitude: number | null;
  longitude: number | null;
  featured: boolean;
  registrationProductId: number | null;
  registrationPrice: number | null;
  registrationDepositPrice: number | null;
  meetingInstructions: string | null;
  primaryContactId: number | null;
  visibilityLevelId: number;
  forceLogin: boolean;
  opportunityId: number | null;
  opportunityCount: number;
  registrationActive: boolean;
  externalRegistrationUrl: string | null;
  locationAddressId: number | null;
  customFormId: number | null;
  customFormGuid: string | null;
  isRegistrationFull: boolean;
  isRegistrationOptionsFull: boolean;
  isFreeEvent: boolean;
  minorRegistration: boolean;
  allowEmail: boolean;
  showBuildingRoomInfo: boolean;
  isUserStaff: boolean;
  attributes: string[];
  rooms: EventRoom[] | null;
  contacts: EventContact[];
}

interface ProductOptionPrice {
  optionPriceId: number;
  optionTitle: string | null;
  optionPrice: number;
  daysOutToHide: number | null;
  qtyAllowed: number;
  addToGroupId: number | null;
  minQty: number;
  maxQty: number;
  qtyOnHand: number;
  isHidden: boolean;
}

interface ProductOptionGroup {
  optionGroupId: number;
  optionGroupName: string | null;
  description: string | null;
  mutuallyExclusive: boolean;
  required: boolean;
  noteLabel: string | null;
  optionPrices: ProductOptionPrice[];
}

interface Product {
  productId: number;
  productName: string | null;
  description: string | null;
  basePrice: number;
  depositPrice: number | null;
  priceCurrency: number | null;
  hasPromoCode: boolean;
  feesWillBeCollected: boolean;
  optionGroups: ProductOptionGroup[];
}

interface PromoCodeResponse {
  isValidPromoCode: boolean;
  optionPriceId: number | null;
  promoCodePrice: number;
  optionTitle: string | null;
  mutuallyExclusiveOptionGroupId: number | null;
  daysOutToHide: number | null;
}

interface SelectedProductOption {
  productId: number | null;
  productOptionId: number | null;
  quantity: number;
  isPromoCode: boolean;
  promoCode: string | null;
  invoiceDetailId: number | null;
}

interface FormResponseAnswer {
  Form_Field_ID: number;
  Form_Response_ID: number | null;
  Response: string | null;
}

interface ExistingParticipant {
  eventParticipantId: number;
  contactId: number | null;
  householdId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lineTotal: number;
  isMinorRegistration: boolean;
  minorFirstName: string | null;
  minorLastName: string | null;
  minorDateOfBirth: string | null;
  selectedProductOptions: SelectedProductOption[];
  formResponses: FormResponseAnswer[];
}

interface ExistingInvoice {
  isInvoiceExpired: boolean;
  isSomePaymentExists: boolean;
  expiredMessageKey: string | null;
  participants: ExistingParticipant[];
}

interface BasicContact {
  contactId: number;
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
  householdId: number | null;
}

interface HouseholdMemberLite {
  contactId: number;
  firstName: string;
  lastName: string;
  nickName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
  dateOfBirth: string | null;
  householdPositionId: number | null;
}

interface HouseholdAddressLite {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateRegion: string;
  postalCode: string;
}

// Household positions that may register as a minor attendee (Minor Child / Adult Child).
const MINOR_POSITION_IDS = [2, 4];

interface PromoRow {
  code: string;
  amount: number;
  exclusiveGroupId: number | null;
}

type SubmitAction =
  | "registerAndCheckout"
  | "registerAndAddAnother"
  | "saveAndCheckout"
  | "saveAndAddAnother";

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * `next-event-details` — single-event view + registration flow.
 *
 * Ported from the legacy `mpp-event-details` portal widget. Supports event
 * display (image/date/description/contacts/rooms/map/ICS), visibility gating,
 * an authenticated/anonymous registration form with product options, promo
 * codes, a depends-on custom form, existing-invoice participant editing, and
 * checkout redirect.
 *
 * Simplifications relative to legacy (noted inline):
 *  - "Register As" is populated from the authenticated basic-contact only (no
 *    household-member endpoint is wired here).
 *  - Custom-form FileUpload renders an input but is not submitted in v1.
 *  - Send-email "Email a Friend" emits `emailRequested` (no send endpoint).
 */
export class EventDetailsWidget extends MPNextWidget {
  private event: EventDetail | null = null;
  private product: Product | null = null;
  private customFields: CustomFormField[] = [];
  private participants: ExistingParticipant[] = [];
  private promos: PromoRow[] = [];

  private loading = true;
  private error: string | null = null;
  private message: { type: string; text: string } | null = null;

  private isAuthenticated = false;
  private contact: BasicContact | null = null;
  private householdMembers: HouseholdMemberLite[] = [];
  private householdAddress: HouseholdAddressLite | null = null;
  private alreadyRegistered = false;
  private invoiceId: string | null = null;
  private editingParticipantId: number | null = null;
  private sessionExpired = false;
  private promoError = false;

  static get observedAttributes() {
    return [
      "api-host",
      "event-id",
      "id-parameter-name",
      "invoice-id-parameter-name",
      "return-url",
      "checkout-url",
      "opportunity-finder-url",
      "invoice-id",
    ];
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (name === "event-id" && this.event) {
      this.init();
    }
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + CUSTOM_FORM_STYLES);
    this.render();
    this.init();
  }

  // ── Attribute helpers ───────────────────────────────────────────────────

  private get idParam(): string {
    return this.getAttribute("id-parameter-name") || "id";
  }
  private get invoiceIdParam(): string {
    return this.getAttribute("invoice-id-parameter-name") || "id";
  }
  private get returnUrl(): string {
    return this.getAttribute("return-url") || "";
  }
  private get checkoutUrl(): string {
    return this.getAttribute("checkout-url") || "";
  }
  private get opportunityFinderUrl(): string {
    return (this.getAttribute("opportunity-finder-url") || "").trim();
  }

  private resolveEventId(): string {
    const attr = this.getAttribute("event-id");
    if (attr) return attr;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get(this.idParam) || params.get("id") || "";
    } catch {
      return "";
    }
  }

  private resolveInvoiceId(): string | null {
    const attr = this.getAttribute("invoice-id");
    if (attr) return attr;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("invoiceid") || params.get("invoiceId") || null;
    } catch {
      return null;
    }
  }

  // ── Init / load ─────────────────────────────────────────────────────────

  private async init() {
    this.loading = true;
    this.error = null;
    this.message = null;
    this.event = null;
    this.product = null;
    this.participants = [];
    this.promos = [];
    this.editingParticipantId = null;
    this.sessionExpired = false;
    this.householdMembers = [];
    this.householdAddress = null;
    this.alreadyRegistered = false;
    this.render();

    const eventId = this.resolveEventId();
    if (!eventId) {
      this.error = "No event specified.";
      this.loading = false;
      this.render();
      this.attachListeners();
      this.emit("eventDetailError", { error: this.error });
      return;
    }

    try {
      // 1. Load event
      const res = await this.fetch(`/api/embed/event-details/${encodeURIComponent(eventId)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: { event: EventDetail; isUserStaff: boolean } = await res.json();
      if (!data || !data.event) {
        throw new Error("This event is not available.");
      }
      this.event = data.event;
      if (typeof data.isUserStaff === "boolean") {
        this.event.isUserStaff = data.isUserStaff;
      }

      // 2. Determine auth (+ household for the Register As picker / prefill)
      await this.loadBasicContact();
      if (this.isAuthenticated) await this.loadHousehold();

      this.invoiceId = this.resolveInvoiceId();

      this.loading = false;
      this.render();

      // 3. Visibility gating
      if (!this.isEventViewable()) {
        this.attachListeners();
        return;
      }

      this.emit("eventDetailLoaded", { eventId: this.event.id, title: this.event.title });

      // 4 + 5. Load forms / participants
      await this.prepareRegistration();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "No event found.";
      this.event = null;
      this.loading = false;
      this.render();
      this.attachListeners();
      this.emit("eventDetailError", { error: this.error });
      return;
    }

    this.render();
    this.attachListeners();
  }

  private async loadBasicContact() {
    try {
      const res = await this.fetch(`/api/embed/event-details/basic-contact`);
      if (res.status === 401) {
        this.isAuthenticated = false;
        this.contact = null;
        return;
      }
      if (!res.ok) {
        this.isAuthenticated = false;
        return;
      }
      const data: { contact: BasicContact } = await res.json();
      this.contact = data.contact ?? null;
      this.isAuthenticated = !!this.contact;
    } catch {
      this.isAuthenticated = false;
      this.contact = null;
    }
  }

  /** Load the signed-in user's household (members + address) for Register As. */
  private async loadHousehold() {
    try {
      const res = await this.fetch(`/api/embed/household`);
      if (!res.ok) return;
      const data: {
        members?: HouseholdMemberLite[];
        household?: { address?: HouseholdAddressLite | null };
      } = await res.json();
      this.householdMembers = data.members ?? [];
      this.householdAddress = data.household?.address ?? null;
    } catch {
      this.householdMembers = [];
      this.householdAddress = null;
    }
  }

  /** Notify the user if the selected contact is already registered. */
  private async checkAlreadyRegistered(contactId: number | null) {
    const ev = this.event;
    if (!ev || !contactId) {
      this.alreadyRegistered = false;
      return;
    }
    try {
      const res = await this.fetch(
        `/api/embed/event-details/has-registered?eventId=${ev.eventId}&contactId=${contactId}`,
      );
      if (!res.ok) {
        this.alreadyRegistered = false;
        return;
      }
      const data: { hasRegistered: boolean } = await res.json();
      this.alreadyRegistered = !!data.hasRegistered;
    } catch {
      this.alreadyRegistered = false;
    }
    const el = this.root.querySelector<HTMLElement>("#ed-already-registered");
    if (el) el.style.display = this.alreadyRegistered ? "" : "none";
  }

  private isEventViewable(): boolean {
    if (!this.event) return false;
    switch (this.event.visibilityLevelId) {
      case 1:
        this.message = { type: "warning", text: "This event is private." };
        return false;
      case 2:
        if (this.event.isUserStaff) return true;
        this.message = { type: "warning", text: "This event is only available to staff." };
        return false;
      default:
        return true;
    }
  }

  /** Loads product/custom-form/participants depending on registration state. */
  private async prepareRegistration() {
    const ev = this.event;
    if (!ev) return;

    if (ev.externalRegistrationUrl) return; // external — no internal form
    if (ev.isRegistrationFull) {
      this.message = { type: "warning", text: "Registration is full." };
      this.render();
      this.attachListeners();
      return;
    }

    // forceLogin + anonymous → show sign-in panel only.
    if (ev.forceLogin && !this.isAuthenticated) {
      this.render();
      this.attachListeners();
      return;
    }

    const productId = ev.registrationProductId;
    if (ev.registrationActive && productId && productId > 0) {
      if (ev.isRegistrationOptionsFull) {
        this.message = { type: "warning", text: "Registration is full." };
      } else {
        await this.loadProduct(productId);
        await this.loadCustomForm();
      }
    }

    // Existing invoice → load participants.
    if (this.invoiceId) {
      await this.loadParticipants();
    }

    this.render();
    this.attachListeners();
  }

  private async loadProduct(productId: number) {
    if (!this.event) return;
    const params = new URLSearchParams({ eventId: String(this.event.eventId) });
    const epId = this.getSelectedParticipantId();
    if (epId) params.set("eventParticipantId", String(epId));
    try {
      const res = await this.fetch(
        `/api/embed/event-products/${productId}?${params.toString()}`,
      );
      if (!res.ok) return;
      const data: { product: Product | null } = await res.json();
      this.product = data.product ?? null;
    } catch {
      this.product = null;
    }
  }

  private async loadCustomForm() {
    if (!this.event || !this.event.customFormId) {
      this.customFields = [];
      return;
    }
    try {
      const res = await this.fetch(
        `/api/embed/custom-form?formId=${this.event.customFormId}`,
      );
      if (!res.ok) {
        this.customFields = [];
        return;
      }
      const data: { fields: CustomFormField[] } = await res.json();
      this.customFields = (data.fields || []).sort(
        (a, b) => a.fieldOrder - b.fieldOrder,
      );
    } catch {
      this.customFields = [];
    }
  }

  private async loadParticipants(clearInvoiceId = true) {
    if (!this.invoiceId) return;
    try {
      const res = await this.fetch(
        `/api/embed/event-details/participants/${encodeURIComponent(this.invoiceId)}`,
      );
      if (!res.ok) {
        this.participants = [];
        return;
      }
      const data: ExistingInvoice = await res.json();
      if (data.isInvoiceExpired) {
        this.handleExpiredInvoice(data.expiredMessageKey, clearInvoiceId);
        return;
      }
      this.sessionExpired = false;
      if ((data.isSomePaymentExists || !data.participants) && clearInvoiceId) {
        // Stale/paid invoice — drop it and start fresh.
        this.invoiceId = null;
        this.participants = [];
        return;
      }
      this.participants = data.participants ?? [];
    } catch {
      this.participants = [];
    }
  }

  private handleExpiredInvoice(_messageKey: string | null, clearInvoiceId: boolean) {
    this.sessionExpired = true;
    if (clearInvoiceId) {
      this.invoiceId = null;
      this.participants = [];
    }
    this.message = {
      type: "warning",
      text: "Your registration session expired.",
    };
  }

  // ── Registration submit ───────────────────────────────────────────────

  private async submit(action: SubmitAction) {
    if (this.sessionExpired) return;
    const form = this.root.querySelector<HTMLFormElement>("#ed-form");
    if (!form) return;

    if (!form.reportValidity()) {
      this.setMessage("danger", "Please verify the registration details.");
      return;
    }

    // DOB-in-future guard.
    const dob = this.root.querySelector<HTMLInputElement>("#ed-attendee-dob");
    if (dob && dob.value) {
      const dobDate = this.parseMpDate(dob.value);
      if (dobDate && dobDate.getTime() > Date.now()) {
        this.setMessage("danger", "Date of birth cannot be in the future.");
        return;
      }
    }

    const payload = this.gatherFormData(form);

    this.setSubmitDisabled(true);
    try {
      const res = await this.fetch(`/api/embed/event-details/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body && body.message === "INVOICE-EXPIRED") {
          this.handleExpiredInvoice("registrationExpiredMessage", true);
          this.render();
          this.attachListeners();
          return;
        }
      }

      const data: { success: boolean; guid: string | null; message?: string } =
        await res.json().catch(() => ({ success: false, guid: null }));

      if (!data.success) {
        const msg = data.message || "Unable to save your registration.";
        this.setMessage("danger", msg);
        this.emit("registrationError", { error: msg });
        this.setSubmitDisabled(false);
        return;
      }

      this.sessionExpired = false;
      this.emit("registrationSaved", { guid: data.guid });

      if (action === "registerAndCheckout" || action === "saveAndCheckout") {
        this.redirectToCheckout(data.guid || this.invoiceId || "");
        return;
      }

      // *AddAnother → store guid, reload participants, reset form.
      this.invoiceId = data.guid;
      this.editingParticipantId = null;
      this.promos = [];
      await this.loadParticipants(false);
      this.setMessage("success", "Saved. Add another person below.");
      this.render();
      this.attachListeners();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Registration failed.";
      this.setMessage("danger", msg);
      this.emit("registrationError", { error: msg });
      this.setSubmitDisabled(false);
    }
  }

  private redirectToCheckout(guid: string) {
    const base = this.checkoutUrl;
    if (!base) return;
    try {
      const url = new URL(base, window.location.href);
      url.searchParams.set(this.invoiceIdParam, guid);
      window.location.href = url.toString();
    } catch {
      const sep = base.includes("?") ? "&" : "?";
      window.location.href = `${base}${sep}${this.invoiceIdParam}=${encodeURIComponent(guid)}`;
    }
  }

  /** Flatten all dynamic + well-known form fields into a string→string map. */
  private gatherFormData(form: HTMLFormElement): Record<string, string> {
    const out: Record<string, string> = {};
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (typeof value === "string") {
        out[key] = value;
      }
      // File entries (custom-form FileUpload) are not submitted in v1.
    }

    const ev = this.event;
    if (ev) {
      out.EventId = String(ev.eventId);
      out.IsMinorRegistration = String(ev.minorRegistration);
      if (ev.registrationProductId) out.ProductId = String(ev.registrationProductId);
      if (ev.customFormId) out.mp_customformformid = String(ev.customFormId);
    }
    if (this.contact) {
      out.HouseholdId = this.contact.householdId != null ? String(this.contact.householdId) : "";
      out.CurrentUserContactId = String(this.contact.contactId);
    }
    if (this.invoiceId) out.InvoiceId = this.invoiceId;

    // ContactId: "Blank Form" sentinel means anonymous/blank — drop it.
    if (out.ContactId === "Blank Form" || out.ContactId === "") {
      delete out.ContactId;
    }

    // Promo rows (these are not real inputs in our render — inject them).
    for (const p of this.promos) {
      out[`promo_${p.code}`] = p.code;
    }

    return out;
  }

  private setSubmitDisabled(disabled: boolean) {
    this.root
      .querySelectorAll<HTMLButtonElement>(".ed-submit")
      .forEach((b) => (b.disabled = disabled));
  }

  // ── Promo codes ─────────────────────────────────────────────────────────

  private async applyPromo(code: string) {
    if (!this.event || !this.product || !code) return;
    this.promoError = false;
    try {
      const params = new URLSearchParams({ promoCode: code });
      const res = await this.fetch(
        `/api/embed/event-products/${this.product.productId}/promo?${params.toString()}`,
      );
      if (!res.ok) {
        this.promoError = true;
        this.render();
        this.attachListeners();
        return;
      }
      const data: { promo: PromoCodeResponse } = await res.json();
      const promo = data.promo;

      const exclusiveDup =
        promo.mutuallyExclusiveOptionGroupId != null &&
        this.promos.some((p) => p.exclusiveGroupId === promo.mutuallyExclusiveOptionGroupId);

      const withinDaysOut = this.promoWithinDaysOut(promo.daysOutToHide);

      if (
        promo.isValidPromoCode &&
        promo.promoCodePrice !== 0 &&
        !exclusiveDup &&
        !withinDaysOut &&
        !this.promos.some((p) => p.code === code)
      ) {
        this.promos.push({
          code,
          amount: promo.promoCodePrice,
          exclusiveGroupId: promo.mutuallyExclusiveOptionGroupId,
        });
        this.promoError = false;
      } else {
        this.promoError = true;
      }
    } catch {
      this.promoError = true;
    }
    this.render();
    this.attachListeners();
  }

  private promoWithinDaysOut(daysOutToHide: number | null): boolean {
    if (!daysOutToHide || daysOutToHide <= 0 || !this.event) return false;
    const start = this.parseMpDate(this.event.startDate);
    if (!start) return false;
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const msPerDay = 1000 * 60 * 60 * 24;
    const todayDay = startOfDay(new Date()).getTime();
    const eventDay = startOfDay(start).getTime();
    const daysUntil = Math.round((eventDay - todayDay) / msPerDay);
    return daysUntil >= 0 && daysUntil <= daysOutToHide;
  }

  private removePromo(code: string) {
    this.promos = this.promos.filter((p) => p.code !== code);
    this.render();
    this.attachListeners();
  }

  // ── Total ─────────────────────────────────────────────────────────────

  private getSelectedParticipantId(): number | null {
    return this.editingParticipantId;
  }

  /** Port of ProductFormBuilder.CalculateTotal + CalculateParticipantsTotal. */
  private calculateTotal(): number {
    let total = this.product?.basePrice ?? 0;
    const groups = this.product?.optionGroups ?? [];
    const form = this.root.querySelector<HTMLFormElement>("#ed-form");

    if (form) {
      form.querySelectorAll<HTMLInputElement>('input[name^="product-checkbox"]').forEach((el) => {
        if (!el.checked) return;
        const parts = el.name.split("_");
        const groupId = Number(parts[1]);
        const priceId = Number(parts[2]);
        const qtyEl = form.querySelector<HTMLSelectElement | HTMLInputElement>(
          `[name="product-qty_${groupId}_${priceId}"]`,
        );
        const qty = qtyEl ? Number(qtyEl.value) || 0 : 0;
        const price = this.findOptionPrice(groups, groupId, priceId);
        if (price) total += qty * price.optionPrice;
      });

      form.querySelectorAll<HTMLInputElement>('input[name^="product-radio"]').forEach((el) => {
        if (!el.checked || !el.value) return;
        const parts = el.name.split("_");
        const groupId = Number(parts[1]);
        const priceId = Number(el.value);
        const qtyEl = form.querySelector<HTMLSelectElement | HTMLInputElement>(
          `[name="product-qty_${groupId}_${priceId}"]`,
        );
        const qty = qtyEl ? Number(qtyEl.value) || 1 : 1;
        const price = this.findOptionPrice(groups, groupId, priceId);
        if (price) total += qty * price.optionPrice;
      });
    }

    for (const p of this.promos) {
      total += p.amount;
    }

    total = Math.max(0, total);
    total += this.calculateParticipantsTotal();
    return Math.max(0, total);
  }

  private calculateParticipantsTotal(): number {
    let total = 0;
    const skip = this.getSelectedParticipantId();
    for (const p of this.participants) {
      if (skip === null || p.eventParticipantId !== skip) {
        total += Math.max(0, p.lineTotal);
      }
    }
    return Math.max(0, total);
  }

  private findOptionPrice(
    groups: ProductOptionGroup[],
    groupId: number,
    priceId: number,
  ): ProductOptionPrice | null {
    const g = groups.find((x) => x.optionGroupId === groupId);
    return g?.optionPrices.find((p) => p.optionPriceId === priceId) ?? null;
  }

  private updateTotal() {
    const el = this.root.querySelector<HTMLElement>("#ed-total-value");
    if (el) el.textContent = CURRENCY.format(this.calculateTotal());
  }

  // ── Participant remove ────────────────────────────────────────────────

  private async removeParticipant(eventParticipantId: number) {
    const participant = this.participants.find(
      (p) => p.eventParticipantId === eventParticipantId,
    );
    if (!participant) return;

    let invoiceDetailId: number | null =
      participant.selectedProductOptions[0]?.invoiceDetailId ?? null;

    if (!invoiceDetailId) {
      try {
        const res = await this.fetch(
          `/api/embed/event-details/invoice-detail?eventParticipantId=${eventParticipantId}`,
        );
        if (res.ok) {
          const data: { invoiceDetailId: number } = await res.json();
          invoiceDetailId = data.invoiceDetailId > 0 ? data.invoiceDetailId : null;
        }
      } catch {
        invoiceDetailId = null;
      }
    }

    if (!invoiceDetailId) {
      this.setMessage("warning", "Unable to find the invoice.");
      return;
    }

    try {
      const res = await this.fetch(`/api/embed/event-details/delete-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceDetailId }),
      });
      const data: { success: boolean; message?: string } = await res
        .json()
        .catch(() => ({ success: false }));
      if (data.success) {
        this.participants = this.participants.filter(
          (p) => p.eventParticipantId !== eventParticipantId,
        );
        this.emit("participantRemoved", { eventParticipantId });
        if (this.participants.length === 0) {
          this.invoiceId = null;
        }
        this.render();
        this.attachListeners();
      } else {
        this.setMessage("warning", data.message || "Unable to delete the registration.");
      }
    } catch {
      this.setMessage("warning", "An error occurred while deleting the registration.");
    }
  }

  private setMessage(type: string, text: string) {
    this.message = { type, text };
    const container = this.root.querySelector<HTMLElement>("#ed-message");
    if (container) {
      container.className = `ed-message ed-message--${type}`;
      container.textContent = text;
      container.style.display = "";
    } else {
      this.render();
      this.attachListeners();
    }
  }

  // ── Listeners ─────────────────────────────────────────────────────────

  private attachListeners() {
    const back = this.root.querySelector('[data-action="back"]');
    if (back) back.addEventListener("click", () => this.init());

    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.emit("loginRequired"));

    const email = this.root.querySelector('[data-action="email"]');
    if (email) {
      email.addEventListener("click", () => {
        this.emit("emailRequested", { eventId: this.event?.eventId });
        this.setMessage("info", "Emailing a friend is not available in this widget.");
      });
    }

    // Register-As dropdown (single contact + Blank Form).
    const registerAs = this.root.querySelector<HTMLSelectElement>("#ed-register-as");
    if (registerAs) {
      registerAs.addEventListener("change", () => this.applyRegisterAs(registerAs.value));
    }

    // Recompute total on any product input change.
    const form = this.root.querySelector<HTMLFormElement>("#ed-form");
    if (form) {
      form.addEventListener("change", (e) => {
        const target = e.target as HTMLElement;
        if (
          target &&
          (target.classList.contains("product-checkbox") ||
            target.classList.contains("product-radio") ||
            target.classList.contains("product-select"))
        ) {
          this.syncCheckboxQtyState();
          this.updateTotal();
        }
      });
    }

    // Promo apply.
    const promoBtn = this.root.querySelector('[data-action="apply-promo"]');
    if (promoBtn) {
      promoBtn.addEventListener("click", () => {
        const input = this.root.querySelector<HTMLInputElement>("#ed-promo-input");
        if (input && input.value.trim()) {
          this.applyPromo(input.value.trim());
          input.value = "";
        }
      });
    }
    this.root.querySelectorAll('[data-action="remove-promo"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const code = (el as HTMLElement).getAttribute("data-promo") || "";
        this.removePromo(code);
      });
    });

    // Submit buttons.
    this.root.querySelectorAll<HTMLButtonElement>(".ed-submit").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const action = btn.getAttribute("data-action") as SubmitAction;
        this.submit(action);
      });
    });

    // Checkout (existing invoice, no new submit).
    const checkout = this.root.querySelector('[data-action="checkout"]');
    if (checkout) {
      checkout.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.invoiceId) this.redirectToCheckout(this.invoiceId);
      });
    }

    // Participant remove buttons.
    this.root.querySelectorAll('[data-action="remove-participant"]').forEach((el) => {
      el.addEventListener("click", () => {
        const id = Number((el as HTMLElement).getAttribute("data-participant-id"));
        if (id) this.removeParticipant(id);
      });
    });

    if (form) bindCustomFormDependsOn(form, this.customFields);
    this.updateTotal();
  }

  /** Enable/disable a checkbox's qty select to mirror its checked state. */
  private syncCheckboxQtyState() {
    const form = this.root.querySelector<HTMLFormElement>("#ed-form");
    if (!form) return;
    form.querySelectorAll<HTMLInputElement>("input.product-checkbox").forEach((cb) => {
      const parts = cb.name.split("_");
      const sel = form.querySelector<HTMLSelectElement>(
        `#product-qty_${parts[1]}_${parts[2]}`,
      );
      if (sel) sel.disabled = !cb.checked;
    });
  }

  private applyRegisterAs(value: string) {
    const setVal = (sel: string, v: string) => {
      const el = this.root.querySelector<HTMLInputElement>(sel);
      if (el) el.value = v;
    };
    const contactIdInput = this.root.querySelector<HTMLInputElement>("#ed-contact-id");
    if (contactIdInput) contactIdInput.value = value;

    if (value === "Blank Form" || value === "") {
      setVal("#ed-first-name", "");
      setVal("#ed-last-name", "");
      setVal("#ed-email", "");
      setVal("#ed-phone", "");
      this.alreadyRegistered = false;
      const note = this.root.querySelector<HTMLElement>("#ed-already-registered");
      if (note) note.style.display = "none";
      return;
    }

    const member = this.householdMembers.find((m) => String(m.contactId) === value);
    const ev = this.event!;
    if (ev.minorRegistration) {
      // Minor attendee from the selected member; parent from the signed-in user.
      if (member) {
        setVal('input[name="attendeeFirstName"]', member.firstName || "");
        setVal('input[name="attendeeLastName"]', member.lastName || "");
        if (member.dateOfBirth) setVal("#ed-attendee-dob", member.dateOfBirth.slice(0, 10));
      }
      if (this.contact) {
        setVal('input[name="parentFirstName"]', this.contact.firstName || "");
        setVal('input[name="parentLastName"]', this.contact.lastName || "");
        setVal('input[name="parentEmailAddress"]', this.contact.emailAddress || "");
        setVal('input[name="parentMobilePhoneNumber"]', this.contact.mobilePhoneNumber || "");
      }
    } else {
      setVal("#ed-first-name", (member ? member.firstName : this.contact?.firstName) || "");
      setVal("#ed-last-name", (member ? member.lastName : this.contact?.lastName) || "");
      setVal("#ed-email", (member ? member.emailAddress : this.contact?.emailAddress) || "");
      setVal("#ed-phone", (member ? member.mobilePhoneNumber : this.contact?.mobilePhoneNumber) || "");
    }
    this.fillAddress();
    void this.checkAlreadyRegistered(Number(value) || null);
  }

  /** Prefill empty address inputs from the household address. */
  private fillAddress() {
    const a = this.householdAddress;
    if (!a) return;
    const setIfEmpty = (name: string, v: string) => {
      const el = this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (el && !el.value) el.value = v;
    };
    setIfEmpty("AddressLine1", a.addressLine1 || "");
    setIfEmpty("AddressLine2", a.addressLine2 || "");
    setIfEmpty("City", a.city || "");
    setIfEmpty("StateRegion", a.stateRegion || "");
    setIfEmpty("PostalCode", a.postalCode || "");
  }

  // ── Render ────────────────────────────────────────────────────────────

  render() {
    if (this.loading) {
      this.root.innerHTML = `<div class="ed">${this.renderState(this.spinnerSvg(), "Loading event…")}</div>`;
      return;
    }
    if (this.error || !this.event) {
      this.root.innerHTML = `
        <div class="ed">
          ${this.renderBackLink()}
          <div class="ed-state ed-error">
            <p>${this.escapeHtml(this.error || "No event found.")}</p>
          </div>
        </div>`;
      return;
    }

    this.root.innerHTML = `
      <div class="ed">
        ${this.renderBackLink()}
        ${this.renderMessage()}
        ${this.renderEventDetails()}
        ${this.renderRegistration()}
      </div>`;
  }

  private renderBackLink(): string {
    if (!this.returnUrl) return "";
    return `<div class="ed-back"><a href="${this.escapeAttr(this.returnUrl)}">&larr; Back to events</a></div>`;
  }

  private renderMessage(): string {
    if (!this.message) return `<div id="ed-message" class="ed-message" style="display:none"></div>`;
    return `<div id="ed-message" class="ed-message ed-message--${this.escapeAttr(this.message.type)}">${this.escapeHtml(this.message.text)}</div>`;
  }

  private renderEventDetails(): string {
    const ev = this.event!;
    const img = ev.imageUrl
      ? `<div class="ed-image" style="background-image:url('${this.escapeAttr(ev.imageUrl)}')"></div>`
      : "";
    const labels =
      ev.attributes && ev.attributes.length
        ? `<ul class="ed-labels">${ev.attributes
            .map((a) => `<li>${this.escapeHtml(a)}</li>`)
            .join("")}</ul>`
        : "";

    const dateRange = this.formatDateRange(ev.startDate, ev.endDate);
    const description = ev.description
      ? `<section class="ed-description">${this.sanitizeHtml(ev.description)}</section>`
      : "";

    const meeting = ev.meetingInstructions
      ? this.specialText("Meeting Instructions", ev.meetingInstructions)
      : "";
    const location = ev.location ? this.specialText("Location", ev.location) : "";

    const rooms = this.renderRooms();
    const contacts = this.renderContacts();
    const map = this.renderMap();
    const ics = this.renderIcsLink();
    const buttons = this.renderEventButtons();

    return `
      <div class="ed-detail">
        ${img}
        <h1 class="ed-title">${this.escapeHtml(ev.title)}</h1>
        ${labels}
        <div class="ed-datetime">${this.escapeHtml(dateRange)}</div>
        ${description}
        ${contacts}
        ${meeting}
        ${location}
        ${rooms}
        ${map}
        <div class="ed-actions">
          ${ics}
          ${buttons}
        </div>
      </div>`;
  }

  private specialText(title: string, body: string): string {
    return `<div class="ed-special"><div class="ed-special-title">${this.escapeHtml(title)}</div><div class="ed-special-body">${this.escapeHtml(body)}</div></div>`;
  }

  private renderRooms(): string {
    const ev = this.event!;
    if (!ev.rooms || !ev.showBuildingRoomInfo) return "";
    const active = ev.rooms.filter((r) => !r.cancelled);
    const seen = new Set<string>();
    const infos: string[] = [];
    for (const r of active) {
      if (r.roomInfo && !seen.has(r.roomInfo)) {
        seen.add(r.roomInfo);
        infos.push(r.roomInfo);
      }
    }
    if (infos.length === 0) return "";
    return `<div class="ed-special"><div class="ed-special-title">Room(s)</div><div class="ed-special-body">${infos
      .map((i) => this.escapeHtml(i))
      .join("<br/>")}</div></div>`;
  }

  private renderContacts(): string {
    const ev = this.event!;
    if (!ev.contacts || ev.contacts.length === 0) return "";
    const items = ev.contacts
      .map((c) => {
        const name = this.escapeHtml(c.displayName || "");
        const canEmail = ev.allowEmail && c.emailAddress;
        const inner = canEmail
          ? `<a href="mailto:${this.escapeAttr(c.emailAddress!)}">${name}</a>`
          : name;
        const badge = c.imageUrl
          ? `<span class="ed-contact-badge" style="background-image:url('${this.escapeAttr(c.imageUrl)}')"></span>`
          : `<span class="ed-contact-badge">${name.charAt(0)}</span>`;
        return `<li class="ed-contact">${badge}<span>${inner}</span></li>`;
      })
      .join("");
    return `<div class="ed-special"><div class="ed-special-title">Contact(s)</div><ul class="ed-contacts">${items}</ul></div>`;
  }

  private renderMap(): string {
    const ev = this.event!;
    if (ev.latitude == null || ev.longitude == null) return "";
    const q = `${ev.latitude},${ev.longitude}`;
    const directions = `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
    return `
      <div class="ed-map">
        <iframe
          title="Event location map"
          src="https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"></iframe>
        <a class="ed-link" href="${this.escapeAttr(directions)}" target="_blank" rel="noopener">Get Directions &rsaquo;</a>
      </div>`;
  }

  private renderIcsLink(): string {
    const ev = this.event!;
    const start = ev.startDateUTC || ev.startDate;
    const end = ev.endDateUTC || ev.endDate;
    if (!start) return "";
    const loc = [ev.location, ev.address].filter(Boolean).join(" - ");
    const href = this.buildIcsHref(ev.title, ev.description || "", loc, start, end);
    return `<a class="ed-link ed-ics" href="${href}" download="event.ics">Add to Calendar &rsaquo;</a>`;
  }

  /** Port of ICSCalendarBuilder.GetICSHrefValue (data: URL). */
  private buildIcsHref(
    title: string,
    description: string,
    location: string,
    start: string,
    end: string,
  ): string {
    const fmt = (d: string) =>
      d ? d.replace(/-/g, "").replace(/:/g, "") + "Z" : "";
    const nl = "%0A";
    const startStr = fmt(start);
    const endStr = fmt(end);
    const summary = `SUMMARY:${encodeURIComponent(title)}${nl}`;
    const desc = `DESCRIPTION:${encodeURIComponent(this.stripHtml(description))}${nl}`;
    const loc = `LOCATION:${encodeURIComponent(location)}${nl}`;
    const dtStart = `DTSTART:${startStr}${nl}`;
    const dtEnd = endStr ? `DTEND:${endStr}${nl}` : "";
    const content = `${dtStart}${dtEnd}${summary}${desc}${loc}`;
    return `data:text/calendar;charset=utf8,BEGIN:VCALENDAR${nl}VERSION:2.0${nl}BEGIN:VEVENT${nl}${content}END:VEVENT${nl}END:VCALENDAR${nl}`;
  }

  private renderEventButtons(): string {
    const ev = this.event!;
    const parts: string[] = [];
    if (ev.externalRegistrationUrl) {
      parts.push(
        `<a class="ed-btn ed-btn--primary" href="${this.escapeAttr(ev.externalRegistrationUrl)}" target="_blank" rel="noopener">Register</a>`,
      );
    }
    if (ev.opportunityCount > 0 && this.isValidUrl(this.opportunityFinderUrl)) {
      const url = this.buildOpportunityUrl();
      if (url) {
        parts.push(`<a class="ed-btn ed-btn--secondary" href="${this.escapeAttr(url)}">Volunteer</a>`);
      }
    }
    if (ev.allowEmail) {
      parts.push(`<button class="ed-btn ed-btn--ghost" type="button" data-action="email">Email a Friend</button>`);
    }
    return parts.join("");
  }

  private isValidUrl(url: string): boolean {
    return !!url && !["", "null", "#", "undefined"].includes(url.toLowerCase());
  }

  private buildOpportunityUrl(): string | null {
    const base = this.opportunityFinderUrl;
    if (!this.event) return null;
    try {
      const url = new URL(base, window.location.href);
      url.searchParams.set("eventid", String(this.event.eventId));
      return url.toString();
    } catch {
      const sep = base.includes("?") ? "&" : "?";
      return `${base}${sep}eventid=${this.event.eventId}`;
    }
  }

  // ── Render: registration ──────────────────────────────────────────────

  private renderRegistration(): string {
    const ev = this.event!;
    if (ev.externalRegistrationUrl) return "";
    if (ev.isRegistrationFull) return "";

    // forceLogin + anonymous → sign-in panel only.
    if (ev.forceLogin && !this.isAuthenticated) {
      return `
        <div class="ed-reg ed-login-panel">
          <p>Please sign in to register for this event.</p>
          <button class="ed-btn ed-btn--primary" type="button" data-action="login">Sign In</button>
        </div>`;
    }

    const productId = ev.registrationProductId;
    const regActive = ev.registrationActive && productId && productId > 0;

    if (!regActive) {
      if (productId && productId > 0) {
        return `<div class="ed-reg"><div class="ed-message ed-message--warning">Registration is not currently active.</div></div>`;
      }
      return "";
    }

    if (ev.isRegistrationOptionsFull) {
      return `<div class="ed-reg"><div class="ed-message ed-message--warning">Registration is full.</div></div>`;
    }

    return `
      <div class="ed-reg">
        <h2 class="ed-reg-title">Register</h2>
        ${this.renderParticipants()}
        <form id="ed-form" class="ed-form" novalidate>
          ${this.renderHiddenInputs()}
          ${this.renderRegisterAs()}
          ${this.renderAttendeeFields()}
          ${this.renderProductOptions()}
          ${this.renderPromoSection()}
          ${this.renderCustomFormSection()}
          ${this.renderTotal()}
          ${this.renderSubmitButtons()}
        </form>
      </div>`;
  }

  private renderHiddenInputs(): string {
    const ev = this.event!;
    return `
      <input type="hidden" name="EventId" value="${ev.eventId}">
      <input type="hidden" name="HouseholdId" value="${this.contact?.householdId ?? ""}">
      <input type="hidden" name="IsMinorRegistration" value="${ev.minorRegistration}">
      <input type="hidden" name="InvoiceId" value="${this.escapeAttr(this.invoiceId || "")}">
      <input type="hidden" name="EventParticipantId" value="">
      <input type="hidden" name="FormResponseId" value="">
      <input type="hidden" name="ProductId" value="${ev.registrationProductId ?? ""}">
      <input type="hidden" name="CurrentUserContactId" value="${this.contact?.contactId ?? ""}">
      <input type="hidden" id="ed-contact-id" name="ContactId" value="">
      ${ev.registrationProductId ? `<input type="hidden" name="product-invoice-detail_${ev.registrationProductId}" value="">` : ""}`;
  }

  private renderRegisterAs(): string {
    if (!this.isAuthenticated || !this.contact) return "";
    const ev = this.event!;
    let members = this.householdMembers;
    if (ev.minorRegistration) {
      members = members.filter(
        (m) => m.householdPositionId != null && MINOR_POSITION_IDS.includes(m.householdPositionId),
      );
    }
    // Fall back to the signed-in contact when no household member list loaded.
    const optionList: HouseholdMemberLite[] = members.length
      ? members
      : [
          {
            contactId: this.contact.contactId,
            firstName: this.contact.firstName || "",
            lastName: this.contact.lastName || "",
            nickName: null,
            emailAddress: this.contact.emailAddress,
            mobilePhoneNumber: this.contact.mobilePhoneNumber,
            dateOfBirth: null,
            householdPositionId: null,
          },
        ];
    const opts = optionList
      .map(
        (m) =>
          `<option value="${m.contactId}">${this.escapeHtml(this.memberDisplayName(m))}</option>`,
      )
      .join("");
    return `
      <div class="ed-field">
        <label for="ed-register-as">Register As</label>
        <select id="ed-register-as" class="ed-input">
          <option value="">-- Select --</option>
          ${opts}
          <option value="Blank Form">Blank Form</option>
        </select>
      </div>
      <div id="ed-already-registered" class="ed-message ed-message--info" style="display:${this.alreadyRegistered ? "" : "none"}">This person is already registered for this event.</div>`;
  }

  private memberDisplayName(m: HouseholdMemberLite): string {
    const first = m.nickName || m.firstName;
    return `${first} ${m.lastName}`.trim() || "My Info";
  }

  private renderAttendeeFields(): string {
    const ev = this.event!;
    if (ev.minorRegistration) {
      return `
        <fieldset class="ed-fieldset">
          <legend>Attendee (Minor)</legend>
          <div class="ed-grid2">
            <div class="ed-field"><label>First Name</label><input class="ed-input" name="attendeeFirstName" required></div>
            <div class="ed-field"><label>Last Name</label><input class="ed-input" name="attendeeLastName" required></div>
          </div>
          <div class="ed-field"><label>Date of Birth</label><input id="ed-attendee-dob" class="ed-input" type="date" name="attendeeDateOfBirth" required></div>
        </fieldset>
        <fieldset class="ed-fieldset">
          <legend>Parent / Guardian</legend>
          <div class="ed-grid2">
            <div class="ed-field"><label>First Name</label><input class="ed-input" name="parentFirstName" required></div>
            <div class="ed-field"><label>Last Name</label><input class="ed-input" name="parentLastName" required></div>
          </div>
          <div class="ed-grid2">
            <div class="ed-field"><label>Email</label><input class="ed-input" type="email" name="parentEmailAddress" required></div>
            <div class="ed-field"><label>Mobile Phone</label><input class="ed-input" name="parentMobilePhoneNumber"></div>
          </div>
        </fieldset>
        ${this.renderAddressFields()}`;
    }
    return `
      <fieldset class="ed-fieldset">
        <legend>Attendee</legend>
        <div class="ed-grid2">
          <div class="ed-field"><label>First Name</label><input id="ed-first-name" class="ed-input" name="FirstName" required></div>
          <div class="ed-field"><label>Last Name</label><input id="ed-last-name" class="ed-input" name="LastName" required></div>
        </div>
        <div class="ed-grid2">
          <div class="ed-field"><label>Email</label><input id="ed-email" class="ed-input" type="email" name="EmailAddress" required></div>
          <div class="ed-field"><label>Mobile Phone</label><input id="ed-phone" class="ed-input" name="MobilePhoneNumber"></div>
        </div>
      </fieldset>
      ${this.renderAddressFields()}
      ${this.renderUpdateMyInfo()}`;
  }

  private renderAddressFields(): string {
    const required = this.event!.isFreeEvent ? "" : "required";
    return `
      <fieldset class="ed-fieldset">
        <legend>Address</legend>
        <div class="ed-field"><label>Address Line 1</label><input class="ed-input" name="AddressLine1" ${required}></div>
        <div class="ed-field"><label>Address Line 2</label><input class="ed-input" name="AddressLine2"></div>
        <div class="ed-grid3">
          <div class="ed-field"><label>City</label><input class="ed-input" name="City" ${required}></div>
          <div class="ed-field"><label>State / Region</label><input class="ed-input" name="StateRegion" ${required}></div>
          <div class="ed-field"><label>Postal Code</label><input class="ed-input" name="PostalCode" ${required}></div>
        </div>
      </fieldset>`;
  }

  private renderUpdateMyInfo(): string {
    if (!this.isAuthenticated) return "";
    return `
      <label class="ed-checkbox">
        <input type="checkbox" name="updateMyInfo" value="true"> Update my contact info with the above
      </label>`;
  }

  private renderProductOptions(): string {
    if (!this.product) return "";
    const groups = this.product.optionGroups.filter((g) =>
      g.optionPrices.some((p) => !p.isHidden),
    );
    if (groups.length === 0) return "";

    const groupsHtml = groups
      .map((group) => {
        const visible = group.optionPrices.filter((p) => !p.isHidden);
        const rows = group.mutuallyExclusive
          ? this.renderRadioGroup(group, visible)
          : this.renderCheckboxGroup(group, visible);
        const title = group.required
          ? `${this.escapeHtml(group.optionGroupName || "")} *`
          : this.escapeHtml(group.optionGroupName || "");
        const desc = group.description
          ? `<p class="ed-option-desc">${this.escapeHtml(group.description)}</p>`
          : "";
        return `
          <div class="ed-option-group">
            <h3 class="ed-option-title">${title}</h3>
            ${desc}
            <table class="ed-option-table">
              <thead><tr><th>Option</th><th>Qty</th><th>Price</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      })
      .join("");

    return `<div class="ed-product-options"><h3 class="ed-reg-subtitle">Add-ons</h3>${groupsHtml}</div>`;
  }

  private renderRadioGroup(group: ProductOptionGroup, prices: ProductOptionPrice[]): string {
    const gid = group.optionGroupId;
    let rows = "";
    if (!group.required) {
      rows += `
        <tr>
          <td><label><input type="radio" class="product-radio" name="product-radio_${gid}" value="" checked> Not Selected</label></td>
          <td></td><td></td>
        </tr>`;
    }
    rows += prices
      .map((p) => {
        const soldOut = p.qtyOnHand <= 0;
        const disabled = soldOut ? "disabled" : "";
        return `
          <tr class="${soldOut ? "ed-soldout" : ""}">
            <td>
              <label><input type="radio" class="product-radio" id="product-radio_${p.optionPriceId}" name="product-radio_${gid}" value="${p.optionPriceId}" ${group.required ? "required" : ""} ${disabled}> ${this.escapeHtml(p.optionTitle || "")}</label>
              ${this.renderNoteInput(group, p)}
              <input type="hidden" name="product-option-invoice-detail_${gid}_${p.optionPriceId}" value="">
            </td>
            <td>${this.renderQtyCell(group, p, true)}</td>
            <td>${CURRENCY.format(p.optionPrice)}</td>
          </tr>`;
      })
      .join("");
    return rows;
  }

  private renderCheckboxGroup(group: ProductOptionGroup, prices: ProductOptionPrice[]): string {
    const gid = group.optionGroupId;
    return prices
      .map((p) => {
        const soldOut = p.qtyOnHand <= 0;
        const disabled = soldOut ? "disabled" : "";
        return `
          <tr class="${soldOut ? "ed-soldout" : ""}">
            <td>
              <label><input type="checkbox" class="product-checkbox" id="product-checkbox_${gid}_${p.optionPriceId}" name="product-checkbox_${gid}_${p.optionPriceId}" ${disabled}> ${this.escapeHtml(p.optionTitle || "")}</label>
              ${this.renderNoteInput(group, p)}
              <input type="hidden" name="product-option-invoice-detail_${gid}_${p.optionPriceId}" value="">
            </td>
            <td>${this.renderQtyCell(group, p, false)}</td>
            <td>${CURRENCY.format(p.optionPrice)}</td>
          </tr>`;
      })
      .join("");
  }

  private renderNoteInput(group: ProductOptionGroup, p: ProductOptionPrice): string {
    if (!group.noteLabel) return "";
    return `<div><input type="text" class="ed-input ed-note" name="product-note_${group.optionGroupId}_${p.optionPriceId}" placeholder="${this.escapeAttr(group.noteLabel)}"></div>`;
  }

  /** Qty select range minQty..min(qtyAllowed, qtyOnHand||qtyAllowed). */
  private renderQtyCell(group: ProductOptionGroup, p: ProductOptionPrice, isRadio: boolean): string {
    const gid = group.optionGroupId;
    const name = `product-qty_${gid}_${p.optionPriceId}`;
    const remaining = p.qtyOnHand || p.qtyAllowed;
    const maxQty = Math.min(p.qtyAllowed, remaining);
    const minQty = p.minQty || 1;
    if (remaining > 1 && maxQty > 1) {
      let opts = "";
      for (let q = minQty; q <= maxQty; q++) {
        opts += `<option value="${q}">${q}</option>`;
      }
      // Checkbox qty selects start disabled (enabled when checkbox is ticked).
      const disabled = isRadio ? "" : "disabled";
      return `<select id="${name}" class="product-select ed-input ed-qty" name="${name}" ${disabled}>${opts}</select>`;
    }
    return `1<input type="hidden" id="${name}" name="${name}" value="1">`;
  }

  private renderPromoSection(): string {
    if (!this.product?.hasPromoCode) return "";
    const rows = this.promos
      .map(
        (p) => `
        <tr>
          <td>${this.escapeHtml(p.code)}</td>
          <td>${CURRENCY.format(p.amount)}</td>
          <td><a href="#" data-action="remove-promo" data-promo="${this.escapeAttr(p.code)}">Remove</a></td>
        </tr>`,
      )
      .join("");
    return `
      <div class="ed-promo">
        <label for="ed-promo-input">Promo Code</label>
        <div class="ed-promo-row">
          <input id="ed-promo-input" class="ed-input" type="text" placeholder="Enter code">
          <button class="ed-btn ed-btn--secondary" type="button" data-action="apply-promo">Apply</button>
        </div>
        ${this.promoError ? `<div class="ed-promo-error">Invalid promo code.</div>` : ""}
        ${this.promos.length ? `<table class="ed-promo-table"><tbody>${rows}</tbody></table>` : ""}
      </div>`;
  }

  private renderCustomFormSection(): string {
    if (!this.customFields.length) return "";
    const ev = this.event!;
    // Shared renderer — same implementation the standalone next-custom-form uses.
    return `
      <div class="ed-customform">
        <h3 class="ed-reg-subtitle">Additional Information</h3>
        ${renderCustomFormFields(this.customFields, { formId: ev.customFormId })}
      </div>`;
  }

  private renderTotal(): string {
    if (this.event!.isFreeEvent) return "";
    return `
      <div class="ed-total" id="ed-total">
        <span class="ed-total-label">Total</span>
        <span class="ed-total-value" id="ed-total-value">${CURRENCY.format(this.calculateTotal())}</span>
      </div>`;
  }

  private renderSubmitButtons(): string {
    const hasInvoice = !!this.invoiceId && this.participants.length > 0;
    const checkoutBtn = hasInvoice
      ? `<button class="ed-btn ed-btn--ghost" type="button" data-action="checkout">Checkout</button>`
      : "";
    return `
      <div class="ed-buttons">
        <button class="ed-btn ed-btn--primary ed-submit" type="button" data-action="registerAndCheckout">Register &amp; Checkout</button>
        <button class="ed-btn ed-btn--secondary ed-submit" type="button" data-action="registerAndAddAnother">Register &amp; Add Another</button>
        ${checkoutBtn}
      </div>`;
  }

  private renderParticipants(): string {
    if (!this.participants.length) return "";
    const rows = this.participants
      .map((p, i) => {
        const name = `${p.firstName || ""} ${p.lastName || ""}`.trim();
        const contacts = [p.email, p.phone].filter(Boolean).map((c) => this.escapeHtml(c!)).join(" · ");
        const price = this.event!.isFreeEvent ? "" : CURRENCY.format(p.lineTotal);
        const registered = p.lineTotal <= 0;
        const minor = p.isMinorRegistration
          ? `<div class="ed-participant-minor">Minor: ${this.escapeHtml(p.minorFirstName || "")} ${this.escapeHtml(p.minorLastName || "")}</div>`
          : "";
        const actions = registered
          ? `<span class="ed-registered">Registered</span>`
          : `<button class="ed-btn ed-btn--ghost ed-btn--sm" type="button" data-action="remove-participant" data-participant-id="${p.eventParticipantId}">Remove</button>`;
        return `
          <div class="ed-participant">
            <div class="ed-participant-head">Participant ${i + 1}</div>
            <div class="ed-participant-body">
              <div class="ed-participant-name">${this.escapeHtml(name)}</div>
              <div class="ed-participant-contacts">${contacts}</div>
              ${minor}
              <div class="ed-participant-footer">
                <span class="ed-participant-price">${price}</span>
                ${actions}
              </div>
            </div>
          </div>`;
      })
      .join("");
    return `<div class="ed-participants"><h3 class="ed-reg-subtitle">Participants</h3>${rows}</div>`;
  }

  private renderState(icon: string, text: string): string {
    return `<div class="ed-state">${icon}<span>${this.escapeHtml(text)}</span></div>`;
  }

  // ── Date / text helpers ───────────────────────────────────────────────

  /** Wall-clock parse of an MP datetime with no TZ day-shift. */
  private parseMpDate(value: string): Date | null {
    if (!value) return null;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) {
      const fallback = new Date(value);
      return isNaN(fallback.getTime()) ? null : fallback;
    }
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0,
    );
  }

  private formatDateRange(start: string, end: string): string {
    const s = this.parseMpDate(start);
    if (!s) return "";
    const e = this.parseMpDate(end);
    const dateFmt: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
    const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    const sDate = s.toLocaleDateString("en-US", dateFmt);
    const sTime = s.toLocaleTimeString("en-US", timeFmt);
    if (!e) return `${sDate}, ${sTime}`;
    const sameDay =
      s.getFullYear() === e.getFullYear() &&
      s.getMonth() === e.getMonth() &&
      s.getDate() === e.getDate();
    const eTime = e.toLocaleTimeString("en-US", timeFmt);
    if (sameDay) return `${sDate}, ${sTime} – ${eTime}`;
    const eDate = e.toLocaleDateString("en-US", dateFmt);
    return `${sDate}, ${sTime} – ${eDate}, ${eTime}`;
  }

  private stripHtml(text: string): string {
    return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  /** Render HTML description but strip script/style/event-handler vectors. */
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
    return `<svg class="ed-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .ed { max-width: 880px; margin: 0 auto; }

      .ed-back { margin-bottom: 12px; }
      .ed-back a { color: #004C97; text-decoration: none; font-weight: 600; font-size: 14px; cursor: pointer; }
      .ed-back a:hover { text-decoration: underline; }

      .ed-message { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
      .ed-message--success { background: #ecf6e0; color: #4d6b1f; }
      .ed-message--warning { background: #fdf6e3; color: #8a6d3b; }
      .ed-message--info { background: #e6f6fc; color: #015a7a; }
      .ed-message--danger { background: #ffe9e9; color: #b91c1c; }

      .ed-image { width: 100%; height: 260px; background-size: cover; background-position: center; border-radius: 12px; margin-bottom: 16px; }
      .ed-title { font-size: 28px; font-weight: 800; color: #002855; margin: 0 0 10px; }
      .ed-labels { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-wrap: wrap; gap: 8px; }
      .ed-labels li { background: #F1BE48; color: #2D2926; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; }
      .ed-datetime { font-size: 16px; font-weight: 600; color: #004C97; margin-bottom: 16px; }
      .ed-description { font-size: 15px; line-height: 1.6; color: #474747; margin-bottom: 16px; }
      .ed-description img { max-width: 100%; height: auto; }

      .ed-special { margin-bottom: 16px; }
      .ed-special-title { font-size: 13px; font-weight: 700; color: #002855; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px; }
      .ed-special-body { font-size: 15px; color: #474747; line-height: 1.5; }

      .ed-contacts { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 16px; }
      .ed-contact { display: flex; align-items: center; gap: 8px; font-size: 14px; }
      .ed-contact a { color: #004C97; text-decoration: none; }
      .ed-contact a:hover { text-decoration: underline; }
      .ed-contact-badge { width: 36px; height: 36px; border-radius: 9999px; background: #004C97; color: white; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; background-size: cover; background-position: center; }

      .ed-map { margin-bottom: 16px; }
      .ed-map iframe { width: 100%; height: 280px; border: 0; border-radius: 12px; }

      .ed-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 8px 0 24px; }
      .ed-link { color: #004C97; font-weight: 600; text-decoration: none; font-size: 14px; }
      .ed-link:hover { text-decoration: underline; }

      .ed-btn { padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; border: none; text-decoration: none; display: inline-block; }
      .ed-btn--primary { background: #004C97; color: white; }
      .ed-btn--primary:hover { background: #002855; }
      .ed-btn--secondary { background: #009CDE; color: white; }
      .ed-btn--secondary:hover { background: #007bb0; }
      .ed-btn--ghost { background: white; color: #004C97; border: 1px solid #004C97; }
      .ed-btn--ghost:hover { background: #f0f6fc; }
      .ed-btn--sm { padding: 5px 12px; font-size: 13px; }
      .ed-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .ed-reg { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .ed-reg-title { font-size: 20px; font-weight: 800; color: #002855; margin: 0 0 16px; }
      .ed-reg-subtitle { font-size: 16px; font-weight: 700; color: #002855; margin: 16px 0 8px; }
      .ed-login-panel { text-align: center; }
      .ed-login-panel p { margin: 0 0 12px; font-size: 15px; }

      .ed-form { display: block; }
      .ed-fieldset { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px 16px; margin: 0 0 16px; }
      .ed-fieldset legend { font-size: 13px; font-weight: 700; color: #002855; padding: 0 6px; }
      .ed-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .ed-field label { font-size: 13px; font-weight: 600; color: #6b7280; }
      .ed-input { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; }
      .ed-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      textarea.ed-input { min-height: 80px; resize: vertical; }
      .ed-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .ed-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
      .ed-checkbox { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-bottom: 12px; }
      .ed-checkbox input { width: auto; }

      .ed-option-group { margin-bottom: 16px; }
      .ed-option-title { font-size: 15px; font-weight: 700; color: #2D2926; margin: 0 0 4px; }
      .ed-option-desc { font-size: 13px; color: #6b7280; margin: 0 0 8px; }
      .ed-option-table { width: 100%; border-collapse: collapse; font-size: 14px; }
      .ed-option-table th { text-align: left; font-size: 12px; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
      .ed-option-table td { padding: 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
      .ed-option-table label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
      .ed-soldout { opacity: 0.5; }
      .ed-qty { padding: 4px 6px; }
      .ed-note { margin-top: 6px; }
      .ed-radio-v { display: flex; flex-direction: column; gap: 6px; }
      .ed-radio-h { display: flex; flex-wrap: wrap; gap: 16px; }
      .ed-radio { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
      .ed-instructions { font-size: 14px; color: #474747; }

      .ed-promo { margin: 16px 0; }
      .ed-promo > label { font-size: 13px; font-weight: 600; color: #6b7280; display: block; margin-bottom: 4px; }
      .ed-promo-row { display: flex; gap: 8px; }
      .ed-promo-row .ed-input { flex: 1; }
      .ed-promo-error { color: #b91c1c; font-size: 13px; margin-top: 6px; }
      .ed-promo-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
      .ed-promo-table td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
      .ed-promo-table a { color: #FF6D6A; text-decoration: none; }

      .ed-total { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-top: 2px solid #e5e7eb; margin: 16px 0; }
      .ed-total-label { font-size: 16px; font-weight: 700; color: #002855; }
      .ed-total-value { font-size: 20px; font-weight: 800; color: #004C97; }

      .ed-buttons { display: flex; flex-wrap: wrap; gap: 12px; }

      .ed-participants { margin-bottom: 20px; }
      .ed-participant { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
      .ed-participant-head { background: #f3f4f6; padding: 6px 12px; font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; }
      .ed-participant-body { padding: 12px; }
      .ed-participant-name { font-weight: 700; color: #2D2926; }
      .ed-participant-contacts { font-size: 13px; color: #6b7280; margin: 2px 0; }
      .ed-participant-minor { font-size: 13px; font-style: italic; color: #6b7280; }
      .ed-participant-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
      .ed-participant-price { font-weight: 700; color: #004C97; }
      .ed-registered { font-weight: 700; color: #86AD3F; }
      .ed-note-text { color: #6b7280; font-size: 12px; }

      .ed-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; font-size: 15px; }
      .ed-error { flex-direction: column; }
      .ed-error p { color: #b91c1c; }
      .ed-spinner { animation: ed-spin 1s linear infinite; color: #004C97; }
      @keyframes ed-spin { to { transform: rotate(360deg); } }

      @media (max-width: 640px) {
        .ed-grid2, .ed-grid3 { grid-template-columns: 1fr; }
        .ed-image { height: 180px; }
        .ed-title { font-size: 22px; }
        .ed-buttons { flex-direction: column; }
        .ed-buttons .ed-btn { width: 100%; text-align: center; }
      }
    `;
  }
}

customElements.define("next-event-details", EventDetailsWidget);
