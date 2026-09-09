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

  /**
   * `next-unsubscribe`.
   *
   * Seeded from `mpp-unsubscribe.json`'s Spanish, which a church has been
   * reading in production — the vocabulary and sentence structure are legacy's.
   * The **person** is not: legacy addresses `tú` ("Has sido desuscrito",
   * "Deshaz"), and this catalogue is `usted` throughout, so mixing them would
   * make one document speak in two registers. `Deshacer` is person-neutral and
   * is adopted verbatim.
   *
   * Only the **first sentence** of each success label is kept. Legacy's full
   * string names two buttons in prose ("Deshaz o actualiza tus preferencias …
   * a través de Mis Suscripciones"), which breaks when the manage link is not
   * configured, duplicates the accessible name of controls that are right
   * there, and triples the length of the one sentence a `role="status"` region
   * reads aloud.
   *
   * `undoFailed` is written fresh. Legacy's Spanish for it — "No es posible
   * anular la suscripción" — is identical to its *unsubscribe* failure label
   * and describes the opposite action.
   */
  unsubscribe: {
    working: "Un momento: estamos actualizando sus preferencias de correo electrónico…",
    // Distinct verbs, as in legacy: "cancelar la suscripción" for one
    // publication, "eliminar del servicio de notificaciones" for bulk email.
    donePublication: "Su suscripción ha sido cancelada.",
    doneBulk: "Ha sido eliminado de nuestro servicio de notificaciones.",
    undoButton: "Deshacer",
    undone: "Ha vuelto a suscribirse.",
    undoFailed: "No se ha podido deshacer la cancelación.",
    manageLink: "Administrar todas mis preferencias de correo electrónico",
    badLink:
      "Este enlace para darse de baja está incompleto. Utilice el enlace de un correo electrónico reciente que le hayamos enviado.",
    title: "Preferencias de correo electrónico",
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
