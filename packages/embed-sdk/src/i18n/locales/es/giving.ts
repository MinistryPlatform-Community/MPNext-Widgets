/**
 * Spanish — giving widget namespaces.
 *
 * Kept in step with `../en/giving.ts`: the index's `satisfies Messages` fails the
 * build if a key here is missing, extra or misspelled.
 *
 * Region-neutral and `usted` throughout, since one Spanish catalogue serves
 * every Spanish-speaking community a church might have.
 */
import type { Messages } from "../en";

export const esGiving = {
  myGiving: {
    title: "Mis donaciones",
    loading: "Cargando el historial de donaciones…",
    totalGiving: "Total donado",
    includeSoftCredits: "Incluir donaciones con crédito indirecto",
    allMonths: "Todos los meses de {year}",
    byMonth: "Por mes",
    byProgram: "Por programa",
    chartEmpty: "No hay donaciones para graficar.",
    byMonthChartLabel: "Donaciones por mes",
    byProgramChartLabel: "Donaciones por programa",
    disclaimer:
      "La siguiente lista de donaciones es informativa y no debe utilizarse para fines fiscales.",
    softCreditDisclaimer:
      "A continuación se incluyen las donaciones con crédito indirecto, que reflejan donativos que se le acreditan a usted pero que no realizó personalmente.",
    donations: "Donaciones",
    empty: "Sin donaciones",
    showMore: "VER MÁS DONACIONES",
    pending: "PENDIENTE",
    badgeSpouse: "Cónyuge",
    badgeSoftCredit: "Crédito indirecto",
    badgeNonDeductible: "No deducible",
  },

  myPledges: {
    title: "Mis compromisos",
    loading: "Cargando compromisos…",
    empty: "Usted no está asociado a ningún compromiso.",
    cancel: "Cancelar compromiso",
    confirmCancel: "¿Desea cancelar este compromiso?",
    confirmCancelYes: "Cancelar compromiso",
    keep: "Conservar",
    canceling: "Cancelando…",
    canceled: "Compromiso cancelado",
    cancelFailed: "Error al cancelar el compromiso. Inténtelo de nuevo.",
    progress: "{paid} de {total} ({percent})",
    installments: {
      one: "{count} cuota a partir del {date}",
      other: "{count} cuotas a partir del {date}",
      // CLDR gives Spanish a `many` category (millions), and
      // `Intl.PluralRules` will select it for a count like 1.000.000. The
      // wording only differs from `other` in compact notation ("1 millón de
      // cuotas"), which these widgets never render.
      many: "{count} cuotas a partir del {date}",
    },
    iconLabel: "Compromiso",
    status: {
      active: "Activo",
      completed: "Completado",
      discontinued: "Descontinuado",
      pending: "Pendiente",
    },
  },

  pledgeCampaign: {
    loading: "Cargando la campaña…",
    notSpecified: "No se especificó ninguna campaña de compromisos.",
    notFound: "No se encontró la campaña de compromisos.",
    closed: "Esta campaña ya no acepta nuevos compromisos.",
    alreadyPledged:
      "Usted ya realizó un compromiso para esta campaña. Confirme que desea comprometerse de nuevo.",
    pastEndDate: "No puede dar después de la fecha de finalización de la campaña.",
    pastEndDateOn:
      "No puede dar después de la fecha de finalización de la campaña ({date}).",
    saveFailed: "No pudimos guardar su compromiso.",
    thankYou:
      "¡Gracias! Recibimos su respuesta para {name}. Si lo desea, haga clic en el botón de abajo para responder por otro miembro del hogar.",
    yourHousehold: "su hogar",
    myInfo: "Mis datos",
    defaultTitle: "Campaña de compromisos",
    progress: "Progreso",
    progressBarLabel: "Progreso de la campaña",
    pledgedOfGoal: "{pledged} comprometidos de una meta de {goal}",
    receivedPercent: "{percent} recibido",
    pledgedPercent: "{percent} comprometido",
    signInPrompt: "Inicie sesión para hacer un compromiso para esta campaña.",
    createPledge: "Crear un compromiso",
    pledgeDetails: "Detalles del compromiso",
    pledgeAmount: "Monto del compromiso",
    selectFrequency: "Seleccione la frecuencia",
    selectPlaceholder: "-- Seleccione --",
    startDate: "Fecha de inicio del compromiso",
    endDate: "Fecha de finalización del compromiso",
    totalPledge: "Compromiso total",
    makePledgeAs: "Hacer un compromiso como",
    blankForm: "Formulario en blanco",
    submit: "Crear compromiso",
    submitAnother: "Crear otro compromiso",
  },

  contributionStatement: {
    title: "Mis estados de contribuciones",
    loading: "Cargando los estados de contribuciones…",
    empty: "No hay estados de contribuciones disponibles por el momento.",
    selectYear: "Seleccione el año del estado",
    savePdf: "Guardar como PDF",
  },

  statementPreferences: {
    title: "Estados de contribuciones",
    loading: "Cargando las preferencias…",
    goPaperless:
      "¡Deje el papel! Reciba sus estados de contribuciones en línea o por correo electrónico.",
    updated: "Se actualizó el método de entrega",
    updateFailed:
      "Error al actualizar el método de entrega. Inténtelo de nuevo.",
  },

  checkout: {
    header: "Detalles de la factura",
    processing: "Procesando…",
    loading: "Cargando la factura…",
    empty: "No hay ninguna factura para mostrar.",
    noInvoiceSpecified: "No se especificó ninguna factura.",
    processorMissing: "El procesador de pagos no está configurado.",
    invoiceDate: "Fecha de la factura",
    status: "Estado",
    noLineItems: "No hay partidas.",
    item: "Artículo",
    amountPaid: "Monto pagado",
    balanceDue: "Saldo pendiente",
    paymentAmount: "Monto del pago",
    payInFull: "Pagar el total ({amount})",
    payDeposit: "Pagar el depósito ({amount})",
    otherAmount: "Otro monto",
    youWillPay: "Usted pagará",
    pay: "Pagar",
    makeChanges: "Hacer cambios",
    paidInFull: "Pagada por completo",
    invalidAmount: "Ingrese un monto de pago válido.",
    paymentReceived: "¡Pago recibido, gracias!",
    paymentPending:
      "Su pago se está procesando. Esta factura se actualizará cuando el pago se acredite.",
    paymentUnconfirmed: "No pudimos confirmar su pago.",
    paymentUnconfirmedDetail: "No pudimos confirmar su pago: {detail}",
  },

  checkoutComplete: {
    confirming: "Confirmando su pago…",
    titleSuccess: "Pago completado",
    titlePending: "Pago pendiente",
    titleFailed: "Pago sin confirmar",
    noPaymentInfo: "No se encontró información del pago.",
    received: "¡Gracias! Recibimos su pago.",
    processing:
      "¡Gracias! Su pago se está procesando y se confirmará en breve.",
    failed:
      "No pudimos confirmar su pago. Inténtelo de nuevo o comuníquese con nosotros.",
    unconfirmed: "No pudimos confirmar su pago.",
  },

  pay: {
    header: "Pago seguro",
    sandboxNotice: "Pago de prueba: use la tarjeta de prueba {card}",
    loading: "Cargando la solicitud de pago…",
    noRequest: "No se proporcionó ninguna solicitud de pago.",
    unavailable: "La solicitud de pago no está disponible.",
    decodeFailed: "No se pudo leer la solicitud de pago.",
    invoice: "Factura",
    amountDue: "Monto a pagar",
    nameOnCard: "Nombre en la tarjeta",
    namePlaceholder: "Juan Pérez",
    cardNumber: "Número de tarjeta",
    expiry: "Vencimiento",
    expiryPlaceholder: "MM/AA",
    cvv: "CVV",
    payAmount: "Pagar {amount}",
    processing: "Procesando…",
    submitFailed: "No se pudo enviar el pago.",
    enterName: "Ingrese el nombre que figura en la tarjeta.",
    enterCard: "Ingrese un número de tarjeta.",
    enterExpiry: "Ingrese la fecha de vencimiento.",
    enterCvv: "Ingrese el CVV.",
  },

  subscriptions: {
    title: "Mis suscripciones",
    subtitle: "Elija las publicaciones que desea recibir.",
    loading: "Cargando suscripciones…",
    searchPlaceholder: "Buscar publicaciones…",
    empty: "No hay publicaciones disponibles.",
    noMatches: "Ninguna publicación coincide con su búsqueda.",
    subscribed: "Se suscribió a {title}",
    unsubscribed: "Canceló la suscripción a {title}",
    updateFailed: "No se pudo actualizar la suscripción. Inténtelo de nuevo.",
  },
  /**
   * `next-subscribe-to-publication` (C70).
   *
   * Seeded from legacy's Spanish labels, with two changes and one restoration:
   *
   * - **`usted`, not legacy's `tú`.** Legacy reads *"Completa el siguiente
   *   formulario para suscribirte"* and *"¡Gracias por suscribirte!"*; the 27
   *   widgets already shipped here are formal, and a visitor should not meet
   *   two registers on one page.
   * - **`linkExpired` is written fresh.** Legacy's `verificationFailedMessage`
   *   still says *"intenta nuevamente"* — its English was tightened to name the
   *   expiry (its own `previousEnglish` records the change) and the Spanish was
   *   never updated to follow. That is the exact staleness `pnpm i18n:check`
   *   exists to catch, so it is not inherited.
   * - **The merge token is restored.** Legacy's Spanish `emailSentConfirmation`
   *   names no publication at all, having dropped `[Publication_Title]`; the
   *   parity test would fail on the missing `{title}`, and the copy is worse
   *   without it.
   *
   * `notAvailable` is translated from our English rather than adopting legacy's
   * *"La publicación solicitada no se puede encontrar."* — that sentence
   * translates legacy's English ("cannot be found"), and ours says something
   * more useful and more accurate: the publication may well exist and simply
   * not be published online.
   */
  subscribeToPublication: {
    title: "Suscripción por correo electrónico",
    heading: "Suscríbase a {title}",
    lead: "Complete el siguiente formulario y le enviaremos un enlace por correo electrónico para confirmar su suscripción.",
    loading: "Cargando la publicación…",
    submit: "Suscribirse",
    checkEmailTitle: "Revise su correo electrónico",
    checkEmail:
      "Enviamos un enlace de confirmación a {email}. Ábralo para terminar de suscribirse a {title}.",
    verifying: "Confirmando su suscripción…",
    verifiedTitle: "Ya está suscrito",
    verified: "Comenzará a recibir {title} en {email}.",
    linkExpired:
      "Ese enlace de confirmación ha expirado. Vuelva a suscribirse para recibir uno nuevo.",
    linkInvalid: "Ese enlace de confirmación no es válido. Vuelva a suscribirse.",
    linkUsed: "Todo está listo: este enlace ya se confirmó.",
    notAvailable: "Esta publicación no está disponible para suscripción en línea.",
    signUpAgain: "Suscribirse de nuevo",
    privacyNote:
      "Solo le enviaremos {title}, y puede cancelar la suscripción en cualquier mensaje.",
    managePreferences: "Administrar todas sus preferencias de correo electrónico",
  },
} satisfies Partial<Messages>;
