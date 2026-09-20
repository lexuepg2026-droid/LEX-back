// ═══════════════════════════════════════════════════════════════════════════
// DADOS BRASILEIROS FICTÍCIOS — nomes, endereços de Ponta Grossa e região,
// contrapartes e o catálogo de tipos de ação do escritório
//
// ── Sobre os nomes ────────────────────────────────────────────────────────
// Combinações sorteadas de prenomes e sobrenomes comuns no Paraná (portugueses,
// e também de origem polonesa, ucraniana, alemã e italiana, que são muitos na
// região). NENHUM nome aqui foi tirado de uma pessoa: o par é sorteado, e uma
// coincidência com alguém real é acaso, não escolha. Ficam fora os nomes que já
// aparecem no projeto (a advogada, o orientador, os colegas): uma linha do seed
// com o nome de quem revisa a tela confundiria dado de teste com pessoa.
//
// ── Sobre os CEPs ─────────────────────────────────────────────────────────
// O prefixo do CEP é coerente com a cidade (Ponta Grossa começa em 840; as
// cidades da região têm o seu, o CEP geral do município). O par bairro↔sufixo
// é PLAUSÍVEL, não conferido nos Correios: o que a tela precisa é cidade,
// bairro e CEP que não se contradigam, e é isso que se garante.
// ═══════════════════════════════════════════════════════════════════════════

// Prenomes que NÃO podem aparecer, comparados sem acento e sem caixa. É a
// lista do que o prompt da fase proíbe, e o teste a confere contra as listas.
export const PRENOMES_PROIBIDOS = Object.freeze(["lais", "daniel", "davi", "raniele", "rani"]);

export const PRENOMES_FEMININOS = Object.freeze([
  "Maria", "Ana", "Juliana", "Fernanda", "Patrícia", "Aline", "Camila", "Luciana", "Sandra",
  "Vanessa", "Bruna", "Tatiane", "Renata", "Cristina", "Adriana", "Priscila", "Simone", "Débora",
  "Márcia", "Elaine", "Carla", "Letícia", "Mariana", "Gabriela", "Larissa", "Jéssica", "Roberta",
  "Silvia", "Andréia", "Viviane", "Eliane", "Rosângela", "Daiane", "Michele", "Natália", "Paula",
  "Helena", "Beatriz", "Isabela", "Rafaela", "Amanda", "Kelly", "Ivone", "Terezinha", "Neusa",
  "Sônia", "Marlene", "Lúcia", "Solange", "Eunice", "Rita", "Denise", "Cláudia", "Valéria",
  "Thaís", "Michelle", "Lídia", "Alessandra", "Josiane", "Carolina"
]);

export const PRENOMES_MASCULINOS = Object.freeze([
  "João", "José", "Carlos", "Paulo", "Marcos", "Luiz", "Fernando", "Rafael", "Rodrigo", "Marcelo",
  "Anderson", "Fábio", "Gustavo", "Leandro", "Ricardo", "Eduardo", "Alexandre", "Sérgio", "André",
  "Bruno", "Diego", "Felipe", "Guilherme", "Henrique", "Igor", "Jair", "Jorge", "Leonardo",
  "Márcio", "Nelson", "Odair", "Pedro", "Renato", "Roberto", "Sidnei", "Tiago", "Valdir",
  "Wilson", "Adriano", "Cláudio", "Evandro", "Gilberto", "Ivan", "Jonas", "Lucas", "Mateus",
  "Nilton", "Osvaldo", "Reinaldo", "Vagner", "Antônio", "Francisco", "Edson", "Élcio", "Volnei",
  "Milton", "Ademir", "Vinícius", "Cristiano"
]);

export const SOBRENOMES = Object.freeze([
  "Silva", "Souza", "Oliveira", "Santos", "Pereira", "Costa", "Rodrigues", "Almeida", "Nascimento",
  "Lima", "Araújo", "Fernandes", "Carvalho", "Gomes", "Martins", "Rocha", "Ribeiro", "Alves",
  "Monteiro", "Mendes", "Barros", "Freitas", "Barbosa", "Pinto", "Moreira", "Cavalcante", "Dias",
  "Castro", "Campos", "Cardoso", "Teixeira", "Correia", "Machado", "Batista", "Nunes", "Ramos",
  "Kowalski", "Nowak", "Kaminski", "Zielinski", "Mazur", "Wisniewski", "Lewandowski", "Szymanski",
  "Wojcik", "Kozlowski", "Sobczak", "Kravchuk", "Melnyk", "Bondarenko", "Shevchuk", "Tkachuk",
  "Schmidt", "Müller", "Weber", "Becker", "Hoffmann", "Schneider", "Wagner", "Fischer", "Klein",
  "Bortolini", "Zanardi", "Ferrari", "Rossi", "Bianchi", "Marchetti", "Colombo", "Ferreira",
  "Vieira", "Lopes", "Pacheco", "Andrade", "Farias", "Miranda", "Moraes", "Toledo", "Camargo",
  "Padilha", "Pontes", "Guimarães", "Siqueira", "Prado", "Viana", "Bueno", "Franco", "Hass"
]);

// ── Pessoa jurídica ────────────────────────────────────────────────────────
export const RAMOS_PJ = Object.freeze([
  ["Padaria", "Panificadora"], ["Mercado", "Comércio de Alimentos"], ["Auto Peças", "Comércio de Autopeças"],
  ["Clínica", "Serviços Médicos"], ["Transportes", "Transportadora"], ["Construtora", "Construções"],
  ["Farmácia", "Comércio de Medicamentos"], ["Móveis", "Indústria e Comércio de Móveis"],
  ["Agropecuária", "Comércio Agropecuário"], ["Contabilidade", "Serviços Contábeis"],
  ["Restaurante", "Alimentação"], ["Papelaria", "Comércio de Papelaria"], ["Madeireira", "Comércio de Madeiras"],
  ["Oficina", "Serviços Automotivos"], ["Distribuidora", "Distribuição de Bebidas"],
  ["Imobiliária", "Negócios Imobiliários"], ["Escola", "Serviços de Educação"],
  ["Lavanderia", "Serviços de Lavanderia"], ["Ótica", "Comércio de Produtos Ópticos"],
  ["Metalúrgica", "Indústria Metalúrgica"], ["Confecções", "Indústria de Confecções"],
  ["Studio", "Serviços de Beleza"], ["Cerealista", "Comércio de Cereais"], ["Gráfica", "Serviços Gráficos"]
]);

export const NOMES_FANTASIA_PJ = Object.freeze([
  "Trigo Dourado", "Boa Vista", "Campos Gerais", "Estação", "Vila Velha", "Sol Nascente", "Nova Aurora",
  "Santa Clara", "Três Irmãos", "Central", "Araucária", "Pinheiral", "Rio Verde", "Serra Azul",
  "Bom Preço", "Ouro Verde", "Horizonte", "União", "Progresso", "Primavera", "Novo Tempo", "Pioneira",
  "Vale do Tibagi", "Cruzeiro", "Real", "Alvorada", "Colonial", "Imperial", "Recanto", "Itaiacoca"
]);

export const CARGOS_REPRESENTANTE = Object.freeze([
  "Sócio-administrador", "Sócia-administradora", "Diretor", "Diretora", "Proprietário", "Proprietária", "Gerente"
]);

// ── Contrapartes fictícias (empresas que aparecem no polo oposto) ──────────
export const CONTRAPARTES = Object.freeze([
  "Banco Meridional S.A.", "Telesul Telecomunicações", "Casa Nova Móveis Ltda", "Seguradora Aurora Mútua",
  "Plano de Saúde Vida Plena", "Companhia Aérea Sulamericana", "Concessionária Serra Azul Veículos",
  "Financeira Crédito Fácil S.A.", "Loja Estrela do Sul", "Operadora Conecta Fibra", "Construtora Vale Norte",
  "Cooperativa de Crédito Campos Gerais", "Eletrodomésticos Bom Lar Ltda", "Universidade Particular Horizonte",
  "Administradora de Cartões Ouro Card", "Imobiliária Terra Firme Ltda", "Distribuidora de Gás Chama Viva",
  "Agência de Viagens Roteiro Certo", "Banco Regional do Sul S.A.", "Rede de Supermercados Fartura"
]);

// ── Endereços ──────────────────────────────────────────────────────────────
// Ponta Grossa: prefixo do CEP por bairro (5 primeiros dígitos).
export const BAIRROS_PONTA_GROSSA = Object.freeze([
  ["Centro", "84010"], ["Uvaranas", "84031"], ["Órfãs", "84015"], ["Oficinas", "84035"],
  ["Nova Rússia", "84070"], ["Jardim Carvalho", "84016"], ["Boa Vista", "84073"], ["Contorno", "84060"],
  ["Olarias", "84025"], ["Chapada", "84050"], ["Cará-Cará", "84042"], ["Neves", "84071"], ["Ronda", "84092"]
]);

export const LOGRADOUROS_PONTA_GROSSA = Object.freeze([
  "Rua Balduíno Taques", "Rua Coronel Cláudio", "Avenida Vicente Machado", "Rua Ermelino de Leão",
  "Avenida Visconde de Mauá", "Rua Doutor Colares", "Rua Sant'Ana", "Avenida Carlos Cavalcanti",
  "Rua Augusto Ribas", "Rua XV de Novembro", "Avenida Bonifácio Vilela", "Rua Engenheiro Schamber",
  "Rua Fernandes Pinheiro", "Rua Padre Anchieta", "Rua Marechal Floriano Peixoto", "Rua Comendador Miró",
  "Rua Presidente Getúlio Vargas", "Rua Tiradentes", "Rua General Carneiro", "Rua Paula Xavier"
]);

// Cidades da região: [cidade, CEP geral do município (prefixo de 5 dígitos)].
export const CIDADES_REGIAO = Object.freeze([
  ["Castro", "84165"], ["Palmeira", "84130"], ["Carambeí", "84145"], ["Tibagi", "84300"],
  ["Telêmaco Borba", "84260"], ["Piraí do Sul", "84240"], ["Jaguariaíva", "84200"], ["Ipiranga", "84450"],
  ["Imbituva", "84430"], ["Prudentópolis", "84400"], ["Irati", "84500"], ["Curitiba", "80010"]
]);

export const LOGRADOUROS_GENERICOS = Object.freeze([
  "Rua Sete de Setembro", "Rua Marechal Deodoro", "Avenida Brasil", "Rua XV de Novembro", "Rua Tiradentes",
  "Rua Dom Pedro II", "Rua Barão do Rio Branco", "Rua São Paulo", "Rua Paraná", "Rua das Palmeiras"
]);

// O prefixo do CEP de uma cidade — usado pelo teste de coerência.
export const PREFIXOS_POR_CIDADE = Object.freeze({
  "Ponta Grossa": BAIRROS_PONTA_GROSSA.map(([, prefixo]) => prefixo),
  ...Object.fromEntries(CIDADES_REGIAO.map(([cidade, prefixo]) => [cidade, [prefixo]]))
});

export const montarEndereco = (sorteio) => {
  const sufixo = String(sorteio.inteiro(0, 999)).padStart(3, "0");
  const numero = String(sorteio.inteiro(12, 3400));

  if (sorteio.chance(0.78)) {
    const [bairro, prefixo] = sorteio.escolher(BAIRROS_PONTA_GROSSA);
    return {
      cep: `${prefixo}-${sufixo}`, pais: "Brasil", estado: "PR", cidade: "Ponta Grossa", bairro,
      logradouro: sorteio.escolher(LOGRADOUROS_PONTA_GROSSA), numero,
      complemento: sorteio.chance(0.25) ? `Apto ${sorteio.inteiro(11, 604)}` : undefined
    };
  }

  const [cidade, prefixo] = sorteio.escolher(CIDADES_REGIAO);
  return {
    cep: `${prefixo}-${sufixo}`, pais: "Brasil", estado: "PR", cidade, bairro: "Centro",
    logradouro: sorteio.escolher(LOGRADOUROS_GENERICOS), numero, complemento: undefined
  };
};

// ── Pessoas ────────────────────────────────────────────────────────────────
export const PROFISSOES_CANDIDATAS = Object.freeze([
  "Enfermeiro", "Contador", "Engenheiro civil", "Pedreiro", "Costureira de peças sob encomenda",
  "Cozinheiro geral", "Auxiliar de escritório", "Técnico de enfermagem", "Cabeleireiro", "Padeiro",
  "Farmacêutico", "Fisioterapeuta geral", "Zelador de edifício", "Operador de caixa",
  "Recepcionista, em geral", "Porteiro de edifícios", "Pintor de obras", "Soldador",
  "Agente comunitário de saúde", "Nutricionista", "Jornalista", "Servente de obras",
  "Motorista de carro de passeio", "Vendedor em comércio atacadista", "Comerciante varejista",
  "Comerciante atacadista", "Psicólogo clínico", "Advogado"
]);

export const ESTADOS_CIVIS = Object.freeze([
  ["solteiro", 30], ["casado", 42], ["divorciado", 12], ["uniao_estavel", 10], ["viuvo", 4], ["separado_judicialmente", 2]
]);

const DOMINIOS_EMAIL = Object.freeze(["exemplo.test", "correio.test", "provedor.test"]);

const semAcento = (texto) =>
  String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const parteDeEmail = (texto) => semAcento(texto).replace(/[^a-z0-9]/g, "");

export const montarEmail = (nomeCompleto, indice, sorteio) => {
  const partes = nomeCompleto.split(" ");
  const primeiro = parteDeEmail(partes[0]);
  const ultimo = parteDeEmail(partes[partes.length - 1]);
  // O índice garante a unicidade (o índice único é por usuário e e-mail).
  return `${primeiro}.${ultimo}${indice}@${sorteio.escolher(DOMINIOS_EMAIL)}`;
};

export const montarTelefone = (sorteio, { fixo = false } = {}) => {
  const ddd = sorteio.chance(0.9) ? "42" : "41";
  const fim = String(sorteio.inteiro(0, 9999)).padStart(4, "0");
  if (fixo) return `(${ddd}) 3${sorteio.inteiro(100, 399)}-${fim}`;
  return `(${ddd}) 9${sorteio.inteiro(8000, 9999)}-${fim}`;
};

export const montarRG = (sorteio) =>
  `${sorteio.inteiro(3, 14)}.${String(sorteio.inteiro(0, 999)).padStart(3, "0")}.` +
  `${String(sorteio.inteiro(0, 999)).padStart(3, "0")}-${sorteio.inteiro(0, 9)}`;

export const NOTAS_INTERNAS = Object.freeze([
  "Indicação de outro cliente.", "Prefere contato por WhatsApp à tarde.", "Documentos entregues em pasta física.",
  "Atendimento presencial às quintas.", "Cliente pontual nos pagamentos.", "Contato preferencial: telefone comercial.",
  "Veio pelo Instagram do escritório.", "Já foi atendido em outra causa.", "Aguardando documentos do cartório.",
  "Pediu retorno após a audiência."
]);

// ── O catálogo de ações do escritório ──────────────────────────────────────
// Direito de Família, Cível e do Consumidor. `classe` é o NOME de uma classe da
// tabela do CNJ e `area` o de um assunto de primeiro nível — o mesmo texto que a
// tela gravaria (DEC-057: grava-se o texto, não o código). O seed confere, ao
// subir, que cada nome existe na tabela.
//
//   pj        pode acontecer com pessoa jurídica?   pf  com pessoa física?
//   reu       o cliente costuma estar no polo passivo?
//   peso      frequência relativa no escritório
//   fees      como costuma ser cobrada (fixo | percentual | custas) e a faixa
const FAM = "DIREITO CIVIL";
const CIV = "DIREITO CIVIL";
const CON = "DIREITO DO CONSUMIDOR";

export const CASOS = Object.freeze([
  // ── Família ──
  { chave: "divorcio_consensual", classe: "Divórcio Consensual", area: FAM, titulo: "Divórcio consensual", pf: true, peso: 7,
    desc: "Divórcio consensual com partilha amigável e definição de guarda.", vara: "Vara de Família e Sucessões", faixa: [1800, 3800] },
  { chave: "divorcio_litigioso", classe: "Divórcio Litigioso", area: FAM, titulo: "Divórcio litigioso com partilha de bens", pf: true, peso: 6,
    desc: "Divórcio litigioso com discussão de partilha e de guarda compartilhada.", vara: "Vara de Família e Sucessões", faixa: [4500, 9500] },
  { chave: "alimentos", classe: "Alimentos - Lei Especial Nº 5.478/68", area: FAM, titulo: "Ação de alimentos", pf: true, peso: 8,
    desc: "Fixação de alimentos em favor de filho menor.", vara: "Vara de Família e Sucessões", faixa: [1500, 3500] },
  { chave: "exec_alimentos", classe: "Execução de Alimentos", area: FAM, titulo: "Execução de alimentos em atraso", pf: true, peso: 4, reu: false,
    desc: "Execução de prestações alimentícias vencidas e não pagas.", vara: "Vara de Família e Sucessões", faixa: [1800, 4200] },
  { chave: "visitas", classe: "Regulamentação de Visitas", area: FAM, titulo: "Regulamentação de convivência familiar", pf: true, peso: 3,
    desc: "Regulamentação do regime de convivência com o filho.", vara: "Vara de Família e Sucessões", faixa: [1500, 3000] },
  { chave: "guarda", classe: "Guarda de Família", area: FAM, titulo: "Guarda de menor", pf: true, peso: 4,
    desc: "Pedido de guarda unilateral com regulamentação de visitas.", vara: "Vara de Família e Sucessões", faixa: [2000, 4500] },
  { chave: "inventario", classe: "Inventário", area: FAM, titulo: "Inventário e partilha de bens", pf: true, peso: 6, herdeiros: true,
    desc: "Inventário judicial com herdeiros e bens a partilhar.", vara: "Vara de Família e Sucessões", faixa: [4000, 9000], percentual: true },
  { chave: "arrolamento", classe: "Arrolamento Sumário", area: FAM, titulo: "Arrolamento sumário de bens", pf: true, peso: 3, herdeiros: true,
    desc: "Arrolamento sumário com partilha amigável entre os herdeiros.", vara: "Vara de Família e Sucessões", faixa: [2500, 5500] },
  { chave: "uniao_estavel", classe: "Reconhecimento e Extinção de União Estável", area: FAM, titulo: "Reconhecimento e dissolução de união estável", pf: true, peso: 3,
    desc: "Reconhecimento e dissolução de união estável com partilha.", vara: "Vara de Família e Sucessões", faixa: [2500, 6000] },
  { chave: "curatela", classe: "Interdição/Curatela", area: FAM, titulo: "Curatela de pessoa idosa", pf: true, peso: 2,
    desc: "Nomeação de curador para pessoa idosa incapaz de gerir seus bens.", vara: "Vara de Família e Sucessões", faixa: [2000, 4500] },
  { chave: "alvara", classe: "Alvará Judicial", area: FAM, titulo: "Alvará judicial para levantamento de valores", pf: true, peso: 2,
    desc: "Alvará para levantamento de saldo de FGTS/PIS de pessoa falecida.", vara: "Vara de Família e Sucessões", faixa: [900, 2200] },

  // ── Cível ──
  { chave: "cobranca", classe: "Procedimento Comum Cível", area: CIV, titulo: "Ação de cobrança", pf: true, pj: true, peso: 8,
    desc: "Cobrança de valores contratados e não pagos.", vara: "Vara Cível", faixa: [2000, 6500], percentual: true },
  { chave: "indenizacao", classe: "Procedimento Comum Cível", area: CIV, titulo: "Indenização por danos materiais e morais", pf: true, peso: 6,
    desc: "Pedido de reparação por danos materiais e morais.", vara: "Vara Cível", faixa: [2500, 7000], percentual: true },
  { chave: "exec_titulo", classe: "Execução de Título Extrajudicial", area: CIV, titulo: "Execução de título extrajudicial", pf: true, pj: true, peso: 6,
    desc: "Execução de cheque, nota promissória ou contrato com força de título.", vara: "Vara Cível", faixa: [1800, 5000] },
  { chave: "monitoria", classe: "Monitória", area: CIV, titulo: "Ação monitória", pf: true, pj: true, peso: 3,
    desc: "Ação monitória para cobrança de débito documentado sem força executiva.", vara: "Vara Cível", faixa: [1500, 4200] },
  { chave: "despejo", classe: "Despejo por Falta de Pagamento", area: CIV, titulo: "Despejo por falta de pagamento", pf: true, pj: true, peso: 4,
    desc: "Despejo cumulado com cobrança de aluguéis e encargos.", vara: "Vara Cível", faixa: [1500, 4000] },
  { chave: "usucapiao", classe: "Usucapião", area: CIV, titulo: "Usucapião de imóvel urbano", pf: true, peso: 3,
    desc: "Usucapião extraordinária com posse mansa e pacífica.", vara: "Vara Cível", faixa: [3500, 8000] },
  { chave: "reintegracao", classe: "Reintegração / Manutenção de Posse", area: CIV, titulo: "Reintegração de posse", pf: true, pj: true, peso: 3,
    desc: "Reintegração de posse de imóvel ocupado sem autorização.", vara: "Vara Cível", faixa: [2500, 6000] },
  { chave: "busca_apreensao", classe: "Busca e Apreensão em Alienação Fiduciária", area: CIV, titulo: "Defesa em busca e apreensão de veículo", pf: true, peso: 3, reu: true,
    desc: "Defesa do cliente em ação de busca e apreensão de veículo financiado.", vara: "Vara Cível", faixa: [1800, 4200] },
  { chave: "consignacao", classe: "Consignação em Pagamento", area: CIV, titulo: "Consignação em pagamento", pf: true, pj: true, peso: 2,
    desc: "Depósito judicial de valores para liberação da obrigação.", vara: "Vara Cível", faixa: [1500, 3500] },
  { chave: "cumprimento", classe: "Cumprimento de sentença", area: CIV, titulo: "Cumprimento de sentença", pf: true, pj: true, peso: 4,
    desc: "Cumprimento de sentença condenatória transitada em julgado.", vara: "Vara Cível", faixa: [1500, 4500] },
  { chave: "exigir_contas", classe: "Ação de Exigir Contas", area: CIV, titulo: "Ação de exigir contas", pf: true, pj: true, peso: 2,
    desc: "Prestação de contas de administração de bens ou contrato.", vara: "Vara Cível", faixa: [2200, 5500] },

  // ── Consumidor ──
  { chave: "negativacao", classe: "Procedimento do Juizado Especial Cível", area: CON, titulo: "Indenização por negativação indevida", pf: true, peso: 7,
    desc: "Indenização por inscrição indevida em cadastro de inadimplentes.", vara: "Juizado Especial Cível", faixa: [900, 2500], percentual: true },
  { chave: "cobranca_indevida", classe: "Procedimento do Juizado Especial Cível", area: CON, titulo: "Cobrança indevida em fatura", pf: true, peso: 5,
    desc: "Restituição de valores cobrados indevidamente em fatura de serviço.", vara: "Juizado Especial Cível", faixa: [800, 2200], percentual: true },
  { chave: "vicio_produto", classe: "Procedimento do Juizado Especial Cível", area: CON, titulo: "Vício em produto — devolução de valores", pf: true, peso: 4,
    desc: "Devolução de valores e indenização por produto com vício não sanado.", vara: "Juizado Especial Cível", faixa: [800, 2000], percentual: true },
  { chave: "revisao_bancaria", classe: "Procedimento Comum Cível", area: CON, titulo: "Revisão de contrato bancário", pf: true, pj: true, peso: 5,
    desc: "Revisão de cláusulas e juros abusivos em contrato de financiamento.", vara: "Vara Cível", faixa: [2500, 6000], percentual: true },
  { chave: "plano_saude", classe: "Procedimento Comum Cível", area: CON, titulo: "Plano de saúde — obrigação de fazer", pf: true, peso: 3,
    desc: "Obrigação de fazer para cobertura de procedimento negado pelo plano.", vara: "Vara Cível", faixa: [2500, 6500], percentual: true },
  { chave: "cancelamento_servico", classe: "Procedimento do Juizado Especial Cível", area: CON, titulo: "Cancelamento de serviço e devolução", pf: true, peso: 3,
    desc: "Indenização por cancelamento unilateral de serviço contratado.", vara: "Juizado Especial Cível", faixa: [800, 2000], percentual: true }
]);

export const MOTIVOS_TRANSITO = Object.freeze([
  "Acordo cumprido", "Sentença transitada em julgado", "Desistência homologada", "Decurso do prazo recursal", "Acordo homologado em audiência"
]);

export const OBSERVACOES_LIMINAR = Object.freeze([
  "Tutela de urgência deferida em parte.", "Pedido de liminar aguardando análise.", "Liminar deferida; contrapartes intimadas.",
  "Tutela de urgência indeferida, agravo em preparo.", "Liminar para manutenção do fornecimento do serviço."
]);
