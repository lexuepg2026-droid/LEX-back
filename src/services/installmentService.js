import mongoose from "mongoose";
import Installment from "../models/Installment.js";
import Fee from "../models/Fee.js";
import Payment from "../models/Payment.js";
import {
  validarCriacaoInstallment,
  validarAtualizacaoInstallment
} from "../validations/installmentValidation.js";
import { recalcularStatusInstallment } from "./paymentService.js";

const erro = (status, message) => {
  const error = new Error(message);
  error.statusCode = status;
  return error;
};

const validarObjectId = (id, nomeCampo) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw erro(400, `${nomeCampo} inválido`);
  }
};

const buscarFeeDoUsuario = async (feeId, usuarioId) => {
  validarObjectId(feeId, "feeId");

  const fee = await Fee.findOne({
    _id: feeId,
    usuarioId,
    ativo: true
  });

  if (!fee) {
    throw erro(404, "Honorário não encontrado");
  }

  return fee;
};

const normalizarStatus = ({ status, dataVencimento, dataPagamento }) => {
  if (status === "pago") {
    return "pago";
  }

  if (!dataPagamento && new Date(dataVencimento) < new Date()) {
    return "vencido";
  }

  return "pendente";
};

const verificarNumeroParcelaDuplicado = async ({
  feeId,
  numeroParcela,
  installmentId = null
}) => {
  const filtro = {
    feeId,
    numeroParcela
  };

  if (installmentId) {
    filtro._id = { $ne: installmentId };
  }

  const existente = await Installment.findOne(filtro);

  if (existente) {
    throw erro(409, "Já existe uma parcela com esse número para este honorário");
  }
};

export const criarInstallment = async (usuarioId, dados) => {
  const erros = validarCriacaoInstallment(dados);

  if (erros.length > 0) {
    throw erro(400, erros.join(", "));
  }

  await buscarFeeDoUsuario(dados.feeId, usuarioId);

  await verificarNumeroParcelaDuplicado({
    feeId: dados.feeId,
    numeroParcela: dados.numeroParcela
  });

  const installment = await Installment.create({
    usuarioId,
    feeId: dados.feeId,
    numeroParcela: dados.numeroParcela,
    valor: dados.valor,
    dataVencimento: dados.dataVencimento,
    status: "pendente",
    dataPagamento: null,
    ativo: dados.ativo !== undefined ? dados.ativo : true
  });

  const atualizado = await recalcularStatusInstallment(installment._id, usuarioId);
  return atualizado || installment;
};

export const listarInstallments = async (usuarioId, { page = 1, limit = 20, processoId } = {}) => {
  const filter = { usuarioId, ativo: true };

  if (processoId) {
    if (!mongoose.Types.ObjectId.isValid(processoId)) {
      return { data: [], total: 0, page: 1, limit: 0, totalPages: 1 };
    }
    const fees = await Fee.find({ processoId, usuarioId, ativo: true }).select("_id");
    filter.feeId = { $in: fees.map(f => f._id) };
    const data = await Installment.find(filter)
      .populate("feeId")
      .sort({ numeroParcela: 1, createdAt: -1 });
    return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
  }

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Installment.find(filter)
      .populate("feeId")
      .sort({ numeroParcela: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Installment.countDocuments(filter)
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const buscarInstallmentPorId = async (usuarioId, installmentId) => {
  validarObjectId(installmentId, "installmentId");

  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId,
    ativo: true
  }).populate("feeId");

  if (!installment) {
    throw erro(404, "Parcela não encontrada");
  }

  return installment;
};

export const atualizarInstallment = async (
  usuarioId,
  installmentId,
  dados
) => {
  validarObjectId(installmentId, "installmentId");

  const erros = validarAtualizacaoInstallment(dados);

  if (erros.length > 0) {
    throw erro(400, erros.join(", "));
  }

  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId,
    ativo: true
  });

  if (!installment) {
    throw erro(404, "Parcela não encontrada");
  }

  let feeIdFinal = installment.feeId;
  if (dados.feeId !== undefined) {
    await buscarFeeDoUsuario(dados.feeId, usuarioId);
    feeIdFinal = dados.feeId;
  }

  const numeroParcelaFinal =
    dados.numeroParcela !== undefined
      ? dados.numeroParcela
      : installment.numeroParcela;

  await verificarNumeroParcelaDuplicado({
    feeId: feeIdFinal,
    numeroParcela: numeroParcelaFinal,
    installmentId
  });

  const dataVencimentoFinal =
    dados.dataVencimento !== undefined
      ? dados.dataVencimento
      : installment.dataVencimento;

  installment.feeId = feeIdFinal;
  installment.numeroParcela = numeroParcelaFinal;
  installment.valor =
    dados.valor !== undefined ? dados.valor : installment.valor;
  installment.dataVencimento = dataVencimentoFinal;
  installment.ativo =
    dados.ativo !== undefined ? dados.ativo : installment.ativo;

  await installment.save();

  const atualizado = await recalcularStatusInstallment(installmentId, usuarioId);
  return atualizado || installment;
};

export const deletarInstallment = async (usuarioId, installmentId) => {
  validarObjectId(installmentId, "installmentId");

  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId,
    ativo: true
  });

  if (!installment) {
    throw erro(404, "Parcela não encontrada");
  }

  const paymentsAtivos = await Payment.countDocuments({ installmentId: installment._id, ativo: true });
  if (paymentsAtivos > 0) {
    throw erro(409, "Não é possível excluir esta cobrança pois existem pagamentos vinculados.");
  }

  installment.ativo = false;
  await installment.save();
  return installment;
};