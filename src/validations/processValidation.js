import mongoose from "mongoose";

const validStatus = ["ativo", "encerrado", "suspenso"];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isValidDate = (value) => {
  if (!value) return true;

  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

export const validateCreateProcess = (data) => {
  const errors = [];

  if (!data.clienteId) {
    errors.push("clienteId é obrigatório");
  } else if (!isValidObjectId(data.clienteId)) {
    errors.push("clienteId inválido");
  }

  if (!data.titulo || !String(data.titulo).trim()) {
    errors.push("titulo é obrigatório");
  }

  if (data.status && !validStatus.includes(data.status)) {
    errors.push("status inválido");
  }

  if (!isValidDate(data.dataDistribuicao)) {
    errors.push("dataDistribuicao inválida");
  }

  return errors;
};

export const validateUpdateProcess = (data) => {
  const errors = [];

  if (data.clienteId !== undefined && !isValidObjectId(data.clienteId)) {
    errors.push("clienteId inválido");
  }

  if (data.titulo !== undefined && !String(data.titulo).trim()) {
    errors.push("titulo não pode ser vazio");
  }

  if (data.status !== undefined && !validStatus.includes(data.status)) {
    errors.push("status inválido");
  }

  if (data.dataDistribuicao !== undefined && !isValidDate(data.dataDistribuicao)) {
    errors.push("dataDistribuicao inválida");
  }

  return errors;
};

export const validateProcessId = (id) => {
  if (!isValidObjectId(id)) {
    return ["id do processo inválido"];
  }

  return [];
};