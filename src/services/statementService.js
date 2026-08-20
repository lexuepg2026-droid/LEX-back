import mongoose from "mongoose";
import Fee from "../models/Fee.js";
import Installment from "../models/Installment.js";
import Payment from "../models/Payment.js";
import Reversal from "../models/Reversal.js";
import Allocation from "../models/Allocation.js";
import Renegotiation from "../models/Renegotiation.js";
import { emCentavos } from "./allocationService.js";
import { moeda } from "../utils/templateFormatters.js";

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
// ── DEC-044: toda linha que deixou de valer diz que deixou de valer ───────
// Uma alocação desfeita por desalocação continuava na lista com exatamente a
// mesma cara de uma alocação viva. No caso real — estorno de R$ 1.000,00 sobre
// um pagamento de R$ 4.500,00, anulado em seguida — isso deixava quatro linhas
// de alocação somando R$ 6.000,00 para um pagamento de R$ 4.500,00. A conta do
// sistema estava certa; a LEITURA é que não fechava.
//
// A linha da alocação passa a carregar `desfeitaEm`, `estornoQueDesfezId` e
// `valorEstornoQueDesfez`; a substituta de estorno parcial carrega
// `substituiAlocacaoId` e `estornoQueGerouId`; a desalocação carrega
// `estornoAnulado`. Nenhum deles é conta nova — são vínculos que já existiam
// nos registros e que o extrato não estava expondo.
//
// `dataPagamento` é a correção de uma AFIRMAÇÃO ERRADA: a alocação nascida de
// uma anulação grava `data` = data da anulação, e a frase da tela ("Do
// pagamento de {data}") usava essa data. O extrato passa a expor a data real
// do pagamento ao lado do `pagamentoId`, e a tela nomeia os dois.
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
    // A data do PAGAMENTO, e não a da alocação. São coisas diferentes: uma
    // alocação nascida de anulação carrega a data da anulação, e a frase "do
    // pagamento de ${data da alocação}" afirmava, nesse caso, uma data em que
    // pagamento nenhum aconteceu. Ver o cabeçalho da DEC-044.
    const pagamentoDaLinha = pagamentoPorId.get(String(a.pagamentoId)) ?? null;
    const dataPagamento = pagamentoDaLinha?.data ?? null;
    // ── DEC-045: o vínculo se lê por VALOR e FORMA ─────────────────────────
    //
    // A frase da alocação nomeava o pagamento por data + sufixo curto do id.
    // Os seis últimos hex de um ObjectId são o CONTADOR, que incrementa de 1
    // em 1: dois pagamentos criados em sequência saem `#e66b7a` e `#e66b7c` —
    // diferem no último caractere. Não colidem (a suíte prova), e ninguém casa
    // isso de relance.
    //
    // O que a advogada reconhece de um pagamento é quanto foi e por onde
    // entrou. Os dois campos já existiam no documento; o que faltava era o
    // extrato carregá-los na linha da ALOCAÇÃO, que é onde o vínculo é escrito
    // — a linha do próprio pagamento já os tinha.
    const valorPagamentoDaLinha = pagamentoDaLinha ? emCentavos(pagamentoDaLinha.valor) : null;
    const formaPagamentoDaLinha = pagamentoDaLinha?.formaPagamento ?? null;
    const estornoQueDesfez = a.estornoId ? estornoPorId.get(String(a.estornoId)) : null;
    const estornoQueGerou = a.estornoOrigemId
      ? estornoPorId.get(String(a.estornoOrigemId))
      : null;

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
      dataPagamento,
      // DEC-045: como a frase do vínculo nomeia o pagamento. `null` quando o
      // dinheiro veio de saldo adiantado e não há pagamento por trás — a tela
      // escreve "de saldo adiantado" nesse caso, e um valor inventado ali
      // afirmaria um pagamento que não existe.
      valorPagamento: valorPagamentoDaLinha,
      formaPagamento: formaPagamentoDaLinha,
      ...parcela,
      alocacaoId: a._id,
      ativa: a.estornoId === null,
      // ── DEC-044: a linha que deixou de valer diz que deixou de valer ─────
      //
      // `ativa: false` já existia e é booleano puro — a tela sabia QUE a
      // alocação foi desfeita e não tinha como dizer QUANDO nem POR QUÊ. Sem
      // isso, o extrato do caso real (estorno de R$ 1.000,00 sobre um
      // pagamento de R$ 4.500,00, depois anulado) exibia quatro alocações
      // somando R$ 6.000,00, todas com a mesma cara.
      desfeitaEm: a.desalocadoEm ?? null,
      estornoQueDesfezId: a.estornoId ?? null,
      valorEstornoQueDesfez: estornoQueDesfez ? emCentavos(estornoQueDesfez.valor) : null,
      // A substituta de estorno parcial (DEC-035): de qual alocação ela é o
      // resto, e qual estorno a produziu.
      substituiAlocacaoId: a.substituiAlocacaoId ?? null,
      estornoQueGerouId: a.estornoOrigemId ?? null,
      valorEstornoQueGerou: estornoQueGerou ? emCentavos(estornoQueGerou.valor) : null
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
        dataPagamento,
        // DEC-045, pelo mesmo motivo: a desalocação também nomeia o pagamento.
        valorPagamento: valorPagamentoDaLinha,
        formaPagamento: formaPagamentoDaLinha,
        ...parcela,
        alocacaoId: a._id,
        // O estorno que causou esta saída — a terceira ponta do vínculo, e a
        // que responde "por que esta parcela voltou a dever".
        estornoId: a.estornoId,
        motivo: estornoQueDesfez?.motivo ?? null,
        // Se ESSE estorno foi anulado depois, a saída de dinheiro que esta
        // linha registra já foi compensada — e quem lê precisa saber, ou
        // subtrai duas vezes. Simetria com o `anulado` da linha do estorno.
        estornoAnulado: anulados.has(String(a.estornoId)),
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

// A formatação de moeda da PROSA vem de `utils/templateFormatters.js`, que é o
// formatador do projeto desde a Fase 2C. O número sai cru em `valor`, e é ele
// que a tela formata; a frase existe porque o extrato é lido, e "1500" no meio
// de uma sentença não se lê.

export default { montarExtrato, TIPO_EVENTO };
