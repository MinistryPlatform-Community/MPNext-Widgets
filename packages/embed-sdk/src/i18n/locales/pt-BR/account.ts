/**
 * Brazilian Portuguese — account widget namespaces.
 *
 * Kept in step with `../en/account.ts`: the index's `satisfies Messages` fails the
 * build if a key here is missing, extra or misspelled.
 *
 * Addressed as `você` throughout, with Brazilian forms ("fatura", not "factura").
 */
import type { Messages } from "../en";

export const ptBRAccount = {
  myInvoices: {
    title: "Minhas faturas",
    // `many` is the branch CLDR selects for whole millions in Portuguese; the
    // wording matches `other`, but the category has to exist or `Intl` falls
    // through to a branch the locale never asked for.
    invoiceCount: {
      one: "{count} fatura",
      many: "{count} faturas",
      other: "{count} faturas",
    },
    searchPlaceholder: "Buscar faturas…",
    loading: "Carregando faturas…",
    loadingDetail: "Carregando os detalhes da fatura…",
    empty: "Nenhuma fatura encontrada.",
    noMatches: "Nenhuma fatura corresponde à sua busca.",
    invoiceNumber: "Fatura nº {id}",
    description: "Descrição",
    status: "Situação",
    pay: "Pagar",
    payNow: "Pagar agora",
    detailTitle: "Detalhes da fatura",
    backToList: "Voltar para as faturas",
    backToInvoice: "Voltar para a fatura",
    invoiceDate: "Data da fatura",
    lineItems: "Itens da fatura",
    product: "Produto",
    quantity: "Qtd.",
    unitPrice: "Preço unitário",
  },

  /**
   * `next-unsubscribe`.
   *
   * `mpp-unsubscribe.json`'s Portuguese is European and second-person-informal
   * — "Foste excluído", "as tuas preferências", "Desfaz", "Minhas Subscrições"
   * — so it seeds the wording but not the grammar. This is `você` with
   * Brazilian lexis: `inscrição` / `cancelar a inscrição` rather than
   * `subscrição`. `Desfazer` needs no change.
   *
   * As in Spanish, only the first sentence of each success label survives, and
   * `undoFailed` is written fresh: legacy's Portuguese for it ("Não é possível
   * cancelar a subscrição") is its *unsubscribe* failure label and describes
   * the opposite action.
   */
  unsubscribe: {
    working: "Só um momento: estamos atualizando suas preferências de e-mail…",
    // Distinct verbs, as in legacy: cancelling one inscription vs. being
    // removed from the bulk notification service.
    donePublication: "Sua inscrição foi cancelada.",
    doneBulk: "Você foi excluído do nosso serviço de notificações por e-mail.",
    undoButton: "Desfazer",
    undone: "Sua inscrição foi reativada.",
    undoFailed: "Não foi possível desfazer o cancelamento.",
    manageLink: "Gerenciar todas as minhas preferências de e-mail",
    badLink:
      "Este link de cancelamento está incompleto. Use o link de um e-mail recente que enviamos para você.",
    title: "Preferências de e-mail",
  },

  userMenu: {
    menuLabel: "Menu do usuário",
    myAccount: "Minha conta",
    modalDescription: "Gerencie as configurações e preferências da sua conta.",
    contributionStatement: "Extrato de contribuições",
    tabs: {
      profile: "Perfil",
      family: "Família",
      groups: "Grupos",
      giving: "Doações",
      subscriptions: "Assinaturas",
      invoices: "Faturas",
    },
  },
} satisfies Partial<Messages>;
