/**
 * Spanish — account widget namespaces.
 *
 * Kept in step with `../en/account.ts`: the index's `satisfies Messages` fails the
 * build if a key here is missing, extra or misspelled.
 *
 * Addressed as `usted` throughout, with region-neutral vocabulary ("factura",
 * not a country-specific billing term).
 */
import type { Messages } from "../en";

export const esAccount = {
  myInvoices: {
    title: "Mis facturas",
    // `many` is the branch CLDR selects for whole millions in Spanish; the
    // wording matches `other`, but the category has to exist or `Intl` falls
    // through to a branch the locale never asked for.
    invoiceCount: {
      one: "{count} factura",
      many: "{count} facturas",
      other: "{count} facturas",
    },
    searchPlaceholder: "Buscar facturas…",
    loading: "Cargando facturas…",
    loadingDetail: "Cargando los detalles de la factura…",
    empty: "No se encontraron facturas.",
    noMatches: "Ninguna factura coincide con su búsqueda.",
    invoiceNumber: "Factura n.º {id}",
    description: "Descripción",
    status: "Estado",
    pay: "Pagar",
    payNow: "Pagar ahora",
    detailTitle: "Detalles de la factura",
    backToList: "Volver a las facturas",
    backToInvoice: "Volver a la factura",
    invoiceDate: "Fecha de la factura",
    // Cada línea de una factura es un "concepto" en el uso comercial habitual.
    lineItems: "Conceptos",
    product: "Producto",
    quantity: "Cant.",
    unitPrice: "Precio unitario",
  },

  userMenu: {
    menuLabel: "Menú de usuario",
    myAccount: "Mi cuenta",
    modalDescription: "Administre la configuración y las preferencias de su cuenta.",
    contributionStatement: "Estado de contribuciones",
    tabs: {
      profile: "Perfil",
      family: "Familia",
      groups: "Grupos",
      giving: "Donaciones",
      subscriptions: "Suscripciones",
      invoices: "Facturas",
    },
  },
} satisfies Partial<Messages>;
