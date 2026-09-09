/**
 * Brazilian Portuguese — shared namespaces.
 *
 * `pt`, `pt-PT` and the African `pt-*` tags all resolve here (see
 * `registry.ts`): Brazilian Portuguese is overwhelmingly the diaspora variant in
 * the US, so it serves as the single Portuguese catalogue rather than shipping
 * two. Where a word differs sharply between Brazil and Portugal, the Brazilian
 * form is used ("celular", not "telemóvel").
 *
 * Address form is `você` throughout — standard in Brazilian Portuguese for
 * respectful direct address, and the natural counterpart to the Spanish
 * catalogue's `usted`.
 */
import type { Messages } from "../en";

export const ptBRCore = {
  common: {
    loading: "Carregando…",
    retry: "Tentar novamente",
    unableToLoad: "Não foi possível carregar",
    signIn: "Entrar",
    signOut: "Sair",
    save: "Salvar",
    saving: "Salvando…",
    cancel: "Cancelar",
    close: "Fechar",
    edit: "Editar",
    remove: "Remover",
    submit: "Enviar",
    submitting: "Enviando…",
    search: "Buscar",
    back: "Voltar",
    next: "Próximo",
    previous: "Anterior",
    total: "Total",
    all: "Todos",
    yes: "Sim",
    no: "Não",
    optional: "opcional",
    required: "obrigatório",
    seeDetails: "Ver detalhes",
    getDirections: "Ver rota",
    signInPrompt: "Entre para continuar.",
    dismiss: "Dispensar",
  },

  fields: {
    firstName: "Nome",
    lastName: "Sobrenome",
    middleName: "Nome do meio",
    nickname: "Apelido",
    prefix: "Título",
    suffix: "Sufixo",
    email: "E-mail",
    mobilePhone: "Celular",
    homePhone: "Telefone residencial",
    workPhone: "Telefone comercial",
    addressLine1: "Endereço linha 1",
    addressLine2: "Endereço linha 2",
    city: "Cidade",
    stateRegion: "Estado / Região",
    postalCode: "CEP",
    country: "País",
    address: "Endereço",
    dateOfBirth: "Data de nascimento",
    gender: "Gênero",
    maritalStatus: "Estado civil",
    congregation: "Congregação",
    ministry: "Ministério",
    name: "Nome",
    message: "Mensagem",
    notes: "Observações",
    amount: "Valor",
    date: "Data",
    location: "Local",
    contact: "Contato",
    personalDetails: "Dados pessoais",
  },

  validation: {
    required: "Este campo é obrigatório.",
    email: "Informe um e-mail válido.",
    url: "Informe uma URL válida.",
    pattern: "Use o formato solicitado.",
    tooShort: "Use pelo menos {min} caracteres.",
    tooLong: "Use {max} caracteres ou menos.",
    outOfRange: "O valor está fora do intervalo permitido.",
    invalidValue: "Informe um valor válido.",
    generic: "Corrija este campo.",
    formIncomplete: "Preencha os campos obrigatórios.",
    phone: "Informe um telefone válido.",
  },

  errors: {
    generic: "Algo deu errado. Tente novamente.",
    network:
      "Não conseguimos conectar ao servidor. Verifique sua conexão e tente novamente.",
    authRequired: "Entre para continuar.",
    sessionExpired: "Sua sessão expirou. Entre novamente.",
    forbidden: "Você não tem permissão para ver isto.",
    notFound: "Não encontramos o que você procurava.",
    rateLimited: "Muitas solicitações. Aguarde um momento e tente novamente.",
    invalidRequest: "Essa solicitação não era válida. Tente novamente.",
    saveFailed: "Não conseguimos salvar suas alterações. Tente novamente.",
    submitFailed: "O envio falhou. Tente novamente.",
    invalid_session: "Sua sessão expirou. Entre novamente.",
    invalid_code: "Esse link de acesso não é mais válido. Entre novamente.",
    link_expired:
      "Este link não é mais válido. Use o link de cancelamento de um e-mail recente ou gerencie suas preferências abaixo.",
    // `next-prayer-feedback` (C69), compartilhados com a inscrição do C70.
    feedback_type_not_allowed: "Essa opção não está disponível neste formulário.",
    feedback_type_not_found: "Essa opção não está mais disponível. Escolha outra.",
    template_not_configured:
      "Este formulário não está totalmente configurado. Entre em contato com a igreja.",
    invalid_return_url: "Essa solicitação não era válida. Tente novamente.",
    email_send_failed:
      "Não foi possível enviar o e-mail de confirmação. Tente novamente.",
    verification_invalid: "Este link não é válido. Envie o formulário novamente.",
    verification_expired: "Este link expirou. Envie o formulário novamente.",
    verification_used: "Este link já foi usado.",
    feedback_save_failed: "Não foi possível enviar sua solicitação. Tente novamente.",
    user_not_found: "Não encontramos sua conta.",
    contact_not_found: "Não encontramos seu registro de contato.",
    donor_not_found: "Nenhum registro de doador está vinculado à sua conta.",
    invoice_not_found: "Não encontramos essa fatura.",
    invoice_not_payable: "Essa fatura não está disponível para pagamento.",
    event_not_found: "Não encontramos esse evento.",
    form_not_found: "Não encontramos esse formulário.",
    group_not_found: "Não encontramos esse grupo.",
    opportunity_not_found: "Não encontramos essa oportunidade.",
    publication_not_found: "Não encontramos essa publicação.",
    precheck_unavailable:
      "O check-in ainda não está configurado neste site. Entre em contato com a igreja.",
    payment_declined: "O pagamento foi recusado. Tente outro método.",
    campaign_not_found: "Não encontramos essa campanha de doações.",
    household_not_found: "Não encontramos sua família.",
    profile_not_found: "Não encontramos seu perfil.",
    photo_not_found: "Não há nenhuma foto cadastrada.",
    not_head_of_household: "Somente o responsável pela família pode fazer esta alteração.",
    not_household_member: "Essa pessoa não faz parte da sua família.",
    directory_forbidden: "Você não tem acesso ao diretório de membros.",
    pledge_forbidden: "Você não tem permissão para alterar esta promessa de doação.",
    validation_failed: "Verifique os campos destacados e tente novamente.",
    no_file: "Escolha um arquivo primeiro.",
    invalid_file_type: "Envie uma imagem JPEG, PNG, GIF ou WebP.",
    file_too_large: "Esse arquivo é muito grande. Escolha uma imagem menor.",
  },

  localeSelector: {
    label: "Idioma",
    ariaLabel: "Escolher um idioma",
  },
} satisfies Partial<Messages>;
