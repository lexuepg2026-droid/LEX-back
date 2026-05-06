import mongoose from "mongoose";

const statusPermitidos = ["pendente", "pago", "vencido"];

const isObjectIdValido = (valor) => mongoose.Types.ObjectId.isValid(valor);

const isNumeroValido = (valor) =>
  typeof valor === "number" && !Number.isNaN(valor);

const isDataValida = (valor) => !Number.isNaN(new Date(valor).getTime());

export const validarCriacaoInstallment = (dados) => {
  const erros = [];

  if (!dados.feeId) {
    erros.push("feeId é obrigatório");
  } else if (!isObjectIdValido(dados.feeId)) {
    erros.push("feeId inválido");
  }

  if (dados.numeroParcela === undefined || dados.numeroParcela === null) {
    erros.push("numeroParcela é obrigatório");
  } else if (
    !Number.isInteger(dados.numeroParcela) ||
    dados.numeroParcela < 1
  ) {
    erros.push("numeroParcela deve ser um número inteiro maior que zero");
  }

  if (dados.valor === undefined || dados.valor === null) {
    erros.push("valor é obrigatório");
  } else if (!isNumeroValido(dados.valor) || dados.valor < 0) {
    erros.push("valor deve ser um número maior ou igual a zero");
  }

  if (!dados.dataVencimento) {
    erros.push("dataVencimento é obrigatória");
  } else if (!isDataValida(dados.dataVencimento)) {
    erros.push("dataVencimento inválida");
  }

  if (dados.status !== undefined && !statusPermitidos.includes(dados.status)) {
    erros.push("status inválido");
  }

  if (dados.dataPagamento !== undefined && dados.dataPagamento !== null) {
    if (!isDataValida(dados.dataPagamento)) {
      erros.push("dataPagamento inválida");
    }
  }

  if (dados.status === "pago" && !dados.dataPagamento) {
    erros.push("dataPagamento é obrigatória quando o status for pago");
  }

  if (dados.status && dados.status !== "pago" && dados.dataPagamento) {
    erros.push("dataPagamento só pode ser informada quando o status for pago");
  }

  if (dados.ativo !== undefined && typeof dados.ativo !== "boolean") {
    erros.push("ativo deve ser booleano");
  }

  return erros;
};

export const validarAtualizacaoInstallment = (dados) => {
  const erros = [];

  if (dados.feeId !== undefined) {
    if (!dados.feeId) {
      erros.push("feeId inválido");
    } else if (!isObjectIdValido(dados.feeId)) {
      erros.push("feeId inválido");
    }
  }

  if (dados.numeroParcela !== undefined) {
    if (!Number.isInteger(dados.numeroParcela) || dados.numeroParcela < 1) {
      erros.push("numeroParcela deve ser um número inteiro maior que zero");
    }
  }

  if (dados.valor !== undefined) {
    if (!isNumeroValido(dados.valor) || dados.valor < 0) {
      erros.push("valor deve ser um número maior ou igual a zero");
    }
  }

  if (dados.dataVencimento !== undefined) {
    if (!isDataValida(dados.dataVencimento)) {
      erros.push("dataVencimento inválida");
    }
  }

  if (dados.status !== undefined && !statusPermitidos.includes(dados.status)) {
    erros.push("status inválido");
  }

  if (dados.dataPagamento !== undefined && dados.dataPagamento !== null) {
    if (!isDataValida(dados.dataPagamento)) {
      erros.push("dataPagamento inválida");
    }
  }

  if (dados.status === "pago" && !dados.dataPagamento) {
    erros.push("dataPagamento é obrigatória quando o status for pago");
  }

  if (
    dados.status !== undefined &&
    dados.status !== "pago" &&
    dados.dataPagamento !== undefined &&
    dados.dataPagamento !== null
  ) {
    erros.push("dataPagamento só pode ser informada quando o status for pago");
  }

  if (dados.ativo !== undefined && typeof dados.ativo !== "boolean") {
    erros.push("ativo deve ser booleano");
  }

  return erros;
};