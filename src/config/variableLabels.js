// Rótulos e descrições do catálogo de variáveis, para exibição na tela.
//
// ESCRITOS À MÃO, um a um. Não derivar de `chave` — derivação produz "Nome
// Cliente", "Cpf Cliente", "Estado Civil Cliente", que funciona e parece
// amador. Este seletor é o que a advogada vê toda vez que escreve uma seção.
//
// Regras que valem para toda entrada nova:
//
//  - A lista é agrupada por origem, então o rótulo NÃO repete o nome do grupo.
//    Dentro de "Cliente": "Nome completo", "CPF", "Estado civil" — nunca "Nome
//    do cliente", "CPF do cliente". A exceção é quando o rótulo sozinho ficaria
//    ambíguo fora do agrupamento ("Número do processo", "Nome do representante
//    legal"), e aí o nome entra por clareza, não por repetição mecânica.
//  - A descrição diz DE ONDE O DADO VEM, para a advogada saber onde corrigir
//    quando sair errado no documento.
//  - Sigla em caixa alta: CPF, CNPJ, OAB, CEP, RG, UF, PIX.
//  - Variável derivada (por extenso, montada, calculada) diz na descrição que é
//    derivada e a partir de qual campo.
//
// Toda chave de CATALOGO_VARIAVEIS precisa aparecer aqui, com rótulo e
// descrição não vazios — `assertCatalogoRotulado()` falha na carga do módulo se
// faltar alguma. É a guarda que impede o seletor de aparecer com buraco na
// defesa.

import { CATALOGO_VARIAVEIS, ORIGENS } from "./templateVariables.js";

// Nome de cada grupo na tela. "usuario" vira "Advogada e escritório": é como a
// titular se refere aos próprios dados, e "Usuário" não diz nada num documento
// jurídico.
export const ROTULOS_ORIGEM = {
  cliente: "Cliente",
  processo: "Processo",
  usuario: "Advogada e escritório",
  honorario: "Honorário",
  sistema: "Sistema"
};

export const DESCRICOES_ORIGEM = {
  cliente: "Dados do cliente para quem o documento é emitido.",
  processo: "Dados do processo ao qual o documento está vinculado.",
  usuario: "Seus dados e os do escritório, do seu perfil.",
  honorario: "Valores do honorário vinculado ao processo.",
  sistema: "Preenchidos automaticamente no momento da geração."
};

// Ordem de exibição dos grupos: primeiro quem aparece na qualificação das
// partes, depois o processo, depois valores, e o sistema por último.
export const ORDEM_ORIGENS = ["cliente", "processo", "usuario", "honorario", "sistema"];

export const ROTULOS_VARIAVEIS = {
  // ── Cliente — pessoa física ────────────────────────────────────────────────
  nomeCliente: {
    rotulo: "Nome completo",
    descricao: "Nome completo do cliente, do cadastro de clientes."
  },
  cpfCliente: {
    rotulo: "CPF",
    descricao: "CPF do cliente, do cadastro de clientes."
  },
  rgCliente: {
    rotulo: "RG",
    descricao: "RG do cliente, do cadastro de clientes."
  },
  dataNascimentoCliente: {
    rotulo: "Data de nascimento",
    descricao: "Data de nascimento do cliente, do cadastro de clientes."
  },
  sexoCliente: {
    rotulo: "Sexo",
    descricao: "Sexo do cliente, do cadastro de clientes."
  },
  estadoCivilCliente: {
    rotulo: "Estado civil",
    descricao: "Estado civil do cliente, do cadastro de clientes."
  },
  profissaoCliente: {
    rotulo: "Profissão",
    descricao: "Profissão do cliente, do cadastro de clientes."
  },
  nacionalidadeCliente: {
    rotulo: "Nacionalidade",
    descricao: "Nacionalidade do cliente, do cadastro de clientes."
  },
  emailCliente: {
    rotulo: "E-mail",
    descricao: "E-mail do cliente, do cadastro de clientes."
  },
  telefoneCliente: {
    rotulo: "Telefone",
    descricao: "Telefone do cliente, do cadastro de clientes."
  },
  enderecoCliente: {
    rotulo: "Endereço completo",
    descricao:
      "Endereço do cliente em uma linha só. Derivado: montado a partir do logradouro, número, complemento, bairro, cidade, UF e CEP do cadastro de clientes."
  },
  cepCliente: {
    rotulo: "CEP",
    descricao: "CEP do endereço do cliente, do cadastro de clientes."
  },
  cidadeCliente: {
    rotulo: "Cidade",
    descricao: "Cidade do endereço do cliente, do cadastro de clientes."
  },
  estadoCliente: {
    rotulo: "UF",
    descricao: "Sigla do estado do endereço do cliente, do cadastro de clientes."
  },

  // ── Cliente — pessoa jurídica ──────────────────────────────────────────────
  razaoSocialCliente: {
    rotulo: "Razão social",
    descricao: "Razão social do cliente pessoa jurídica, do cadastro de clientes."
  },
  nomeFantasiaCliente: {
    rotulo: "Nome fantasia",
    descricao: "Nome fantasia do cliente pessoa jurídica, do cadastro de clientes."
  },
  cnpjCliente: {
    rotulo: "CNPJ",
    descricao: "CNPJ do cliente pessoa jurídica, do cadastro de clientes."
  },
  representanteLegalNome: {
    rotulo: "Nome do representante legal",
    descricao:
      "Nome de quem assina pela pessoa jurídica, do cadastro de clientes."
  },
  representanteLegalCpf: {
    rotulo: "CPF do representante legal",
    descricao: "CPF de quem assina pela pessoa jurídica, do cadastro de clientes."
  },
  representanteLegalCargo: {
    rotulo: "Cargo do representante legal",
    descricao:
      "Cargo de quem assina pela pessoa jurídica — sócio, diretor, procurador —, do cadastro de clientes."
  },

  // ── Processo ───────────────────────────────────────────────────────────────
  numeroProcesso: {
    rotulo: "Número do processo",
    descricao: "Número do processo, do cadastro de processos."
  },
  tituloProcesso: {
    rotulo: "Título",
    descricao: "Título dado ao processo no cadastro de processos."
  },
  tipoAcao: {
    rotulo: "Tipo de ação",
    descricao: "Tipo da ação — inventário, usucapião, execução fiscal —, do cadastro de processos."
  },
  areaProcesso: {
    rotulo: "Área do direito",
    descricao: "Área do direito do processo — cível, trabalhista, família —, do cadastro de processos."
  },
  orgaoProcesso: {
    rotulo: "Órgão",
    descricao: "Órgão julgador perante o qual o processo tramita, do cadastro de processos."
  },
  varaProcesso: {
    rotulo: "Vara",
    descricao: "Vara em que o processo tramita, do cadastro de processos."
  },
  comarcaProcesso: {
    rotulo: "Comarca",
    descricao: "Comarca em que o processo tramita, do cadastro de processos."
  },
  dataDistribuicao: {
    rotulo: "Data de distribuição",
    descricao: "Data em que o processo foi distribuído, do cadastro de processos."
  },
  statusProcesso: {
    rotulo: "Situação",
    descricao: "Situação atual do processo — ativo, suspenso, encerrado —, do cadastro de processos."
  },

  // ── Advogada e escritório ──────────────────────────────────────────────────
  nomeAdvogado: {
    rotulo: "Nome da advogada",
    descricao: "Nome da titular, do seu perfil."
  },
  cpfAdvogado: {
    rotulo: "CPF",
    descricao: "CPF da titular, do seu perfil."
  },
  numOAB: {
    rotulo: "Número da OAB",
    descricao: "Número de inscrição na OAB, do seu perfil."
  },
  estadoOAB: {
    rotulo: "UF da OAB",
    descricao: "Sigla do estado em que a inscrição na OAB foi feita, do seu perfil."
  },
  nomeAdvocacia: {
    rotulo: "Nome do escritório",
    descricao: "Nome do escritório de advocacia, do seu perfil."
  },
  enderecoEscritorio: {
    rotulo: "Endereço completo",
    descricao:
      "Endereço do escritório em uma linha só. Derivado: montado a partir do logradouro, número, complemento, bairro, cidade, UF e CEP do seu perfil."
  },
  telefoneEscritorio: {
    rotulo: "Telefone",
    descricao: "Telefone do escritório, do seu perfil."
  },
  emailEscritorio: {
    rotulo: "E-mail",
    descricao: "E-mail da titular, do seu perfil."
  },
  chavePix: {
    rotulo: "Chave PIX",
    descricao: "Chave PIX para recebimento de honorários, do seu perfil."
  },
  cidadeEscritorio: {
    rotulo: "Cidade",
    descricao:
      "Cidade do escritório, do seu perfil. É a cidade que costuma abrir o fecho de assinatura do documento."
  },

  // ── Honorário ──────────────────────────────────────────────────────────────
  valorHonorario: {
    rotulo: "Valor",
    descricao: "Valor do honorário vinculado ao processo, do cadastro de honorários."
  },
  valorHonorarioExtenso: {
    rotulo: "Valor por extenso",
    descricao:
      "Valor do honorário escrito por extenso, gerado a partir do valor cadastrado."
  },
  tipoHonorario: {
    rotulo: "Tipo de cobrança",
    descricao:
      "Forma de cobrança do honorário — fixo, percentual, custas processuais —, do cadastro de honorários."
  },
  dataVencimentoHonorario: {
    rotulo: "Data de vencimento",
    descricao: "Data de vencimento do honorário, do cadastro de honorários."
  },
  numeroParcelas: {
    rotulo: "Número de parcelas",
    descricao:
      "Quantas parcelas o honorário tem. Derivado: contado a partir das parcelas ativas. Sem parcela cadastrada, vale 1 — pagamento único."
  },
  valorParcela: {
    rotulo: "Valor da parcela",
    descricao:
      "Quanto vale cada parcela. Derivado das parcelas ativas do honorário. Sem parcela cadastrada, é o valor cheio."
  },

  // ── Sistema ────────────────────────────────────────────────────────────────
  dataAtual: {
    rotulo: "Data de hoje",
    descricao:
      "Data em que o documento for gerado, preenchida pelo sistema no formato dd/mm/aaaa."
  },
  dataAtualExtenso: {
    rotulo: "Data de hoje por extenso",
    descricao:
      "Data em que o documento for gerado, escrita por extenso pelo sistema — por exemplo, 28 de julho de 2026."
  }
};

// Falha alto na carga do módulo se alguém acrescentar variável ao catálogo sem
// escrever rótulo e descrição. É barato aqui e caro na defesa do TCC: sem esta
// guarda, a chave nova apareceria no seletor sem nome nenhum.
export const assertCatalogoRotulado = () => {
  const semRotulo = [];
  const sobrando = [];

  for (const chave of Object.keys(CATALOGO_VARIAVEIS)) {
    const entrada = ROTULOS_VARIAVEIS[chave];
    if (!entrada?.rotulo?.trim() || !entrada?.descricao?.trim()) {
      semRotulo.push(chave);
    }
  }

  for (const chave of Object.keys(ROTULOS_VARIAVEIS)) {
    if (!CATALOGO_VARIAVEIS[chave]) sobrando.push(chave);
  }

  if (semRotulo.length > 0 || sobrando.length > 0) {
    const partes = [];
    if (semRotulo.length > 0) {
      partes.push(`sem rótulo ou descrição: ${semRotulo.join(", ")}`);
    }
    if (sobrando.length > 0) {
      partes.push(`rotuladas mas fora do catálogo: ${sobrando.join(", ")}`);
    }
    throw new Error(`variableLabels.js fora de sincronia com o catálogo — ${partes.join("; ")}`);
  }
};

assertCatalogoRotulado();

// Catálogo pronto para a tela: agrupado por origem, cada entrada com chave,
// rótulo e descrição. Sem `caminho` nem `formatador` — são detalhe interno de
// resolução e não dizem nada à advogada.
export const montarCatalogoParaExibicao = () => {
  const grupos = ORDEM_ORIGENS.filter((origem) => ORIGENS.includes(origem)).map((origem) => {
    const variaveis = Object.entries(CATALOGO_VARIAVEIS)
      .filter(([, def]) => def.origem === origem)
      .map(([chave]) => ({
        chave,
        rotulo: ROTULOS_VARIAVEIS[chave].rotulo,
        descricao: ROTULOS_VARIAVEIS[chave].descricao
      }));

    return {
      origem,
      rotulo: ROTULOS_ORIGEM[origem],
      descricao: DESCRICOES_ORIGEM[origem],
      total: variaveis.length,
      variaveis
    };
  });

  return {
    total: Object.keys(CATALOGO_VARIAVEIS).length,
    grupos
  };
};

export default ROTULOS_VARIAVEIS;
