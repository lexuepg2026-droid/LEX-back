import mongoose from "mongoose";
import Client from "../models/Client.js";
import Process from "../models/Process.js";
import {
  validateCreateProcess,
  validateProcessId,
  validateUpdateProcess
} from "../validations/processValidation.js";

const normalizePayload = (data) => {
  const payload = { ...data };

  if (payload.titulo !== undefined) payload.titulo = String(payload.titulo).trim();
  if (payload.numeroProcesso !== undefined) payload.numeroProcesso = String(payload.numeroProcesso).trim();
  if (payload.tipoAcao !== undefined) payload.tipoAcao = String(payload.tipoAcao).trim();
  if (payload.area !== undefined) payload.area = String(payload.area).trim();
  if (payload.orgao !== undefined) payload.orgao = String(payload.orgao).trim();
  if (payload.vara !== undefined) payload.vara = String(payload.vara).trim();
  if (payload.comarca !== undefined) payload.comarca = String(payload.comarca).trim();
  if (payload.status !== undefined) payload.status = String(payload.status).trim();
  if (payload.descricao !== undefined) payload.descricao = String(payload.descricao).trim();
  if (payload.observacoes !== undefined) payload.observacoes = String(payload.observacoes).trim();

  if (payload.numeroProcesso === "") payload.numeroProcesso = undefined;

  if (
    payload.dataDistribuicao !== undefined &&
    payload.dataDistribuicao !== null &&
    payload.dataDistribuicao !== ""
  ) {
    payload.dataDistribuicao = new Date(payload.dataDistribuicao);
  }

  return payload;
};

const toObjectId = (value) => new mongoose.Types.ObjectId(value);

const findClientByUser = async (clienteId, usuarioId) => {
  return Client.findOne({
    _id: clienteId,
    usuarioId,
    ativo: true
  });
};

const handleDuplicateKeyError = (error) => {
  if (error?.code === 11000 && error?.keyPattern?.numeroProcesso) {
    const customError = new Error("Já existe um processo com este número para este usuário");
    customError.statusCode = 409;
    throw customError;
  }

  throw error;
};

export const createProcess = async (usuarioId, data) => {
  const errors = validateCreateProcess(data);

  if (errors.length > 0) {
    const error = new Error(errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  const normalizedClienteId = toObjectId(data.clienteId);

  const client = await findClientByUser(normalizedClienteId, usuarioId);

  if (!client) {
    const error = new Error("Cliente não encontrado para este usuário");
    error.statusCode = 404;
    throw error;
  }

  try {
    const payload = normalizePayload(data);

    const process = await Process.create({
      ...payload,
      usuarioId,
      clienteId: client._id
    });

    return process;
  } catch (error) {
    handleDuplicateKeyError(error);
  }
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const listProcesses = async (usuarioId, { page = 1, limit = 20, busca, status } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true };
  if (busca && typeof busca === 'string') {
    const termo = busca.slice(0, 80).trim();
    if (termo) {
      const regex = new RegExp(escapeRegex(termo), 'i');
      filter.$or = [{ titulo: regex }, { numeroProcesso: regex }];
    }
  }
  if (status && typeof status === 'string') filter.status = status;
  const [data, total] = await Promise.all([
    Process.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("clienteId", "nomeCompleto razaoSocial tipoPessoa"),
    Process.countDocuments(filter)
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const getProcessById = async (usuarioId, processId) => {
  const errors = validateProcessId(processId);

  if (errors.length > 0) {
    const error = new Error(errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  const process = await Process.findOne({
    _id: processId,
    usuarioId,
    ativo: true
  }).populate("clienteId", "nomeCompleto razaoSocial tipoPessoa");

  if (!process) {
    const error = new Error("Processo não encontrado");
    error.statusCode = 404;
    throw error;
  }

  return process;
};

export const updateProcess = async (usuarioId, processId, data) => {
  const idErrors = validateProcessId(processId);
  const bodyErrors = validateUpdateProcess(data);
  const errors = [...idErrors, ...bodyErrors];

  if (errors.length > 0) {
    const error = new Error(errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  const existingProcess = await Process.findOne({
    _id: processId,
    usuarioId,
    ativo: true
  });

  if (!existingProcess) {
    const error = new Error("Processo não encontrado");
    error.statusCode = 404;
    throw error;
  }

  const payload = normalizePayload(data);

  if (payload.clienteId !== undefined) {
    const normalizedClienteId = toObjectId(payload.clienteId);

    const client = await findClientByUser(normalizedClienteId, usuarioId);

    if (!client) {
      const error = new Error("Cliente não encontrado para este usuário");
      error.statusCode = 404;
      throw error;
    }

    payload.clienteId = client._id;
  }

  try {
    const updatedProcess = await Process.findOneAndUpdate(
      { _id: processId, usuarioId, ativo: true },
      payload,
      {
        new: true,
        runValidators: true
      }
    );

    return updatedProcess;
  } catch (error) {
    handleDuplicateKeyError(error);
  }
};

export const deleteProcess = async (usuarioId, processId) => {
  const errors = validateProcessId(processId);

  if (errors.length > 0) {
    const error = new Error(errors.join(", "));
    error.statusCode = 400;
    throw error;
  }

  const process = await Process.findOne({
    _id: processId,
    usuarioId,
    ativo: true
  });

  if (!process) {
    const error = new Error("Processo não encontrado");
    error.statusCode = 404;
    throw error;
  }

  process.ativo = false;
  await process.save();
  return process;
};