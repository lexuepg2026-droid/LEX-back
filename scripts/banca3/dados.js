// scripts/banca3/dados.js
//
// ═══════════════════════════════════════════════════════════════════════════
// O CENÁRIO DA 3ª BANCA (DEC-065) — dados, e só dados
//
// Escritório fictício de Ponta Grossa/PR. Todo CPF e CNPJ é fictício e tem
// dígito verificador válido (conferido por `src/utils/documentos.js`); todo
// número de processo segue o padrão CNJ com o dígito módulo 97 válido
// (conferido em `seedBanca3.js` antes de gravar). Os CEPs são reais de Ponta
// Grossa, conferidos no ViaCEP em 03/10/2026. E-mails de terceiros usam o
// domínio reservado `example.com` (RFC 2606): nenhum e-mail sai para pessoa
// real por causa deste cenário.
//
// Telefone e CEP vão SÓ COM DÍGITOS, como a tela os envia
// (`ClientFormPage.jsx` aplica `unmask` antes do POST).
//
// ── AS DATAS ─────────────────────────────────────────────────────────────
// Toda data é RELATIVA à âncora (padrão 05/10/2026, o dia da banca) e
// calculada quando o seed roda. Duas consequências que o roteiro precisa:
//
//   • nenhuma parcela vence entre o dia em que o seed roda e a âncora. O
//     status "vencido" é GRAVADO no recálculo (`definirStatusInstallment`), não
//     lido na hora: uma parcela que vencesse no domingo continuaria "pendente"
//     na segunda. O seed recusa rodar se isso acontecer (ver `seedBanca3.js`);
//   • os eventos da agenda, ao contrário, são classificados NA LEITURA (hoje,
//     atrasado), e por isso caem certo no dia da banca.
// ═══════════════════════════════════════════════════════════════════════════

export const ANCORA_PADRAO = "2026-10-05";

// ── Credenciais (Regra 1 do pedido) ────────────────────────────────────────
// Fixas e no repositório DE PROPÓSITO, como as do seed antigo: são de
// demonstração, e a pessoa que apresenta precisa copiá-las do README.
export const ADVOGADA_EMAIL = "lexuepg2026@gmail.com";
export const ADVOGADA_SENHA = "LexBanca2026";
export const PORTAL_EMAIL = "lexuepg2026+portal@gmail.com";
export const PORTAL_SENHA = "LexBanca2026";
// Senha que a advogada "entregou" ao cliente. O cliente a troca no primeiro
// acesso (DEC-029 ponto 4), pela própria rota do portal — é isso que deixa a
// senha final como senha PRÓPRIA e libera a confirmação de leitura.
export const PORTAL_SENHA_PROVISORIA = "Provisoria2026";
// O login do portal é CÓDIGO DE ACESSO + senha (DEC-029 ponto 1), e não
// e-mail. Desde a Fase 2.5 (DEC-089) o código é da PESSOA — o código PESSOAL
// da Mariana —, e não mais do vínculo dela com P1. Ele nasce sorteado quando a
// senha é definida; o seed o fixa neste valor para que ele possa ir para o
// README. Alfabeto Crockford, formato `LEX-XXXX-XXXX` — conferido por
// `isCodigoAcessoValido`.
//
// ⚠️ Num banco MIGRADO (o `lex_prod` de antes da 2.5) o código pessoal da
// Mariana é o que a migração sorteou, e não este: o antigo era do vínculo, e
// código de vínculo não vira código pessoal (DEC-090). Lá, o código está na
// tela da advogada — Clientes → Mariana → "Acesso ao portal".
export const PORTAL_CODIGO = "LEX-2026-BANC";

// ── A advogada ─────────────────────────────────────────────────────────────
export const ADVOGADA = {
  nomeCompleto: "Camila Wolff Bittencourt",
  email: ADVOGADA_EMAIL,
  senha: ADVOGADA_SENHA,
  cpf: "79426153837",
  telefone: "42999318406",
  oab: { numero: "87412", estado: "PR" },
  advocacia: {
    nome: "Bittencourt Advocacia",
    chavePix: ADVOGADA_EMAIL
  },
  endereco: {
    cep: "84010010", pais: "Brasil", estado: "PR", cidade: "Ponta Grossa",
    bairro: "Centro", logradouro: "Rua Doutor Colares", numero: "432", complemento: "Sala 804"
  }
};

const PG = (cep, bairro, logradouro, numero, complemento) => ({
  cep, pais: "Brasil", estado: "PR", cidade: "Ponta Grossa", bairro, logradouro, numero,
  ...(complemento ? { complemento } : {})
});

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES — chave → payload da tela
// Os seis PRINCIPAIS (4 PF + 2 PJ) são o cenário pedido. Os oito de APOIO
// existem para a listagem e o autocomplete não parecerem vazios.
// ═══════════════════════════════════════════════════════════════════════════
export const CLIENTES = {
  // ── Principais ─────────────────────────────────────────────────────────
  mariana: {
    tipoPessoa: "fisica", nomeCompleto: "Mariana Kloster Ribeiro", cpf: "41827365080",
    rg: "10.482.736-5", dataNascimento: "1986-04-17", sexo: "feminino", estadoCivil: "casado",
    profissao: "Enfermeira", nacionalidade: "brasileira",
    email: PORTAL_EMAIL, telefone: "42998127345",
    endereco: PG("84010050", "Centro", "Rua Balduíno Taques", "645", "Apto 302"),
    observacoes: "Prefere contato por WhatsApp no fim da tarde. Acompanha o processo pelo portal.",
    senhaPortal: PORTAL_SENHA_PROVISORIA
  },
  rogerio: {
    tipoPessoa: "fisica", nomeCompleto: "Rogério Dziedzic Santos", cpf: "52739184646",
    rg: "8.736.120-4", dataNascimento: "1979-09-02", sexo: "masculino", estadoCivil: "divorciado",
    profissao: "Motorista de caminhão", nacionalidade: "brasileiro",
    email: "rogerio.dziedzic@example.com", telefone: "42999641208",
    endereco: PG("84070000", "Nova Rússia", "Avenida Ernesto Vilela", "1350"),
    observacoes: "Trabalhou 6 anos na reclamada. Guarda os discos de tacógrafo de 2022 a 2024."
  },
  helena: {
    tipoPessoa: "fisica", nomeCompleto: "Helena Wosch Carneiro", cpf: "30615847226",
    rg: "4.215.873-0", dataNascimento: "1968-02-23", sexo: "feminino", estadoCivil: "casado",
    profissao: "Professora", nacionalidade: "brasileira",
    email: "helena.carneiro@example.com", telefone: "42988053417",
    endereco: PG("84015480", "Jardim Carvalho", "Avenida Monteiro Lobato", "980"),
    observacoes: "Inventariante. Irmã de Paulo Roberto Wosch."
  },
  paulo: {
    tipoPessoa: "fisica", nomeCompleto: "Paulo Roberto Wosch", cpf: "73926401516",
    rg: "5.904.318-2", dataNascimento: "1972-11-08", sexo: "masculino", estadoCivil: "viuvo",
    profissao: "Agricultor", nacionalidade: "brasileiro",
    email: "paulo.wosch@example.com", telefone: "42999720584",
    endereco: PG("84025000", "Uvaranas", "Avenida General Carlos Cavalcanti", "1890"),
    observacoes: "Herdeiro no inventário do pai. Mora na chácara de Itaiacoca nos fins de semana."
  },
  madeireira: {
    tipoPessoa: "juridica", razaoSocial: "Madeireira Campos Gerais Ltda",
    nomeFantasia: "Madeireira Campos Gerais", cnpj: "47182036000105",
    representanteLegal: { nome: "Ademir Kosloski", cpf: "28194736528", cargo: "Sócio-administrador" },
    email: "financeiro.madeireiracg@example.com", telefone: "4232241876",
    endereco: PG("84062000", "Chapada", "Avenida Souza Naves", "2780", "Barracão 2"),
    observacoes: "Cobrança de duplicatas de fornecimento de madeira para obra."
  },
  transportadora: {
    tipoPessoa: "juridica", razaoSocial: "Transportadora Princesa dos Campos Ltda",
    nomeFantasia: "Princesa dos Campos Transportes", cnpj: "28461957000154",
    representanteLegal: { nome: "Luciane Mayer Prestes", cpf: "64531829042", cargo: "Diretora administrativa" },
    email: "juridico.princesadoscampos@example.com", telefone: "4232198450",
    endereco: PG("84043000", "Colônia Dona Luíza", "Avenida Visconde de Mauá", "3120"),
    observacoes: "Frota de 40 caminhões. Discute a incidência de ISS sobre frete intermunicipal."
  },

  // ── Apoio ──────────────────────────────────────────────────────────────
  anaPaula: {
    tipoPessoa: "fisica", nomeCompleto: "Ana Paula Gomes Ferreira", cpf: "85312076490",
    rg: "12.094.553-7", dataNascimento: "1994-06-30", sexo: "feminino", estadoCivil: "solteiro",
    profissao: "Analista de recursos humanos", nacionalidade: "brasileira",
    email: "anapaula.ferreira@example.com", telefone: "42991384520",
    endereco: PG("84010340", "Centro", "Rua Engenheiro Schamber", "215", "Apto 41")
  },
  joaquim: {
    tipoPessoa: "fisica", nomeCompleto: "Joaquim Manuel Teixeira Pinto", cpf: "19283746546",
    rg: "V492817-K", dataNascimento: "1961-12-14", sexo: "masculino", estadoCivil: "casado",
    profissao: "Comerciante", nacionalidade: "português",
    email: "joaquim.pinto@example.com", telefone: "42999015736",
    endereco: PG("84010330", "Centro", "Avenida Bonifácio Vilela", "88"),
    observacoes: "Natural de Braga, residente no Brasil desde 1998 (RNM)."
  },
  luana: {
    tipoPessoa: "fisica", nomeCompleto: "Luana Oliveira Kruger", cpf: "37465182964",
    rg: "13.508.264-9", dataNascimento: "1997-01-22", sexo: "feminino", estadoCivil: "separado_judicialmente",
    profissao: "Atendente de farmácia", nacionalidade: "brasileira",
    email: "luana.kruger@example.com", telefone: "42998460217",
    endereco: PG("84035000", "Olarias", "Rua Ermelino de Leão", "510")
  },
  sergio: {
    tipoPessoa: "fisica", nomeCompleto: "Sérgio Antunes Mendes", cpf: "51628394773",
    rg: "3.882.416-1", dataNascimento: "1963-08-05", sexo: "masculino", estadoCivil: "uniao_estavel",
    profissao: "Eletricista", nacionalidade: "brasileiro",
    email: "sergio.mendes@example.com", telefone: "42999271843",
    endereco: PG("84040000", "Estrela", "Rua Balduíno Taques", "1420")
  },
  beatriz: {
    tipoPessoa: "fisica", nomeCompleto: "Beatriz Nowak Almeida", cpf: "90817263586",
    rg: "9.367.104-3", dataNascimento: "1975-03-19", sexo: "feminino", estadoCivil: "viuvo",
    profissao: "Contadora", nacionalidade: "brasileira",
    email: "beatriz.almeida@example.com", telefone: "42988327614",
    endereco: PG("84016210", "Jardim Carvalho", "Avenida Monteiro Lobato", "2215")
  },
  laticinios: {
    tipoPessoa: "juridica", razaoSocial: "Laticínios Tibagi Ltda", nomeFantasia: "Laticínios Tibagi",
    cnpj: "63517284000108",
    representanteLegal: { nome: "Gustavo Schreiner", cpf: "26354091889", cargo: "Sócio-gerente" },
    email: "contato.laticiniostibagi@example.com", telefone: "4232237719",
    endereco: PG("84064000", "Chapada", "Avenida Souza Naves", "4105")
  },
  clinica: {
    tipoPessoa: "juridica", razaoSocial: "Clínica Odontológica Sorriso dos Campos Ltda",
    nomeFantasia: "Sorriso dos Campos", cnpj: "19284735000112",
    representanteLegal: { nome: "Fernanda Lopes Hartmann", cpf: "47182930650", cargo: "Diretora clínica" },
    email: "administrativo.sorrisodoscampos@example.com", telefone: "4232254408",
    endereco: PG("84010000", "Centro", "Avenida Doutor Vicente Machado", "731", "Sala 12")
  },
  diesel: {
    tipoPessoa: "juridica", razaoSocial: "Mecânica Diesel Ronda Ltda", nomeFantasia: "Diesel Ronda",
    cnpj: "80273641000159",
    representanteLegal: { nome: "Valdecir Prestes", cpf: "68520314708", cargo: "Sócio-administrador" },
    email: "oficina.dieselronda@example.com", telefone: "4232265093",
    endereco: PG("84070484", "Boa Vista", "Avenida Ernesto Vilela", "2480")
  }
};

// CPF reservado para o smoke test não colidir com o cenário. O smoke sorteia o
// dele; este fica de fora de propósito.
export const CPF_LIVRE_EXEMPLO = "13095628498";

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSOS — fase e status em EIXOS SEPARADOS (DEC-054)
// ═══════════════════════════════════════════════════════════════════════════
const TJPR = "Tribunal de Justiça do Estado do Paraná";
const TRT9 = "Tribunal Regional do Trabalho da 9ª Região";

export const PROCESSOS = {
  // P1 — o do PORTAL. Encerrado com trânsito em julgado.
  p1: {
    clientes: [{ c: "mariana", papel: "autor", principal: true }],
    titulo: "Indenização por atraso na entrega de apartamento",
    numeroProcesso: "0012847-19.2024.8.16.0019",
    tipoAcao: "Procedimento Comum Cível", area: "DIREITO DO CONSUMIDOR",
    orgao: TJPR, vara: "2ª Vara Cível de Ponta Grossa", comarca: "Ponta Grossa",
    status: "encerrado", fase: "recursos", dataDistribuicao: "2024-03-12",
    transitoEmJulgadoEm: "2026-08-14",
    motivoEncerramento: "Sentença de procedência confirmada pelo TJPR na apelação; nenhuma das partes recorreu.",
    descricao: "Ação contra a incorporadora pelo atraso de 14 meses na entrega do apartamento, com pedido de lucros cessantes e danos morais.",
    observacoes: "Valor da condenação já depositado em juízo. Falta expedir o alvará de levantamento."
  },
  // P2 — em RECURSOS, com prazo amanhã.
  p2: {
    clientes: [{ c: "rogerio", papel: "autor", principal: true }],
    titulo: "Reclamação trabalhista — horas extras e adicional noturno",
    numeroProcesso: "0003391-40.2025.5.09.0024",
    tipoAcao: "Ação Trabalhista - Rito Ordinário", area: "DIREITO DO TRABALHO",
    orgao: TRT9, vara: "1ª Vara do Trabalho de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "recursos", dataDistribuicao: "2025-02-18",
    descricao: "Reclamação contra a antiga empregadora (Rodoviário Tibagi Ltda) por horas extras, adicional noturno e reflexos.",
    observacoes: "Sentença parcialmente procedente. A reclamada interpôs recurso ordinário."
  },
  // P3 — LITISCONSÓRCIO, em CONHECIMENTO, com o REPARCELAMENTO.
  // Fase 2.5: a Mariana é a terceira herdeira e está no processo, mas a
  // advogada AINDA NÃO o liberou no portal (`liberado: false` é o padrão de
  // todo vínculo novo, DEC-091). É o caso que a demonstração precisa: ela
  // entra, vê só P1 e vai direto para ele; a advogada libera P3 na tela e a
  // lista dela passa a ter dois processos.
  p3: {
    clientes: [
      { c: "helena", papel: "autor", principal: true },
      { c: "paulo", papel: "litisconsorte", principal: false },
      { c: "mariana", papel: "litisconsorte", principal: false }
    ],
    titulo: "Inventário de Ernesto Wosch",
    numeroProcesso: "0006174-73.2025.8.16.0019",
    tipoAcao: "Inventário", area: "DIREITO CIVIL",
    orgao: TJPR, vara: "1ª Vara de Família e Sucessões de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "conhecimento", dataDistribuicao: "2025-05-06",
    descricao: "Inventário judicial com dois herdeiros: imóvel urbano no Jardim Carvalho e chácara em Itaiacoca.",
    observacoes: "Monte-mor estimado em R$ 250.000,00. Aguardando avaliação do imóvel rural."
  },
  // P4 — em EXECUÇÃO, SUSPENSO por acordo. Honorário sem pagamento ainda.
  p4: {
    clientes: [{ c: "madeireira", papel: "autor", principal: true }],
    titulo: "Execução de duplicatas — Construtora Vale Verde",
    numeroProcesso: "0015208-09.2024.8.16.0019",
    tipoAcao: "Execução de Título Extrajudicial", area: "DIREITO CIVIL",
    orgao: TJPR, vara: "3ª Vara Cível de Ponta Grossa", comarca: "Ponta Grossa",
    status: "suspenso", fase: "execucao", dataDistribuicao: "2024-07-22",
    descricao: "Execução de seis duplicatas de fornecimento de madeira não pagas pela construtora.",
    observacoes: "Suspensa por acordo de parcelamento do débito (art. 922 do CPC) até dezembro de 2026."
  },
  // P5 — em SENTENÇA, com LIMINAR. Honorário à vista quitado.
  p5: {
    clientes: [{ c: "transportadora", papel: "autor", principal: true }],
    titulo: "Mandado de segurança — ISS sobre frete intermunicipal",
    numeroProcesso: "0009863-28.2025.8.16.0019",
    tipoAcao: "Mandado de Segurança Cível", area: "DIREITO TRIBUTÁRIO",
    orgao: TJPR, vara: "Vara da Fazenda Pública de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "sentenca", dataDistribuicao: "2025-06-02",
    liminar: true, liminarEm: "2025-06-12",
    liminarObservacao: "Liminar deferida para suspender a exigibilidade do ISS sobre o frete intermunicipal até o julgamento.",
    descricao: "Impetração contra ato do Secretário Municipal da Fazenda que exige ISS sobre transporte intermunicipal de cargas.",
    observacoes: "Sentença concessiva publicada. Aguardando o reexame necessário."
  },
  // P6 — DESATIVADO, e reativável (o cliente continua ativo).
  p6: {
    clientes: [{ c: "paulo", papel: "autor", principal: true }],
    titulo: "Usucapião extraordinária — chácara em Itaiacoca",
    numeroProcesso: "0021450-47.2025.8.16.0019",
    tipoAcao: "Usucapião", area: "DIREITO CIVIL",
    orgao: TJPR, vara: "4ª Vara Cível de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "conhecimento", dataDistribuicao: "2025-10-20",
    descricao: "Usucapião da faixa de 2.400 m² contígua à chácara da família, com posse mansa há mais de 15 anos.",
    observacoes: "Cadastro desativado enquanto o cliente decide se aguarda o fim do inventário.",
    desativar: true
  },

  // ── Apoio ──────────────────────────────────────────────────────────────
  a1: {
    clientes: [{ c: "anaPaula", papel: "autor", principal: true }],
    titulo: "Cobrança indevida de tarifa bancária",
    numeroProcesso: "0002716-14.2026.8.16.0019",
    tipoAcao: "Procedimento do Juizado Especial Cível", area: "DIREITO DO CONSUMIDOR",
    orgao: TJPR, vara: "Juizado Especial Cível de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "conhecimento", dataDistribuicao: "2026-02-09",
    descricao: "Restituição em dobro de tarifas de pacote de serviços não contratado."
  },
  a2: {
    clientes: [{ c: "joaquim", papel: "autor", principal: true }],
    titulo: "Divórcio litigioso com partilha de bens",
    numeroProcesso: "0018932-84.2025.8.16.0019",
    tipoAcao: "Divórcio Litigioso", area: "DIREITO CIVIL",
    orgao: TJPR, vara: "2ª Vara de Família e Sucessões de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "sentenca", dataDistribuicao: "2025-09-15",
    descricao: "Divórcio com partilha do imóvel comercial e de quotas da empresa do casal."
  },
  a3: {
    clientes: [{ c: "luana", papel: "autor", principal: true }],
    titulo: "Cumprimento de sentença — alimentos em atraso",
    numeroProcesso: "0007745-45.2026.8.16.0019",
    tipoAcao: "Alimentos - Lei Especial Nº 5.478/68", area: "DIREITO CIVIL",
    orgao: TJPR, vara: "2ª Vara de Família e Sucessões de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "execucao", dataDistribuicao: "2026-04-14",
    descricao: "Execução de pensão alimentícia de dois filhos menores, com três meses em atraso."
  },
  a4: {
    clientes: [{ c: "sergio", papel: "autor", principal: true }],
    titulo: "Aposentadoria por tempo de contribuição — revisão de períodos especiais",
    numeroProcesso: "5004218-82.2025.4.04.7009",
    tipoAcao: "Procedimento Comum Cível", area: "DIREITO PREVIDENCIÁRIO",
    orgao: "Justiça Federal — Seção Judiciária do Paraná", vara: "1ª Vara Federal de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "conhecimento", dataDistribuicao: "2025-08-25",
    descricao: "Reconhecimento de tempo especial como eletricista exposto a alta tensão (1989–2004)."
  },
  a5: {
    clientes: [{ c: "beatriz", papel: "autor", principal: true }],
    titulo: "Despejo por falta de pagamento — sala comercial",
    numeroProcesso: "0011290-94.2024.8.16.0019",
    tipoAcao: "Despejo por Falta de Pagamento", area: "DIREITO CIVIL",
    orgao: TJPR, vara: "1ª Vara Cível de Ponta Grossa", comarca: "Ponta Grossa",
    status: "encerrado", fase: "sentenca", dataDistribuicao: "2024-05-27",
    motivoEncerramento: "Acordo homologado e cumprido: imóvel desocupado e aluguéis quitados.",
    descricao: "Despejo de inquilino de sala comercial com cinco aluguéis em atraso."
  },
  a6: {
    clientes: [{ c: "laticinios", papel: "autor", principal: true }],
    titulo: "Ação monitória — cheques devolvidos de distribuidor",
    numeroProcesso: "0016622-08.2025.8.16.0019",
    tipoAcao: "Monitória", area: "DIREITO CIVIL",
    orgao: TJPR, vara: "1ª Vara Cível de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "conhecimento", dataDistribuicao: "2025-11-03",
    descricao: "Cobrança de quatro cheques prescritos emitidos por distribuidor de laticínios."
  },
  a7: {
    clientes: [{ c: "clinica", papel: "autor", principal: true }],
    titulo: "Revisão de aluguel de imóvel comercial",
    numeroProcesso: "0001963-57.2026.8.16.0019",
    tipoAcao: "Procedimento Comum Cível", area: "DIREITO CIVIL",
    orgao: TJPR, vara: "2ª Vara Cível de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "recursos", dataDistribuicao: "2026-01-19",
    descricao: "Revisional do aluguel da sede da clínica, reajustado acima do índice contratual."
  },
  a8: {
    clientes: [{ c: "diesel", papel: "reu", principal: true }],
    titulo: "Execução fiscal — defesa em exceção de pré-executividade",
    numeroProcesso: "0004120-37.2025.8.16.0019",
    tipoAcao: "Execução Fiscal", area: "DIREITO TRIBUTÁRIO",
    orgao: TJPR, vara: "Vara da Fazenda Pública de Ponta Grossa", comarca: "Ponta Grossa",
    status: "ativo", fase: "execucao", dataDistribuicao: "2025-03-10",
    descricao: "Defesa da empresa executada por IPTU de 2019 a 2021 já prescrito."
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// HONORÁRIOS — sem "pagamento no êxito" (pedido explícito)
//
// `parcelas[].venc` e `pagamentos[].data` são descritores de data relativos à
// âncora: { m: <meses a partir do mês da âncora>, d: <dia do mês> }.
// `contratoAntes` gera o contrato LOGO DEPOIS das parcelas — antes de pagamento
// e de reparcelamento —, que é o momento em que um contrato é assinado. O
// documento gerado é congelado (decisão 11 do módulo de documentos).
// ═══════════════════════════════════════════════════════════════════════════
export const HONORARIOS = {
  // F1 — o PARCELADO: 3 pagas, 1 vencida, 2 futuras. É o do portal.
  f1: {
    processo: "p1", criadoEm: { m: -5, d: 20 },
    fee: { descricao: "Honorários contratuais — ação indenizatória", tipo: "fixo", valor: 6000 },
    parcelas: [1000, 1000, 1000, 1000, 1000, 1000].map((valor, i) => ({ valor, venc: { m: -4 + i, d: 10 } })),
    contrato: "contratoPf",
    pagamentos: [
      { valor: 1000, data: { m: -4, d: 8 }, formaPagamento: "pix", observacoes: "Parcela de junho" },
      { valor: 1000, data: { m: -3, d: 9 }, formaPagamento: "pix", observacoes: "Parcela de julho" },
      { valor: 1000, data: { m: -2, d: 7 }, formaPagamento: "transferencia", observacoes: "Parcela de agosto" }
    ]
  },
  // F2 — o REPARCELADO: percentual sobre o monte-mor, 3 parcelas → 4.
  f2: {
    processo: "p3", criadoEm: { m: -5, d: 28 },
    fee: { descricao: "Honorários do inventário — 6% sobre o monte-mor", tipo: "percentual", percentual: 6, valorBase: 250000 },
    parcelas: [5000, 5000, 5000].map((valor, i) => ({ valor, venc: { m: -4 + i, d: 15 } })),
    contrato: "contratoPercentual",
    pagamentos: [
      { valor: 5000, data: { m: -4, d: 14 }, formaPagamento: "transferencia", observacoes: "Primeira parcela" },
      { valor: 2000, data: { m: -3, d: 20 }, formaPagamento: "pix", observacoes: "Pagamento parcial da segunda parcela" }
    ],
    reparcelamento: {
      data: { m: -2, d: 5 },
      motivo: "Herdeiros aguardam o alvará de venda do imóvel rural; saldo renegociado em quatro parcelas.",
      parcelas: [2000, 2000, 2000, 2000].map((valor, i) => ({ valor, venc: { m: -1 + i, d: 7 } }))
    },
    pagamentosDepois: [
      { valor: 2000, data: { m: -1, d: 5 }, formaPagamento: "pix", observacoes: "Parcela 1 do novo plano" }
    ]
  },
  // F3 — o À VISTA, quitado neste mês.
  f3: {
    processo: "p5", criadoEm: { m: -4, d: 2 },
    fee: { descricao: "Honorários — mandado de segurança (à vista)", tipo: "fixo", valor: 7500 },
    parcelas: [{ valor: 7500, venc: { m: 0, d: 1 } }],
    contrato: "contratoPj",
    pagamentos: [
      { valor: 7500, data: { m: 0, d: 1 }, formaPagamento: "transferencia", observacoes: "Pagamento à vista" }
    ]
  },
  // F4 — nada pago ainda: é o que faz "Honorários a Receber" não ser zero.
  f4: {
    processo: "p4", criadoEm: { m: -1, d: 22 },
    fee: { descricao: "Honorários — execução de duplicatas", tipo: "fixo", valor: 4500 },
    parcelas: [1500, 1500, 1500].map((valor, i) => ({ valor, venc: { m: i, d: 15 } })),
    contrato: "contratoPj"
  },
  // F5 — parcelado em dia, mais custas (o terceiro tipo do enum).
  f5: {
    processo: "p2", criadoEm: { m: -2, d: 3 },
    fee: { descricao: "Honorários — reclamação trabalhista", tipo: "fixo", valor: 3600 },
    parcelas: [1200, 1200, 1200].map((valor, i) => ({ valor, venc: { m: -2 + i, d: 20 } })),
    contrato: "contratoPf",
    pagamentos: [
      { valor: 1200, data: { m: -2, d: 19 }, formaPagamento: "pix", observacoes: "" },
      { valor: 1200, data: { m: -1, d: 18 }, formaPagamento: "dinheiro", observacoes: "Pago no escritório" }
    ]
  },
  f6: {
    processo: "p2", criadoEm: { m: -1, d: 10 },
    fee: { descricao: "Custas — preparo do recurso adesivo", tipo: "custas", valor: 680 },
    parcelas: [{ valor: 680, venc: { m: -1, d: 25 } }],
    pagamentos: [
      { valor: 680, data: { m: -1, d: 24 }, formaPagamento: "boleto", observacoes: "Guia de custas" }
    ]
  },

  // ── Apoio ──────────────────────────────────────────────────────────────
  fa1: { processo: "a1", criadoEm: { m: -7, d: 12 },
    fee: { descricao: "Honorários — juizado especial", tipo: "fixo", valor: 1500 },
    parcelas: [{ valor: 1500, venc: { m: 0, d: 20 } }], contrato: "contratoPf" },
  fa2: { processo: "a2", criadoEm: { m: -3, d: 1 },
    fee: { descricao: "Honorários — divórcio e partilha", tipo: "fixo", valor: 5000 },
    parcelas: [{ valor: 2500, venc: { m: -2, d: 15 } }, { valor: 2500, venc: { m: 1, d: 15 } }],
    pagamentos: [{ valor: 2500, data: { m: -2, d: 14 }, formaPagamento: "cartao_credito", observacoes: "" }] },
  fa4: { processo: "a4", criadoEm: { m: -4, d: 5 },
    fee: { descricao: "Honorários — ação previdenciária", tipo: "fixo", valor: 2400 },
    parcelas: [600, 600, 600, 600].map((valor, i) => ({ valor, venc: { m: -3 + i, d: 10 } })),
    pagamentos: [
      { valor: 600, data: { m: -3, d: 10 }, formaPagamento: "pix", observacoes: "" },
      { valor: 600, data: { m: -2, d: 10 }, formaPagamento: "pix", observacoes: "" },
      { valor: 600, data: { m: -1, d: 9 }, formaPagamento: "pix", observacoes: "" }
    ] },
  fa5: { processo: "a5", criadoEm: { m: -6, d: 2 },
    fee: { descricao: "Honorários — ação de despejo", tipo: "fixo", valor: 2000 },
    parcelas: [{ valor: 2000, venc: { m: -5, d: 30 } }],
    pagamentos: [{ valor: 2000, data: { m: -5, d: 28 }, formaPagamento: "transferencia", observacoes: "" }] },
  fa6: { processo: "a6", criadoEm: { m: -1, d: 6 },
    fee: { descricao: "Honorários — ação monitória", tipo: "fixo", valor: 3200 },
    parcelas: [{ valor: 1600, venc: { m: -1, d: 30 } }, { valor: 1600, venc: { m: 0, d: 30 } }],
    pagamentos: [{ valor: 1600, data: { m: -1, d: 29 }, formaPagamento: "boleto", observacoes: "" }] },
  fa7: { processo: "a7", criadoEm: { m: 0, d: 2 },
    fee: { descricao: "Honorários — revisional de aluguel", tipo: "fixo", valor: 4000 },
    parcelas: [{ valor: 4000, venc: { m: 0, d: 26 } }] },
  fa8: { processo: "a8", criadoEm: { m: -2, d: 25 },
    fee: { descricao: "Honorários — defesa em execução fiscal", tipo: "fixo", valor: 2800 },
    parcelas: [{ valor: 1400, venc: { m: -1, d: 5 } }, { valor: 1400, venc: { m: 1, d: 5 } }],
    pagamentos: [{ valor: 1400, data: { m: -1, d: 5 }, formaPagamento: "pix", observacoes: "" }] }
};

// ═══════════════════════════════════════════════════════════════════════════
// AGENDA — `dia` em dias a partir da âncora (0 = o dia da banca)
// ═══════════════════════════════════════════════════════════════════════════
export const EVENTOS = [
  { dia: -14, tipo: "audiencia", processo: "a2", hora: "14:00", concluido: true,
    titulo: "Audiência de conciliação (sem acordo)", local: "2ª Vara de Família e Sucessões de Ponta Grossa" },
  { dia: -6, tipo: "reuniao", processo: "p1", hora: "17:30", concluido: true,
    titulo: "Reunião com Mariana — explicar o acórdão e o trânsito em julgado", local: "Escritório" },
  // O ÚNICO atrasado: entra no sino.
  { dia: -3, tipo: "prazo", processo: "p3",
    titulo: "Prazo — apresentar as primeiras declarações do inventário",
    descricao: "Prazo de 20 dias contado da intimação. Falta a certidão de ônus do imóvel rural." },
  // HOJE (dia da banca).
  { dia: 0, tipo: "reuniao", processo: "p1", hora: "09:00",
    titulo: "Reunião com Mariana — alvará de levantamento", local: "Escritório",
    descricao: "Levar a minuta da petição de levantamento para conferência." },
  { dia: 0, tipo: "audiencia", processo: "a1", hora: "14:30",
    titulo: "Audiência de conciliação — Juizado Especial Cível", local: "Fórum de Ponta Grossa — Juizado Especial Cível",
    descricao: "Cliente confirmou presença. Levar extratos de 2024 e 2025." },
  // AMANHÃ.
  { dia: 1, tipo: "prazo", processo: "p2",
    titulo: "Prazo — contrarrazões ao recurso ordinário da reclamada" },
  // RESTO DA SEMANA.
  { dia: 2, tipo: "reuniao", processo: null, hora: "10:30",
    titulo: "Consulta — aposentadoria rural (indicação do Sr. Paulo Wosch)", local: "Escritório",
    descricao: "Evento sem processo: primeira conversa com um possível cliente." },
  { dia: 3, tipo: "audiencia", processo: "a2", hora: "15:00",
    titulo: "Audiência de instrução — divórcio", local: "2ª Vara de Família e Sucessões de Ponta Grossa" },
  { dia: 4, tipo: "outro", processo: "p5",
    titulo: "Despachar memoriais com o juiz da Fazenda Pública" },
  // FUTUROS.
  { dia: 10, tipo: "outro", processo: "p3", hora: "09:30",
    titulo: "Perícia de avaliação da chácara de Itaiacoca", local: "Distrito de Itaiacoca" },
  { dia: 17, tipo: "audiencia", processo: "a6", hora: "13:30",
    titulo: "Audiência de conciliação — ação monitória", local: "1ª Vara Cível de Ponta Grossa" },
  { dia: 24, tipo: "prazo", processo: "a4",
    titulo: "Prazo — réplica à contestação do INSS" }
];

// ═══════════════════════════════════════════════════════════════════════════
// SEÇÕES e MODELOS — só variáveis do catálogo fechado (48 chaves)
// ═══════════════════════════════════════════════════════════════════════════
export const SECOES = {
  qualificacaoPf: { tipo: "qualificacao", titulo: "Outorgante — pessoa física",
    texto: "OUTORGANTE: {{nomeCliente}}, {{nacionalidadeCliente}}, {{estadoCivilCliente}}, {{profissaoCliente}}, portador(a) do RG nº {{rgCliente}}, inscrito(a) no CPF sob o nº {{cpfCliente}}, nascido(a) em {{dataNascimentoCliente}}, residente e domiciliado(a) em {{enderecoCliente}}, e-mail {{emailCliente}}, telefone {{telefoneCliente}}." },
  qualificacaoPj: { tipo: "qualificacao", titulo: "Outorgante — pessoa jurídica",
    texto: "OUTORGANTE: {{razaoSocialCliente}}, nome fantasia {{nomeFantasiaCliente}}, pessoa jurídica de direito privado inscrita no CNPJ sob o nº {{cnpjCliente}}, com sede em {{enderecoCliente}}, neste ato representada por {{representanteLegalNome}}, {{representanteLegalCargo}}, inscrito(a) no CPF sob o nº {{representanteLegalCpf}}." },
  outorgada: { tipo: "qualificacao", titulo: "Outorgada — a advogada",
    texto: "OUTORGADA: {{nomeAdvogada}}, advogada inscrita na OAB/{{estadoOAB}} sob o nº {{numOAB}} e no CPF sob o nº {{cpfAdvogada}}, integrante de {{nomeAdvocacia}}, com escritório profissional em {{enderecoEscritorio}}, telefone {{telefoneEscritorio}}, e-mail {{emailEscritorio}}." },
  poderes: { tipo: "objeto", titulo: "Poderes da cláusula ad judicia et extra",
    texto: "PODERES: por este instrumento particular de procuração, o(a) OUTORGANTE nomeia e constitui sua bastante procuradora a OUTORGADA, a quem confere os poderes da cláusula ad judicia et extra, para o foro em geral, e especialmente para representá-lo(a) nos autos nº {{numeroProcesso}} — {{tituloProcesso}}, em trâmite perante a {{varaProcesso}} da comarca de {{comarcaProcesso}}, podendo propor ações, contestar, recorrer, transigir, desistir, receber e dar quitação, firmar compromissos e substabelecer, com ou sem reserva de poderes." },
  localData: { tipo: "encerramento", titulo: "Local e data",
    texto: "{{cidadeEscritorio}}, {{dataAtualExtenso}}." },
  assinaturaPf: { tipo: "assinatura", titulo: "Assinatura — pessoa física",
    texto: "_______________________________________\n{{nomeCliente}}\nCPF {{cpfCliente}}" },
  assinaturaPj: { tipo: "assinatura", titulo: "Assinatura — pessoa jurídica",
    texto: "_______________________________________\n{{razaoSocialCliente}}\nCNPJ {{cnpjCliente}}\np.p. {{representanteLegalNome}} — {{representanteLegalCargo}}" },
  contratantePf: { tipo: "qualificacao", titulo: "Contratante — pessoa física",
    texto: "CONTRATANTE: {{nomeCliente}}, {{nacionalidadeCliente}}, {{estadoCivilCliente}}, {{profissaoCliente}}, inscrito(a) no CPF sob o nº {{cpfCliente}}, residente e domiciliado(a) em {{enderecoCliente}}." },
  contratantePj: { tipo: "qualificacao", titulo: "Contratante — pessoa jurídica",
    texto: "CONTRATANTE: {{razaoSocialCliente}} ({{nomeFantasiaCliente}}), inscrita no CNPJ sob o nº {{cnpjCliente}}, com sede em {{enderecoCliente}}, representada por {{representanteLegalNome}}, {{representanteLegalCargo}}, CPF {{representanteLegalCpf}}." },
  contratada: { tipo: "qualificacao", titulo: "Contratada — a advogada",
    texto: "CONTRATADA: {{nomeAdvogada}}, advogada inscrita na OAB/{{estadoOAB}} sob o nº {{numOAB}}, CPF {{cpfAdvogada}}, integrante de {{nomeAdvocacia}}, com escritório em {{enderecoEscritorio}}." },
  objeto: { tipo: "objeto", titulo: "Cláusula 1ª — objeto do contrato",
    texto: "CLÁUSULA 1ª — DO OBJETO: a CONTRATADA prestará ao(à) CONTRATANTE serviços advocatícios nos autos nº {{numeroProcesso}} — {{tituloProcesso}} ({{tipoAcao}}), perante a {{varaProcesso}} da comarca de {{comarcaProcesso}}, acompanhando o feito em todas as instâncias até o seu encerramento." },
  honorariosFixos: { tipo: "clausula", titulo: "Cláusula 2ª — honorários fixos",
    texto: "CLÁUSULA 2ª — DOS HONORÁRIOS: pelos serviços contratados, o(a) CONTRATANTE pagará à CONTRATADA honorários do tipo {{tipoHonorario}}, no valor total de {{valorHonorario}} ({{valorHonorarioExtenso}}), em {{numeroParcelas}} parcela(s) de {{valorParcela}}, com vencimento final em {{dataVencimentoHonorario}}, por transferência bancária ou PIX para a chave {{chavePix}}, de titularidade de {{nomeAdvocacia}}." },
  honorariosPercentual: { tipo: "clausula", titulo: "Cláusula 2ª — honorários sobre o monte-mor",
    texto: "CLÁUSULA 2ª — DOS HONORÁRIOS: o(a) CONTRATANTE pagará à CONTRATADA honorários de {{percentualHonorario}} sobre o valor do monte-mor inventariado, o que perfaz {{valorHonorario}} ({{valorHonorarioExtenso}}), em {{numeroParcelas}} parcela(s) de {{valorParcela}}, com vencimento final em {{dataVencimentoHonorario}}, por PIX para a chave {{chavePix}}." },
  obrigacoes: { tipo: "clausula", titulo: "Cláusula 3ª — obrigações das partes",
    texto: "CLÁUSULA 3ª — DAS OBRIGAÇÕES: a CONTRATADA obriga-se a conduzir a causa com zelo e a manter o(a) CONTRATANTE informado(a) do andamento processual, inclusive pelo portal do cliente, podendo ser contatada pelo telefone {{telefoneEscritorio}} ou pelo e-mail {{emailEscritorio}}. O(A) CONTRATANTE obriga-se a fornecer documentos e informações verídicas." },
  foro: { tipo: "clausula", titulo: "Cláusula 4ª — foro",
    texto: "CLÁUSULA 4ª — DO FORO: fica eleito o foro da comarca de {{cidadeEscritorio}} para dirimir as questões oriundas deste contrato. E, por estarem justas e contratadas, as partes firmam o presente instrumento." },
  enderecamento: { tipo: "outro", titulo: "Endereçamento ao juízo",
    texto: "EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DA {{varaProcesso}} DA COMARCA DE {{comarcaProcesso}} — PR\n\nAutos nº {{numeroProcesso}}" },
  pedidoLevantamento: { tipo: "pedido", titulo: "Pedido de juntada e de alvará",
    texto: "{{nomeCliente}}, já qualificada nos autos em epígrafe, por sua advogada que esta subscreve, vem, respeitosamente, requerer a juntada do comprovante de [...] e a expedição de alvará para o levantamento dos valores depositados em juízo pela executada." },
  fechoPeticao: { tipo: "encerramento", titulo: "Fecho de petição",
    texto: "Nestes termos, pede deferimento.\n\n{{cidadeEscritorio}}, {{dataAtualExtenso}}.\n\n{{nomeAdvogada}}\nOAB/{{estadoOAB}} nº {{numOAB}}" },
  hipossuficiencia: { tipo: "fundamentacao", titulo: "Declaração de hipossuficiência",
    texto: "DECLARAÇÃO DE HIPOSSUFICIÊNCIA\n\n{{nomeCliente}}, {{nacionalidadeCliente}}, {{estadoCivilCliente}}, {{profissaoCliente}}, inscrito(a) no CPF sob o nº {{cpfCliente}}, residente em {{enderecoCliente}}, DECLARA, para os fins do art. 99 do Código de Processo Civil, que não tem condições de arcar com as custas processuais sem prejuízo do próprio sustento e do de sua família, requerendo a gratuidade da justiça nos autos nº {{numeroProcesso}}." }
};

export const MODELOS = {
  procuracaoPf: { nome: "Procuração ad judicia — pessoa física", tipo: "procuracao",
    descricao: "Procuração com poderes gerais e especiais para o processo.",
    secoes: ["qualificacaoPf", "outorgada", "poderes", "localData", "assinaturaPf"] },
  procuracaoPj: { nome: "Procuração ad judicia — pessoa jurídica", tipo: "procuracao",
    descricao: "Procuração outorgada pela empresa, por seu representante legal.",
    secoes: ["qualificacaoPj", "outorgada", "poderes", "localData", "assinaturaPj"] },
  contratoPf: { nome: "Contrato de honorários — pessoa física", tipo: "contrato_prestacao_servicos",
    descricao: "Contrato de prestação de serviços advocatícios com honorários fixos.",
    secoes: ["contratantePf", "contratada", "objeto", "honorariosFixos", "obrigacoes", "foro", "localData", "assinaturaPf"] },
  contratoPj: { nome: "Contrato de honorários — pessoa jurídica", tipo: "contrato_prestacao_servicos",
    descricao: "Contrato de prestação de serviços advocatícios para empresa.",
    secoes: ["contratantePj", "contratada", "objeto", "honorariosFixos", "obrigacoes", "foro", "localData", "assinaturaPj"] },
  contratoPercentual: { nome: "Contrato de honorários — percentual sobre o monte-mor", tipo: "contrato_prestacao_servicos",
    descricao: "Contrato para inventário, com honorários percentuais sobre o monte-mor.",
    secoes: ["contratantePf", "contratada", "objeto", "honorariosPercentual", "obrigacoes", "foro", "localData", "assinaturaPf"] },
  peticaoLevantamento: { nome: "Petição — juntada e alvará de levantamento", tipo: "peticao",
    descricao: "Petição simples de juntada de comprovante e pedido de alvará.",
    secoes: ["enderecamento", "pedidoLevantamento", "fechoPeticao"] },
  hipossuficiencia: { nome: "Declaração de hipossuficiência", tipo: "declaracao_hipossuficiencia",
    descricao: "Declaração para pedido de gratuidade da justiça (art. 99 do CPC).",
    secoes: ["hipossuficiencia", "localData", "assinaturaPf"] }
};

// Documentos gerados FORA do fluxo de honorário (os contratos saem em
// `HONORARIOS[*].contrato`). `visivel` liga a visibilidade no portal.
export const DOCUMENTOS = [
  { modelo: "procuracaoPf", processo: "p1", cliente: "mariana", visivel: true },
  { modelo: "peticaoLevantamento", processo: "p1", cliente: "mariana", visivel: false },
  { modelo: "procuracaoPf", processo: "p2", cliente: "rogerio" },
  { modelo: "procuracaoPf", processo: "p3", cliente: "helena" },
  { modelo: "procuracaoPf", processo: "p3", cliente: "paulo" },
  { modelo: "procuracaoPj", processo: "p4", cliente: "madeireira" },
  { modelo: "procuracaoPj", processo: "p5", cliente: "transportadora" },
  { modelo: "procuracaoPf", processo: "a1", cliente: "anaPaula" },
  { modelo: "hipossuficiencia", processo: "a3", cliente: "luana" },
  { modelo: "procuracaoPj", processo: "a6", cliente: "laticinios" }
];

// O contrato de honorários de F1 é o segundo documento visível no portal.
export const CONTRATOS_VISIVEIS = ["f1"];
