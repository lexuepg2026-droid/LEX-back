import mongoose from "mongoose";

const TIPOS_VALIDOS = ["fixo", "percentual", "custas"];
const STATUS_VALIDOS = ["pendente", "pago", "cancelado"];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizeString = (value) => {
  if (typeof value !== "string") return value;
  return value.trim();
};

export const validateCreateFee = (data) => {
  const errors = [];

  if (!data.processoId) {
    errors.push("processoId é obrigatório");
  } else if (!isValidObjectId(data.processoId)) {
    errors.push("processoId inválido");
  }

  if (!data.descricao || !normalizeString(data.descricao)) {
    errors.push("descrição é obrigatória");
  }

  if (data.valor === undefined || data.valor === null || data.valor === "") {
    errors.push("valor é obrigatório");
  } else if (Number.isNaN(Number(data.valor)) || Number(data.valor) < 0) {
    errors.push("valor inválido");
  }

  if (!data.tipo) {
    errors.push("tipo é obrigatório");
  } else if (!TIPOS_VALIDOS.includes(data.tipo)) {
    errors.push(`tipo inválido. Use: ${TIPOS_VALIDOS.join(", ")}`);
  }

  if (!data.status) {
    errors.push("status é obrigatório");
  } else if (!STATUS_VALIDOS.includes(data.status)) {
    errors.push(`status inválido. Use: ${STATUS_VALIDOS.join(", ")}`);
  }

  if (!data.dataVencimento) {
    errors.push("dataVencimento é obrigatória");
  } else if (Number.isNaN(new Date(data.dataVencimento).getTime())) {
    errors.push("dataVencimento inválida");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateUpdateFee = (data) => {
  const errors = [];
  const hasOwn = (field) => Object.prototype.hasOwnProperty.call(data, field);

  if (hasOwn("processoId")) {
    if (!data.processoId) {
      errors.push("processoId é obrigatório");
    } else if (!isValidObjectId(data.processoId)) {
      errors.push("processoId inválido");
    }
  }

  if (hasOwn("descricao")) {
    if (!data.descricao || !normalizeString(data.descricao)) {
      errors.push("descrição inválida");
    }
  }

  if (hasOwn("valor")) {
    if (data.valor === "" || Number.isNaN(Number(data.valor)) || Number(data.valor) < 0) {
      errors.push("valor inválido");
    }
  }

  if (hasOwn("tipo")) {
    if (!data.tipo || !TIPOS_VALIDOS.includes(data.tipo)) {
      errors.push(`tipo inválido. Use: ${TIPOS_VALIDOS.join(", ")}`);
    }
  }

  if (hasOwn("status")) {
    if (!data.status || !STATUS_VALIDOS.includes(data.status)) {
      errors.push(`status inválido. Use: ${STATUS_VALIDOS.join(", ")}`);
    }
  }

  if (hasOwn("dataVencimento")) {
    if (!data.dataVencimento || Number.isNaN(new Date(data.dataVencimento).getTime())) {
      errors.push("dataVencimento inválida");
    }
  }

  if (hasOwn("ativo") && typeof data.ativo !== "boolean") {
    errors.push("ativo deve ser boolean");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateFeeId = (id) => {
  if (!isValidObjectId(id)) {
    return {
      isValid: false,
      errors: ["id inválido"]
    };
  }

  return {
    isValid: true,
    errors: []
  };
};