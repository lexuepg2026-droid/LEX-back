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
// Honorário: a origem `honorario` cobre o que o Fee suporta.
// `percentualHonorario` ficou de fora da Fase 2C de propósito — o campo
// `percentual` só nasceria na Fase 4, e declarar a variável antes do campo
// produziria pendência perpétua numa seção que a advogada não teria como
// resolver. O campo nasceu na DEC-027 e a variável entrou na Fase 4.1.
//
// ── Contagem ───────────────────────────────────────────────────────────────
// 48 variáveis: cliente 20, usuario 10, processo 9, honorario 7, sistema 2.
//
// Eram 47 até a Fase 3.2 (honorario 6). A Fase 4.1 acrescentou
// `percentualHonorario`, e só ela.
//
// A auditoria da Fase 2C falou em "45 antes das 6 de honorário"; o número era
// erro de contagem, não divergência real. O arquivo imediatamente anterior ao
// commit de honorário (1acc9bf^) tinha exatamente 41 chaves — o mesmo 41 que a
// Fase 2A registrou. Ou seja: 41 documentadas + 6 de honorário = 47, e nunca
// houve chave a mais sem origem conhecida.
//
// Todos os 48 `caminho` foram conferidos contra os schemas reais de User,
// Client, Process e Fee — nenhum resolver órfão, nenhum campo inexistente.
// `numeroParcelas` e `valorParcela` não são campos do Fee: são derivados das
// parcelas ativas em documentGenerationService, e por isso não aparecem no
// schema. As seções do seed exercitam as 48.
//
// Quem acrescentar variável aqui precisa acrescentar rótulo e descrição em
// `variableLabels.js` — há guarda em teste de carga que falha se faltar.

export const ORIGENS = ["usuario", "cliente", "processo", "sistema", "honorario"];

// Onde o usuário vai preencher o campo que faltou.
export const ONDE_PREENCHER = {
  usuario: "no seu perfil",
  cliente: "no cadastro do cliente",
  processo: "no cadastro do processo",
  sistema: "automaticamente pelo sistema",
  honorario: "no honorário vinculado ao processo"
};

// ── Onde EXATAMENTE, tela e campo (Fase 4.6, item 2.7) ────────────────────
//
// `ONDE_PREENCHER` diz a tela; isto diz o caminho até o campo. "Preencha
// 'Cidade do escritório' no seu perfil" manda a pessoa à tela certa e a deixa
// procurando entre quinze campos — e o Raio-X registrou que o perfil tem quatro
// seções. "Perfil → Endereço → Cidade" acaba a procura.
//
// A seção intermediária é escrita por chave, e não derivada do `caminho` do
// catálogo: `endereco.cidade` viraria "Endereco → Cidade", e `oab.numero`
// viraria "Oab → Numero" — derivação produz rótulo que funciona e parece
// amador, exatamente como a Fase 2D.1 registrou para os rótulos.
const TELA_DA_ORIGEM = {
  usuario: "Perfil",
  cliente: "Cadastro do cliente",
  processo: "Cadastro do processo",
  honorario: "Honorários",
  sistema: null
};

// Seção dentro da tela, por variável. Ausente = campo direto no formulário.
const SECAO_DO_CAMPO = {
  // Perfil
  numOAB: "OAB", estadoOAB: "OAB",
  nomeAdvocacia: "Advocacia", chavePix: "Advocacia",
  enderecoEscritorio: "Endereço", cidadeEscritorio: "Endereço",
  // Cliente
  enderecoCliente: "Endereço", cepCliente: "Endereço",
  cidadeCliente: "Endereço", estadoCliente: "Endereço",
  representanteLegalNome: "Representante legal",
  representanteLegalCpf: "Representante legal",
  representanteLegalCargo: "Representante legal"
};

// "Perfil → Endereço → Cidade do escritório"
export const caminhoDoCampo = (nome) => {
  const def = CATALOGO_VARIAVEIS[nome];
  if (!def) return null;
  const tela = TELA_DA_ORIGEM[def.origem];
  if (!tela) return null;
  return [tela, SECAO_DO_CAMPO[nome], def.rotulo].filter(Boolean).join(" → ");
};

export const CATALOGO_VARIAVEIS = {
  // ── Cliente — pessoa física ────────────────────────────────────────────────
  nomeCliente:             { origem: "cliente", caminho: "nomeCompleto",              rotulo: "Nome completo do cliente",   formatador: "texto", tipoCliente: "pf" },
  cpfCliente:              { origem: "cliente", caminho: "cpf",                       rotulo: "CPF do cliente",             formatador: "cpf", tipoCliente: "pf" },
  rgCliente:               { origem: "cliente", caminho: "rg",                        rotulo: "RG do cliente",              formatador: "texto", tipoCliente: "pf" },
  dataNascimentoCliente:   { origem: "cliente", caminho: "dataNascimento",            rotulo: "Data de nascimento",         formatador: "data", tipoCliente: "pf" },
  sexoCliente:             { origem: "cliente", caminho: "sexo",                      rotulo: "Sexo",                       formatador: "sexo", tipoCliente: "pf" },
  estadoCivilCliente:      { origem: "cliente", caminho: "estadoCivil",               rotulo: "Estado civil",               formatador: "estadoCivil", tipoCliente: "pf" },
  profissaoCliente:        { origem: "cliente", caminho: "profissao",                 rotulo: "Profissão",                  formatador: "texto", tipoCliente: "pf" },
  nacionalidadeCliente:    { origem: "cliente", caminho: "nacionalidade",             rotulo: "Nacionalidade",              formatador: "texto", tipoCliente: "pf" },
  emailCliente:            { origem: "cliente", caminho: "email",                     rotulo: "E-mail do cliente",          formatador: "texto", tipoCliente: "comum" },
  telefoneCliente:         { origem: "cliente", caminho: "telefone",                  rotulo: "Telefone do cliente",        formatador: "telefone", tipoCliente: "comum" },
  enderecoCliente:         { origem: "cliente", caminho: "endereco",                  rotulo: "Endereço do cliente",        formatador: "endereco", tipoCliente: "comum" },
  cepCliente:              { origem: "cliente", caminho: "endereco.cep",              rotulo: "CEP do cliente",             formatador: "cep", tipoCliente: "comum" },
  cidadeCliente:           { origem: "cliente", caminho: "endereco.cidade",           rotulo: "Cidade do cliente",          formatador: "texto", tipoCliente: "comum" },
  estadoCliente:           { origem: "cliente", caminho: "endereco.estado",           rotulo: "Estado (UF) do cliente",     formatador: "texto", tipoCliente: "comum" },

  // ── Cliente — pessoa jurídica ──────────────────────────────────────────────
  razaoSocialCliente:      { origem: "cliente", caminho: "razaoSocial",               rotulo: "Razão social",               formatador: "texto", tipoCliente: "pj" },
  nomeFantasiaCliente:     { origem: "cliente", caminho: "nomeFantasia",              rotulo: "Nome fantasia",              formatador: "texto", tipoCliente: "pj" },
  cnpjCliente:             { origem: "cliente", caminho: "cnpj",                      rotulo: "CNPJ do cliente",            formatador: "cnpj", tipoCliente: "pj" },
  representanteLegalNome:  { origem: "cliente", caminho: "representanteLegal.nome",   rotulo: "Nome do representante legal", formatador: "texto", tipoCliente: "pj" },
  representanteLegalCpf:   { origem: "cliente", caminho: "representanteLegal.cpf",    rotulo: "CPF do representante legal",  formatador: "cpf", tipoCliente: "pj" },
  representanteLegalCargo: { origem: "cliente", caminho: "representanteLegal.cargo",  rotulo: "Cargo do representante legal", formatador: "texto", tipoCliente: "pj" },

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
  nomeAdvogada:            { origem: "usuario", caminho: "nomeCompleto",              rotulo: "Seu nome completo",          formatador: "texto" },
  cpfAdvogada:             { origem: "usuario", caminho: "cpf",                       rotulo: "Seu CPF",                    formatador: "cpf" },
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
  // Fase 4.1: o campo `percentual` nasceu na DEC-027, e com ele a variável que
  // a Fase 2C deixou de fora de propósito. Honorário sem percentual (fixo,
  // custas) devolve "" e vira pendência 422 — não se inventa valor.
  percentualHonorario:     { origem: "honorario", caminho: "percentual",              rotulo: "Percentual do honorário",    formatador: "percentual" },

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


// ── Classificação por tipo de pessoa (Fase 4.6) ────────────────────────────
//
// Cada chave de origem `cliente` é `pf`, `pj` ou `comum`. A lista NÃO foi
// escolhida a olho: é exatamente o que o hook `pre("validate")` de
// `models/Client.js` apaga em cada tipo. Cliente PF tem `razaoSocial`,
// `nomeFantasia`, `cnpj` e `representanteLegal` zerados; cliente PJ tem
// `nomeCompleto`, `cpf`, `rg`, `dataNascimento`, `sexo`, `estadoCivil`,
// `profissao` e `nacionalidade` zerados. Os seis restantes (contato e endereço)
// o hook não toca — são `comum`.
//
// ── O problema que isto existe para resolver ──────────────────────────────
// Um usuário real montou modelo com variáveis de PJ e gerou para cliente PF. A
// pendência dizia **"Preencha 'CNPJ' no cadastro do cliente"** — e seguir
// aquilo é IMPOSSÍVEL: o campo não existe naquele cadastro, e se existisse o
// hook o apagaria na gravação. A orientação mandava a pessoa a uma tela onde o
// campo não está.
//
// Sem esta classificação não há como o resolvedor distinguir "faltou preencher"
// de "esta variável não se aplica a este cliente". São causas diferentes, com
// ações diferentes, e a mesma frase para as duas é o que torna uma delas um
// beco sem saída.
export const TIPOS_CLIENTE_VARIAVEL = ["pf", "pj", "comum"];

export const ROTULO_TIPO_PESSOA = {
  fisica: "pessoa física",
  juridica: "pessoa jurídica"
};

// `fisica` → `pf`. Mapeia o vocabulário do schema para o do catálogo, que são
// diferentes de propósito: o schema fala de PESSOA, o catálogo fala de VARIÁVEL.
const TIPO_DO_CLIENTE = { fisica: "pf", juridica: "pj" };

// A variável se aplica a este cliente? `comum` sempre; as demais só no tipo
// correspondente. Variável que não é de origem `cliente` nunca é incompatível.
export const variavelCompativelCom = (nome, tipoPessoa) => {
  const def = CATALOGO_VARIAVEIS[nome];
  if (!def || def.origem !== "cliente") return true;
  if (def.tipoCliente === "comum") return true;
  if (!tipoPessoa) return true;
  return def.tipoCliente === TIPO_DO_CLIENTE[tipoPessoa];
};

// Quais variáveis de um texto são incompatíveis com o tipo do cliente.
// Usada pelo resolvedor (para a pendência) e pela rota de aviso preventivo.
export const variaveisIncompativeis = (nomes, tipoPessoa) =>
  (nomes ?? []).filter((nome) => !variavelCompativelCom(nome, tipoPessoa));

// ── Vocabulário FECHADO de `motivo` nas pendências (Fase 4.6) ─────────────
//
// A pendência deixa de ser só "falta X". `motivo` diz POR QUE falta, e a tela
// usa para destacar diferente — incompatibilidade não se resolve preenchendo
// campo, então exibi-la ao lado de "faltou preencher" convidaria à ação errada.
//
// Fechado pela mesma razão de `DEPENDENCIA` em `integrityConflicts.js`: sem uma
// lista, em duas fases existiriam `tipoIncompativel`, `tipo_incompativel` e
// `incompativel`, e o frontend voltaria a chutar.
export const MOTIVO_PENDENCIA = Object.freeze({
  // O dado simplesmente não foi preenchido no cadastro. É o caso comum.
  CAMPO_VAZIO: "campoVazio",
  // A variável é de um tipo de pessoa e o cliente é de outro. Preencher é
  // impossível: o hook do Client apaga o campo do tipo errado.
  TIPO_INCOMPATIVEL: "tipoIncompativel",
  // O honorário do processo não admite o campo (percentual em honorário fixo).
  TIPO_HONORARIO_INCOMPATIVEL: "tipoHonorarioIncompativel",
  // As parcelas têm valores diferentes — não existe "valor da parcela".
  PARCELAS_DESIGUAIS: "parcelasDesiguais",
  // Falta escolher qual honorário alimenta o texto.
  ESCOLHA_PENDENTE: "escolhaPendente"
});


export const NOMES_VARIAVEIS = Object.keys(CATALOGO_VARIAVEIS);

// Mensagem de pendência: diz o que falta e onde preencher.
// ═══════════════════════════════════════════════════════════════════════════
// A PENDÊNCIA (Fase 4.6 — reescrita para dizer a verdade)
//
// Toda pendência responde três perguntas: o que falta, POR QUÊ, e onde/como
// resolver. E a ação sugerida precisa ser executável de verdade — há teste que
// SEGUE cada orientação até o 201.
//
// `contexto` traz o que o resolvedor sabe e o catálogo não: o tipo e o nome do
// cliente escolhido, o tipo do honorário. Sem ele esta função só sabe dizer
// "preencha", que é a frase certa em um caso e um beco sem saída em três.
// ═══════════════════════════════════════════════════════════════════════════
export const orientacaoPendencia = (nome, contexto = {}) => {
  const def = CATALOGO_VARIAVEIS[nome];
  if (!def) {
    return {
      variavel: nome,
      rotulo: nome,
      origem: null,
      motivo: null,
      orientacao: "Variável desconhecida"
    };
  }

  const base = { variavel: nome, rotulo: def.rotulo, origem: def.origem };
  const onde = caminhoDoCampo(nome);

  // ── 1.2 — incompatibilidade de tipo de pessoa ──────────────────────────
  //
  // O caso que abriu a fase. Antes dizia "Preencha 'CNPJ' no cadastro do
  // cliente" — e o cadastro de um cliente PF não tem CNPJ, nem passaria a ter:
  // o hook do Client apaga os campos do outro tipo na gravação. A pessoa ia à
  // tela, não achava o campo, e concluía que o sistema estava quebrado.
  const { tipoPessoaCliente, nomeCliente } = contexto;
  if (def.origem === "cliente" && !variavelCompativelCom(nome, tipoPessoaCliente)) {
    const tipoVar = def.tipoCliente === "pf" ? "pessoa física" : "pessoa jurídica";
    const tipoCli = ROTULO_TIPO_PESSOA[tipoPessoaCliente] ?? "de outro tipo";
    const quem = nomeCliente ? `${nomeCliente} é ${tipoCli}` : `o cliente escolhido é ${tipoCli}`;
    const alvo = def.tipoCliente === "pf" ? "pessoa física" : "pessoa jurídica";

    return {
      ...base,
      motivo: MOTIVO_PENDENCIA.TIPO_INCOMPATIVEL,
      tipoVariavel: def.tipoCliente,
      tipoCliente: tipoPessoaCliente ?? null,
      causa: `Esta variável é de ${tipoVar} e ${quem}.`,
      // A ação é executável e testada: vincular um cliente do tipo certo ao
      // processo e gerar para ele, OU usar um modelo do tipo do cliente.
      orientacao:
        `Esta variável é de ${tipoVar} e ${quem}. ` +
        `Vincule um cliente ${alvo} a este processo e gere para ele, ` +
        `ou use um modelo para ${tipoCli}.`
    };
  }

  // ── Campo simplesmente vazio ───────────────────────────────────────────
  return {
    ...base,
    motivo: MOTIVO_PENDENCIA.CAMPO_VAZIO,
    // 2.7: tela E campo. Sem caminho conhecido (origem `sistema`), mantém a
    // frase antiga em vez de inventar um lugar.
    orientacao: onde
      ? `Preencha em ${onde}`
      : `Preencha "${def.rotulo}" ${ONDE_PREENCHER[def.origem]}`
  };
};

export default CATALOGO_VARIAVEIS;
