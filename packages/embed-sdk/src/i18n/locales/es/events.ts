/**
 * Spanish — events widget namespaces.
 *
 * Kept in step with `../en/events.ts`: the index's `satisfies Messages` fails
 * the build if a key here is missing, extra or misspelled.
 */
import type { Messages } from "../en";

export const esEvents = {
  eventFinder: {
    searchPlaceholder: "Buscar eventos…",
    searchLabel: "Buscar eventos",
    showAdvanced: "Búsqueda avanzada",
    hideAdvanced: "Ocultar búsqueda avanzada",
    allCongregations: "Todas las congregaciones",
    allMinistries: "Todos los ministerios",
    allMonths: "Todos los meses",
    month: "Mes",
    signupType: "Tipo de inscripción",
    signupBoth: "Ambos",
    signupRegistration: "Inscripción abierta",
    signupVolunteer: "Oportunidades de voluntariado abiertas",
    loading: "Cargando eventos…",
    empty: "No se encontraron eventos.",
    featured: "Destacado",
  },
} satisfies Partial<Messages>;
