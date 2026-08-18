import mongoose from "mongoose";
import Process from "../models/Process.js";
import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import Installment from "../models/Installment.js";
import Allocation from "../models/Allocation.js";
import Payment from "../models/Payment.js";
import Reversal from "../models/Reversal.js";
import Renegotiation from "../models/Renegotiation.js";
import Document from "../models/Document.js";
// A conta dos totais do honorário (DEC-040) mora num arquivo só desde a
// F-1b: esta ficha e a página do honorário leem dela.
import { totaisDoHonorario } from "./feeTotals.js";

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

  // A DATA de cada reparcelamento, para a parcela substituída poder dizer por
  // qual operação ela saiu. Uma consulta para o processo inteiro — a ficha não
  // pode custar uma ida ao banco por parcela cancelada.
  const reparcelamentos = await Renegotiation.find({
    honorarioId: { $in: feeIds },
    usuarioId
  }).select("data");
  const dataDoReparcelamento = new Map(
    reparcelamentos.map((r) => [String(r._id), r.data])
  );

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
      //
      // ── PISO EM ZERO (DEC-040, F-1a.1) ───────────────────────────────────
      // O motor nunca aloca mais do que a parcela comporta, então este número
      // não deveria poder ser negativo. Mas o caminho existe: `PATCH
      // /installments/:id { valor }` aceita reduzir o valor da parcela DEPOIS
      // de ela ter recebido alocação, e aí `valorPago` fica maior que `valor`.
      // Sem o piso, a parcela exibiria "em aberto −R$ 500,00" e o número
      // entraria em `aReceberNoMes` e `valorVencido` abatendo outras parcelas.
      //
      // O excedente não some por causa do piso: ele continua visível em
      // `valorPago`, que é maior que `valor` — e é ali que a advogada vê que
      // recebeu mais do que cobrou.
      emAberto: Math.max(0, emCentavos(Number(parcela.valor) - Number(parcela.valorPago || 0))),
      dataVencimento: parcela.dataVencimento,
      dataPagamento: parcela.dataPagamento,
      status: parcela.status,
      // ── O vínculo do reparcelamento (F-1a.1) ─────────────────────────────
      //
      // Sem este campo a ficha não distingue "cancelada por reparcelamento" de
      // "cancelada avulsa" — e exibia "em aberto R$ 2.250,00" numa parcela que
      // foi substituída, mostrando dívida que não existe. Não entrava em soma
      // nenhuma; o problema era só de leitura, e leitura é o que a ficha é.
      //
      // `null` quando não houve reparcelamento, nunca omitido: campo ausente e
      // campo vazio são coisas diferentes para quem monta a tela.
      reparcelamentoId: parcela.reparcelamentoId ?? null,
      // A data da operação que a substituiu, para a tela escrever a frase sem
      // buscar o reparcelamento. `null` quando não houve.
      reparceladaEm: parcela.reparcelamentoId
        ? dataDoReparcelamento.get(String(parcela.reparcelamentoId)) ?? null
        : null,
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

    // ── EM ABERTO TEM PISO ZERO; CRÉDITO É CAMPO PRÓPRIO (DEC-040) ────────
    //
    // A fórmula MUDOU DE ARQUIVO na F-1b, e não mudou de valor: ela agora mora
    // em `services/feeTotals.js`, porque a página do honorário (F-1b) precisa
    // dos mesmos quatro números e uma segunda cópia da conta divergiria da
    // primeira. O texto abaixo continua descrevendo o que aquela função faz.
    //
    //     emAberto = max(0, contratado − pagoLiquidoAlocado)
    //
    // **O `saldoAdiantado` NÃO entra nesta conta.** Ele é o crédito, e sai
    // nomeado ao lado — nunca somado dentro de recebido, nunca subtraído do
    // em aberto.
    //
    // ── A fórmula anterior estava errada, e o erro tinha direção ──────────
    // A F-1a calculava `contratado − pagoLiquidoAlocado − saldoAdiantado` e
    // aceitava resultado negativo, com o argumento de que zerar no piso
    // "esconderia dinheiro da cliente". A preocupação era certa; a execução,
    // não — o negativo PROPAGAVA para a soma do processo, e ali um crédito de
    // um honorário abatia a dívida de outro.
    //
    // Medido no smoke test de 17/08/2026: processo com contratado 10.500 e
    // recebido 7.500 exibindo em aberto 2.500, quando a cliente devia 3.000.
    // Um honorário com −500 de crédito comia 500 da dívida do vizinho. O
    // dinheiro fechava (nada sumia), mas a leitura mentia — e mentia **a favor
    // do cliente**, num módulo que imprime recibo assinado.
    //
    // Crédito é do honorário onde foi gerado. Ele aparece em
    // `saldoAdiantado`, com nome, e não como desconto silencioso em outro
    // lugar da árvore.
    const totaisDoFee = totaisDoHonorario({
      valorContratado: fee.valor,
      saldoAdiantado: fee.saldoAdiantado,
      parcelas: parcelasDoFee
    });
    const saldoAdiantado = totaisDoFee.saldoAdiantado;

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
      // `contratado`, `pago`, `pagoLiquidoAlocado`, `saldoAdiantado` e
      // `emAberto`, exatamente as chaves que a ficha publica desde a 4.1 — a
      // função é que passou a montá-las.
      totais: totaisDoFee,
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
  // ── A soma do processo é Σ DAS LINHAS, não uma fórmula própria (DEC-040) ─
  //
  // Cada `emAberto` de honorário já vem com piso zero, então somá-los é o que
  // impede o crédito de um de abater a dívida de outro. Recalcular aqui por
  // `contratado − pago` reintroduziria exatamente o defeito, porque a
  // subtração global não conhece a fronteira entre os honorários.
  //
  // É a inversão da nota que estava aqui até a F-1a ("sair da fórmula garante
  // que continue dando"): a fórmula global e a soma das linhas NÃO dão o mesmo
  // número quando há crédito, e a que descreve a dívida é a soma das linhas.
  const emAbertoDoProcesso = somar(vigentes.map((l) => l.totais), "emAberto");

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
      emAberto: emAbertoDoProcesso,
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
