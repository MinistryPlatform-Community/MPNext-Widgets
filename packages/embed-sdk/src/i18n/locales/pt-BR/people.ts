/**
 * Brazilian Portuguese — people widget namespaces.
 *
 * Kept in step with `../en/people.ts`: the index's `satisfies Messages` fails the
 * build if a key here is missing, extra or misspelled.
 *
 * `você` throughout, and Brazilian forms: "celular", "e-mail", "CEP".
 */
import type { Messages } from "../en";

export const ptBRPeople = {
  myHousehold: {
    title: "Minha família",
    loading: "Carregando a família…",
    empty: "Nenhuma família foi encontrada para a sua conta.",
    householdLabel: "Família",
    householdName: "Nome da família",
    editHousehold: "Editar a família",
    primaryAddress: "Endereço principal",
    seasonalAddress: "Endereço temporário",
    seasonalAddressSection: "Endereço temporário ou alternativo",
    noAddress: "Nenhum endereço cadastrado.",
    seasonStart: "Início do período",
    seasonEnd: "Fim do período",
    repeatAnnually: "Repetir todos os anos",
    seasonRangeAnnual: "{start} – {end} todos os anos",
    seasonStartAnnual: "{start} todos os anos",
    seasonFrom: "A partir de {date}",
    seasonUntil: "Até {date}",
    homePhoneUnlisted: "Não divulgar o telefone residencial",
    homeAddressUnlisted: "Não divulgar o endereço residencial",
    members: "Membros",
    addMember: "+ Adicionar membro da família",
    memberFallbackName: "Membro",
    addMemberTitle: "Adicionar membro",
    editMemberTitle: "Editar {name}",
    householdPosition: "Posição na família",
    contactInformation: "Informações de contato",
    communicationPreferences: "Preferências de comunicação",
    emailUnlisted: "Não divulgar o e-mail",
    mobilePhoneUnlisted: "Não divulgar o celular",
    doNotText: "Não enviar mensagens de texto",
    bulkEmailOptOut: "Não receber e-mails em massa",
    removeFromDirectory: "Remover do diretório",
    memberPhotoAlt: "Foto do membro",
    addPhoto: "Adicionar foto",
    changePhoto: "Alterar a foto",
    photoHint: "JPEG, PNG, GIF ou WebP. Máximo de 10 MB.",
    photoTooLarge: "A foto deve ter menos de 10 MB.",
    saveHousehold: "Salvar a família",
    saveMember: "Salvar o membro",
    fixHighlighted: "Corrija os campos destacados.",
    householdSaved: "A família foi salva com sucesso.",
    memberSaved: "O membro foi salvo com sucesso.",
  },

  profile: {
    loading: "Carregando o perfil…",
    photoAlt: "Foto do perfil",
    greeting: "Olá, {name}!",
    intro:
      "Preencha as suas informações abaixo e clique em Salvar. Elas ficarão visíveis apenas para a equipe da igreja, a menos que você escolha compartilhá-las com outras pessoas.",
    month: "Mês",
    day: "Dia",
    year: "Ano",
    contactInformation: "Informações de contato",
    contactPrompt: "Como você prefere ser contatado?",
    smsOptIn: "Concordo em receber mensagens de texto de {org}",
    orgFallback: "nossa organização",
    smsRates:
      "Podem ser aplicadas tarifas de mensagens e dados. A frequência das mensagens varia e você pode cancelar o recebimento quando quiser.",
    bulkEmailOptOut: "Não quero receber e-mails em massa",
    saveProfile: "Salvar o perfil",
    saved: "O perfil foi salvo com sucesso.",
    changePassword: "Alterar a senha",
    currentPassword: "Senha atual",
    newPassword: "Nova senha",
    confirmPassword: "Confirmar a nova senha",
    passwordChanged: "A senha foi alterada com sucesso.",
    passwordsDoNotMatch: "As senhas não coincidem",
    photoTypeInvalid: "Envie uma imagem JPEG, PNG, GIF ou WebP.",
    photoTooLarge: "A foto deve ter menos de 5 MB.",
    // Guillemets rather than double quotes: this message is also rendered into
    // an attribute-adjacent context by the validation layer.
    firstNameOnly: "Digite apenas o seu primeiro nome (sem «&» nem «and»)",
    phoneFormat: "Use o formato: 999-999-9999",
  },

  onlineDirectory: {
    title: "Diretório",
    loading: "Carregando o diretório…",
    signInRequired: "Entre na sua conta para ver o diretório.",
    accessDenied: "Você não tem acesso ao diretório.",
    loadFailed: "Não foi possível carregar o diretório.",
    searchLabel: "Buscar por nome, telefone ou e-mail",
    searchPlaceholder: {
      one: "Digite ao menos {count} caractere…",
      // `many` is the CLDR branch Portuguese selects for compact millions; it
      // can never fire on a search length, but the parity guard requires it.
      many: "Digite ao menos {count} caracteres…",
      other: "Digite ao menos {count} caracteres…",
    },
    minLengthHint: {
      one: "Digite ao menos {count} caractere para buscar no diretório.",
      many: "Digite ao menos {count} caracteres para buscar no diretório.",
      other: "Digite ao menos {count} caracteres para buscar no diretório.",
    },
    allCongregations: "Todas as congregações",
    searching: "Buscando…",
    noResults: "Nenhum resultado encontrado.",
    truncated:
      "Mostrando os primeiros resultados; refine a sua busca para reduzi-los.",
    searchFailed: "A busca falhou.",
    familyChip: "Família {name}",
    clearFamilyFilter: "Remover o filtro de família",
    family: "Família",
    viewFamily: "Ver a família",
    map: "Mapa",
    addBirthday: "Adicionar o aniversário ao calendário",
    birthdaySummary: "Feliz aniversário, {name}!",
    emailTitle: "Enviar e-mail para {name}",
    subject: "Assunto",
    send: "Enviar",
    sent: "Enviado",
    sendFailed: "Não foi possível enviar a mensagem.",
  },
} satisfies Partial<Messages>;
