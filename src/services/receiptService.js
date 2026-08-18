import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import Installment from "../models/Installment.js";
import Allocation from "../models/Allocation.js";
import Fee from "../models/Fee.js";
import Process from "../models/Process.js";
import Client from "../models/Client.js";
import User from "../models/User.js";
import ProcessoCliente from "../models/ProcessoCliente.js";

import {
  registrarFontes,
  criarPdf,
  montarTimbrado,
  nomeArquivoSeguro,
  cabecalhoPdf,
  rodapePdf,
  ESTILOS_TIMBRADO_PDF,
  MARGEM_PT,
  MARGEM_SUPERIOR_PT,
  LARGURA_UTIL_PT
} from "./letterheadService.js";

import { valorPorExtenso } from "../utils/numeroPorExtenso.js";
import { moeda, data as formatarData, dataExtenso } from "../utils/templateFormatters.js";
import { formatarCPF, formatarCNPJ, somenteDigitos } from "../utils/documentos.js";
import { carregarEstornos, valorLiquido } from "./reversalService.js";

// ═══════════════════════════════════════════════════════════════════════════
// RECIBO DE PAGAMENTO — PDF sob demanda (Fase 4.1)
//
// ── O recibo NÃO é um `Document` ─────────────────────────────────────────
// Não cria registro na coleção de documentos, não tem `visivelPortal`, não
// entra no portal e não aparece na lista de documentos do processo. É emissão
// sob demanda: o PDF é montado, entregue e esquecido.
//
// O motivo é que `Document` é peça composta por seções, com texto resolvido,
// rastreabilidade de origem e poder moderador da advogada sobre o texto final.
// O recibo não tem nada disso: ele é uma função do pagamento, e o pagamento já
// está gravado. Gravá-lo de novo como documento criaria dois lugares dizendo a
// mesma coisa, livres para divergir quando o pagamento fosse corrigido.
//
// Sai sobre o MESMO timbrado do documento, de `letterheadService.js`.
// ═══════════════════════════════════════════════════════════════════════════

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const CONTENT_TYPE_RECIBO = "application/pdf";

// Nome de quem pagou, e o documento dela. PJ assina pela razão social.
const identificarPagador = (cliente) => {
  if (!cliente) return { nome: "", documento: "" };

  if (cliente.tipoPessoa === "juridica") {
    const digitos = somenteDigitos(cliente.cnpj);
    return {
      nome: cliente.razaoSocial || cliente.nomeFantasia || "",
      documento: digitos.length === 14 ? `CNPJ ${formatarCNPJ(digitos)}` : ""
    };
  }

  const digitos = somenteDigitos(cliente.cpf);
  return {
    nome: cliente.nomeCompleto || "",
    documento: digitos.length === 11 ? `CPF ${formatarCPF(digitos)}` : ""
  };
};

const ROTULO_FORMA_PAGAMENTO = {
  dinheiro: "em dinheiro",
  pix: "por PIX",
  boleto: "por boleto bancário",
  cartao_credito: "por cartão de crédito",
  cartao_debito: "por cartão de débito",
  transferencia: "por transferência bancária"
};

// ── Quem é "quem pagou" ───────────────────────────────────────────────────
// O pagamento pendura em parcela, que pendura em honorário, que pendura em
// processo — e processo tem N participantes desde a Fase 2B. O recibo nomeia o
// participante PRINCIPAL, que é quem contrata os honorários; num
// litisconsórcio, os demais são partes do processo e não do contrato.
//
// A junção `ProcessoCliente` é a fonte da verdade (`clientePrincipalId` é
// derivado dela), então é por ela que se pergunta, com o derivado como
// segunda tentativa.
const resolverPagador = async (processo, usuarioId) => {
  const vinculo = await ProcessoCliente.findOne({
    processoId: processo._id,
    usuarioId,
    ativo: true,
    principal: true
  });

  const clienteId = vinculo?.clienteId ?? processo.clientePrincipalId;
  if (!clienteId) return null;

  return Client.findOne({ _id: clienteId, usuarioId, ativo: true });
};

// Centavos, como em todo o módulo financeiro: somar float acumula resíduo, e
// resíduo aqui é um recibo assinado com um centavo a mais.
const emCentavosRecibo = (n) => Math.round(Number(n || 0) * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// O QUE O RECIBO DESCREVE — DEC-041 (Fase F-1a.1). **PROVISÓRIA.**
//
// ── O defeito que originou ────────────────────────────────────────────────
// Smoke test de 17/08/2026: recibo de um pagamento de R$ 7.000,00 dizia
// "referente a Honorários advocatícios — parcela 2 de 2" e dava "plena e geral
// quitação" — quando só R$ 1.500,00 foram para aquela parcela (que vale 3.000)
// e R$ 5.500,00 viraram crédito.
//
// O documento é assinado pela advogada e entregue ao cliente. Ele quitava mais
// do que a obrigação a que se referia, e é o papel que o cliente guardaria
// para provar isso.
//
// ── As duas regras ────────────────────────────────────────────────────────
// 1. O recibo é DO PAGAMENTO. Uma alocação não gera recibo próprio — um PIX é
//    um recibo, mesmo cobrindo três parcelas.
// 2. Ele DESCREVE a alocação. Onde o dinheiro foi parar sai por extenso, e a
//    frase de quitação acompanha o que de fato foi quitado.
//
// **A redação é PROVISÓRIA e aguarda ratificação da Laís**, como
// TIPOS_HONORARIO (DEC-039): é texto jurídico entregue a terceiro, e a escolha
// entre "quitação plena" e "quitação do valor recebido" tem efeito que não se
// decide por critério técnico.
// ═══════════════════════════════════════════════════════════════════════════

// A frase de REFERÊNCIA — "referente a …".
//
// O caso comum (uma parcela, sem sobra) mantém o texto que existia desde a
// 4.1: enumerar valor onde há um destino só seria ruído. Os valores aparecem
// assim que houver mais de um destino OU sobra em crédito — porque aí o valor
// total do recibo deixa de descrever o que foi para a parcela citada, que é
// exatamente o defeito observado.
export const descreverDestino = ({ destinos = [], creditoMantido = 0, totalDeParcelas = 0 }) => {
  // ── A-2 (F-1a.2): alocação que NÃO quita também precisa do valor ─────────
  //
  // O predicado era `mais de um destino OU sobra em crédito`. Faltava o
  // terceiro caso, e ele produziu o recibo de R$ 5.000,00 do adiantamento do
  // inventário: uma alocação só, numa cobrança de parcela única de R$ 12.000,
  // sem sobra — caía em "pagamento único", e quem recebia o papel não tinha
  // como ligar o dinheiro à obrigação.
  //
  // "Pagamento único" passa a valer só quando a alocação QUITA a parcela.
  // Alocação que deixa saldo é enumerada com o valor, porque é aí que o total
  // do recibo deixa de descrever o que a parcela recebeu.
  const enumerar =
    destinos.length > 1 ||
    (destinos.length > 0 && creditoMantido > 0) ||
    destinos.some((d) => !d.quitaAParcela);

  if (destinos.length === 0) {
    // Nada encostou em parcela: ou não há parcela emitida, ou o pagamento foi
    // registrado como adiantamento. Nos dois casos o dinheiro é crédito, e a
    // frase não inventa número de parcela.
    return totalDeParcelas === 0 ? "adiantamento" : "adiantamento, sem parcela quitada";
  }

  if (!enumerar) {
    // Honorário não parcelado continua sendo "pagamento único": escrever
    // "parcela 1 de 1" é ruído, e era assim desde a 4.1.
    return totalDeParcelas <= 1
      ? "pagamento único"
      : `parcela ${destinos[0].numeroParcela} de ${totalDeParcelas}`;
  }

  const partes = destinos.map(
    (d) => `${moeda(d.valor)} na parcela ${d.numeroParcela} de ${totalDeParcelas}`
  );

  if (creditoMantido > 0) {
    partes.push(`${moeda(creditoMantido)} mantidos como crédito para abatimento futuro`);
  }

  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
};

// ═══════════════════════════════════════════════════════════════════════════
// A frase de QUITAÇÃO — DEC-042 (Fase F-1a.2). **PROVISÓRIA.**
//
// ── O defeito que originou (A-1, GRAVE) ───────────────────────────────────
// Recibo de R$ 3.500,00 do seed (Agro Campos, "Honorários complementares —
// recurso administrativo"). O corpo dizia certo: "R$ 3.000,00 na parcela 1 de
// 1 e R$ 500,00 mantidos como crédito para abatimento futuro". O pé dizia que
// a quitação era PARCIAL e que "não alcança o saldo remanescente da obrigação,
// que permanece devido".
//
// **Não havia saldo remanescente.** A parcela 1 de 1 valia R$ 3.000,00 e foi
// paga integralmente; a obrigação estava quitada e ainda sobrou crédito. O
// documento afirmava dívida inexistente CONTRA O CLIENTE QUE PAGOU A MAIS — e
// é papel assinado pela advogada, que trabalha contra ela em qualquer
// discussão futura.
//
// A condição culpada era `creditoMantido <= 0` dentro do teste de quitação
// plena: ela tratava SOBRA como se fosse FALTA.
//
// ── A regra: quem decide é a OBRIGAÇÃO ALCANÇADA, não a sobra ─────────────
// A pergunta não é "sobrou dinheiro?", é "o que este pagamento alcançou ficou
// quitado?". Daí os três estados:
//
//   1. PLENA — as parcelas alcançadas ficaram integralmente quitadas. Vale
//      MESMO HAVENDO CRÉDITO: a sobra é dita à parte, como crédito, e não
//      contamina a quitação.
//   2. PARCIAL — alguma parcela alcançada continua com saldo em aberto.
//      Redação inalterada desde a DEC-041: ela está correta.
//   3. ADIANTAMENTO — nenhuma alocação. Não quita obrigação nenhuma porque não
//      há obrigação vencida a quitar; o valor fica como crédito. Sem falar de
//      "saldo remanescente devido".
//
// ── Regras de redação ─────────────────────────────────────────────────────
// • A quitação se refere ao VALOR EFETIVAMENTE RECEBIDO, sempre.
// • Havendo crédito, o pé NOMEIA o crédito e diz que fica para abatimento
//   futuro — nunca o descreve como dívida do cliente.
// • A palavra "devido" só aparece quando existe, de fato, saldo em aberto numa
//   parcela alcançada. É o que `tests/financial/recibo.test.js` prova, caso a
//   caso, sobre o texto extraído do PDF.
//
// **PROVISÓRIA**, como a DEC-041, com quem convive: a Laís ratifica antes de
// qualquer recibo ir a cliente real.
// ═══════════════════════════════════════════════════════════════════════════

export const ESTADO_QUITACAO = {
  PLENA: "plena",
  PARCIAL: "parcial",
  ADIANTAMENTO: "adiantamento"
};

// O estado, separado do texto: é a decisão, e é ela que os testes leem sem
// depender de uma vírgula da redação — que é provisória e vai mudar quando a
// Laís revisar.
export const estadoDaQuitacao = ({ destinos = [] }) => {
  if (destinos.length === 0) return ESTADO_QUITACAO.ADIANTAMENTO;
  return destinos.every((d) => d.quitaAParcela)
    ? ESTADO_QUITACAO.PLENA
    : ESTADO_QUITACAO.PARCIAL;
};

export const frasePeDeQuitacao = ({ destinos = [], creditoMantido = 0 }) => {
  const estado = estadoDaQuitacao({ destinos });

  if (estado === ESTADO_QUITACAO.ADIANTAMENTO) {
    return (
      "Para clareza e como prova, firmo o presente recibo, dando quitação do " +
      "valor acima efetivamente recebido. Este pagamento não alcançou parcela " +
      "alguma: não há obrigação vencida a quitar, e o valor recebido fica " +
      "registrado como crédito do contratante, para abatimento futuro."
    );
  }

  if (estado === ESTADO_QUITACAO.PARCIAL) {
    // Inalterada. Aqui existe, de fato, saldo em aberto numa parcela que este
    // pagamento alcançou — é o único lugar em que "devido" é verdade.
    return (
      "Para clareza e como prova, firmo o presente recibo, dando quitação do " +
      "valor acima efetivamente recebido. A quitação é PARCIAL e não alcança o " +
      "saldo remanescente da obrigação, que permanece devido."
    );
  }

  // PLENA sem crédito: o texto que existia e está correto. Regressão travada.
  if (creditoMantido <= 0) {
    return (
      "Para clareza e como prova, firmo o presente recibo, dando plena e geral " +
      "quitação do valor acima em relação à obrigação a que se refere."
    );
  }

  // PLENA com crédito: a quitação é plena porque o que foi alcançado ficou
  // quitado. A sobra é NOMEADA e dita como crédito — nunca como dívida.
  return (
    "Para clareza e como prova, firmo o presente recibo, dando plena e geral " +
    "quitação do valor acima em relação às parcelas alcançadas por este " +
    `pagamento, que ficaram integralmente quitadas. Os ${moeda(creditoMantido)} ` +
    "restantes não correspondem a obrigação em aberto: ficam registrados como " +
    "crédito do contratante, para abatimento futuro."
  );
};

// ── A-3 (F-1a.2): o recibo do pagamento estornado não pode ser silencioso ──
//
// O recibo de R$ 2.500,00 do seed (Beatriz, usucapião) saía pelo líquido —
// correto — mas em silêncio: o pagamento foi de R$ 4.000,00 com estorno de
// R$ 1.500,00, e o documento não dizia nada disso. Para documento de prova é
// lacuna: o cliente fica com um recibo de 2.500 e nenhum registro do que houve
// com a diferença.
//
// O número em destaque continua sendo o LÍQUIDO — é o que a advogada recebeu
// de fato. O que se acrescenta é a conta que leva até ele.
//
// Motivo do estorno NÃO entra: o campo pode estar vazio, e inventar motivo em
// documento assinado é pior que omiti-lo.
export const fraseDeEstorno = ({ valorBruto = 0, estornosAtivos = [], liquido = 0 }) => {
  if (estornosAtivos.length === 0) return "";

  const partes = estornosAtivos.map(
    (e) => `${moeda(e.valor)} em ${formatarData(e.data)}`
  );

  const lista =
    partes.length === 1
      ? partes[0]
      : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;

  const verbo = partes.length === 1 ? "foi estornado" : "foram estornados";

  return (
    `Este recibo é do valor líquido: do pagamento de ${moeda(valorBruto)} ` +
    `${verbo} ${lista}, restando os ${moeda(liquido)} acima.`
  );
};

export const carregarDadosDoRecibo = async (pagamentoId, usuarioId) => {
  if (!mongoose.Types.ObjectId.isValid(pagamentoId)) {
    throw createError("Identificador de pagamento inválido", 400);
  }

  // Só pagamento ATIVO. Desativado responde 404, como toda leitura do projeto:
  // recibo de pagamento estornado é justamente o papel que não pode existir.
  const pagamento = await Payment.findOne({ _id: pagamentoId, usuarioId, ativo: true });
  if (!pagamento) {
    throw createError("Pagamento não encontrado", 404);
  }

  // ── A âncora do recibo virou o HONORÁRIO (F-1a) ──────────────────────────
  //
  // Até a F-0 o recibo saía de UMA parcela, porque o pagamento pertencia a uma.
  // Agora um PIX pode atravessar duas, ou nenhuma (adiantamento), e a pergunta
  // "de qual parcela é este recibo" deixou de ter resposta única. A referência
  // do recibo passa a ser a cobrança — que é o que o cliente reconhece — e as
  // parcelas cobertas entram como detalhamento.
  const honorario = await Fee.findOne({ _id: pagamento.honorarioId, usuarioId, ativo: true });
  if (!honorario) {
    throw createError("O honorário deste pagamento não está mais ativo", 404);
  }

  // ── Estorno: o recibo é do LÍQUIDO, e some quando o líquido zera ─────────
  //
  // "Recebi de fulano a importância de X" precisa ser verdade no dia em que o
  // papel é lido. Se 300 de 1.000 voltaram, recebi 700 — imprimir 1.000 daria
  // ao cliente um comprovante de um valor que ele não pagou, e é justamente o
  // documento que ele guardaria para provar o contrário.
  //
  // Estornado por inteiro, o recibo deixa de existir (404), pela mesma regra
  // que já valia para pagamento desativado: recibo de pagamento que voltou é o
  // papel que não pode existir.
  const estornos = await carregarEstornos(pagamento._id, usuarioId);
  const liquido = valorLiquido(pagamento, estornos);
  if (liquido <= 0) {
    throw createError(
      "Este pagamento foi integralmente estornado e não gera recibo",
      404
    );
  }

  const processo = await Process.findOne({ _id: honorario.processoId, usuarioId, ativo: true });
  if (!processo) {
    throw createError("O processo deste pagamento não está mais ativo", 404);
  }

  const [usuario, cliente, totalDeParcelas, alocacoes] = await Promise.all([
    User.findById(usuarioId),
    resolverPagador(processo, usuarioId),
    Installment.countDocuments({ feeId: honorario._id, usuarioId, ativo: true }),
    // As parcelas que ESTE pagamento cobriu, ativas. Cada alocação traz o
    // VALOR que encostou na parcela e o estado atual dela — os dois são
    // necessários para o recibo descrever o que de fato quitou (DEC-041).
    Allocation.find({ pagamentoId: pagamento._id, usuarioId, estornoId: null })
      .populate("parcelaId", "numeroParcela valor valorPago")
      .sort({ data: 1 })
  ]);

  if (!usuario) {
    throw createError("Usuário não encontrado", 404);
  }

  // Uma linha por PARCELA, com o quanto deste pagamento foi para ela. Duas
  // alocações na mesma parcela (acontece quando um estorno parcial substitui a
  // linha original) somam numa entrada só: o recibo descreve destino, não
  // mecânica interna.
  const porParcela = new Map();
  for (const a of alocacoes) {
    const numero = a.parcelaId?.numeroParcela;
    if (numero === undefined || numero === null) continue;
    const atual = porParcela.get(numero) ?? {
      numeroParcela: numero,
      valor: 0,
      valorParcela: Number(a.parcelaId?.valor ?? 0),
      // `valorPago` da parcela é a soma de TODAS as alocações ativas dela,
      // inclusive de outros pagamentos. É o estado dela hoje, e é isso que a
      // frase de quitação precisa refletir — não o quanto este pagamento
      // sozinho contribuiu.
      valorPagoDaParcela: Number(a.parcelaId?.valorPago ?? 0)
    };
    atual.valor = emCentavosRecibo(atual.valor + Number(a.valor));
    porParcela.set(numero, atual);
  }

  const destinos = [...porParcela.values()]
    .sort((a, b) => a.numeroParcela - b.numeroParcela)
    .map((d) => ({ ...d, quitaAParcela: d.valorPagoDaParcela >= d.valorParcela }));

  // O que do LÍQUIDO não encontrou parcela e ficou como crédito.
  //
  // Sai da diferença, e não de `Fee.saldoAdiantado`: aquele campo é do
  // honorário e pode ter contribuição de outros pagamentos, enquanto o recibo
  // fala de UM. A conta fecha mesmo com estorno no meio, porque a desalocação
  // consome o crédito antes das parcelas — ver `desalocarPorEstorno`.
  const alocadoNoTotal = emCentavosRecibo(
    destinos.reduce((t, d) => t + d.valor, 0)
  );
  const creditoMantido = Math.max(0, emCentavosRecibo(liquido - alocadoNoTotal));

  // Os estornos que de fato pesaram no líquido (A-3). Anulação não é débito e
  // estorno anulado não conta — a regra é a de `totalEstornado`, e é dela que
  // esta lista precisa ser o espelho, ou o recibo declararia um estorno que
  // foi desfeito.
  const estornosAtivos = estornos
    .filter((e) => !e.ehAnulacao && !e.anulado)
    .map((e) => ({ valor: Number(e.doc.valor), data: e.doc.data }));

  return {
    pagamento,
    honorario,
    processo,
    cliente,
    usuario,
    totalDeParcelas,
    destinos,
    creditoMantido,
    estornosAtivos,
    valorLiquido: liquido
  };
};

// ── Montagem do PDF ─────────────────────────────────────────────────────────

const linhaAssinatura = () => ({
  margin: [0, 60, 0, 0],
  canvas: [
    {
      type: "line",
      // Assinatura centrada, com 260 pt de traço: largura de assinatura de
      // caneta, não a página inteira.
      x1: (LARGURA_UTIL_PT - 260) / 2,
      y1: 0,
      x2: (LARGURA_UTIL_PT - 260) / 2 + 260,
      y2: 0,
      lineWidth: 0.7,
      lineColor: "#333333"
    }
  ]
});

export const montarPdfDoRecibo = ({
  pagamento,
  honorario,
  processo,
  cliente,
  usuario,
  totalDeParcelas,
  destinos = [],
  creditoMantido = 0,
  estornosAtivos = [],
  valorLiquido: liquido
}) => {
  registrarFontes();

  const timbrado = montarTimbrado(usuario);
  const pagador = identificarPagador(cliente);

  const valor = Number(liquido ?? pagamento.valor);
  const valorFormatado = moeda(valor);
  // O extenso vem de `numeroPorExtenso.js`, que existe e está coberto por teste
  // desde a Fase 2C. Num recibo, o extenso é o que prevalece quando diverge dos
  // algarismos — é a razão de ele estar aqui, e não enfeite.
  const valorExtenso = valorPorExtenso(valor);

  const forma = ROTULO_FORMA_PAGAMENTO[pagamento.formaPagamento] || "";

  const estornoDeclarado = fraseDeEstorno({
    valorBruto: Number(pagamento.valor),
    estornosAtivos,
    liquido: valor
  });

  // O destino do dinheiro, por extenso (DEC-041). A regra inteira mora em
  // `descreverDestino`, que é pura e testável sem montar PDF.
  const referencia = [
    honorario.descricao,
    descreverDestino({ destinos, creditoMantido, totalDeParcelas }),
    processo.numeroProcesso ? `processo nº ${processo.numeroProcesso}` : "",
    processo.titulo
  ]
    .filter(Boolean)
    .join(" — ");

  const cidadeEData = [
    usuario?.endereco?.cidade,
    dataExtenso(new Date())
  ]
    .filter(Boolean)
    .join(", ");

  const corpo = [
    { text: "RECIBO", style: "titulo" },
    { text: `${valorFormatado}`, style: "valor" },
    { text: `(${valorExtenso})`, style: "valorExtenso" },
    {
      style: "corpo",
      text:
        `Recebi de ${pagador.nome}${pagador.documento ? `, ${pagador.documento}` : ""}, ` +
        `a importância de ${valorFormatado} (${valorExtenso})${forma ? `, paga ${forma}` : ""}, ` +
        `referente a ${referencia}.`
    },
    {
      style: "corpo",
      text: `Data do pagamento: ${formatarData(pagamento.data)}.`
    },
    // A conta que leva ao número em destaque, quando houve estorno (A-3).
    // Fica ANTES das observações e da quitação: é fato do pagamento, e quem lê
    // precisa dele para entender o valor antes de ler o que ele quitou.
    ...(estornoDeclarado
      ? [{ style: "corpo", text: estornoDeclarado }]
      : []),
    ...(pagamento.observacoes
      ? [{ style: "corpo", text: `Observações: ${pagamento.observacoes}` }]
      : []),
    {
      style: "corpo",
      // Plena, parcial ou adiantamento, conforme a OBRIGAÇÃO ALCANÇADA — ver
      // `frasePeDeQuitacao` e a DEC-042. Era incondicionalmente plena até a
      // F-1a.1, e tratava sobra-em-crédito como dívida até a F-1a.2.
      text: frasePeDeQuitacao({ destinos, creditoMantido })
    },
    ...(cidadeEData ? [{ text: cidadeEData, style: "cidadeData" }] : []),
    linhaAssinatura(),
    { text: usuario?.nomeCompleto || "", style: "assinaturaNome" },
    ...(usuario?.oab?.numero && usuario?.oab?.estado
      ? [{ text: `OAB/${usuario.oab.estado} nº ${usuario.oab.numero}`, style: "assinaturaOab" }]
      : [])
  ];

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [MARGEM_PT, MARGEM_SUPERIOR_PT, MARGEM_PT, MARGEM_PT],
    header: cabecalhoPdf(timbrado),
    footer: rodapePdf(),
    defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.4 },
    styles: {
      ...ESTILOS_TIMBRADO_PDF,
      titulo: { fontSize: 18, bold: true, alignment: "center", margin: [0, 0, 0, 18] },
      valor: { fontSize: 16, bold: true, alignment: "center", margin: [0, 0, 0, 2] },
      valorExtenso: { fontSize: 10, italics: true, alignment: "center", margin: [0, 0, 0, 22] },
      corpo: { alignment: "justify", margin: [0, 0, 0, 12] },
      cidadeData: { alignment: "right", margin: [0, 22, 0, 0] },
      assinaturaNome: { alignment: "center", bold: true, margin: [0, 6, 0, 0] },
      assinaturaOab: { alignment: "center", fontSize: 9, color: "#444444" }
    },
    content: corpo,
    info: {
      title: "Recibo LEX",
      creator: timbrado.nomeAdvocacia || "LEX"
    }
  };

  return criarPdf(docDefinition).getBuffer();
};

export const emitirRecibo = async (pagamentoId, usuarioId) => {
  const dados = await carregarDadosDoRecibo(pagamentoId, usuarioId);

  const buffer = await montarPdfDoRecibo(dados);

  const pagador = identificarPagador(dados.cliente);

  return {
    buffer,
    contentType: CONTENT_TYPE_RECIBO,
    // Mesma regra do download de documento: sem acento e sem espaço.
    nomeArquivo: nomeArquivoSeguro(
      [
        "recibo",
        pagador.nome,
        new Date(dados.pagamento.data).toISOString().slice(0, 10)
      ],
      "pdf"
    )
  };
};

export default { emitirRecibo, carregarDadosDoRecibo, montarPdfDoRecibo, CONTENT_TYPE_RECIBO };
