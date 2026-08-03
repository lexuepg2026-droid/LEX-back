import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import Installment from "../models/Installment.js";
import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import { REGRA_CONFLITO } from "../config/integrityConflicts.js";
import { validateUpdatePayment } from "../validations/paymentValidation.js";
import { checarUpdate } from "../validations/shared/camposPermitidos.js";
import { filtroObjectId } from "../utils/filtrosDeConsulta.js";

const criarErro = (statusCode, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

const validarObjectId = (id, nomeCampo) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw criarErro(400, `${nomeCampo} inválido`);
  }
};

const validarInstallmentDoUsuario = async (installmentId, usuarioId) => {
  validarObjectId(installmentId, "installmentId");

  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId,
    ativo: true
  });

  if (!installment) {
    throw criarErro(404, "Parcela não encontrada");
  }

  return installment;
};

const calcularTotalPagoExcluindo = async (installmentId, usuarioId, excludePaymentId = null) => {
  const filtro = { installmentId, usuarioId, ativo: true };
  if (excludePaymentId) filtro._id = { $ne: excludePaymentId };
  const pagamentos = await Payment.find(filtro);
  return pagamentos.reduce((acc, p) => acc + Number(p.valorPago), 0);
};

const validarOverpayment = async (installment, novoValorPago, usuarioId, excludePaymentId = null) => {
  const totalExistente = await calcularTotalPagoExcluindo(installment._id, usuarioId, excludePaymentId);
  if (totalExistente + novoValorPago > installment.valor) {
    const saldo = installment.valor - totalExistente;
    const saldoFormatado = saldo.toFixed(2).replace(".", ",");
    // Não é contagem de dependente: `dependencia`/`quantidade` não descreveriam
    // nada aqui. As chaves descrevem a regra — `saldoDisponivel` é o número que
    // a tela precisa para oferecer "pagar o saldo" sem extrair "R$ 1.234,56" da
    // prosa por regex.
    // Este 409, ao contrário dos de integridade, TEM input em conflito: é o
    // valor que ela acabou de digitar. Por isso leva `campo` também.
    throw criarErro(409, `Pagamento excede o valor da parcela. Saldo disponível: R$ ${saldoFormatado}`, {
      campo: "valorPago",
      regra: REGRA_CONFLITO.PAGAMENTO_EXCEDE_PARCELA,
      saldoDisponivel: Number(saldo.toFixed(2)),
      valorParcela: Number(installment.valor)
    });
  }
};

const definirStatusInstallment = (installment, totalPago) => {
  if (totalPago >= installment.valor) return "pago";
  if (totalPago > 0) return "parcial";

  const hoje = new Date();
  if (new Date(installment.dataVencimento) < hoje) return "vencido";

  return "pendente";
};

// ═══════════════════════════════════════════════════════════════════════════
// DEC-028 — STATUS DO HONORÁRIO DERIVADO DAS PARCELAS (Fase 4.1)
//
// Antes desta fase `Fee.status` só mudava por escrita explícita, e a Fase 2E.2
// deixou um teste travando esse comportamento. O teste foi INVERTIDO, no mesmo
// arquivo, para o histórico do Git mostrar a transição deliberada.
//
// O recálculo se pendura na MESMA cadeia que já recalcula a parcela — pagamento
// gravado ou desativado → recalcula a parcela → recalcula o honorário. Não há
// caminho paralelo: `recalcularStatusInstallment` chama este daqui no fim, e
// quem mexe em pagamento já chamava aquele.
// ═══════════════════════════════════════════════════════════════════════════

// Honorário SEM parcela nenhuma é `pendente`, nunca `pago`.
//
// A Fase 2C decidiu que, para as variáveis de template, honorário sem parcela
// vale como pagamento único — uma parcela do valor cheio. A leitura aqui é a
// mesma, levada até o fim: essa parcela única existe e NÃO foi paga, porque
// pagamento pendura em parcela e não há nenhuma. Chamar de `pago` um honorário
// que nunca recebeu um centavo seria o pior erro possível neste módulo.
//
// A conta é feita sobre `Installment.status`, que `definirStatusInstallment`
// acima já derivou — e não sobre uma segunda soma de pagamentos. `pago` é
// exatamente "totalPago >= valor" e `parcial` é exatamente
// "0 < totalPago < valor": recomputar daria duas fórmulas para a mesma
// pergunta, livres para divergir.
const derivarStatusFee = (parcelas) => {
  if (parcelas.length === 0) return "pendente";

  const quitadas = parcelas.filter((p) => p.status === "pago");
  if (quitadas.length === parcelas.length) return "pago";

  const comPagamento = parcelas.filter((p) => p.status === "pago" || p.status === "parcial");
  if (comPagamento.length > 0) return "parcialmente_pago";

  return "pendente";
};

export const recalcularStatusFee = async (feeId, usuarioId) => {
  if (!feeId) return null;

  const fee = await Fee.findOne({ _id: feeId, usuarioId, ativo: true });
  if (!fee) return null;

  // ── GUARDA: `cancelado` NUNCA é sobrescrito pelo recálculo ───────────────
  // Escrita explícita, e só. Honorário cancelado não vira "pago" porque alguém
  // quitou uma parcela antiga — a cobrança foi desfeita, e o dinheiro que
  // entrou depois é outro assunto.
  //
  // Isto é um `return` próprio, e NÃO a ordem dos `if` de `derivarStatusFee`:
  // efeito colateral de ordenação some na primeira vez que alguém reordena as
  // condições "para ficar mais legível", e some em silêncio.
  if (fee.status === STATUS_CANCELADO) return fee;

  const parcelas = await Installment.find({
    feeId: fee._id,
    usuarioId,
    ativo: true
  }).select("status");

  const novoStatus = derivarStatusFee(parcelas);

  if (fee.status !== novoStatus) {
    fee.status = novoStatus;
    await fee.save();
  }

  return fee;
};

// ═══════════════════════════════════════════════════════════════════════════
// O HONORÁRIO MENTIROSO (achado 2.5b — corrigido na Fase 4.5)
//
// A busca da parcela exigia `ativo: true`. Desativada a parcela, esta função
// devolvia `null` na primeira linha e a cadeia MORRIA ali: `recalcularStatusFee`
// no fim nunca era alcançado, e o honorário ficava com o status derivado de um
// mundo que não existe mais — tipicamente `pago`, com o pagamento removido.
//
// A correção é na CAUSA: para fins de RECÁLCULO a parcela é carregada sem o
// filtro de `ativo`. Recalcular é leitura de fato consumado; o filtro ali não
// protegia nada, só escondia a parcela de si mesma.
//
// As GUARDAS DE ESCRITA continuam: só parcela ATIVA tem os campos derivados
// regravados. Regravar status e `valorPago` de uma parcela desativada seria
// ressuscitá-la pela metade, e `derivarStatusFee` já a exclui do conjunto do
// honorário (ele filtra `ativo: true`, corretamente).
//
// O honorário é recalculado nos DOIS casos — é esse o ponto do achado.
// ═══════════════════════════════════════════════════════════════════════════
export const recalcularStatusInstallment = async (installmentId, usuarioId) => {
  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId
  });

  if (!installment) return null;

  // Parcela desativada: nada a regravar nela, mas o honorário acima precisa
  // saber que o conjunto mudou.
  if (installment.ativo !== true) {
    await recalcularStatusFee(installment.feeId, usuarioId);
    return null;
  }

  const pagamentos = await Payment.find({
    installmentId,
    usuarioId,
    ativo: true
  }).sort({ dataPagamento: -1, createdAt: -1 });

  const totalPago = pagamentos.reduce(
    (total, payment) => total + Number(payment.valorPago),
    0
  );

  const statusFinal = definirStatusInstallment(installment, totalPago);

  installment.status = statusFinal;
  // Soma dos pagamentos ATIVOS, desnormalizada (Fase 4.1). Este é o ÚNICO
  // ponto de escrita do campo. Arredondada em centavos na gravação para a soma
  // de floats não deixar 0,30000000000000004 na ficha financeira.
  installment.valorPago = Math.round(totalPago * 100) / 100;
  installment.dataPagamento =
    statusFinal === "pago" && pagamentos.length > 0
      ? pagamentos[0].dataPagamento
      : null;

  await installment.save();

  // A cadeia continua para cima: parcela recalculada → honorário recalculado.
  await recalcularStatusFee(installment.feeId, usuarioId);

  return installment;
};

export const create = async (data, usuarioId) => {
  const installment = await validarInstallmentDoUsuario(data.installmentId, usuarioId);

  await validarOverpayment(installment, Number(data.valorPago), usuarioId);

  const novoPagamento = await Payment.create({
    usuarioId,
    installmentId: installment._id,
    processoId: installment.processoId,
    valorPago: Number(data.valorPago),
    dataPagamento: new Date(data.dataPagamento),
    formaPagamento: data.formaPagamento,
    observacoes: data.observacoes?.trim() || "",
    ativo: data.ativo !== undefined ? data.ativo : true
  });

  await recalcularStatusInstallment(installment._id, usuarioId);

  return Payment.findById(novoPagamento._id).populate("installmentId");
};

const PAYMENT_POPULATE = {
  path: "installmentId",
  populate: {
    path: "feeId",
    select: "descricao processoId",
    populate: { path: "processoId", select: "titulo numeroProcesso" }
  }
};

export const findAll = async (usuarioId, { page = 1, limit = 20, installmentId, processoId, formaPagamento, inativos } = {}) => {
  // ── `?inativos=true` — a listagem do desativado (Fase 4.5) ────────────────
  //
  // Existe para a tela poder oferecer "Reativar". Sem ela, o registro
  // desativado é invisível na interface e a rota de reativação só seria
  // alcançável por curl — a funcionalidade existiria sem porta de entrada.
  //
  // É um MODO, não um "incluir": `?inativos=true` lista SÓ os desativados. Um
  // parâmetro que misturasse os dois conjuntos mudaria o significado da
  // listagem padrão conforme uma caixa de seleção, e as somas da tela passariam
  // a incluir o que foi removido sem nada dizendo isso na linha.
  //
  // O default não muda: sem o parâmetro, `ativo: true`, como sempre.
  const somenteInativos = inativos === true || inativos === "true";
  const filter = { usuarioId, ativo: !somenteInativos };
  if (formaPagamento && typeof formaPagamento === 'string') filter.formaPagamento = formaPagamento;

  if (processoId) {
    if (!mongoose.Types.ObjectId.isValid(processoId)) {
      return { data: [], total: 0, page: 1, limit: 0, totalPages: 1 };
    }
    filter.processoId = processoId;
    const data = await Payment.find(filter).populate(PAYMENT_POPULATE).sort({ createdAt: -1 });
    return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
  }

  // Guarda de tipo (Fase 4.5): só ObjectId em string entra na query.
  const installmentFiltro = filtroObjectId(installmentId);
  if (installmentFiltro) filter.installmentId = installmentFiltro;
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Payment.find(filter).populate(PAYMENT_POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Payment.countDocuments(filter)
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const findById = async (id, usuarioId) => {
  validarObjectId(id, "paymentId");

  const payment = await Payment.findOne({
    _id: id,
    usuarioId,
    ativo: true
  }).populate("installmentId");

  if (!payment) throw criarErro(404, "Pagamento não encontrado");

  return payment;
};

export const update = async (id, data, usuarioId) => {
  // Allowlist da Fase 4.5. `payments` era o unico modulo em que `ativo` no
  // corpo NAO era descuido: estava em `CAMPOS_PERMITIDOS_UPDATE` e era
  // aplicado por uma linha explicita. Mudanca de contrato consciente.
  const recusado = checarUpdate("payments", data);
  if (recusado) {
    throw criarErro(400, recusado.mensagem, recusado.campo ? { campo: recusado.campo } : {});
  }

  validarObjectId(id, "paymentId");

  // A validação de payload veio do controller nesta fase. Estava lá desde a
  // Fase 1 e era o único módulo financeiro fora da convenção do projeto
  // ("validação sempre no service, nunca no controller" — sessão de 09/05).
  // Rodando antes do service, ela engolia a recusa da allowlist: `ativo` deixou
  // de ser campo conhecido, `camposValidosEnviados` ficava vazio, e a resposta
  // era "Informe ao menos um campo válido" — sem `campo` e sem dizer o que
  // estava errado.
  const errosDePayload = validateUpdatePayment(data);
  if (errosDePayload.length > 0) {
    throw criarErro(400, errosDePayload[0], { errors: errosDePayload });
  }

  const payment = await Payment.findOne({ _id: id, usuarioId, ativo: true });

  if (!payment) throw criarErro(404, "Pagamento não encontrado");

  const installmentOriginalId = payment.installmentId.toString();

  let targetInstallment = null;
  if (data.installmentId !== undefined) {
    targetInstallment = await validarInstallmentDoUsuario(data.installmentId, usuarioId);
    payment.installmentId = targetInstallment._id;
    payment.processoId = targetInstallment.processoId;
  }

  if (data.valorPago !== undefined) payment.valorPago = Number(data.valorPago);
  if (data.dataPagamento !== undefined) payment.dataPagamento = new Date(data.dataPagamento);
  if (data.formaPagamento !== undefined) payment.formaPagamento = data.formaPagamento;
  if (data.observacoes !== undefined) payment.observacoes = data.observacoes?.trim() || "";
  // `data.ativo` era aplicado aqui até a Fase 4.5. Removido junto com a entrada
  // na allowlist: desativar é o DELETE, reativar é `PATCH /:id/reativar`.

  if (!targetInstallment) {
    targetInstallment = await Installment.findOne({
      _id: payment.installmentId,
      usuarioId,
      ativo: true
    });
  }

  if (targetInstallment) {
    await validarOverpayment(targetInstallment, payment.valorPago, usuarioId, id);
  }

  await payment.save();

  await recalcularStatusInstallment(installmentOriginalId, usuarioId);

  if (payment.installmentId.toString() !== installmentOriginalId) {
    await recalcularStatusInstallment(payment.installmentId.toString(), usuarioId);
  }

  return Payment.findById(payment._id).populate("installmentId");
};

// ═══════════════════════════════════════════════════════════════════════════
// REATIVAÇÃO DE PAGAMENTO (achado 2.2c — Fase 4.5)
//
// Rota deliberada, e não `PATCH { ativo: true }`: reativar tem guarda de
// integridade PRÓPRIA, e um campo no corpo de um update genérico não tem onde
// pendurá-la. Foi exatamente por não existir este caminho que o `ativo` no
// corpo parecia necessário.
//
// A guarda: um pagamento só volta se a PARCELA dele estiver ativa. Sem isso o
// pagamento reapareceria pendurado numa parcela que não existe mais para o
// sistema, e `recalcularStatusInstallment` o ignoraria para sempre — dinheiro
// registrado que não conta em lugar nenhum.
//
// O excedente é reconferido: enquanto o pagamento estava fora, outros podem ter
// ocupado o saldo. Reativar sem checar estouraria o valor da parcela por um
// caminho que o 409 de `create`/`update` nunca vê.
// ═══════════════════════════════════════════════════════════════════════════
export const reativar = async (id, usuarioId) => {
  validarObjectId(id, "paymentId");

  const payment = await Payment.findOne({ _id: id, usuarioId });
  if (!payment) throw criarErro(404, "Pagamento não encontrado");

  if (payment.ativo === true) {
    return Payment.findById(payment._id).populate("installmentId");
  }

  const installment = await Installment.findOne({
    _id: payment.installmentId,
    usuarioId,
    ativo: true
  });

  if (!installment) {
    throw criarErro(
      409,
      "Não é possível reativar este pagamento: a parcela dele está desativada. " +
      "Reative a parcela antes.",
      { dependencia: "parcela" }
    );
  }

  await validarOverpayment(installment, Number(payment.valorPago), usuarioId, payment._id);

  payment.ativo = true;
  await payment.save();

  await recalcularStatusInstallment(payment.installmentId.toString(), usuarioId);

  return Payment.findById(payment._id).populate("installmentId");
};

export const remove = async (id, usuarioId) => {
  validarObjectId(id, "paymentId");

  const payment = await Payment.findOne({ _id: id, usuarioId, ativo: true });

  if (!payment) throw criarErro(404, "Pagamento não encontrado");

  payment.ativo = false;
  await payment.save();

  await recalcularStatusInstallment(payment.installmentId.toString(), usuarioId);

  return { message: "Pagamento removido com sucesso" };
};

export default { create, findAll, findById, update, reativar, remove };
