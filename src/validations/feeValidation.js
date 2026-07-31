import mongoose from "mongoose";
import { TIPOS_HONORARIO, STATUS_HONORARIO, TIPO_PERCENTUAL } from "../models/Fee.js";

// Os vocabulários são IMPORTADOS do model, nunca reescritos aqui. Duas listas
// escritas à mão divergem na primeira fase que acrescentar um valor, e a
// divergência aparece como "tipo inválido" num tipo que o banco aceita.
const TIPOS_VALIDOS = TIPOS_HONORARIO;
const STATUS_VALIDOS = STATUS_HONORARIO;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizeString = (value) => {
  if (typeof value !== "string") return value;
  return value.trim();
};

// Apagar campo é gravar `null`. `null` aqui significa "sem percentual", e não
// "valor inválido" — quem decide se a ausência é permitida é o hook do model,
// que é o único que conhece o tipo.
const ehApagado = (valor) => valor === null || valor === "";

// ── O que esta validação NÃO faz ───────────────────────────────────────────
// A regra CONDICIONAL de `percentual`/`valorBase` (obrigatório conforme o tipo,
// faixa, exigência de base) vive no `pre("validate")` do model — DEC-027. Aqui
// só entra o que é verdade independentemente do tipo: se veio, tem de ser
// número. Duplicar a regra condicional nos dois lugares garantiria que um dia
// eles discordassem, e o do model é o que vale também para o `save()` de outro
// service.
const validarNumeroOpcional = (data, campo, rotulo, errors, campos) => {
  if (!Object.prototype.hasOwnProperty.call(data, campo)) return;
  const valor = data[campo];
  if (ehApagado(valor) || valor === undefined) return;
  if (Number.isNaN(Number(valor))) {
    errors.push(`${rotulo} inválido`);
    campos.push(campo);
  }
};

// `campos` acompanha `errors` na mesma ordem de descoberta. Quando exatamente
// um campo é responsável, `feeService` o repassa como `campo` na resposta — é o
// que o `getApiErrorField` do FeeFormPage lê para destacar o input.
const resultado = (errors, campos) => ({
  isValid: errors.length === 0,
  errors,
  campos
});

export const validateCreateFee = (data) => {
  const errors = [];
  const campos = [];

  if (!data.processoId) {
    errors.push("processoId é obrigatório");
    campos.push("processoId");
  } else if (!isValidObjectId(data.processoId)) {
    errors.push("processoId inválido");
    campos.push("processoId");
  }

  if (!data.descricao || !normalizeString(data.descricao)) {
    errors.push("descrição é obrigatória");
    campos.push("descricao");
  }

  // No honorário percentual `valor` é DERIVADO pelo hook a partir de
  // `percentual` × `valorBase`. Exigi-lo no corpo obrigaria a advogada a
  // digitar uma conta que o sistema já sabe fazer — e o que ela digitasse
  // seria descartado.
  const derivaValor = data.tipo === TIPO_PERCENTUAL;

  if (data.valor === undefined || data.valor === null || data.valor === "") {
    if (!derivaValor) {
      errors.push("valor é obrigatório");
      campos.push("valor");
    }
  } else if (Number.isNaN(Number(data.valor)) || Number(data.valor) < 0) {
    errors.push("valor inválido");
    campos.push("valor");
  }

  if (!data.tipo) {
    errors.push("tipo é obrigatório");
    campos.push("tipo");
  } else if (!TIPOS_VALIDOS.includes(data.tipo)) {
    errors.push(`tipo inválido. Use: ${TIPOS_VALIDOS.join(", ")}`);
    campos.push("tipo");
  }

  if (!data.status) {
    errors.push("status é obrigatório");
    campos.push("status");
  } else if (!STATUS_VALIDOS.includes(data.status)) {
    errors.push(`status inválido. Use: ${STATUS_VALIDOS.join(", ")}`);
    campos.push("status");
  }

  if (!data.dataVencimento) {
    errors.push("dataVencimento é obrigatória");
    campos.push("dataVencimento");
  } else if (Number.isNaN(new Date(data.dataVencimento).getTime())) {
    errors.push("dataVencimento inválida");
    campos.push("dataVencimento");
  }

  validarNumeroOpcional(data, "percentual", "percentual", errors, campos);
  validarNumeroOpcional(data, "valorBase", "valor base", errors, campos);

  return resultado(errors, campos);
};

export const validateUpdateFee = (data) => {
  const errors = [];
  const campos = [];
  const hasOwn = (field) => Object.prototype.hasOwnProperty.call(data, field);

  if (hasOwn("processoId")) {
    if (!data.processoId) {
      errors.push("processoId é obrigatório");
      campos.push("processoId");
    } else if (!isValidObjectId(data.processoId)) {
      errors.push("processoId inválido");
      campos.push("processoId");
    }
  }

  if (hasOwn("descricao")) {
    if (!data.descricao || !normalizeString(data.descricao)) {
      errors.push("descrição inválida");
      campos.push("descricao");
    }
  }

  if (hasOwn("valor")) {
    if (data.valor === "" || Number.isNaN(Number(data.valor)) || Number(data.valor) < 0) {
      errors.push("valor inválido");
      campos.push("valor");
    }
  }

  if (hasOwn("tipo")) {
    if (!data.tipo || !TIPOS_VALIDOS.includes(data.tipo)) {
      errors.push(`tipo inválido. Use: ${TIPOS_VALIDOS.join(", ")}`);
      campos.push("tipo");
    }
  }

  if (hasOwn("status")) {
    if (!data.status || !STATUS_VALIDOS.includes(data.status)) {
      errors.push(`status inválido. Use: ${STATUS_VALIDOS.join(", ")}`);
      campos.push("status");
    }
  }

  if (hasOwn("dataVencimento")) {
    if (!data.dataVencimento || Number.isNaN(new Date(data.dataVencimento).getTime())) {
      errors.push("dataVencimento inválida");
      campos.push("dataVencimento");
    }
  }

  if (hasOwn("ativo") && typeof data.ativo !== "boolean") {
    errors.push("ativo deve ser boolean");
    campos.push("ativo");
  }

  validarNumeroOpcional(data, "percentual", "percentual", errors, campos);
  validarNumeroOpcional(data, "valorBase", "valor base", errors, campos);

  return resultado(errors, campos);
};

export const validateFeeId = (id) => {
  if (!isValidObjectId(id)) {
    return {
      isValid: false,
      errors: ["id inválido"],
      campos: ["id"]
    };
  }

  return {
    isValid: true,
    errors: [],
    campos: []
  };
};
