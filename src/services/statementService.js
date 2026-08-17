import mongoose from "mongoose";
import Fee from "../models/Fee.js";
import Installment from "../models/Installment.js";
import Payment from "../models/Payment.js";
import Reversal from "../models/Reversal.js";
import Allocation from "../models/Allocation.js";
import Renegotiation from "../models/Renegotiation.js";
import { emCentavos } from "./allocationService.js";

// ═══════════════════════════════════════════════════════════════════════════
// EXTRATO DO HONORÁRIO — `GET /api/fees/:id/statement` (Fase F-1a)
//
// A linha do tempo do dinheiro de UMA cobrança: o que entrou, o que voltou,
// para onde foi, o que saiu de lá, quando o plano foi refeito e quando o
// status mudou — tudo numa lista só, ordenada por data.
//
// ── Agregado por LEITURA. Nenhuma coleção de log nova ─────────────────────
// Cada evento é derivado de um registro que já existe e que já é imutável:
// `Payment`, `Reversal`, `Allocation`, `Renegotiation` e o `historicoStatus`
// do próprio `Fee`. Uma coleção de eventos separada seria uma SEGUNDA fonte da
// verdade sobre os mesmos fatos, livre para divergir no dia em que alguém
// gravasse num lugar e esquecesse do outro — e um extrato que discorda da
// ficha é pior que extrato nenhum, porque parece autoridade.
//
// O custo é seis consultas por leitura, todas por índice e todas escopadas a um
// honorário. É uma tela de detalhe, não uma listagem de milhares.
//
// ── Os vínculos são explícitos em cada linha ──────────────────────────────
// Estorno traz o pagamento que ele desfaz; alocação traz o par
// pagamento↔parcela; desalocação traz os dois MAIS o estorno que a causou. É a
// informação que a advogada precisa para responder "por que esta parcela
// voltou a dever" sem abrir outras três telas — e é ela que a F-1b desenha.
//
// ── Ordenação estável ─────────────────────────────────────────────────────
// Por data, e em empate por `id`, que é único e determinístico. Sem o segundo
// critério, dois eventos do mesmo dia trocariam de lugar entre requisições — e
// a paginação passaria a repetir e a pular linhas, que é exatamente o defeito
// que o teste de invariante nº 11 procura.
// ═══════════════════════════════════════════════════════════════════════════

const erro = (status, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = status;
  Object.assign(error, extra);
  return error;
};

const validarObjectId = (id, campo) => {
  if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
    throw erro(400, `${campo} inválido`, { campo });
  }
};

// Vocabulário FECHADO de tipo de evento. Existe pelo mesmo motivo de
// `DEPENDENCIA` nos 409 (Fase 2E.1): sem lista, em duas fases existiriam
// `desalocacao`, `desalocação` e `alocacaoDesfeita` como valores possíveis, e
// a tela voltaria a chutar.
export const TIPO_EVENTO = Object.freeze({
  PAGAMENTO: "pagamento",
  ESTORNO: "estorno",
  ANULACAO_ESTORNO: "anulacaoEstorno",
  ALOCACAO: "alocacao",
  DESALOCACAO: "desalocacao",
  REPARCELAMENTO: "reparcelamento",
  MUDANCA_STATUS: "mudancaStatus"
});

export const montarExtrato = async (honorarioId, usuarioId, { page = 1, limit = 20 } = {}) => {
  validarObjectId(honorarioId, "honorarioId");

  const fee = await Fee.findOne({ _id: honorarioId, usuarioId, ativo: true });
  if (!fee) throw erro(404, "Honorário não encontrado");

  const [pagamentos, estornos, alocacoes, reparcelamentos, parcelas] = await Promise.all([
    Payment.find({ honorarioId: fee._id, usuarioId, ativo: true }).sort({ data: 1 }),
    Reversal.find({ honorarioId: fee._id, usuarioId }).sort({ data: 1 }),
    Allocation.find({ honorarioId: fee._id, usuarioId }).sort({ data: 1 }),
    Renegotiation.find({ honorarioId: fee._id, usuarioId }).sort({ data: 1 }),
    Installment.find({ feeId: fee._id, usuarioId }).select("numeroParcela valor dataVencimento status")
  ]);

  const parcelaPorId = new Map(parcelas.map((p) => [String(p._id), p]));
  const pagamentoPorId = new Map(pagamentos.map((p) => [String(p._id), p]));
  const estornoPorId = new Map(estornos.map((e) => [String(e._id), e]));

  const resumoParcela = (parcelaId) => {
    const p = parcelaPorId.get(String(parcelaId));
    return p
      ? {
          parcelaId: p._id,
          numeroParcela: p.numeroParcela,
          valorParcela: emCentavos(p.valor),
          dataVencimento: p.dataVencimento
        }
      : { parcelaId: parcelaId ?? null, numeroParcela: null, valorParcela: null, dataVencimento: null };
  };

  const eventos = [];

  // ── 1. Entradas de dinheiro ───────────────────────────────────────────────
  for (const p of pagamentos) {
    eventos.push({
      id: `pagamento:${p._id}`,
      tipo: TIPO_EVENTO.PAGAMENTO,
      data: p.data,
      valor: emCentavos(p.valor),
      descricao: `Pagamento de ${moeda(p.valor)}`,
      pagamentoId: p._id,
      formaPagamento: p.formaPagamento,
      tipoPagamento: p.tipo,
      observacoes: p.observacoes || ""
    });
  }

  // ── 2. Estornos e anulações, com o vínculo ────────────────────────────────
  //
  // Os dois saem da mesma coleção e viram tipos DIFERENTES no extrato: um
  // estorno tira dinheiro, uma anulação devolve. Chamá-los pelo mesmo nome
  // faria a advogada somar na direção errada ao ler a coluna.
  const anulados = new Set(
    estornos.filter((e) => e.estornoAnuladoId).map((e) => String(e.estornoAnuladoId))
  );

  for (const e of estornos) {
    const ehAnulacao = Boolean(e.estornoAnuladoId);
    const alvo = ehAnulacao ? estornoPorId.get(String(e.estornoAnuladoId)) : null;

    eventos.push({
      id: `estorno:${e._id}`,
      tipo: ehAnulacao ? TIPO_EVENTO.ANULACAO_ESTORNO : TIPO_EVENTO.ESTORNO,
      data: e.data,
      valor: emCentavos(e.valor),
      descricao: ehAnulacao
        ? `Anulação de estorno de ${moeda(e.valor)}`
        : `Estorno de ${moeda(e.valor)}`,
      motivo: e.motivo,
      estornoId: e._id,
      // O pagamento que este estorno desfaz — o vínculo que a tela navega.
      pagamentoId: e.pagamentoId,
      valorPagamento: emCentavos(pagamentoPorId.get(String(e.pagamentoId))?.valor ?? 0),
      // Só na anulação: qual estorno foi desfeito.
      estornoAnuladoId: e.estornoAnuladoId ?? null,
      valorEstornoAnulado: alvo ? emCentavos(alvo.valor) : null,
      // Um estorno que já foi anulado não conta mais no líquido. A tela precisa
      // saber para não exibi-lo como débito vivo.
      anulado: anulados.has(String(e._id))
    });
  }

  // ── 3. Alocações e desalocações ───────────────────────────────────────────
  //
  // Cada alocação pode gerar DUAS linhas: o dia em que o dinheiro encontrou a
  // parcela, e — se um estorno a desfez — o dia em que saiu. São dois fatos
  // com datas diferentes, e mesclá-los num só apagaria o intervalo em que a
  // parcela esteve quitada.
  for (const a of alocacoes) {
    const parcela = resumoParcela(a.parcelaId);

    eventos.push({
      id: `alocacao:${a._id}`,
      tipo: TIPO_EVENTO.ALOCACAO,
      data: a.data,
      valor: emCentavos(a.valor),
      descricao:
        a.origem === "saldoAdiantado"
          ? `${moeda(a.valor)} de saldo adiantado alocados na parcela ${parcela.numeroParcela ?? "?"}`
          : `${moeda(a.valor)} alocados na parcela ${parcela.numeroParcela ?? "?"}`,
      origem: a.origem,
      // O par pagamento↔parcela, explícito, nos dois sentidos.
      pagamentoId: a.pagamentoId ?? null,
      ...parcela,
      alocacaoId: a._id,
      ativa: a.estornoId === null
    });

    if (a.estornoId) {
      eventos.push({
        id: `desalocacao:${a._id}`,
        tipo: TIPO_EVENTO.DESALOCACAO,
        data: a.desalocadoEm ?? a.data,
        valor: emCentavos(a.valor),
        descricao: `${moeda(a.valor)} desalocados da parcela ${parcela.numeroParcela ?? "?"}`,
        origem: a.origem,
        pagamentoId: a.pagamentoId ?? null,
        ...parcela,
        alocacaoId: a._id,
        // O estorno que causou esta saída — a terceira ponta do vínculo, e a
        // que responde "por que esta parcela voltou a dever".
        estornoId: a.estornoId,
        motivo: estornoPorId.get(String(a.estornoId))?.motivo ?? null,
        ativa: false
      });
    }
  }

  // ── 4. Reparcelamentos ────────────────────────────────────────────────────
  for (const r of reparcelamentos) {
    eventos.push({
      id: `reparcelamento:${r._id}`,
      tipo: TIPO_EVENTO.REPARCELAMENTO,
      data: r.data,
      valor: emCentavos(r.saldoRenegociado),
      descricao:
        `Reparcelamento: ${r.parcelasCanceladas.length} parcela(s) cancelada(s), ` +
        `${r.parcelasNovas.length} nova(s), saldo de ${moeda(r.saldoRenegociado)}`,
      motivo: r.motivo ?? null,
      reparcelamentoId: r._id,
      // O snapshot, para a tela mostrar o que saiu sem ir buscar parcela por
      // parcela — e para continuar legível quando o `valorPago` delas mudar.
      parcelasCanceladas: r.parcelasCanceladas.map((p) => ({
        parcelaId: p.parcelaId,
        numeroParcela: p.numeroParcela,
        valor: p.valor,
        emAberto: p.emAberto,
        statusAnterior: p.statusAnterior
      })),
      parcelasNovas: r.parcelasNovas.map((id) => resumoParcela(id))
    });
  }

  // ── 5. Mudanças de status do honorário ────────────────────────────────────
  //
  // Vêm do `historicoStatus` append-only do próprio `Fee` (DEC-038). O índice
  // entra no id porque duas transições podem cair no mesmo instante — e id
  // repetido quebraria a paginação.
  (fee.historicoStatus ?? []).forEach((h, i) => {
    eventos.push({
      id: `status:${fee._id}:${i}`,
      tipo: TIPO_EVENTO.MUDANCA_STATUS,
      data: h.data,
      valor: null,
      descricao: h.de
        ? `Status do honorário: ${h.de} → ${h.para}`
        : `Honorário criado como ${h.para}`,
      de: h.de ?? null,
      para: h.para,
      origemStatus: h.origem
    });
  });

  // ── Ordenação e paginação ─────────────────────────────────────────────────
  eventos.sort((a, b) => {
    const dif = new Date(a.data).getTime() - new Date(b.data).getTime();
    if (dif !== 0) return dif;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const total = eventos.length;
  const skip = (page - 1) * limit;

  return {
    honorario: {
      _id: fee._id,
      descricao: fee.descricao,
      valor: emCentavos(fee.valor),
      tipo: fee.tipo,
      status: fee.status,
      saldoAdiantado: emCentavos(fee.saldoAdiantado || 0),
      processoId: fee.processoId
    },
    // Envelope padrão de listagem (regra central nº 4): o extrato É uma
    // listagem, diferente da ficha financeira — que é UM processo com uma
    // árvore embaixo e por isso ficou de fora do envelope na 4.1.
    data: eventos.slice(skip, skip + limit),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
};

// Formatação de moeda para a PROSA da linha, não para o número — o número sai
// cru em `valor`, e é ele que a tela formata. A frase existe porque o extrato
// é lido, e "1500" no meio de uma sentença não se lê.
const moeda = (n) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;

export default { montarExtrato, TIPO_EVENTO };
