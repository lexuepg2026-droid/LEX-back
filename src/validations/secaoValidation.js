import mongoose from "mongoose";
import { TIPOS_SECAO } from "../models/Secao.js";
import { validarVariaveis } from "../utils/templateParser.js";

// Mesmo contrato de clientValidation e authValidation: cada função devolve uma
// string com o primeiro erro encontrado, ou null quando o payload é válido.

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const hasOwnProperty = (obj, key) =>
  Object.prototype.hasOwnProperty.call(obj, key);

export const validarIdSecao = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? null : "Identificador de seção inválido";

// Variável fora do catálogo é barrada no cadastro, não na geração: é aqui que a
// advogada ainda lembra o que quis escrever.
const validarTextoDoTemplate = (texto) => {
  const invalidas = validarVariaveis(texto);
  if (invalidas.length > 0) {
    return `Variáveis inválidas no texto: ${invalidas.map((v) => `{{${v}}}`).join(", ")}`;
  }
  return null;
};

export const validateCreateSecaoPayload = (data) => {
  if (data === null || typeof data !== "object") {
    return "Payload inválido";
  }

  if (!isNonEmptyString(data.titulo)) {
    return "Título é obrigatório";
  }
  if (data.titulo.trim().length > 120) {
    return "Título deve ter no máximo 120 caracteres";
  }

  if (!isNonEmptyString(data.tipo)) {
    return "Tipo é obrigatório";
  }
  if (!TIPOS_SECAO.includes(data.tipo)) {
    return `Tipo inválido. Valores aceitos: ${TIPOS_SECAO.join(", ")}`;
  }

  if (!isNonEmptyString(data.texto)) {
    return "Texto é obrigatório";
  }

  return validarTextoDoTemplate(data.texto);
};

export const validateUpdateSecaoPayload = (data) => {
  if (data === null || typeof data !== "object") {
    return "Payload inválido";
  }

  if (hasOwnProperty(data, "titulo")) {
    if (!isNonEmptyString(data.titulo)) {
      return "Título não pode ser vazio";
    }
    if (data.titulo.trim().length > 120) {
      return "Título deve ter no máximo 120 caracteres";
    }
  }

  if (hasOwnProperty(data, "tipo")) {
    if (!isNonEmptyString(data.tipo)) {
      return "Tipo não pode ser vazio";
    }
    if (!TIPOS_SECAO.includes(data.tipo)) {
      return `Tipo inválido. Valores aceitos: ${TIPOS_SECAO.join(", ")}`;
    }
  }

  if (hasOwnProperty(data, "texto")) {
    if (!isNonEmptyString(data.texto)) {
      return "Texto não pode ser vazio";
    }
    const erroTexto = validarTextoDoTemplate(data.texto);
    if (erroTexto) return erroTexto;
  }

  const camposEditaveis = ["titulo", "tipo", "texto"];
  if (!camposEditaveis.some((campo) => hasOwnProperty(data, campo))) {
    return "Nenhum campo válido informado para atualização";
  }

  return null;
};

export default {
  validarIdSecao,
  validateCreateSecaoPayload,
  validateUpdateSecaoPayload
};
