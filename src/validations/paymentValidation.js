// src/validations/paymentValidation.js
import mongoose from "mongoose";

const FORMAS_PAGAMENTO_VALIDAS = [
  "dinheiro",
  "pix",
  "boleto",
  "cartao_credito",
  "cartao_debito",
  "transferencia"
];

const CAMPOS_PERMITIDOS_UPDATE = [
  "installmentId",
  "valorPago",
  "dataPagamento",
  "formaPagamento",
  "observacoes",
  "ativo"
];

const isObjectIdValido = (valor) => mongoose.Types.ObjectId.isValid(valor);

const isNumeroValido = (valor) => {
  const numero = Number(valor);
  return !Number.isNaN(numero);
};

const isDataValida = (valor) => !Number.isNaN(new Date(valor).getTime());

export const validateCreatePayment = (data) => {
  const erros = [];

  if (!data.installmentId) {
    erros.push("installmentId é obrigatório");
  } else if (!isObjectIdValido(data.installmentId)) {
    erros.push("installmentId inválido");
  }

  if (data.valorPago === undefined || data.valorPago === null || data.valorPago === "") {
    erros.push("valorPago é obrigatório");
  } else if (!isNumeroValido(data.valorPago)) {
    erros.push("valorPago deve ser numérico");
  } else if (Number(data.valorPago) <= 0) {
    erros.push("valorPago deve ser maior que zero");
  }

  if (!data.dataPagamento) {
    erros.push("dataPagamento é obrigatória");
  } else if (!isDataValida(data.dataPagamento)) {
    erros.push("dataPagamento inválida");
  }

  if (!data.formaPagamento) {
    erros.push("formaPagamento é obrigatória");
  } else if (!FORMAS_PAGAMENTO_VALIDAS.includes(data.formaPagamento)) {
    erros.push("formaPagamento inválida");
  }

  if (
    data.observacoes !== undefined &&
    data.observacoes !== null &&
    typeof data.observacoes !== "string"
  ) {
    erros.push("observacoes deve ser texto");
  }

  if (data.ativo !== undefined && typeof data.ativo !== "boolean") {
    erros.push("ativo deve ser boolean");
  }

  return erros;
};

export const validateUpdatePayment = (data) => {
  const erros = [];

  const camposEnviados = Object.keys(data);
  const camposValidosEnviados = camposEnviados.filter((campo) =>
    CAMPOS_PERMITIDOS_UPDATE.includes(campo)
  );

  if (camposValidosEnviados.length === 0) {
    erros.push("Informe ao menos um campo válido para atualização");
    return erros;
  }

  if (data.installmentId !== undefined) {
    if (!data.installmentId || !isObjectIdValido(data.installmentId)) {
      erros.push("installmentId inválido");
    }
  }

  if (data.valorPago !== undefined) {
    if (data.valorPago === null || data.valorPago === "") {
      erros.push("valorPago inválido");
    } else if (!isNumeroValido(data.valorPago)) {
      erros.push("valorPago deve ser numérico");
    } else if (Number(data.valorPago) <= 0) {
      erros.push("valorPago deve ser maior que zero");
    }
  }

  if (data.dataPagamento !== undefined) {
    if (!data.dataPagamento || !isDataValida(data.dataPagamento)) {
      erros.push("dataPagamento inválida");
    }
  }

  if (data.formaPagamento !== undefined) {
    if (!FORMAS_PAGAMENTO_VALIDAS.includes(data.formaPagamento)) {
      erros.push("formaPagamento inválida");
    }
  }

  if (
    data.observacoes !== undefined &&
    data.observacoes !== null &&
    typeof data.observacoes !== "string"
  ) {
    erros.push("observacoes deve ser texto");
  }

  if (data.ativo !== undefined && typeof data.ativo !== "boolean") {
    erros.push("ativo deve ser boolean");
  }

  return erros;
};

export const validatePaymentId = (id) => {
  if (!id) {
    return ["ID do pagamento é obrigatório"];
  }

  if (!isObjectIdValido(id)) {
    return ["ID do pagamento inválido"];
  }

  return [];
};