// Catálogo FECHADO de variáveis de template.
//
// Fechado de propósito: a validação acontece no cadastro da seção, não na
// geração. É no cadastro que a advogada ainda tem contexto para corrigir um
// {{nomeDoCliente}} que ela quis escrever como {{nomeCliente}} — descobrir isso
// meses depois, na hora de gerar a procuração, é tarde.
//
// Cada entrada declara:
//   origem      — de qual documento o valor sai (define a orientação da pendência)
//   caminho     — caminho no documento de origem, em notação de ponto
//   rotulo      — nome legível, usado nas mensagens de pendência
//   formatador  — chave de templateFormatters aplicada ao valor bruto
//
// Todos os caminhos foram conferidos contra os schemas reais de User, Client,
// Process e Fee.
//
// Honorário (Fase 2C): a origem `honorario` cobre apenas o que o Fee ATUAL
// suporta. `percentualHonorario` fica de fora de propósito — o campo
// `percentual` só nasce na Fase 4, e declarar a variável antes do campo
// produziria pendência perpétua numa seção que a advogada não teria como
// resolver.

export const ORIGENS = ["usuario", "cliente", "processo", "sistema", "honorario"];

// Onde o usuário vai preencher o campo que faltou.
export const ONDE_PREENCHER = {
  usuario: "no seu perfil",
  cliente: "no cadastro do cliente",
  processo: "no cadastro do processo",
  sistema: "automaticamente pelo sistema",
  honorario: "no honorário vinculado ao processo"
};

export const CATALOGO_VARIAVEIS = {
  // ── Cliente — pessoa física ────────────────────────────────────────────────
  nomeCliente:             { origem: "cliente", caminho: "nomeCompleto",              rotulo: "Nome completo do cliente",   formatador: "texto" },
  cpfCliente:              { origem: "cliente", caminho: "cpf",                       rotulo: "CPF do cliente",             formatador: "cpf" },
  rgCliente:               { origem: "cliente", caminho: "rg",                        rotulo: "RG do cliente",              formatador: "texto" },
  dataNascimentoCliente:   { origem: "cliente", caminho: "dataNascimento",            rotulo: "Data de nascimento",         formatador: "data" },
  sexoCliente:             { origem: "cliente", caminho: "sexo",                      rotulo: "Sexo",                       formatador: "sexo" },
  estadoCivilCliente:      { origem: "cliente", caminho: "estadoCivil",               rotulo: "Estado civil",               formatador: "estadoCivil" },
  profissaoCliente:        { origem: "cliente", caminho: "profissao",                 rotulo: "Profissão",                  formatador: "texto" },
  nacionalidadeCliente:    { origem: "cliente", caminho: "nacionalidade",             rotulo: "Nacionalidade",              formatador: "texto" },
  emailCliente:            { origem: "cliente", caminho: "email",                     rotulo: "E-mail do cliente",          formatador: "texto" },
  telefoneCliente:         { origem: "cliente", caminho: "telefone",                  rotulo: "Telefone do cliente",        formatador: "telefone" },
  enderecoCliente:         { origem: "cliente", caminho: "endereco",                  rotulo: "Endereço do cliente",        formatador: "endereco" },
  cepCliente:              { origem: "cliente", caminho: "endereco.cep",              rotulo: "CEP do cliente",             formatador: "cep" },
  cidadeCliente:           { origem: "cliente", caminho: "endereco.cidade",           rotulo: "Cidade do cliente",          formatador: "texto" },
  estadoCliente:           { origem: "cliente", caminho: "endereco.estado",           rotulo: "Estado (UF) do cliente",     formatador: "texto" },

  // ── Cliente — pessoa jurídica ──────────────────────────────────────────────
  razaoSocialCliente:      { origem: "cliente", caminho: "razaoSocial",               rotulo: "Razão social",               formatador: "texto" },
  nomeFantasiaCliente:     { origem: "cliente", caminho: "nomeFantasia",              rotulo: "Nome fantasia",              formatador: "texto" },
  cnpjCliente:             { origem: "cliente", caminho: "cnpj",                      rotulo: "CNPJ do cliente",            formatador: "cnpj" },
  representanteLegalNome:  { origem: "cliente", caminho: "representanteLegal.nome",   rotulo: "Nome do representante legal", formatador: "texto" },
  representanteLegalCpf:   { origem: "cliente", caminho: "representanteLegal.cpf",    rotulo: "CPF do representante legal",  formatador: "cpf" },
  representanteLegalCargo: { origem: "cliente", caminho: "representanteLegal.cargo",  rotulo: "Cargo do representante legal", formatador: "texto" },

  // ── Processo ───────────────────────────────────────────────────────────────
  numeroProcesso:          { origem: "processo", caminho: "numeroProcesso",           rotulo: "Número do processo",         formatador: "texto" },
  tituloProcesso:          { origem: "processo", caminho: "titulo",                   rotulo: "Título do processo",         formatador: "texto" },
  tipoAcao:                { origem: "processo", caminho: "tipoAcao",                 rotulo: "Tipo de ação",               formatador: "texto" },
  areaProcesso:            { origem: "processo", caminho: "area",                     rotulo: "Área do processo",           formatador: "texto" },
  orgaoProcesso:           { origem: "processo", caminho: "orgao",                    rotulo: "Órgão",                      formatador: "texto" },
  varaProcesso:            { origem: "processo", caminho: "vara",                     rotulo: "Vara",                       formatador: "texto" },
  comarcaProcesso:         { origem: "processo", caminho: "comarca",                  rotulo: "Comarca",                    formatador: "texto" },
  dataDistribuicao:        { origem: "processo", caminho: "dataDistribuicao",         rotulo: "Data de distribuição",       formatador: "data" },
  statusProcesso:          { origem: "processo", caminho: "status",                   rotulo: "Status do processo",         formatador: "texto" },

  // ── Usuário / escritório ───────────────────────────────────────────────────
  nomeAdvogado:            { origem: "usuario", caminho: "nomeCompleto",              rotulo: "Seu nome completo",          formatador: "texto" },
  cpfAdvogado:             { origem: "usuario", caminho: "cpf",                       rotulo: "Seu CPF",                    formatador: "cpf" },
  numOAB:                  { origem: "usuario", caminho: "oab.numero",                rotulo: "Número da OAB",              formatador: "texto" },
  estadoOAB:               { origem: "usuario", caminho: "oab.estado",                rotulo: "UF da OAB",                  formatador: "texto" },
  nomeAdvocacia:           { origem: "usuario", caminho: "advocacia.nome",            rotulo: "Nome da advocacia",          formatador: "texto" },
  enderecoEscritorio:      { origem: "usuario", caminho: "endereco",                  rotulo: "Endereço do escritório",     formatador: "endereco" },
  telefoneEscritorio:      { origem: "usuario", caminho: "telefone",                  rotulo: "Telefone do escritório",     formatador: "telefone" },
  emailEscritorio:         { origem: "usuario", caminho: "email",                     rotulo: "E-mail do escritório",       formatador: "texto" },
  chavePix:                { origem: "usuario", caminho: "advocacia.chavePix",        rotulo: "Chave PIX",                  formatador: "texto" },
  // Sai do endereço do usuário, não de constante do sistema: a comarca de
  // assinatura é a do escritório, e é lá que ela é corrigida.
  cidadeEscritorio:        { origem: "usuario", caminho: "endereco.cidade",           rotulo: "Cidade do escritório",       formatador: "texto" },

  // ── Honorário ──────────────────────────────────────────────────────────────
  // `numeroParcelas` e `valorParcela` não são campos do Fee: são derivados das
  // parcelas ativas, calculados em documentGenerationService ao montar a
  // origem. Sem parcela cadastrada, o honorário é pagamento único (1 parcela
  // do valor cheio) — que é como o contrato deve descrevê-lo.
  valorHonorario:          { origem: "honorario", caminho: "valor",                   rotulo: "Valor do honorário",         formatador: "moeda" },
  valorHonorarioExtenso:   { origem: "honorario", caminho: "valor",                   rotulo: "Valor do honorário por extenso", formatador: "extenso" },
  tipoHonorario:           { origem: "honorario", caminho: "tipo",                    rotulo: "Tipo de honorário",          formatador: "tipoHonorario" },
  dataVencimentoHonorario: { origem: "honorario", caminho: "dataVencimento",          rotulo: "Vencimento do honorário",    formatador: "data" },
  numeroParcelas:          { origem: "honorario", caminho: "numeroParcelas",          rotulo: "Número de parcelas",         formatador: "inteiro" },
  valorParcela:            { origem: "honorario", caminho: "valorParcela",            rotulo: "Valor da parcela",           formatador: "moeda" },

  // ── Sistema ────────────────────────────────────────────────────────────────
  dataAtual:               { origem: "sistema", caminho: "hoje",                      rotulo: "Data atual",                 formatador: "data" },
  dataAtualExtenso:        { origem: "sistema", caminho: "hoje",                      rotulo: "Data atual por extenso",     formatador: "dataExtenso" }
};

// Variáveis que exigem um honorário resolvido. O gerador só cobra a escolha de
// `honorarioId` quando o texto usa alguma delas — documento sem variável de
// honorário não deve nem perguntar.
export const VARIAVEIS_DE_HONORARIO = Object.entries(CATALOGO_VARIAVEIS)
  .filter(([, def]) => def.origem === "honorario")
  .map(([nome]) => nome);

export const NOMES_VARIAVEIS = Object.keys(CATALOGO_VARIAVEIS);

// Mensagem de pendência: diz o que falta e onde preencher.
export const orientacaoPendencia = (nome) => {
  const def = CATALOGO_VARIAVEIS[nome];
  if (!def) {
    return { variavel: nome, rotulo: nome, origem: null, orientacao: "Variável desconhecida" };
  }
  return {
    variavel: nome,
    rotulo: def.rotulo,
    origem: def.origem,
    orientacao: `Preencha "${def.rotulo}" ${ONDE_PREENCHER[def.origem]}`
  };
};

export default CATALOGO_VARIAVEIS;
