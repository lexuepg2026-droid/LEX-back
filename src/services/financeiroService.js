import mongoose from "mongoose";
import Process from "../models/Process.js";
import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import Installment from "../models/Installment.js";
import Allocation from "../models/Allocation.js";
import Payment from "../models/Payment.js";
import Reversal from "../models/Reversal.js";
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

  // ── O vínculo parcela↔dinheiro virou a ALOCAÇÃO (F-1a) ──────────────────
  //
  // Até a F-0 o pagamento pertencia a uma parcela e a ficha o lia direto. Com
  // o Financeiro 2.0, um PIX pode atravessar duas parcelas, e "os pagamentos
  // desta parcela" passa a ser "as alocações ativas desta parcela, com o
  // pagamento de onde cada uma veio".
  //
  // Só alocações ATIVAS (`estornoId: null`): a desalocada é histórico do
  // extrato, não dinheiro em cima da parcela. Somá-la aqui faria a ficha
  // mostrar como recebido um valor que voltou.
  const alocacoes = await Allocation.find({
    parcelaId: { $in: parcelas.map((p) => p._id) },
    usuarioId,
    estornoId: null
  })
    .populate("pagamentoId", "valor data formaPagamento tipo observacoes")
    .sort({ data: 1, createdAt: 1 });

  const alocacoesPorParcela = new Map();
  for (const alocacao of alocacoes) {
    const chave = String(alocacao.parcelaId);
    if (!alocacoesPorParcela.has(chave)) alocacoesPorParcela.set(chave, []);
    alocacoesPorParcela.get(chave).push({
      _id: alocacao._id,
      valor: alocacao.valor,
      data: alocacao.data,
      origem: alocacao.origem,
      // O vínculo, explícito: de qual pagamento este pedaço veio. É o que a
      // tela da F-1b usa para navegar da parcela ao pagamento e vice-versa.
      pagamentoId: alocacao.pagamentoId?._id ?? alocacao.pagamentoId ?? null,
      formaPagamento: alocacao.pagamentoId?.formaPagamento ?? null,
      tipoPagamento: alocacao.pagamentoId?.tipo ?? null,
      dataPagamento: alocacao.pagamentoId?.data ?? null,
      observacoes: alocacao.pagamentoId?.observacoes ?? ""
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
      // `alocacoes` substitui `pagamentos` (F-1a). O nome mudou porque a coisa
      // mudou: não são os pagamentos da parcela, são os pedaços de pagamento
      // que encostaram nela — e um mesmo pagamento pode aparecer em duas.
      alocacoes: alocacoesPorParcela.get(String(parcela._id)) ?? []
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

    // ── A INVARIANTE DA FICHA (F-1a) ──────────────────────────────────────
    //
    //     contratado − pagoLiquidoAlocado − saldoAdiantado = emAberto
    //
    // `pagoLiquidoAlocado` é a soma das alocações ATIVAS — o dinheiro que
    // encontrou parcela e não voltou por estorno. `saldoAdiantado` é o que
    // entrou e ainda não achou destino. Os dois são dinheiro no caixa da
    // advogada; o que os separa é só ter ou não uma parcela apontada.
    //
    // Por isso os DOIS abatem o em aberto. Contar só o alocado faria um
    // honorário integralmente adiantado aparecer como devendo tudo, no dia
    // seguinte ao cliente ter pago — que é o erro que a advogada notaria
    // primeiro e confiaria menos depois.
    //
    // `emAberto` sai da FÓRMULA, e não de uma segunda soma sobre as parcelas.
    // Duas fórmulas para a mesma pergunta divergem, e esta é a mesma razão
    // pela qual `pendente` do resumo é `contratado − recebido` (Fase 4.3).
    //
    // Pode dar NEGATIVO, e é honesto: um honorário que recebeu mais do que foi
    // contratado tem crédito, e zerar no piso esconderia dinheiro da cliente.
    const pagoLiquidoAlocado = somar(parcelasDoFee, "valorPago");
    const saldoAdiantado = emCentavos(fee.saldoAdiantado || 0);

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
      // Dinheiro recebido que ainda não achou parcela. Exposto na ficha porque
      // é a única tela onde a advogada pode entender por que um honorário com
      // parcelas em aberto já está pago.
      saldoAdiantado,
      totais: {
        contratado: emCentavos(fee.valor),
        // `pago` mantém o nome que a ficha publicou na 4.1 (o frontend o lê),
        // e ganha o apelido explícito ao lado. Renomear de vez é churn de
        // contrato sem ganho; ter os dois nomes divergindo, não — saem da
        // mesma variável.
        pago: pagoLiquidoAlocado,
        pagoLiquidoAlocado,
        saldoAdiantado,
        emAberto: emCentavos(Number(fee.valor) - pagoLiquidoAlocado - saldoAdiantado)
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
  const pago = somar(vigentes.map((l) => l.totais), "pagoLiquidoAlocado");
  const saldoAdiantado = somar(vigentes.map((l) => l.totais), "saldoAdiantado");

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
      pagoLiquidoAlocado: pago,
      saldoAdiantado,
      // A mesma invariante, um nível acima. Somar os `emAberto` das linhas
      // daria o mesmo número; sair da fórmula garante que continue dando,
      // mesmo se um dia a lista de linhas ganhar recorte.
      emAberto: emCentavos(contratado - pago - saldoAdiantado),
      // Contagens: a tela mostra "3 honorários, 1 cancelado" sem recontar o
      // array — e sem errar a conta quando um dia houver recorte.
      honorarios: linhas.length,
      honorariosCancelados: linhas.length - vigentes.length
    },
    honorarios: linhas,
    geradoEm: new Date()
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGAMENTOS DO PROCESSO — `GET /api/financeiro/processos/:id/payments`
// (Fase F-1a)
//
// A lista do dinheiro que entrou neste processo, na ordem em que entrou, com
// os estornos e as alocações de cada linha já resumidos.
//
// ── Por que não é a ficha, e por que não é `GET /payments?processoId=` ────
// A ficha é a árvore da COBRANÇA e não pagina (contrato publicado na 4.1).
// `GET /payments?processoId=` existe e continua existindo, mas devolve o
// pagamento cru do módulo — sem o líquido nem o para-onde-foi. Esta rota é a
// junção das duas coisas para a aba financeira do processo, e o resumo vem do
// backend pelo mesmo motivo dos totais da ficha: a tela não faz conta.
//
// O `processoId` do `Payment` é denormalizado e escrito UMA vez, na criação
// (o pagamento é imutável desde a DEC-032) — então aqui ele é fonte confiável,
// diferente do que acontecia na F-0, quando mover a parcela de honorário o
// reescrevia.
// ═══════════════════════════════════════════════════════════════════════════
export const listarPagamentosDoProcesso = async (
  usuarioId,
  processoId,
  { page = 1, limit = 20 } = {}
) => {
  if (!mongoose.Types.ObjectId.isValid(processoId)) {
    throw createError("Identificador de processo inválido", 400);
  }

  const processo = await Process.findOne({ _id: processoId, usuarioId, ativo: true })
    .select("numeroProcesso titulo");
  if (!processo) {
    throw createError("Processo não encontrado", 404);
  }

  const filtro = { processoId: processo._id, usuarioId, ativo: true };
  const skip = (page - 1) * limit;

  const [pagamentos, total] = await Promise.all([
    Payment.find(filtro)
      .populate("honorarioId", "descricao tipo status")
      .sort({ data: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Payment.countDocuments(filtro)
  ]);

  const ids = pagamentos.map((p) => p._id);

  // Duas consultas para a página inteira, e não duas por linha: a listagem não
  // pode custar N+1 idas ao banco.
  const [estornos, alocacoes] = await Promise.all([
    Reversal.find({ pagamentoId: { $in: ids }, usuarioId }).sort({ data: 1 }),
    Allocation.find({ pagamentoId: { $in: ids }, usuarioId })
      .populate("parcelaId", "numeroParcela valor dataVencimento status")
      .sort({ data: 1 })
  ]);

  const anulados = new Set(
    estornos.filter((e) => e.estornoAnuladoId).map((e) => String(e.estornoAnuladoId))
  );

  const estornosPorPagamento = new Map();
  for (const e of estornos) {
    const chave = String(e.pagamentoId);
    if (!estornosPorPagamento.has(chave)) estornosPorPagamento.set(chave, []);
    estornosPorPagamento.get(chave).push(e);
  }

  const alocacoesPorPagamento = new Map();
  for (const a of alocacoes) {
    const chave = String(a.pagamentoId);
    if (!alocacoesPorPagamento.has(chave)) alocacoesPorPagamento.set(chave, []);
    alocacoesPorPagamento.get(chave).push(a);
  }

  const data = pagamentos.map((p) => {
    const meus = estornosPorPagamento.get(String(p._id)) ?? [];
    // Σ estornos ATIVOS — os comuns que ninguém anulou. Mesma regra de
    // `reversalService.totalEstornado`, que é quem a define.
    const estornado = emCentavos(
      meus
        .filter((e) => !e.estornoAnuladoId && !anulados.has(String(e._id)))
        .reduce((t, e) => t + Number(e.valor), 0)
    );

    const minhas = alocacoesPorPagamento.get(String(p._id)) ?? [];

    return {
      _id: p._id,
      valor: emCentavos(p.valor),
      valorLiquido: emCentavos(Number(p.valor) - estornado),
      totalEstornado: estornado,
      data: p.data,
      tipo: p.tipo,
      formaPagamento: p.formaPagamento,
      observacoes: p.observacoes ?? "",
      honorarioId: p.honorarioId?._id ?? p.honorarioId,
      descricaoHonorario: p.honorarioId?.descricao ?? null,
      estornos: meus.map((e) => ({
        _id: e._id,
        valor: e.valor,
        motivo: e.motivo,
        data: e.data,
        tipo: e.tipo,
        estornoAnuladoId: e.estornoAnuladoId,
        anulado: anulados.has(String(e._id))
      })),
      alocacoes: minhas.map((a) => ({
        _id: a._id,
        valor: a.valor,
        data: a.data,
        origem: a.origem,
        parcelaId: a.parcelaId?._id ?? a.parcelaId,
        numeroParcela: a.parcelaId?.numeroParcela ?? null,
        dataVencimento: a.parcelaId?.dataVencimento ?? null,
        estornoId: a.estornoId,
        ativa: a.estornoId === null
      }))
    };
  });

  return {
    processo: {
      _id: processo._id,
      numeroProcesso: processo.numeroProcesso,
      titulo: processo.titulo
    },
    data,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
};

export default { montarFichaFinanceira, listarPagamentosDoProcesso };
