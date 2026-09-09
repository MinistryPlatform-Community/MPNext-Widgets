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
