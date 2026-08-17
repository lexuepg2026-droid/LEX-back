import mongoose from "mongoose";
import Client from "../models/Client.js";
import Process from "../models/Process.js";
import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import Installment from "../models/Installment.js";
import Document from "../models/Document.js";
import Payment from "../models/Payment.js";
import { contarNaoVistas } from "./confirmacaoService.js";

const toCountMap = (arr) =>
  arr.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

// Mesma função de `financeiroService.js`, pelo mesmo motivo: soma de float
// acumula resíduo, e resíduo num painel financeiro é a advogada lendo
// "em aberto: R$ 0,00000000001".
const emCentavos = (n) => Math.round(Number(n || 0) * 100) / 100;

const somar = (itens, campo) =>
  emCentavos(itens.reduce((acc, item) => acc + Number(item[campo] || 0), 0));

// Quantas parcelas o resumo mostra em "próximos vencimentos". Cinco cabem no
// cartão sem virar segunda listagem: quem precisa da lista inteira abre
// `/parcelas`, que já existe e é paginada.
const PROXIMOS_VENCIMENTOS = 5;

export const getSummary = async (usuarioId) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [
    processosAtivos,
    clientesCadastrados,
    honorariosAReceber,
    parcelasVencidas,
    documentosCadastrados,
    pagamentosResult,
    // Contador de confirmações de visualização não vistas (Fase 3.1).
    //
    // Entra AQUI, no resumo que já existe, e não em rota nova: é mais um
    // número do mesmo painel, sai da mesma consulta paralela, e uma rota
    // própria obrigaria a tela a fazer duas chamadas para desenhar um cabeçalho.
    // Apoiado pelo índice { usuarioId, vistaPelaAdvogada }.
    //
    // A consulta vem de `confirmacaoService.contarNaoVistas` desde a Fase F-0.
    // Estava escrita à mão aqui, idêntica à função que já existia e que a
    // auditoria de retomada encontrou SEM NENHUMA referência — as duas únicas
    // ocorrências de `contarNaoVistas` no repositório eram a definição e o
    // `export default`. Duas fórmulas para a mesma pergunta divergem; o dia em
    // que "não vista" ganhar uma condição a mais, só uma delas saberia.
    confirmacoesNaoVistas
  ] = await Promise.all([
    Process.countDocuments({ usuarioId, status: "ativo", ativo: true }),
    Client.countDocuments({ usuarioId, ativo: true }),
    Fee.countDocuments({ usuarioId, status: "pendente", ativo: true }),
    Installment.countDocuments({ usuarioId, status: "vencido", ativo: true }),
    Document.countDocuments({ usuarioId, ativo: true }),
    Payment.aggregate([
      {
        $match: {
          usuarioId,
          ativo: true,
          dataPagamento: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$valorPago" }
        }
      }
    ]),
    contarNaoVistas(usuarioId)
  ]);

  return {
    processosAtivos,
    clientesCadastrados,
    honorariosAReceber,
    parcelasVencidas,
    documentosCadastrados,
    pagamentosRecebidosMes: pagamentosResult[0]?.total ?? 0,
    confirmacoesNaoVistas
  };
};

export const getStatusCounts = async (usuarioId) => {
  const groupByStatus = { _id: "$status", count: { $sum: 1 } };

  const [processResults, feeResults, installmentResults] = await Promise.all([
    Process.aggregate([
      { $match: { usuarioId, ativo: true } },
      { $group: groupByStatus }
    ]),
    Fee.aggregate([
      { $match: { usuarioId, ativo: true } },
      { $group: groupByStatus }
    ]),
    Installment.aggregate([
      { $match: { usuarioId, ativo: true } },
      { $group: groupByStatus }
    ])
  ]);

  return {
    processos:  toCountMap(processResults),
    honorarios: toCountMap(feeResults),
    parcelas:   toCountMap(installmentResults)
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// RESUMO FINANCEIRO GLOBAL — `GET /api/financeiro/resumo`
//
// A Fase 4.3 fecha a promessa da DEC-028(d): além dos três acumulados que já
// existiam, o resumo passa a expor o recorte do MÊS (a receber e recebido), o
// VALOR total vencido (havia só a contagem) e os próximos vencimentos.
//
// ── A cadeia é filtrada como a da ficha, e esse é o ponto ────────────────────
// A ficha financeira do processo (Fase 4.1) é o contrato publicado. O resumo é
// o mesmo dinheiro visto de cima, e portanto:
//
//   Process   ativo: true
//     └ Fee   ativo: true  E  status ≠ cancelado
//        └ Installment  ativo: true
//           └ Payment   ativo: true
//
// **Como estava antes desta fase, os dois números não fechavam.** O resumo
// somava honorário cancelado em `valorContratado`, somava os pagamentos das
// parcelas dele em `recebido`, e somava honorário de processo desativado — que
// nenhuma ficha mostra, porque a ficha de processo desativado responde 404. A
// advogada podia abrir as dez fichas, somar na calculadora e não chegar ao
// número do painel. Quem se ajustou foi o resumo: a ficha não muda.
//
// ── `pendente` é `contratado − recebido`, e não a soma dos saldos ───────────
// A ficha calcula o em aberto de cada honorário como `fee.valor − pago`, e não
// como a soma do que falta nas parcelas. A diferença aparece no honorário que
// ainda não foi parcelado por inteiro: 3.000 contratados com uma parcela de
// 1.000 emitida têm 3.000 em aberto na ficha e teriam 1.000 aqui. Duas
// fórmulas para a mesma pergunta divergem — e a que vale é a publicada.
//
// ── `recebidoNoMes` sai de Payment, não de Installment ─────────────────────
// `Installment.dataPagamento` é a data em que a parcela FECHOU. Um pagamento
// de julho numa parcela vencida em maio precisa contar em julho, que é quando
// o dinheiro entrou — é disso que a advogada precisa para saber o que recebeu
// no mês. Por isso a fonte é `Payment.dataPagamento`, sempre restrita às
// parcelas da cadeia acima.
// ═══════════════════════════════════════════════════════════════════════════
export const getFinanceiroResumo = async (usuarioId) => {
  const uid = new mongoose.Types.ObjectId(usuarioId);

  // ── As fronteiras do mês são em UTC, e isso é deliberado ──────────────────
  // `dataVencimento` e `dataPagamento` são datas SEM hora: chegam como
  // `"2026-08-31"` e o Mongoose as grava em meia-noite UTC. O frontend as
  // renderiza com `timeZone: "UTC"` (`utils/formatters.js`), justamente para
  // não exibir 30/08 numa parcela gravada como 31.
  //
  // Recortar o mês no fuso LOCAL do servidor jogaria a parcela de 01/09 para
  // dentro de agosto num servidor a oeste de Greenwich — e a advogada leria,
  // no cartão "A receber em agosto", uma linha datada de setembro. O recorte
  // segue o mesmo fuso em que o dado foi gravado e é exibido.
  const agora = new Date();
  const ano = agora.getUTCFullYear();
  const mes = agora.getUTCMonth();

  const inicioDoMes = new Date(Date.UTC(ano, mes, 1));
  const fimDoMes = new Date(Date.UTC(ano, mes + 1, 0, 23, 59, 59, 999));
  // Meia-noite de hoje: uma parcela que vence HOJE ainda é próximo
  // vencimento, e comparar com o instante atual a jogaria para o passado ao
  // meio-dia.
  const hoje = new Date(Date.UTC(ano, mes, agora.getUTCDate()));

  // `"2026-07"`. Vai na resposta para a tela rotular os cartões sem adivinhar
  // o mês: sem ele o frontend teria de recalcular o recorte por conta própria,
  // e "A receber em julho" com o número de agosto é pior do que rótulo nenhum.
  const mesReferencia = `${ano}-${String(mes + 1).padStart(2, "0")}`;

  // ── 1. Processos ativos ───────────────────────────────────────────────────
  const processos = await Process.find({ usuarioId: uid, ativo: true })
    .select("numeroProcesso");
  const processoIds = processos.map((p) => p._id);
  const numeroPorProcesso = new Map(
    processos.map((p) => [String(p._id), p.numeroProcesso ?? null])
  );

  // ── 2. Honorários vigentes desses processos ───────────────────────────────
  // `cancelado` fica fora de TUDO: contratado, recebido, em aberto, vencido e
  // próximos vencimentos. A cobrança foi desfeita.
  const honorarios = await Fee.find({
    usuarioId: uid,
    ativo: true,
    status: { $ne: STATUS_CANCELADO },
    processoId: { $in: processoIds }
  }).select("valor descricao processoId");

  const feeIds = honorarios.map((f) => f._id);
  const honorarioPorId = new Map(honorarios.map((f) => [String(f._id), f]));

  // ── 3. Parcelas desses honorários ─────────────────────────────────────────
  const parcelas = await Installment.find({
    usuarioId: uid,
    ativo: true,
    feeId: { $in: feeIds }
  }).select("feeId numeroParcela valor valorPago dataVencimento status");

  const linhas = parcelas.map((parcela) => {
    const fee = honorarioPorId.get(String(parcela.feeId));
    const processoId = fee?.processoId ?? null;
    return {
      _id: parcela._id,
      // `descricaoHonorario` e não `descricao`: a tela lista PARCELAS, e o
      // nome que a advogada reconhece é o da cobrança de origem.
      descricaoHonorario: fee?.descricao ?? null,
      numeroParcela: parcela.numeroParcela,
      valor: parcela.valor,
      valorPago: parcela.valorPago ?? 0,
      emAberto: emCentavos(Number(parcela.valor) - Number(parcela.valorPago || 0)),
      dataVencimento: parcela.dataVencimento,
      status: parcela.status,
      // Vem do HONORÁRIO, e não do `processoId` desnormalizado da parcela,
      // pelo mesmo motivo da ficha: mover a parcela de honorário reescreve
      // aquele campo, e a resposta dependeria de a reescrita nunca ter falhado.
      processoId,
      numeroProcesso: processoId ? numeroPorProcesso.get(String(processoId)) ?? null : null
    };
  });

  // ── 4. Pagamentos do mês, pela data em que o dinheiro entrou ──────────────
  const recebidoNoMesRes = await Payment.aggregate([
    {
      $match: {
        usuarioId: uid,
        ativo: true,
        installmentId: { $in: parcelas.map((p) => p._id) },
        dataPagamento: { $gte: inicioDoMes, $lte: fimDoMes }
      }
    },
    { $group: { _id: null, total: { $sum: "$valorPago" } } }
  ]);

  const contratado = somar(honorarios, "valor");
  const recebido = somar(parcelas, "valorPago");

  const noMes = linhas.filter(
    (l) => l.dataVencimento >= inicioDoMes && l.dataVencimento <= fimDoMes
  );
  const vencidasLinhas = linhas.filter((l) => l.status === "vencido");

  const proximosVencimentos = linhas
    .filter((l) => l.emAberto > 0 && l.dataVencimento >= hoje)
    .sort((a, b) => a.dataVencimento - b.dataVencimento || a.numeroParcela - b.numeroParcela)
    .slice(0, PROXIMOS_VENCIMENTOS);

  return {
    // Os três acumulados que a Fase 4.2 já consome. Os nomes não mudam —
    // mudou o que entra na conta, para fecharem com as fichas.
    valorContratado: contratado,
    recebido,
    pendente: emCentavos(contratado - recebido),
    // Contagem de parcelas vencidas, como sempre. Agora acompanhada do valor.
    vencidas: vencidasLinhas.length,

    // ── DEC-028(d) ──────────────────────────────────────────────────────────
    mesReferencia,
    aReceberNoMes: somar(noMes, "emAberto"),
    recebidoNoMes: emCentavos(recebidoNoMesRes[0]?.total ?? 0),
    valorVencido: somar(vencidasLinhas, "emAberto"),
    proximosVencimentos
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// HONORÁRIOS CONTRATADOS POR MÊS — `GET /api/dashboard/honorarios-por-mes`
//
// Soma `Fee.valor` agrupando por `createdAt`: é o valor CONTRATADO, pelo mês em
// que a cobrança foi cadastrada. Não é recebimento — quem responde isso é
// `recebidoNoMes`, no resumo financeiro.
//
// **Honorário `cancelado` fica de fora (Fase 4.4).** Era um achado reportado e
// não corrigido na 4.3: o gráfico somava o cancelado enquanto o
// `valorContratado` do resumo passou a excluí-lo, e o título da barra dizia
// "Honorários contratados". Os dois números falavam do mesmo assunto, na mesma
// tela, e não fechavam — a advogada podia ler no cartão um contratado menor do
// que a soma das barras logo abaixo.
//
// A regra é a mesma da DEC-028 e da ficha da 4.1: a cobrança foi desfeita, e
// somá-la faria ela ler como contratado um valor que ela mesma cancelou.
// ═══════════════════════════════════════════════════════════════════════════
export const getFeesByMonth = async (usuarioId) => {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const results = await Fee.aggregate([
    {
      $match: {
        usuarioId,
        ativo: true,
        status: { $ne: STATUS_CANCELADO },
        createdAt: { $gte: sixMonthsAgo }
      }
    },
    {
      $group: {
        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
        total: { $sum: "$valor" }
      }
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } }
  ]);

  return results.map(({ _id, total }) => ({
    mes: `${_id.year}-${String(_id.month).padStart(2, "0")}`,
    total
  }));
};
