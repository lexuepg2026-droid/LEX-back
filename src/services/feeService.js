import Fee from "../models/Fee.js";
import Process from "../models/Process.js";
import {
  validateCreateFee,
  validateUpdateFee,
  validateFeeId
} from "../validations/feeValidation.js";

const sanitizeFeeData = (data) => {
  const sanitized = {};

  if (Object.prototype.hasOwnProperty.call(data, "processoId")) {
    sanitized.processoId = data.processoId;
  }

  if (Object.prototype.hasOwnProperty.call(data, "descricao")) {
    sanitized.descricao = data.descricao?.trim();
  }

  if (Object.prototype.hasOwnProperty.call(data, "valor")) {
    sanitized.valor = Number(data.valor);
  }

  if (Object.prototype.hasOwnProperty.call(data, "tipo")) {
    sanitized.tipo = data.tipo?.trim();
  }

  if (Object.prototype.hasOwnProperty.call(data, "status")) {
    sanitized.status = data.status?.trim();
  }

  if (Object.prototype.hasOwnProperty.call(data, "dataVencimento")) {
    sanitized.dataVencimento = new Date(data.dataVencimento);
  }

  if (Object.prototype.hasOwnProperty.call(data, "ativo")) {
    sanitized.ativo = data.ativo;
  }

  return sanitized;
};

const ensureProcessBelongsToUser = async (processoId, usuarioId) => {
  const process = await Process.findOne({
    _id: processoId,
    usuarioId
  });

  if (!process) {
    const error = new Error("Processo não encontrado para este usuário");
    error.statusCode = 404;
    throw error;
  }

  return process;
};

const createFee = async (usuarioId, feeData) => {
  const validation = validateCreateFee(feeData);

  if (!validation.isValid) {
    const error = new Error(validation.errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  await ensureProcessBelongsToUser(feeData.processoId, usuarioId);

  const sanitizedData = sanitizeFeeData(feeData);

  const fee = await Fee.create({
    ...sanitizedData,
    usuarioId
  });

  return fee;
};

const listFees = async (usuarioId) => {
  return Fee.find({ usuarioId }).sort({ createdAt: -1 });
};

const getFeeById = async (feeId, usuarioId) => {
  const validation = validateFeeId(feeId);

  if (!validation.isValid) {
    const error = new Error(validation.errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  const fee = await Fee.findOne({
    _id: feeId,
    usuarioId
  });

  if (!fee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  return fee;
};

const updateFee = async (feeId, usuarioId, updateData) => {
  const idValidation = validateFeeId(feeId);

  if (!idValidation.isValid) {
    const error = new Error(idValidation.errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  const validation = validateUpdateFee(updateData);

  if (!validation.isValid) {
    const error = new Error(validation.errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  const existingFee = await Fee.findOne({
    _id: feeId,
    usuarioId
  });

  if (!existingFee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  if (Object.prototype.hasOwnProperty.call(updateData, "processoId")) {
    await ensureProcessBelongsToUser(updateData.processoId, usuarioId);
  }

  const sanitizedData = sanitizeFeeData(updateData);

  delete sanitizedData.usuarioId;

  const updatedFee = await Fee.findOneAndUpdate(
    {
      _id: feeId,
      usuarioId
    },
    sanitizedData,
    {
      new: true,
      runValidators: true
    }
  );

  return updatedFee;
};

const deleteFee = async (feeId, usuarioId) => {
  const validation = validateFeeId(feeId);

  if (!validation.isValid) {
    const error = new Error(validation.errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  const deletedFee = await Fee.findOneAndDelete({
    _id: feeId,
    usuarioId
  });

  if (!deletedFee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  return deletedFee;
};

export default {
  createFee,
  listFees,
  getFeeById,
  updateFee,
  deleteFee
};