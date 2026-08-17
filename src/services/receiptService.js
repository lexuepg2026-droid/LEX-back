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
    // As parcelas que ESTE pagamento cobriu, ativas. Ordenadas por número para
    // o recibo dizer "parcelas 2 e 3" na ordem em que a advogada as emitiu.
    Allocation.find({ pagamentoId: pagamento._id, usuarioId, estornoId: null })
      .populate("parcelaId", "numeroParcela")
      .sort({ data: 1 })
  ]);

  if (!usuario) {
    throw createError("Usuário não encontrado", 404);
  }

  const numerosDeParcela = [
    ...new Set(
      alocacoes
        .map((a) => a.parcelaId?.numeroParcela)
        .filter((n) => n !== undefined && n !== null)
    )
  ].sort((a, b) => a - b);

  return {
    pagamento,
    honorario,
    processo,
    cliente,
    usuario,
    totalDeParcelas,
    numerosDeParcela,
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
  numerosDeParcela = [],
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

  const referencia = [
    honorario.descricao,
    // Um pagamento pode cobrir DUAS parcelas, ou nenhuma (adiantamento). A
    // frase acompanha o fato em vez de fingir que sempre há uma só.
    numerosDeParcela.length === 0
      ? (totalDeParcelas > 0 ? "adiantamento" : "pagamento único")
      : numerosDeParcela.length === 1
        ? `parcela ${numerosDeParcela[0]} de ${totalDeParcelas}`
        : `parcelas ${numerosDeParcela.slice(0, -1).join(", ")} e ` +
          `${numerosDeParcela[numerosDeParcela.length - 1]} de ${totalDeParcelas}`,
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
    ...(pagamento.observacoes
      ? [{ style: "corpo", text: `Observações: ${pagamento.observacoes}` }]
      : []),
    {
      style: "corpo",
      text:
        "Para clareza e como prova, firmo o presente recibo, dando plena e geral " +
        "quitação do valor acima em relação à obrigação a que se refere."
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
