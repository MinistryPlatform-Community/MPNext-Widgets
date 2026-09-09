/**
 * Brazilian Portuguese — giving widget namespaces.
 *
 * Kept in step with `../en/giving.ts`: the index's `satisfies Messages` fails the
 * build if a key here is missing, extra or misspelled.
 *
 * `você` throughout, and Brazilian giving vocabulary: *promessa de doação* for
 * a pledge, *informe de doações* for a contribution statement.
 */
import type { Messages } from "../en";

export const ptBRGiving = {
  myGiving: {
    title: "Minhas doações",
    loading: "Carregando o histórico de doações…",
    totalGiving: "Total doado",
    includeSoftCredits: "Incluir doações com crédito indireto",
    allMonths: "Todos os meses de {year}",
    byMonth: "Por mês",
    byProgram: "Por programa",
    chartEmpty: "Não há doações para exibir no gráfico.",
    byMonthChartLabel: "Doações por mês",
    byProgramChartLabel: "Doações por programa",
    disclaimer:
      "A lista de doações a seguir é informativa e não deve ser usada para fins fiscais.",
    softCreditDisclaimer:
      "As doações com crédito indireto estão incluídas abaixo e refletem doações creditadas a você, mas que você não fez pessoalmente.",
    donations: "Doações",
    empty: "Nenhuma doação",
    showMore: "VER MAIS DOAÇÕES",
    pending: "PENDENTE",
    badgeSpouse: "Cônjuge",
    badgeSoftCredit: "Crédito indireto",
    badgeNonDeductible: "Não dedutível",
  },

  myPledges: {
    title: "Minhas promessas de doação",
    loading: "Carregando promessas…",
    empty: "Você não está associado a nenhuma promessa de doação.",
    cancel: "Cancelar promessa",
    confirmCancel: "Deseja cancelar esta promessa?",
    confirmCancelYes: "Cancelar promessa",
    keep: "Manter",
    canceling: "Cancelando…",
    canceled: "Promessa cancelada",
    cancelFailed: "Erro ao cancelar a promessa. Tente novamente.",
    progress: "{paid} de {total} ({percent})",
    installments: {
      one: "{count} parcela a partir de {date}",
      other: "{count} parcelas a partir de {date}",
      // CLDR gives Brazilian Portuguese a `many` category (millions), which
      // `Intl.PluralRules` selects for a count like 1.000.000; the wording only
      // differs from `other` in compact notation, which is never rendered here.
      many: "{count} parcelas a partir de {date}",
    },
    iconLabel: "Promessa de doação",
    status: {
      active: "Ativa",
      completed: "Concluída",
      discontinued: "Descontinuada",
      pending: "Pendente",
    },
  },

  pledgeCampaign: {
    loading: "Carregando a campanha…",
    notSpecified: "Nenhuma campanha de promessas foi especificada.",
    notFound: "Campanha de promessas não encontrada.",
    closed: "Esta campanha não aceita mais novas promessas.",
    alreadyPledged:
      "Você já fez uma promessa para esta campanha. Confirme se deseja fazer outra.",
    pastEndDate: "Você não pode doar após a data final da campanha.",
    pastEndDateOn: "Você não pode doar após a data final da campanha ({date}).",
    saveFailed: "Não foi possível salvar sua promessa.",
    thankYou:
      "Obrigado! Sua resposta para {name} foi recebida. Se desejar, clique no botão abaixo para responder por outro membro da família.",
    yourHousehold: "sua família",
    myInfo: "Meus dados",
    defaultTitle: "Campanha de promessas",
    progress: "Progresso",
    progressBarLabel: "Progresso da campanha",
    pledgedOfGoal: "{pledged} prometidos de uma meta de {goal}",
    receivedPercent: "{percent} recebido",
    pledgedPercent: "{percent} prometido",
    signInPrompt: "Entre para fazer uma promessa de doação para esta campanha.",
    createPledge: "Criar uma promessa",
    pledgeDetails: "Detalhes da promessa",
    pledgeAmount: "Valor da promessa",
    selectFrequency: "Selecione a frequência",
    selectPlaceholder: "-- Selecione --",
    startDate: "Data de início da promessa",
    endDate: "Data final da promessa",
    totalPledge: "Total da promessa",
    makePledgeAs: "Fazer promessa como",
    blankForm: "Formulário em branco",
    submit: "Criar promessa",
    submitAnother: "Criar outra promessa",
  },

  contributionStatement: {
    title: "Meus informes de doações",
    loading: "Carregando os informes de doações…",
    empty: "Nenhum informe disponível no momento.",
    selectYear: "Selecione o ano do informe",
    savePdf: "Salvar como PDF",
  },

  statementPreferences: {
    title: "Informes de doações",
    loading: "Carregando as preferências…",
    goPaperless: "Dispense o papel! Receba seus informes online ou por e-mail.",
    updated: "Método de entrega atualizado",
    updateFailed: "Erro ao atualizar o método de entrega. Tente novamente.",
  },

  checkout: {
    header: "Detalhes da fatura",
    processing: "Processando…",
    loading: "Carregando a fatura…",
    empty: "Nenhuma fatura para exibir.",
    noInvoiceSpecified: "Nenhuma fatura foi especificada.",
    processorMissing: "O processador de pagamentos não está configurado.",
    invoiceDate: "Data da fatura",
    status: "Situação",
    noLineItems: "Nenhum item.",
    item: "Item",
    amountPaid: "Valor pago",
    balanceDue: "Saldo devedor",
    paymentAmount: "Valor do pagamento",
    payInFull: "Pagar o total ({amount})",
    payDeposit: "Pagar o depósito ({amount})",
    otherAmount: "Outro valor",
    youWillPay: "Você vai pagar",
    pay: "Pagar",
    makeChanges: "Fazer alterações",
    paidInFull: "Paga integralmente",
    invalidAmount: "Informe um valor de pagamento válido.",
    paymentReceived: "Pagamento recebido — obrigado!",
    paymentPending:
      "Seu pagamento está sendo processado. Esta fatura será atualizada quando o pagamento for confirmado.",
    paymentUnconfirmed: "Não conseguimos confirmar seu pagamento.",
    paymentUnconfirmedDetail:
      "Não conseguimos confirmar seu pagamento: {detail}",
  },

  checkoutComplete: {
    confirming: "Confirmando seu pagamento…",
    titleSuccess: "Pagamento concluído",
    titlePending: "Pagamento pendente",
    titleFailed: "Pagamento não confirmado",
    noPaymentInfo: "Nenhuma informação de pagamento foi encontrada.",
    received: "Obrigado! Seu pagamento foi recebido.",
    processing:
      "Obrigado! Seu pagamento está sendo processado e será confirmado em breve.",
    failed:
      "Não conseguimos confirmar seu pagamento. Tente novamente ou entre em contato conosco.",
    unconfirmed: "Não conseguimos confirmar seu pagamento.",
  },

  pay: {
    header: "Pagamento seguro",
    sandboxNotice: "Pagamento de teste: use o cartão de teste {card}",
    loading: "Carregando a solicitação de pagamento…",
    noRequest: "Nenhuma solicitação de pagamento foi fornecida.",
    unavailable: "Solicitação de pagamento indisponível.",
    decodeFailed: "Não foi possível ler a solicitação de pagamento.",
    invoice: "Fatura",
    amountDue: "Valor a pagar",
    nameOnCard: "Nome no cartão",
    namePlaceholder: "João da Silva",
    cardNumber: "Número do cartão",
    expiry: "Validade",
    expiryPlaceholder: "MM/AA",
    cvv: "CVV",
    payAmount: "Pagar {amount}",
    processing: "Processando…",
    submitFailed: "Não foi possível enviar o pagamento.",
    enterName: "Informe o nome que está no cartão.",
    enterCard: "Informe o número do cartão.",
    enterExpiry: "Informe a data de validade.",
    enterCvv: "Informe o CVV.",
  },

  subscriptions: {
    title: "Minhas assinaturas",
    subtitle: "Escolha as publicações que você deseja receber.",
    loading: "Carregando assinaturas…",
    searchPlaceholder: "Buscar publicações…",
    empty: "Nenhuma publicação disponível.",
    noMatches: "Nenhuma publicação corresponde à sua busca.",
    subscribed: "Você assinou {title}",
    unsubscribed: "Você cancelou a assinatura de {title}",
    updateFailed: "Não foi possível atualizar a assinatura. Tente novamente.",
  },
} satisfies Partial<Messages>;
