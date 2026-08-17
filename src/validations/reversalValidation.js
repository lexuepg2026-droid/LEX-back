import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE ESTORNO — DEC-033 (Fase F-1a)
//
// Escrita à mão, no padrão do projeto. Sem zod/joi/yup.
//
// ── O que fica aqui e o que fica no service ───────────────────────────────
// Aqui: FORMA — tipo, presença, faixa. Lá: REGRA — quanto ainda é estornável,
// se o alvo da anulação existe, se já foi anulado. A divisão não é estética:
// as regras precisam do banco, e uma validação que consulta o banco vira um
// segundo service com outro nome.
//
// `valor` é dispensado na ANULAÇÃO, e de propósito: anular restaura o valor
// integral do estorno anulado, e aceitar um valor diferente ali criaria uma
// "anulação parcial" que a DEC-033 não tem — quem quer devolver parte registra
// um estorno novo, não uma anulação torta.
// ═══════════════════════════════════════════════════════════════════════════

const isObjectIdValido = (valor) =>
  typeof valor === "string" && mongoose.Types.ObjectId.isValid(valor);

const isDataValida = (valor) => !Number.isNaN(new Date(valor).getTime());

const resultado = (errors, campos) => ({ isValid: errors.length === 0, errors, campos });

export const validateCreateReversal = (data = {}) => {
  const errors = [];
  const campos = [];

  const ehAnulacao = data.estornoAnuladoId !== undefined && data.estornoAnuladoId !== null;

  if (ehAnulacao && !isObjectIdValido(String(data.estornoAnuladoId))) {
    errors.push("estornoAnuladoId inválido");
    campos.push("estornoAnuladoId");
  }

  // `motivo` é obrigatório nos DOIS caminhos. É o campo que responde, meses
  // depois, por que este dinheiro voltou — e um estorno sem motivo é
  // exatamente o registro que não explica nada.
  if (data.motivo === undefined || data.motivo === null || String(data.motivo).trim() === "") {
    errors.push("motivo é obrigatório");
    campos.push("motivo");
  } else if (typeof data.motivo !== "string") {
    errors.push("motivo deve ser texto");
    campos.push("motivo");
  } else if (data.motivo.trim().length < 3) {
    errors.push("motivo deve ter ao menos 3 caracteres");
    campos.push("motivo");
  } else if (data.motivo.trim().length > 500) {
    errors.push("motivo deve ter no máximo 500 caracteres");
    campos.push("motivo");
  }

  if (!ehAnulacao) {
    if (data.valor === undefined || data.valor === null || data.valor === "") {
      errors.push("valor é obrigatório");
      campos.push("valor");
    } else if (Number.isNaN(Number(data.valor))) {
      errors.push("valor deve ser numérico");
      campos.push("valor");
    } else if (Number(data.valor) <= 0) {
      errors.push("valor deve ser maior que zero");
      campos.push("valor");
    }
  }

  if (data.data !== undefined && data.data !== null && !isDataValida(data.data)) {
    errors.push("data inválida");
    campos.push("data");
  }

  return resultado(errors, campos);
};

export default { validateCreateReversal };
