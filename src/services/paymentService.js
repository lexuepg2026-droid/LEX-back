import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import Installment from "../models/Installment.js";
import Fee from "../models/Fee.js";

const criarErro = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
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
    throw criarErro(409, `Pagamento excede o valor da parcela. Saldo disponível: R$ ${saldoFormatado}`);
  }
};

const definirStatusInstallment = (installment, totalPago) => {
  if (totalPago >= installment.valor) return "pago";
  if (totalPago > 0) return "parcial";

  const hoje = new Date();
  if (new Date(installment.dataVencimento) < hoje) return "vencido";

  return "pendente";
};

export const recalcularStatusInstallment = async (installmentId, usuarioId) => {
  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId,
    ativo: true
  });

  if (!installment) return null;

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
  installment.dataPagamento =
    statusFinal === "pago" && pagamentos.length > 0
      ? pagamentos[0].dataPagamento
      : null;

  await installment.save();

  return installment;
};

export const create = async (data, usuarioId) => {
  const installment = await validarInstallmentDoUsuario(data.installmentId, usuarioId);

  await validarOverpayment(installment, Number(data.valorPago), usuarioId);

  const novoPagamento = await Payment.create({
    usuarioId,
    installmentId: installment._id,
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

export const findAll = async (usuarioId, { page = 1, limit = 20, installmentId, processoId, formaPagamento } = {}) => {
  const filter = { usuarioId, ativo: true };
  if (formaPagamento && typeof formaPagamento === 'string') filter.formaPagamento = formaPagamento;

  if (processoId) {
    if (!mongoose.Types.ObjectId.isValid(processoId)) {
      return { data: [], total: 0, page: 1, limit: 0, totalPages: 1 };
    }
    const fees = await Fee.find({ processoId, usuarioId, ativo: true }).select("_id");
    const insts = await Installment.find({ feeId: { $in: fees.map(f => f._id) }, usuarioId, ativo: true }).select("_id");
    filter.installmentId = { $in: insts.map(i => i._id) };
    const data = await Payment.find(filter).populate(PAYMENT_POPULATE).sort({ createdAt: -1 });
    return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
  }

  if (installmentId) filter.installmentId = installmentId;
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
  validarObjectId(id, "paymentId");

  const payment = await Payment.findOne({ _id: id, usuarioId, ativo: true });

  if (!payment) throw criarErro(404, "Pagamento não encontrado");

  const installmentOriginalId = payment.installmentId.toString();

  let targetInstallment = null;
  if (data.installmentId !== undefined) {
    targetInstallment = await validarInstallmentDoUsuario(data.installmentId, usuarioId);
    payment.installmentId = targetInstallment._id;
  }

  if (data.valorPago !== undefined) payment.valorPago = Number(data.valorPago);
  if (data.dataPagamento !== undefined) payment.dataPagamento = new Date(data.dataPagamento);
  if (data.formaPagamento !== undefined) payment.formaPagamento = data.formaPagamento;
  if (data.observacoes !== undefined) payment.observacoes = data.observacoes?.trim() || "";
  if (data.ativo !== undefined) payment.ativo = data.ativo;

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

export const remove = async (id, usuarioId) => {
  validarObjectId(id, "paymentId");

  const payment = await Payment.findOne({ _id: id, usuarioId, ativo: true });

  if (!payment) throw criarErro(404, "Pagamento não encontrado");

  payment.ativo = false;
  await payment.save();

  await recalcularStatusInstallment(payment.installmentId.toString(), usuarioId);

  return { message: "Pagamento removido com sucesso" };
};

export default { create, findAll, findById, update, remove };
