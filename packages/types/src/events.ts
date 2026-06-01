import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// Event Finder (public search)
// ─────────────────────────────────────────────────────────────────────────

/** A single event card returned by the finder search. */
export const EventSearchResultSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  location: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  featured: z.boolean(),
});
export type EventSearchResult = z.infer<typeof EventSearchResultSchema>;

export const EventSearchResponseSchema = z.object({
  events: z.array(EventSearchResultSchema),
});
export type EventSearchResponse = z.infer<typeof EventSearchResponseSchema>;

/** A id/name option used to populate finder filter dropdowns. */
export const EventFilterOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type EventFilterOption = z.infer<typeof EventFilterOptionSchema>;

/** Dropdown configuration data for the finder (congregations + ministries). */
export const EventConfigurationsSchema = z.object({
  congregations: z.array(EventFilterOptionSchema),
  ministries: z.array(EventFilterOptionSchema),
});
export type EventConfigurations = z.infer<typeof EventConfigurationsSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Event Details (single event, via api_MPPW_GetEventById + enrichment)
// ─────────────────────────────────────────────────────────────────────────

export const EventRoomSchema = z.object({
  buildingName: z.string().nullable(),
  roomName: z.string().nullable(),
  roomNumber: z.string().nullable(),
  cancelled: z.boolean(),
  /** Pre-joined "Building - Room (Number)" display string, when resolvable. */
  roomInfo: z.string().nullable(),
});
export type EventRoom = z.infer<typeof EventRoomSchema>;

export const EventContactSchema = z.object({
  displayName: z.string().nullable(),
  imageUrl: z.string().nullable(),
  emailAddress: z.string().nullable(),
});
export type EventContact = z.infer<typeof EventContactSchema>;

export const EventDetailSchema = z.object({
  id: z.number(),
  eventId: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  startDateUTC: z.string().nullable(),
  endDateUTC: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  featured: z.boolean(),
  registrationProductId: z.number().nullable(),
  registrationPrice: z.number().nullable(),
  registrationDepositPrice: z.number().nullable(),
  meetingInstructions: z.string().nullable(),
  primaryContactId: z.number().nullable(),
  visibilityLevelId: z.number(),
  forceLogin: z.boolean(),
  opportunityId: z.number().nullable(),
  opportunityCount: z.number(),
  registrationActive: z.boolean(),
  externalRegistrationUrl: z.string().nullable(),
  locationAddressId: z.number().nullable(),
  customFormId: z.number().nullable(),
  customFormGuid: z.string().nullable(),
  isRegistrationFull: z.boolean(),
  isRegistrationOptionsFull: z.boolean(),
  isFreeEvent: z.boolean(),
  minorRegistration: z.boolean(),
  allowEmail: z.boolean(),
  showBuildingRoomInfo: z.boolean(),
  isUserStaff: z.boolean(),
  attributes: z.array(z.string()),
  rooms: z.array(EventRoomSchema).nullable(),
  contacts: z.array(EventContactSchema),
});
export type EventDetail = z.infer<typeof EventDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Products / promo codes (via api_MPPW_GetProduct)
// ─────────────────────────────────────────────────────────────────────────

export const ProductOptionPriceSchema = z.object({
  optionPriceId: z.number(),
  optionTitle: z.string().nullable(),
  optionPrice: z.number(),
  daysOutToHide: z.number().nullable(),
  qtyAllowed: z.number(),
  addToGroupId: z.number().nullable(),
  minQty: z.number(),
  maxQty: z.number(),
  qtyOnHand: z.number(),
  isHidden: z.boolean(),
});
export type ProductOptionPrice = z.infer<typeof ProductOptionPriceSchema>;

export const ProductOptionGroupSchema = z.object({
  optionGroupId: z.number(),
  optionGroupName: z.string().nullable(),
  description: z.string().nullable(),
  mutuallyExclusive: z.boolean(),
  required: z.boolean(),
  noteLabel: z.string().nullable(),
  optionPrices: z.array(ProductOptionPriceSchema),
});
export type ProductOptionGroup = z.infer<typeof ProductOptionGroupSchema>;

export const ProductSchema = z.object({
  productId: z.number(),
  productName: z.string().nullable(),
  description: z.string().nullable(),
  basePrice: z.number(),
  depositPrice: z.number().nullable(),
  priceCurrency: z.number().nullable(),
  hasPromoCode: z.boolean(),
  feesWillBeCollected: z.boolean(),
  optionGroups: z.array(ProductOptionGroupSchema),
});
export type Product = z.infer<typeof ProductSchema>;

export const PromoCodeResponseSchema = z.object({
  isValidPromoCode: z.boolean(),
  optionPriceId: z.number().nullable(),
  promoCodePrice: z.number(),
  optionTitle: z.string().nullable(),
  mutuallyExclusiveOptionGroupId: z.number().nullable(),
  daysOutToHide: z.number().nullable(),
});
export type PromoCodeResponse = z.infer<typeof PromoCodeResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Existing invoice / participants (via api_MPPW_GetInvoice)
// ─────────────────────────────────────────────────────────────────────────

export const SelectedProductOptionSchema = z.object({
  productId: z.number().nullable(),
  productOptionId: z.number().nullable(),
  quantity: z.number(),
  isPromoCode: z.boolean(),
  promoCode: z.string().nullable(),
  invoiceDetailId: z.number().nullable(),
});
export type SelectedProductOption = z.infer<typeof SelectedProductOptionSchema>;

/** Raw Form_Response_Answers row passed through verbatim for re-population. */
export const FormResponseAnswerSchema = z.object({
  Form_Field_ID: z.number(),
  Form_Response_ID: z.number().nullable(),
  Response: z.string().nullable(),
});
export type FormResponseAnswer = z.infer<typeof FormResponseAnswerSchema>;

export const ExistingParticipantSchema = z.object({
  eventParticipantId: z.number(),
  contactId: z.number().nullable(),
  householdId: z.number().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  lineTotal: z.number(),
  isMinorRegistration: z.boolean(),
  minorFirstName: z.string().nullable(),
  minorLastName: z.string().nullable(),
  minorDateOfBirth: z.string().nullable(),
  selectedProductOptions: z.array(SelectedProductOptionSchema),
  formResponses: z.array(FormResponseAnswerSchema),
});
export type ExistingParticipant = z.infer<typeof ExistingParticipantSchema>;

export const ExistingInvoiceSchema = z.object({
  isInvoiceExpired: z.boolean(),
  isSomePaymentExists: z.boolean(),
  expiredMessageKey: z.string().nullable(),
  participants: z.array(ExistingParticipantSchema),
});
export type ExistingInvoice = z.infer<typeof ExistingInvoiceSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Basic contact (via api_MPPW_GetContactInfo / GetCurrentBasicContact)
// ─────────────────────────────────────────────────────────────────────────

export const BasicContactSchema = z.object({
  contactId: z.number(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  emailAddress: z.string().nullable(),
  mobilePhoneNumber: z.string().nullable(),
  householdId: z.number().nullable(),
});
export type BasicContact = z.infer<typeof BasicContactSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Availability check (CheckAvailability)
// ─────────────────────────────────────────────────────────────────────────

export const SoldOutProductSchema = z.object({
  optionPrice: z.object({
    optionPriceId: z.number(),
    optionTitle: z.string().nullable(),
  }),
});
export type SoldOutProduct = z.infer<typeof SoldOutProductSchema>;

export const AvailabilityResponseSchema = z.object({
  isSuccessful: z.boolean(),
  status: z.number(),
  soldOutProducts: z.array(SoldOutProductSchema),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Registration save
// ─────────────────────────────────────────────────────────────────────────

/**
 * Registration submission. The product-option and custom-form fields are
 * dynamic (`product-radio_{g}`, `product-checkbox_{g}_{p}`, `product-qty_*`,
 * `product-note_*`, `promo_{code}`, `mp_customform_*`), so the request is a
 * loose string map mirroring the legacy multipart form. Well-known fields are
 * documented here; the service reads the dynamic keys directly.
 */
export const RegistrationRequestSchema = z.record(z.string(), z.string());
export type RegistrationRequest = z.infer<typeof RegistrationRequestSchema>;

export const RegistrationSaveResponseSchema = z.object({
  success: z.boolean(),
  guid: z.string().nullable(),
  message: z.string().optional(),
});
export type RegistrationSaveResponse = z.infer<typeof RegistrationSaveResponseSchema>;
