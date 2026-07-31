import mongoose from "mongoose";
import Process from "../models/Process.js";
import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import Installment from "../models/Installment.js";
import Payment from "../models/Payment.js";
import Document from "../models/Document.js";

// ═══════════════════════════════════════════════════════════════════════════
// FICHA FINANCEIRA DO PROCESSO (Fase 4.1)
//
// Leitura consolidada: honorários do processo, com as parcelas de cada um, os
// pagamentos de cada parcela, e os totais já calculados.
//
// ── Por que a resposta NÃO usa o envelope de listagem ─────────────────────
// A regra vigente desde a Fase 2E.2 é que `{ data, total, page, limit,
// totalPages }` é contrato de LISTAGEM, e não de resposta em geral. Aqui não há
// listagem: há UM processo, com uma árvore embaixo e três totais em cima.
// `page` e `limit` não descreveriam nada — a ficha não é paginável, porque
// paginar honorário partiria o total ao meio e a advogada leria "recebido" de
// meia ficha. Mesmo raciocínio que deixou `PATCH /documents/:id/secoes/
// reordenar` devolvendo array cru.
//
// A resposta é um OBJETO com quatro chaves de primeiro nível: `processo`,
// `totais`, `honorarios` e `geradoEm`. Registrado no CLAUDE.md.
//
// ── Os totais são calculados aqui ────────────────────────────────────────
// A tela não faz conta. Somar no frontend significaria somar o que foi baixado
// — e no dia em que a ficha ganhar recorte, o total seria do recorte e não do
// processo, sem ninguém perceber.
// ═══════════════════════════════════════════════════════════════════════════

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Centavos: soma de float acumula resíduo, e resíduo numa ficha financeira é a
// advogada vendo "em aberto: R$ 0,00000000001".
const emCentavos = (n) => Math.round(Number(n || 0) * 100) / 100;

const somar = (itens, campo) =>
  emCentavos(itens.reduce((acc, item) => acc + Number(item[campo] || 0), 0));

export const montarFichaFinanceira = async (usuarioId, processoId) => {
  if (!mongoose.Types.ObjectId.isValid(processoId)) {
    throw createError("Identificador de processo inválido", 400);
  }

  // Filtrado por `usuarioId`, como tudo. Processo de outra usuária responde
  // 404, e não 403: quem não é dona não fica sabendo que o registro existe.
  const processo = await Process.findOne({ _id: processoId, usuarioId, ativo: true })
    .select("numeroProcesso titulo status tipoAcao");

  if (!processo) {
    throw createError("Processo não encontrado", 404);
  }

  const honorarios = await Fee.find({ processoId: processo._id, usuarioId, ativo: true })
    .sort({ dataVencimento: 1, createdAt: 1 });

  const feeIds = honorarios.map((f) => f._id);

  // Consultas por conjunto, e não N+1 por honorário: a ficha é uma tela só e
  // não pode custar uma ida ao banco por parcela.
  const [parcelas, documentos] = await Promise.all([
    Installment.find({ feeId: { $in: feeIds }, usuarioId, ativo: true })
      .sort({ numeroParcela: 1 }),
    // Primeiro consumidor real do índice `documents.honorarioId_1`, que a
    // auditoria da Fase 2E.1 listou como criado e nunca consultado. A ficha
    // responde "de qual cobrança saiu esta peça", que é a pergunta pela qual o
    // índice foi criado.
    Document.find({
      honorarioId: { $in: feeIds },
      usuarioId,
      ativo: true,
      ehModelo: false
    }).select("nome tipo dataGeracao honorarioId")
  ]);

  // Os pagamentos saem por `installmentId`, que é o vínculo real, e não pelo
  // `processoId` desnormalizado que o Payment também carrega: mudar a parcela
  // de honorário reescreve aquele campo, e uma ficha montada sobre ele
  // dependeria de a reescrita nunca ter falhado.
  const pagamentos = await Payment.find({
    installmentId: { $in: parcelas.map((p) => p._id) },
    usuarioId,
    ativo: true
  }).sort({ dataPagamento: 1, createdAt: 1 });

  const pagamentosPorParcela = new Map();
  for (const pagamento of pagamentos) {
    const chave = String(pagamento.installmentId);
    if (!pagamentosPorParcela.has(chave)) pagamentosPorParcela.set(chave, []);
    pagamentosPorParcela.get(chave).push({
      _id: pagamento._id,
      valorPago: pagamento.valorPago,
      dataPagamento: pagamento.dataPagamento,
      formaPagamento: pagamento.formaPagamento,
      observacoes: pagamento.observacoes
    });
  }

  const parcelasPorHonorario = new Map();
  for (const parcela of parcelas) {
    const chave = String(parcela.feeId);
    if (!parcelasPorHonorario.has(chave)) parcelasPorHonorario.set(chave, []);
    parcelasPorHonorario.get(chave).push({
      _id: parcela._id,
      numeroParcela: parcela.numeroParcela,
      valor: parcela.valor,
      valorPago: parcela.valorPago,
      // Quanto falta nesta parcela. Sai calculado pelo mesmo motivo dos
      // totais: é a coluna que a tela mais quer e a que ela mais erraria.
      emAberto: emCentavos(Number(parcela.valor) - Number(parcela.valorPago || 0)),
      dataVencimento: parcela.dataVencimento,
      dataPagamento: parcela.dataPagamento,
      status: parcela.status,
      pagamentos: pagamentosPorParcela.get(String(parcela._id)) ?? []
    });
  }

  const documentosPorHonorario = new Map();
  for (const documento of documentos) {
    const chave = String(documento.honorarioId);
    if (!documentosPorHonorario.has(chave)) documentosPorHonorario.set(chave, []);
    documentosPorHonorario.get(chave).push({
      _id: documento._id,
      nome: documento.nome,
      tipo: documento.tipo,
      dataGeracao: documento.dataGeracao
    });
  }

  const linhas = honorarios.map((fee) => {
    const parcelasDoFee = parcelasPorHonorario.get(String(fee._id)) ?? [];
    const pagoNoFee = somar(parcelasDoFee, "valorPago");

    return {
      _id: fee._id,
      descricao: fee.descricao,
      tipo: fee.tipo,
      valor: fee.valor,
      // `percentual` e `valorBase` só existem no tipo percentual; nos demais
      // saem como `null`, e não omitidos: campo ausente e campo vazio são
      // coisas diferentes para quem monta a tela.
      percentual: fee.percentual ?? null,
      valorBase: fee.valorBase ?? null,
      status: fee.status,
      dataVencimento: fee.dataVencimento,
      totais: {
        contratado: emCentavos(fee.valor),
        pago: pagoNoFee,
        emAberto: emCentavos(Number(fee.valor) - pagoNoFee)
      },
      parcelas: parcelasDoFee,
      documentos: documentosPorHonorario.get(String(fee._id)) ?? []
    };
  });

  // ── Totais do processo ───────────────────────────────────────────────────
  // Honorário CANCELADO fica fora de `contratado`: a cobrança foi desfeita, e
  // somá-la faria a advogada ler como devido um valor que ela mesma cancelou.
  // Ele continua na lista de `honorarios`, com o status à vista — sumir da
  // ficha seria pior, porque some junto o histórico.
  const vigentes = linhas.filter((linha) => linha.status !== STATUS_CANCELADO);

  const contratado = somar(vigentes.map((l) => l.totais), "contratado");
  const pago = somar(vigentes.map((l) => l.totais), "pago");

  return {
    processo: {
      _id: processo._id,
      numeroProcesso: processo.numeroProcesso,
      titulo: processo.titulo,
      status: processo.status,
      tipoAcao: processo.tipoAcao
    },
    totais: {
      contratado,
      pago,
      emAberto: emCentavos(contratado - pago),
      // Contagens: a tela mostra "3 honorários, 1 cancelado" sem recontar o
      // array — e sem errar a conta quando um dia houver recorte.
      honorarios: linhas.length,
      honorariosCancelados: linhas.length - vigentes.length
    },
    honorarios: linhas,
    geradoEm: new Date()
  };
};

export default { montarFichaFinanceira };
