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

  eventDetails: {
    loading: "Carregando o evento…",
    notAvailable: "Este evento não está disponível.",
    noEventSpecified: "Nenhum evento foi especificado.",
    backToEvents: "Voltar aos eventos",
    private: "Este evento é privado.",
    staffOnly: "Este evento está disponível apenas para a equipe.",
    meetingInstructions: "Instruções da reunião",
    rooms: "Sala(s)",
    contacts: "Contato(s)",
    mapTitle: "Mapa do local do evento",
    register: "Inscrever-se",
    volunteer: "Ser voluntário",
    emailFriend: "Enviar para um amigo",
    emailUnavailable:
      "O envio por e-mail para um amigo não está disponível neste widget.",
    signInToRegister: "Faça login para se inscrever neste evento.",
    registrationInactive: "As inscrições não estão ativas neste momento.",
    registrationFull: "As inscrições estão esgotadas.",
    registrationSessionExpired: "Sua sessão de inscrição expirou.",
    verifyDetails: "Confira os dados da inscrição.",
    dobInFuture: "A data de nascimento não pode ser uma data futura.",
    saveFailed: "Não foi possível salvar sua inscrição.",
    savedAddAnother: "Salvo. Adicione outra pessoa abaixo.",
    registrationFailed: "A inscrição falhou.",
    invoiceNotFound: "Não foi possível encontrar a fatura.",
    deleteFailed: "Não foi possível excluir a inscrição.",
    deleteError: "Ocorreu um erro ao excluir a inscrição.",
    registerAs: "Inscrever como",
    selectPrompt: "-- Selecione --",
    blankForm: "Formulário em branco",
    myInfo: "Meus dados",
    alreadyRegistered: "Esta pessoa já está inscrita neste evento.",
    attendee: "Participante",
    attendeeMinor: "Participante (menor de idade)",
    parentGuardian: "Pai / responsável",
    updateMyInfo: "Atualizar meus dados de contato com as informações acima",
    addOns: "Itens adicionais",
    optionColumn: "Opção",
    qtyColumn: "Qtd.",
    priceColumn: "Preço",
    notSelected: "Não selecionado",
    promoCode: "Código promocional",
    promoPlaceholder: "Digite o código",
    promoApply: "Aplicar",
    promoInvalid: "Código promocional inválido.",
    additionalInformation: "Informações adicionais",
    checkout: "Finalizar pagamento",
    registerAndCheckout: "Inscrever-se e pagar",
    registerAndAddAnother: "Inscrever-se e adicionar outro",
    participants: "Participantes",
    participantNumber: "Participante {number}",
    minorLabel: "Menor: {name}",
    registered: "Inscrito",
  },

  fullCalendar: {
    loading: "Carregando o calendário…",
    initFailed: "Não foi possível carregar o calendário. Atualize a página.",
    libraryFailed: "Não foi possível carregar a biblioteca do calendário.",
    libraryUnavailable: "A biblioteca do calendário não está disponível.",
    today: "Hoje",
    tomorrow: "Amanhã",
    viewMonth: "Mês",
    viewGrid: "Grade",
    viewWeek: "Semana",
    viewList: "Lista",
    viewCards: "Cartões",
    viewCalendar: "Calendário",
    previousMonth: "Mês anterior",
    nextMonth: "Próximo mês",
    density1to3: "1-3 eventos",
    density4to6: "4-6 eventos",
    density7plus: "7+ eventos",
    campus: "Campus",
    noEventsFound: "Nenhum evento encontrado",
    learnMore: "SAIBA MAIS",
    showMore: "Mostrar mais",
    emptyPeriod: "Nenhum evento programado para este período.",
    // Brazilian Portuguese selects CLDR `many` for exact millions, where the
    // noun takes "de" ("1.000.000 de eventos").
    eventCount: {
      one: "{count} evento",
      many: "{count} de eventos",
      other: "{count} eventos",
    },
    featured: "Destaque",
    register: "Inscrever-se",
    adminDetails: "Detalhes administrativos",
    participants: "Participantes",
    registration: "Inscrição",
    openInMinistryPlatform: "Abrir no Ministry Platform",
  },

  addToCalendar: {
    trigger: "Adicionar ao calendário",
    loading: "Carregando o evento…",
    menuLabel: "Adicionar {title} ao calendário",
    notConfigured: "Este link de calendário não está configurado corretamente.",
    buildFailed: "Não foi possível criar o item do calendário.",
    otherIcs: "Outro (arquivo .ics)",
  },

  /**
   * `next-pre-check` (C78). Written rather than ported: MP ships no
   * `mpp-pre-check.json` label file, so there was no MP-authored Portuguese to
   * lift. Register is `você`, matching the rest of these catalogues.
   *
   * "Check-in" is kept: it is ordinary Brazilian Portuguese and is what a
   * church volunteer says out loud, so "pré-check-in" reads more naturally
   * than a fully translated coinage would.
   */
  preCheck: {
    title: "Pré-check-in",
    intro: "Faça o check-in da sua família antes de chegar.",
    loading: "Carregando os eventos da sua família…",
    emptyNoEvents: "Não há eventos com check-in em {date}.",
    signedOutPrompt: "Entre para fazer o check-in da sua família.",
    signedOutLegacy:
      "Entre usando o link de acesso desta página para fazer o check-in da sua família.",
    selectAll: "Selecionar tudo",
    clearAll: "Limpar tudo",
    attendedLocked: "Check-in já feito",
    memberEventsLabel: "Eventos de {name}",
    save: "Fazer check-in",
    qrTitle: "Seu código de check-in",
    qrHelp: "Mostre este código no posto de check-in.",
    qrUnavailable: "O código de check-in não está disponível no momento.",
    // `many` is required: Brazilian Portuguese selects the CLDR `many`
    // category for exact millions, and `catalogue-parity.test.ts` enforces
    // full branch coverage whether or not the count can reach it.
    savedCount: {
      one: "{count} pessoa está com check-in feito para {date}.",
      many: "{count} de pessoas estão com check-in feito para {date}.",
      other: "{count} pessoas estão com check-in feito para {date}.",
    },
    cancelledNote: "Quem você desmarcou foi removido.",
    savedNone: "Ninguém está com check-in feito para {date}.",
    staleSelection:
      "Esta página está desatualizada. Ela foi recarregada: confira suas escolhas e tente de novo.",
  },
} satisfies Partial<Messages>;
