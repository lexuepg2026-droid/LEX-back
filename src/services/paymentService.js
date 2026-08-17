import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import Installment from "../models/Installment.js";
import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import Allocation from "../models/Allocation.js";
import { checarUpdate } from "../validations/shared/camposPermitidos.js";
import { filtroTexto, filtroObjectIdExigido } from "../utils/filtrosDeConsulta.js";
import { validateCreatePayment } from "../validations/paymentValidation.js";
import { registrarStatus, ORIGEM_STATUS } from "./statusHistory.js";
import {
  alocarPagamento,
  autoAlocarSaldo,
  planejarAlocacao,
  listarAlocaveis,
  mapaDeAlocado,
  emCentavos
} from "./allocationService.js";
import { carregarEstornos, totalEstornado } from "./reversalService.js";

// ═══════════════════════════════════════════════════════════════════════════
// PAGAMENTO — reescrito na Fase F-1 sobre o modelo imutável
//
// O que saiu daqui, e para onde foi:
//   • `update` de valor/data/parcela  → morreu (DEC-032). Estorno é o caminho.
//   • `reativar`                      → morreu (DEC-034). Anulação de estorno.
//   • `remove`                        → morreu (DEC-032). Estorno.
//   • guarda de excedente por parcela → virou o motor de alocação (DEC-035).
//     Não existe mais "pagamento maior que a parcela": existe pagamento que
//     atravessa parcelas e, no fim, vira saldo adiantado.
//
// O que ficou: a cadeia de recálculo da 4.1, que continua sendo o ponto único
// de escrita de `Installment.valorPago` e `Fee.status`. Mudou a FONTE do
// número — antes somava pagamentos da parcela, agora soma alocações ativas.
// ═══════════════════════════════════════════════════════════════════════════

const criarErro = (statusCode, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

const validarObjectId = (id, campo) => {
  if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
    throw criarErro(400, `${campo} inválido`, { campo });
  }
};

const PAYMENT_POPULATE = {
  path: "honorarioId",
  select: "descricao valor tipo status processoId",
  populate: { path: "processoId", select: "titulo numeroProcesso" }
};

// ═══════════════════════════════════════════════════════════════════════════
// RECÁLCULO — a cadeia da 4.1, agora sobre alocações
// ═══════════════════════════════════════════════════════════════════════════

// Status derivado da parcela. Inalterado desde a 4.1, exceto por `cancelado`:
// parcela cancelada por reparcelamento não é derivada — o estado dela é
// decisão registrada, não conta.
const definirStatusInstallment = (installment, totalAlocado) => {
  if (installment.status === "cancelado") return "cancelado";
  if (totalAlocado >= installment.valor) return "pago";
  if (totalAlocado > 0) return "parcial";

  const hoje = new Date();
  if (new Date(installment.dataVencimento) < hoje) return "vencido";

  return "pendente";
};

// Honorário SEM parcela nenhuma é `pendente`, nunca `pago` — a leitura da
// Fase 2C levada até o fim: a parcela única implícita existe e não foi paga.
//
// Parcelas `cancelado` ficam fora do conjunto: um honorário cujas parcelas
// foram todas reparceladas não é "pago", é o que as parcelas NOVAS disserem.
const derivarStatusFee = (parcelas) => {
  const vigentes = parcelas.filter((p) => p.status !== "cancelado");
  if (vigentes.length === 0) return "pendente";

  const quitadas = vigentes.filter((p) => p.status === "pago");
  if (quitadas.length === vigentes.length) return "pago";

  const comPagamento = vigentes.filter((p) => p.status === "pago" || p.status === "parcial");
  if (comPagamento.length > 0) return "parcialmente_pago";

  return "pendente";
};

export const recalcularStatusFee = async (feeId, usuarioId, origem = ORIGEM_STATUS.RECALCULO) => {
  if (!feeId) return null;

  const fee = await Fee.findOne({ _id: feeId, usuarioId, ativo: true });
  if (!fee) return null;

  // ── GUARDA: `cancelado` NUNCA é sobrescrito pelo recálculo (DEC-028) ─────
  // `return` próprio, e não ordem de `if`: efeito colateral de ordenação some
  // na primeira vez que alguém reorganiza as condições "para ficar mais
  // legível", e some em silêncio. Preservada intacta na F-1.
  if (fee.status === STATUS_CANCELADO) return fee;

  const parcelas = await Installment.find({
    feeId: fee._id,
    usuarioId,
    ativo: true
  }).select("status");

  if (registrarStatus(fee, derivarStatusFee(parcelas), origem)) {
    await fee.save();
  }

  return fee;
};

// Recalcula uma parcela a partir das ALOCAÇÕES ativas dela.
//
// A parcela é carregada SEM o filtro de `ativo` de propósito (correção da
// 4.5): recalcular é leitura de fato consumado, e o filtro só escondia a
// parcela de si mesma, matando a cadeia antes de o honorário ser recalculado.
// `origem` viaja pela cadeia desde a F-1a. O recálculo em si é sempre o mesmo
// cálculo; o que muda é QUEM o disparou, e é isso que o `historicoStatus`
// precisa registrar (DEC-038). Sem o parâmetro, um reparcelamento apareceria no
// histórico como derivação normal — e a advogada perderia justamente a
// distinção entre "o sistema derivou" e "alguém decidiu".
export const recalcularStatusInstallment = async (
  installmentId,
  usuarioId,
  origem = ORIGEM_STATUS.RECALCULO
) => {
  const installment = await Installment.findOne({ _id: installmentId, usuarioId });
  if (!installment) return null;

  if (installment.ativo !== true) {
    await recalcularStatusFee(installment.feeId, usuarioId, origem);
    return null;
  }

  const alocacoes = await Allocation.find({
    parcelaId: installmentId,
    usuarioId,
    estornoId: null
  }).sort({ data: -1, createdAt: -1 });

  const totalAlocado = emCentavos(alocacoes.reduce((t, a) => t + Number(a.valor), 0));

  installment.status = definirStatusInstallment(installment, totalAlocado);
  installment.valorPago = totalAlocado;
  installment.dataPagamento =
    installment.status === "pago" && alocacoes.length > 0 ? alocacoes[0].data : null;

  await installment.save();

  await recalcularStatusFee(installment.feeId, usuarioId, origem);

  return installment;
};

// Recalcula tudo o que uma operação tocou. Uma parcela por vez, porque o
// recálculo do honorário no fim de cada uma é idempotente e barato — e porque
// tentar recalcular em lote reintroduziria uma segunda fórmula.
export const recalcularParcelas = async (
  parcelaIds,
  usuarioId,
  origem = ORIGEM_STATUS.RECALCULO
) => {
  for (const id of new Set(parcelaIds.map(String))) {
    await recalcularStatusInstallment(id, usuarioId, origem);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// CRIAÇÃO — nasce contra o honorário e aloca no ato
// ═══════════════════════════════════════════════════════════════════════════

const carregarFeeParaPagamento = async (honorarioId, usuarioId) => {
  const fee = await Fee.findOne({ _id: honorarioId, usuarioId, ativo: true });

  if (!fee) {
    throw criarErro(404, "Honorário não encontrado");
  }

  // Honorário cancelado não recebe dinheiro: a cobrança foi desfeita, e
  // registrar pagamento contra ela deixaria um valor recebido pendurado numa
  // dívida que não existe. A mensagem diz o que fazer — descancelar é escrita
  // explícita e a derivação volta a valer (DEC-028).
  if (fee.status === STATUS_CANCELADO) {
    throw criarErro(
      409,
      "Este honorário está cancelado e não recebe pagamento. " +
        "Se a cobrança voltou a valer, mude o status do honorário antes de registrar o pagamento.",
      { regra: "honorarioCancelado" }
    );
  }

  return fee;
};

// Preview: o que ACONTECERIA. Mesma função de planejamento que a criação usa —
// é isso que impede o preview de mentir.
export const preverAlocacao = async (dados, usuarioId) => {
  validarObjectId(String(dados.honorarioId ?? ""), "honorarioId");
  const fee = await carregarFeeParaPagamento(dados.honorarioId, usuarioId);

  const valor = Number(dados.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw criarErro(400, "O valor do pagamento deve ser maior que zero", { campo: "valor" });
  }

  // Sem ramo por tipo: desde a F-1a `adiantamento` e `comum` passam pelo MESMO
  // planejamento (ver o cabeçalho de `alocarPagamento`). Um `if` aqui faria o
  // preview divergir da criação no exato caso em que ele mais importa.
  const parcelas = await listarAlocaveis(fee._id, usuarioId);
  const alocado = await mapaDeAlocado(fee._id, usuarioId);
  const { destinos, sobra } = planejarAlocacao(valor, parcelas, alocado);

  return {
    honorarioId: fee._id,
    tipo: dados.tipo === "adiantamento" ? "adiantamento" : "comum",
    destinos,
    sobra,
    saldoAdiantadoAtual: emCentavos(fee.saldoAdiantado || 0),
    saldoAdiantadoDepois: emCentavos(Number(fee.saldoAdiantado || 0) + sobra)
  };
};

export const create = async (data, usuarioId) => {
  const validacao = validateCreatePayment(data);
  if (!validacao.isValid) {
    throw criarErro(400, validacao.errors.join("; "), {
      errors: [...validacao.errors],
      ...(validacao.campos.length === 1 ? { campo: validacao.campos[0] } : {})
    });
  }

  const fee = await carregarFeeParaPagamento(data.honorarioId, usuarioId);

  const [pagamento] = await Payment.create([
    {
      usuarioId,
      honorarioId: fee._id,
      processoId: fee.processoId,
      valor: emCentavos(data.valor),
      data: new Date(data.data),
      tipo: data.tipo || "comum",
      formaPagamento: data.formaPagamento,
      observacoes: data.observacoes?.trim() || ""
    }
  ]);

  const { alocacoes, sobra } = await alocarPagamento({ pagamento, fee, usuarioId });

  await recalcularParcelas(
    alocacoes.map((a) => a.parcelaId),
    usuarioId
  );

  const feeAtual = await Fee.findById(fee._id);

  return {
    pagamento: await Payment.findById(pagamento._id).populate(PAYMENT_POPULATE),
    alocacoes,
    sobra,
    saldoAdiantado: emCentavos(feeAtual?.saldoAdiantado || 0)
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// LEITURA
// ═══════════════════════════════════════════════════════════════════════════

// `?installmentId=` continua existindo e continua em inglês (convenção de
// rota), mas agora filtra POR ALOCAÇÃO: "pagamentos que tocaram esta parcela".
// É a mesma pergunta de antes; o que mudou é que a resposta pode incluir um
// pagamento que também tocou outras.
const idsDePagamentoPorParcela = async (parcelaId, usuarioId) => {
  const alocacoes = await Allocation.find({
    parcelaId,
    usuarioId,
    estornoId: null
  }).select("pagamentoId");
  return alocacoes.map((a) => a.pagamentoId);
};

export const findAll = async (
  usuarioId,
  { page = 1, limit = 20, installmentId, honorarioId, processoId, formaPagamento, tipo } = {}
) => {
  const filter = { usuarioId, ativo: true };

  const formaFiltro = filtroTexto(formaPagamento);
  if (formaFiltro) filter.formaPagamento = formaFiltro;

  const tipoFiltro = filtroTexto(tipo);
  if (tipoFiltro) filter.tipo = tipoFiltro;

  const processoFiltro = filtroObjectIdExigido(processoId, "processoId");
  if (processoFiltro) filter.processoId = processoFiltro;

  const honorarioFiltro = filtroObjectIdExigido(honorarioId, "honorarioId");
  if (honorarioFiltro) filter.honorarioId = honorarioFiltro;

  const parcelaFiltro = filtroObjectIdExigido(installmentId, "installmentId");
  if (parcelaFiltro) {
    filter._id = { $in: await idsDePagamentoPorParcela(parcelaFiltro, usuarioId) };
  }

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Payment.find(filter).populate(PAYMENT_POPULATE).sort({ data: -1, createdAt: -1 }).skip(skip).limit(limit),
    Payment.countDocuments(filter)
  ]);

  // Cada linha vem com o líquido e as alocações resumidas: a listagem precisa
  // mostrar quanto do pagamento ainda vale, e sem isso a tela faria N chamadas.
  const enriquecidos = await Promise.all(data.map((p) => comEstornosEAlocacoes(p, usuarioId)));

  return { data: enriquecidos, total, page, limit, totalPages: Math.ceil(total / limit) };
};

// Monta a visão de um pagamento com o que a tela precisa para decidir o que
// oferecer: líquido restante (o default do estorno) e para onde o dinheiro foi.
export const comEstornosEAlocacoes = async (pagamento, usuarioId) => {
  const estornos = await carregarEstornos(pagamento._id, usuarioId);
  const estornado = totalEstornado(estornos);

  const alocacoes = await Allocation.find({ pagamentoId: pagamento._id, usuarioId })
    .populate("parcelaId", "numeroParcela valor dataVencimento status")
    .sort({ data: 1 });

  const bruto = pagamento.toObject ? pagamento.toObject() : pagamento;

  return {
    ...bruto,
    valorLiquido: emCentavos(Number(pagamento.valor) - estornado),
    totalEstornado: estornado,
    estornos: estornos.map((e) => ({
      _id: e.doc._id,
      valor: e.doc.valor,
      motivo: e.doc.motivo,
      data: e.doc.data,
      tipo: e.doc.tipo,
      estornoAnuladoId: e.doc.estornoAnuladoId,
      anulado: e.anulado
    })),
    alocacoes: alocacoes.map((a) => ({
      _id: a._id,
      parcelaId: a.parcelaId?._id ?? a.parcelaId,
      numeroParcela: a.parcelaId?.numeroParcela ?? null,
      dataVencimento: a.parcelaId?.dataVencimento ?? null,
      valor: a.valor,
      data: a.data,
      origem: a.origem,
      estornoId: a.estornoId,
      desalocadoEm: a.desalocadoEm,
      ativa: a.estornoId === null
    }))
  };
};

export const findById = async (id, usuarioId) => {
  validarObjectId(id, "paymentId");

  const payment = await Payment.findOne({ _id: id, usuarioId, ativo: true }).populate(
    PAYMENT_POPULATE
  );
  if (!payment) throw criarErro(404, "Pagamento não encontrado");

  return comEstornosEAlocacoes(payment, usuarioId);
};

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE — um campo só (DEC-032)
// ═══════════════════════════════════════════════════════════════════════════
export const update = async (id, data, usuarioId) => {
  // A allowlist de `payments` encolheu para `["observacoes"]` na F-1. Qualquer
  // outro campo cai aqui com 400 e `campo` — inclusive `valor` e `data`, que
  // eram editáveis até a F-0. Corrigir dinheiro é estornar, não reescrever.
  const recusado = checarUpdate("payments", data);
  if (recusado) {
    throw criarErro(400, recusado.mensagem, recusado.campo ? { campo: recusado.campo } : {});
  }

  validarObjectId(id, "paymentId");

  const payment = await Payment.findOne({ _id: id, usuarioId, ativo: true });
  if (!payment) throw criarErro(404, "Pagamento não encontrado");

  if (data.observacoes !== undefined) {
    payment.observacoes = data.observacoes === null ? "" : String(data.observacoes).trim();
  }

  await payment.save();

  return comEstornosEAlocacoes(
    await Payment.findById(payment._id).populate(PAYMENT_POPULATE),
    usuarioId
  );
};

export default {
  create,
  preverAlocacao,
  findAll,
  findById,
  update,
  recalcularStatusInstallment,
  recalcularStatusFee,
  recalcularParcelas,
  autoAlocarSaldo
};
