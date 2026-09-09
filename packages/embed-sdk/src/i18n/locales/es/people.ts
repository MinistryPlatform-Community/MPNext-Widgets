/**
 * Spanish — people widget namespaces.
 *
 * Kept in step with `../en/people.ts`: the index's `satisfies Messages` fails the
 * build if a key here is missing, extra or misspelled.
 *
 * `usted` throughout, and region-neutral vocabulary: "celular" rather than
 * "móvil", "correo electrónico" rather than "mail".
 */
import type { Messages } from "../en";

export const esPeople = {
  myHousehold: {
    title: "Mi hogar",
    loading: "Cargando el hogar…",
    empty: "No se encontró ningún hogar para su cuenta.",
    householdLabel: "Hogar",
    householdName: "Nombre del hogar",
    editHousehold: "Editar el hogar",
    primaryAddress: "Dirección principal",
    seasonalAddress: "Dirección temporal",
    seasonalAddressSection: "Dirección temporal o alternativa",
    noAddress: "No hay ninguna dirección registrada.",
    seasonStart: "Inicio de la temporada",
    seasonEnd: "Fin de la temporada",
    repeatAnnually: "Repetir cada año",
    seasonRangeAnnual: "{start} – {end} cada año",
    seasonStartAnnual: "{start} cada año",
    seasonFrom: "Desde {date}",
    seasonUntil: "Hasta {date}",
    homePhoneUnlisted: "No publicar el teléfono de casa",
    homeAddressUnlisted: "No publicar la dirección de casa",
    members: "Miembros",
    addMember: "+ Agregar un miembro del hogar",
    memberFallbackName: "Miembro",
    addMemberTitle: "Agregar un miembro",
    editMemberTitle: "Editar a {name}",
    householdPosition: "Posición en el hogar",
    contactInformation: "Información de contacto",
    communicationPreferences: "Preferencias de comunicación",
    emailUnlisted: "No publicar el correo electrónico",
    mobilePhoneUnlisted: "No publicar el celular",
    doNotText: "No enviar mensajes de texto",
    bulkEmailOptOut: "No recibir correos masivos",
    removeFromDirectory: "Quitar del directorio",
    memberPhotoAlt: "Foto del miembro",
    addPhoto: "Agregar una foto",
    changePhoto: "Cambiar la foto",
    photoHint: "JPEG, PNG, GIF o WebP. Máximo 10 MB.",
    photoTooLarge: "La foto debe pesar menos de 10 MB.",
    saveHousehold: "Guardar el hogar",
    saveMember: "Guardar el miembro",
    fixHighlighted: "Corrija los campos marcados.",
    householdSaved: "El hogar se guardó correctamente.",
    memberSaved: "El miembro se guardó correctamente.",
  },

  profile: {
    loading: "Cargando el perfil…",
    photoAlt: "Foto del perfil",
    greeting: "¡Hola, {name}!",
    intro:
      "Escriba su información a continuación y luego haga clic en Guardar. Solo será visible para el personal de la iglesia, a menos que usted decida compartirla con otras personas.",
    month: "Mes",
    day: "Día",
    year: "Año",
    contactInformation: "Información de contacto",
    contactPrompt: "¿Cómo desea que lo contactemos?",
    smsOptIn: "Acepto recibir mensajes de texto de {org}",
    orgFallback: "nuestra organización",
    smsRates:
      "Se pueden aplicar tarifas de mensajes y datos. La frecuencia de los mensajes varía y usted puede cancelar la suscripción en cualquier momento.",
    bulkEmailOptOut: "No deseo recibir correos electrónicos masivos",
    saveProfile: "Guardar el perfil",
    saved: "El perfil se guardó correctamente.",
    changePassword: "Cambiar la contraseña",
    currentPassword: "Contraseña actual",
    newPassword: "Contraseña nueva",
    confirmPassword: "Confirmar la contraseña nueva",
    passwordChanged: "La contraseña se cambió correctamente.",
    passwordsDoNotMatch: "Las contraseñas no coinciden",
    photoTypeInvalid: "Suba una imagen JPEG, PNG, GIF o WebP.",
    photoTooLarge: "La foto debe pesar menos de 5 MB.",
    // Guillemets rather than double quotes: this message is also rendered into
    // an attribute-adjacent context by the validation layer.
    firstNameOnly: "Escriba solo su primer nombre (sin «&» ni «and»)",
    phoneFormat: "Use el formato: 999-999-9999",
  },

  onlineDirectory: {
    title: "Directorio",
    loading: "Cargando el directorio…",
    signInRequired: "Inicie sesión para ver el directorio.",
    accessDenied: "Usted no tiene acceso al directorio.",
    loadFailed: "No se pudo cargar el directorio.",
    searchLabel: "Buscar por nombre, teléfono o correo electrónico",
    searchPlaceholder: {
      one: "Escriba al menos {count} carácter…",
      // `many` is the CLDR branch Spanish selects for compact millions; it can
      // never fire on a search length, but the parity guard requires it.
      many: "Escriba al menos {count} caracteres…",
      other: "Escriba al menos {count} caracteres…",
    },
    minLengthHint: {
      one: "Escriba al menos {count} carácter para buscar en el directorio.",
      many: "Escriba al menos {count} caracteres para buscar en el directorio.",
      other: "Escriba al menos {count} caracteres para buscar en el directorio.",
    },
    allCongregations: "Todas las congregaciones",
    searching: "Buscando…",
    noResults: "No se encontraron resultados.",
    truncated:
      "Se muestran los primeros resultados; refine su búsqueda para reducirlos.",
    searchFailed: "La búsqueda falló.",
    familyChip: "Familia {name}",
    clearFamilyFilter: "Quitar el filtro de familia",
    family: "Familia",
    viewFamily: "Ver la familia",
    map: "Mapa",
    addBirthday: "Agregar el cumpleaños al calendario",
    birthdaySummary: "¡Feliz cumpleaños, {name}!",
    emailTitle: "Enviar un correo a {name}",
    subject: "Asunto",
    send: "Enviar",
    sent: "Enviado",
    sendFailed: "No se pudo enviar el mensaje.",
  },
  /**
   * `next-prayer-feedback` (C69). Seeded from the legacy
   * `mpp-prayer-feedback-form` Spanish labels — the wording churches have
   * already seen — with the register moved from legacy's `tú` to this
   * catalogue's `usted`, and legacy's two machine-translated strings rewritten.
   */
  prayerFeedback: {
    title: "Oración y comentarios",
    lead: "Complete el siguiente formulario para solicitar oración, compartir un informe de alabanza o enviarnos otros comentarios y opiniones.",
    feedbackType: "Tipo de comentario",
    selectType: "Seleccione…",
    summary: "Resumen",
    summaryHint: "Un título breve para su solicitud.",
    details: "Detalles",
    private: "Mantener esto en privado",
    privateHint: "Solo el personal de la iglesia verá esta solicitud.",
    provideFeedbackAs: "Proporcione sus comentarios como",
    blankForm: "Otra persona",
    signInHint: "¿Tiene una cuenta? Si inicia sesión, omitimos el paso de confirmación por correo electrónico.",
    notConfigured:
      "Este formulario no está configurado por completo. Comuníquese con la iglesia.",
    verificationSent:
      "Revise su correo electrónico y siga el enlace para confirmar su solicitud.",
    submitted: "Su solicitud ha sido enviada. ¡Gracias!",
    verified: "Su solicitud ha sido enviada. ¡Gracias!",
    charactersLeft: {
      one: "queda {count} carácter",
      many: "quedan {count} caracteres",
      other: "quedan {count} caracteres",
    },
  },
} satisfies Partial<Messages>;
