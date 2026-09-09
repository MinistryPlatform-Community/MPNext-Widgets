/**
 * Brazilian Portuguese — events widget namespaces.
 *
 * Kept in step with `../en/events.ts`: the index's `satisfies Messages` fails
 * the build if a key here is missing, extra or misspelled.
 */
import type { Messages } from "../en";

export const ptBREvents = {
  eventFinder: {
    searchPlaceholder: "Buscar eventos…",
    searchLabel: "Buscar eventos",
    showAdvanced: "Busca avançada",
    hideAdvanced: "Ocultar busca avançada",
    allCongregations: "Todas as congregações",
    allMinistries: "Todos os ministérios",
    allMonths: "Todos os meses",
    month: "Mês",
    signupType: "Tipo de inscrição",
    signupBoth: "Ambos",
    signupRegistration: "Inscrições abertas",
    signupVolunteer: "Oportunidades de voluntariado abertas",
    loading: "Carregando eventos…",
    empty: "Nenhum evento encontrado.",
    featured: "Destaque",
  },
} satisfies Partial<Messages>;
