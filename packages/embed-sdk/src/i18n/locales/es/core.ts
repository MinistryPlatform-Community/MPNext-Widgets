/**
 * Spanish — shared namespaces.
 *
 * Region-neutral Spanish (`es`): `es-MX`, `es-US`, `es-419` and every other
 * `es-*` tag resolve here (see `registry.ts`). So the wording avoids
 * region-marked vocabulary where a neutral alternative exists.
 *
 * **Address form is `usted` throughout.** A church addresses its congregation
 * respectfully, and `usted` reads correctly across every Spanish-speaking
 * community; `tú` would read as over-familiar to a large share of them. Keep new
 * strings consistent with that — mixing the two within one widget is worse than
 * either choice alone.
 */
import type { Messages } from "../en";

export const esCore = {
  common: {
    loading: "Cargando…",
    retry: "Intentar de nuevo",
    unableToLoad: "No se pudo cargar",
    signIn: "Iniciar sesión",
    signOut: "Cerrar sesión",
    save: "Guardar",
    saving: "Guardando…",
    cancel: "Cancelar",
    close: "Cerrar",
    edit: "Editar",
    remove: "Eliminar",
    submit: "Enviar",
    submitting: "Enviando…",
    search: "Buscar",
    back: "Atrás",
    next: "Siguiente",
    previous: "Anterior",
    total: "Total",
    all: "Todos",
    yes: "Sí",
    no: "No",
    optional: "opcional",
    required: "obligatorio",
    seeDetails: "Ver detalles",
    getDirections: "Cómo llegar",
    signInPrompt: "Inicie sesión para continuar.",
    dismiss: "Descartar",
  },

  fields: {
    firstName: "Nombre",
    lastName: "Apellido",
    middleName: "Segundo nombre",
    nickname: "Apodo",
    prefix: "Título",
    suffix: "Sufijo",
    email: "Correo electrónico",
    mobilePhone: "Teléfono móvil",
    homePhone: "Teléfono de casa",
    workPhone: "Teléfono del trabajo",
    addressLine1: "Dirección línea 1",
    addressLine2: "Dirección línea 2",
    city: "Ciudad",
    stateRegion: "Estado / Región",
    postalCode: "Código postal",
    country: "País",
    address: "Dirección",
    dateOfBirth: "Fecha de nacimiento",
    gender: "Género",
    maritalStatus: "Estado civil",
    congregation: "Congregación",
    ministry: "Ministerio",
    name: "Nombre",
    message: "Mensaje",
    notes: "Notas",
    amount: "Cantidad",
    date: "Fecha",
    location: "Lugar",
    contact: "Contacto",
    personalDetails: "Datos personales",
  },

  validation: {
    required: "Este campo es obligatorio.",
    email: "Ingrese un correo electrónico válido.",
    url: "Ingrese una URL válida.",
    pattern: "Por favor, use el formato solicitado.",
    tooShort: "Use al menos {min} caracteres.",
    tooLong: "Use {max} caracteres o menos.",
    outOfRange: "El valor está fuera del rango permitido.",
    invalidValue: "Ingrese un valor válido.",
    generic: "Corrija este campo.",
    formIncomplete: "Complete los campos obligatorios.",
    phone: "Ingrese un número de teléfono válido.",
  },

  errors: {
    generic: "Algo salió mal. Inténtelo de nuevo.",
    network:
      "No pudimos conectar con el servidor. Revise su conexión e inténtelo de nuevo.",
    authRequired: "Inicie sesión para continuar.",
    sessionExpired: "Su sesión ha expirado. Inicie sesión de nuevo.",
    forbidden: "No tiene permiso para ver esto.",
    notFound: "No encontramos lo que buscaba.",
    rateLimited: "Demasiadas solicitudes. Espere un momento e inténtelo de nuevo.",
    invalidRequest: "Esa solicitud no fue válida. Inténtelo de nuevo.",
    saveFailed: "No pudimos guardar sus cambios. Inténtelo de nuevo.",
    submitFailed: "El envío falló. Inténtelo de nuevo.",
    invalid_session: "Su sesión ha expirado. Inicie sesión de nuevo.",
    invalid_code: "Ese enlace de acceso ya no es válido. Inicie sesión de nuevo.",
    link_expired:
      "Ese enlace ya no es válido. Utilice el enlace para darse de baja de un correo electrónico reciente o administre sus preferencias a continuación.",
    // `next-prayer-feedback` (C69), compartidos con la suscripción de C70.
    feedback_type_not_allowed: "Esa opción no está disponible en este formulario.",
    feedback_type_not_found: "Esa opción ya no está disponible. Elija otra.",
    template_not_configured:
      "Este formulario no está configurado por completo. Comuníquese con la iglesia.",
    invalid_return_url: "Esa solicitud no fue válida. Inténtelo de nuevo.",
    email_send_failed:
      "No pudimos enviar el correo electrónico de confirmación. Inténtelo de nuevo.",
    verification_invalid: "Este enlace no es válido. Envíe el formulario de nuevo.",
    verification_expired: "Este enlace ha expirado. Envíe el formulario de nuevo.",
    verification_used: "Este enlace ya se ha utilizado.",
    feedback_save_failed: "No pudimos enviar su solicitud. Inténtelo de nuevo.",
    user_not_found: "No encontramos su cuenta.",
    contact_not_found: "No encontramos su registro de contacto.",
    donor_not_found: "No hay un registro de donante vinculado a su cuenta.",
    invoice_not_found: "No encontramos esa factura.",
    invoice_not_payable: "Esa factura no está disponible para pago.",
    event_not_found: "No encontramos ese evento.",
    form_not_found: "No encontramos ese formulario.",
    group_not_found: "No encontramos ese grupo.",
    opportunity_not_found: "No encontramos esa oportunidad.",
    publication_not_found: "No encontramos esa publicación.",
    payment_declined: "El pago fue rechazado. Intente con otro método.",
    campaign_not_found: "No encontramos esa campaña de donaciones.",
    household_not_found: "No encontramos su hogar.",
    profile_not_found: "No encontramos su perfil.",
    photo_not_found: "No hay ninguna foto registrada.",
    not_head_of_household: "Solo el jefe de hogar puede hacer este cambio.",
    not_household_member: "Esa persona no forma parte de su hogar.",
    directory_forbidden: "No tiene acceso al directorio de miembros.",
    pledge_forbidden: "No tiene permiso para modificar este compromiso.",
    validation_failed: "Revise los campos marcados e inténtelo de nuevo.",
    no_file: "Primero elija un archivo.",
    invalid_file_type: "Suba una imagen JPEG, PNG, GIF o WebP.",
    file_too_large: "Ese archivo es demasiado grande. Elija una imagen más pequeña.",
  },

  localeSelector: {
    label: "Idioma",
    ariaLabel: "Elegir un idioma",
  },
} satisfies Partial<Messages>;
