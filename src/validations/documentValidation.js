import mongoose from "mongoose";
import { TIPOS_DOCUMENTO, ORIGENS_DOCUMENTO } from "../models/Document.js";

const TIPOS_DOCUMENTO_VALIDOS = TIPOS_DOCUMENTO;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : value;

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return value;
};

const normalizeNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    return value;
  }

  return numberValue;
};

const normalizeDate = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date;
};

export const validateCreateDocument = (body) => {
  const errors = [];

  const data = {
    processoId: normalizeString(body.processoId),
    nome: normalizeString(body.nome),
    tipo: normalizeString(body.tipo),
    descricao: normalizeString(body.descricao),
    urlArquivo: normalizeString(body.urlArquivo),
    origem: normalizeString(body.origem),
    ehModelo: body.ehModelo === undefined ? undefined : normalizeBoolean(body.ehModelo),
    visivelPortal: body.visivelPortal === undefined ? undefined : normalizeBoolean(body.visivelPortal),
    tamanho: normalizeNumber(body.tamanho),
    dataUpload: normalizeDate(body.dataUpload),
    ativo: body.ativo === undefined ? undefined : normalizeBoolean(body.ativo)
  };

  // processoId e urlArquivo são condicionais: modelo não pertence a processo e
  // documento gerado não tem arquivo. Mesma regra do hook do schema.
  if (!isNonEmptyString(data.processoId)) {
    if (data.ehModelo !== true) {
      errors.push("processoId é obrigatório para documento que não é modelo");
    }
  } else if (!isValidObjectId(data.processoId)) {
    errors.push("processoId inválido");
  }

  if (!isNonEmptyString(data.nome)) {
    errors.push("nome é obrigatório");
  }

  if (!isNonEmptyString(data.tipo)) {
    errors.push("tipo é obrigatório");
  } else if (!TIPOS_DOCUMENTO_VALIDOS.includes(data.tipo)) {
    errors.push("tipo inválido");
  }

  if (data.origem !== undefined && !ORIGENS_DOCUMENTO.includes(data.origem)) {
    errors.push(`origem inválida. Valores aceitos: ${ORIGENS_DOCUMENTO.join(", ")}`);
  }

  const origemEfetiva = data.ehModelo === true ? "gerado" : (data.origem || "upload");
  if (origemEfetiva === "upload" && !isNonEmptyString(data.urlArquivo)) {
    errors.push('urlArquivo é obrigatório quando origem é "upload"');
  }

  if (data.tamanho !== undefined) {
    if (typeof data.tamanho !== "number" || Number.isNaN(data.tamanho)) {
      errors.push("tamanho deve ser um número válido");
    } else if (data.tamanho < 0) {
      errors.push("tamanho não pode ser negativo");
    }
  }

  if (data.dataUpload !== undefined && !(data.dataUpload instanceof Date)) {
    errors.push("dataUpload inválida");
  }

  if (data.ativo !== undefined && typeof data.ativo !== "boolean") {
    errors.push("ativo deve ser booleano");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data
  };
};

export const validateUpdateDocument = (body) => {
  const errors = [];

  const data = {};

  if (body.processoId !== undefined) {
    data.processoId = normalizeString(body.processoId);

    if (!isNonEmptyString(data.processoId)) {
      errors.push("processoId não pode ser vazio");
    } else if (!isValidObjectId(data.processoId)) {
      errors.push("processoId inválido");
    }
  }

  if (body.nome !== undefined) {
    data.nome = normalizeString(body.nome);

    if (!isNonEmptyString(data.nome)) {
      errors.push("nome não pode ser vazio");
    }
  }

  if (body.tipo !== undefined) {
    data.tipo = normalizeString(body.tipo);

    if (!isNonEmptyString(data.tipo)) {
      errors.push("tipo não pode ser vazio");
    } else if (!TIPOS_DOCUMENTO_VALIDOS.includes(data.tipo)) {
      errors.push("tipo inválido");
    }
  }

  if (body.descricao !== undefined) {
    data.descricao = normalizeString(body.descricao);
  }

  if (body.urlArquivo !== undefined) {
    data.urlArquivo = normalizeString(body.urlArquivo);

    if (!isNonEmptyString(data.urlArquivo)) {
      errors.push("urlArquivo não pode ser vazio");
    }
  }

  if (body.tamanho !== undefined) {
    data.tamanho = normalizeNumber(body.tamanho);

    if (typeof data.tamanho !== "number" || Number.isNaN(data.tamanho)) {
      errors.push("tamanho deve ser um número válido");
    } else if (data.tamanho < 0) {
      errors.push("tamanho não pode ser negativo");
    }
  }

  if (body.dataUpload !== undefined) {
    data.dataUpload = normalizeDate(body.dataUpload);

    if (!(data.dataUpload instanceof Date)) {
      errors.push("dataUpload inválida");
    }
  }

  if (body.origem !== undefined) {
    data.origem = normalizeString(body.origem);

    if (!ORIGENS_DOCUMENTO.includes(data.origem)) {
      errors.push(`origem inválida. Valores aceitos: ${ORIGENS_DOCUMENTO.join(", ")}`);
    }
  }

  // Aceito só para o service poder recusar a alteração com mensagem própria —
  // ehModelo é imutável depois da criação.
  if (body.ehModelo !== undefined) {
    data.ehModelo = normalizeBoolean(body.ehModelo);

    if (typeof data.ehModelo !== "boolean") {
      errors.push("ehModelo deve ser booleano");
    }
  }

  if (body.visivelPortal !== undefined) {
    data.visivelPortal = normalizeBoolean(body.visivelPortal);

    if (typeof data.visivelPortal !== "boolean") {
      errors.push("visivelPortal deve ser booleano");
    }
  }

  if (body.ativo !== undefined) {
    data.ativo = normalizeBoolean(body.ativo);

    if (typeof data.ativo !== "boolean") {
      errors.push("ativo deve ser booleano");
    }
  }

  if (Object.keys(data).length === 0) {
    errors.push("nenhum campo válido informado para atualização");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data
  };
};

export const validateDocumentId = (id) => {
  if (!isValidObjectId(id)) {
    return {
      isValid: false,
      error: "ID do documento inválido"
    };
  }

  return {
    isValid: true
  };
};
// Modelo não recebe processoId nem urlArquivo: o hook do schema descarta o
// processo e a origem é sempre "gerado".
export const validateCreateModelo = (body) => {
  const errors = [];

  const data = {
    nome: normalizeString(body.nome),
    tipo: normalizeString(body.tipo),
    descricao: normalizeString(body.descricao)
  };

  if (!isNonEmptyString(data.nome)) {
    errors.push("nome é obrigatório");
  }

  if (!isNonEmptyString(data.tipo)) {
    errors.push("tipo é obrigatório");
  } else if (!TIPOS_DOCUMENTO_VALIDOS.includes(data.tipo)) {
    errors.push(`tipo inválido. Valores aceitos: ${TIPOS_DOCUMENTO_VALIDOS.join(", ")}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    data
  };
};
