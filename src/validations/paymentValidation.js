// src/validations/paymentValidation.js
import mongoose from "mongoose";
import { TIPOS_PAGAMENTO, FORMAS_PAGAMENTO } from "../models/Payment.js";

// ═══════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE PAGAMENTO — reescrita na Fase F-1 (DEC-032 / DEC-035)
//
// O contrato de criação mudou de forma: o pagamento nasce contra o HONORÁRIO,
// não contra a parcela, e `valorPago`/`dataPagamento` viraram `valor`/`data`.
// A validação de update encolheu junto com a allowlist — sobrou `observacoes`.
//
// Vocabulários importados do model, nunca reescritos: duas listas à mão
// divergem na primeira fase que acrescentar um valor, e a divergência aparece
// como "forma inválida" numa forma que o banco aceita.
// ═══════════════════════════════════════════════════════════════════════════

const isObjectIdValido = (valor) =>
  typeof valor === "string" && mongoose.Types.ObjectId.isValid(valor);

const isDataValida = (valor) => !Number.isNaN(new Date(valor).getTime());

// `campos` acompanha `errors` na mesma ordem de descoberta. Com exatamente um
// campo responsável, o service o repassa como `campo` — é o que a tela usa
// para destacar o input. Com dois, destacar o primeiro esconderia o segundo.
const resultado = (errors, campos) => ({ isValid: errors.length === 0, errors, campos });

export const validateCreatePayment = (data = {}) => {
  const errors = [];
  const campos = [];

  if (!data.honorarioId) {
    errors.push("honorarioId é obrigatório");
    campos.push("honorarioId");
  } else if (!isObjectIdValido(String(data.honorarioId))) {
    errors.push("honorarioId inválido");
    campos.push("honorarioId");
  }

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

  if (!data.data) {
    errors.push("data é obrigatória");
    campos.push("data");
  } else if (!isDataValida(data.data)) {
    errors.push("data inválida");
    campos.push("data");
  }

  // `tipo` é opcional e cai em `comum`: registrar um recebimento normal é o
  // caso de longe mais frequente, e exigir a palavra "comum" em toda
  // requisição seria pedir ao cliente HTTP o único valor óbvio.
  if (data.tipo !== undefined && data.tipo !== null) {
    if (!TIPOS_PAGAMENTO.includes(data.tipo)) {
      errors.push(`tipo inválido. Use: ${TIPOS_PAGAMENTO.join(", ")}`);
      campos.push("tipo");
    }
  }

  if (!data.formaPagamento) {
    errors.push("formaPagamento é obrigatória");
    campos.push("formaPagamento");
  } else if (!FORMAS_PAGAMENTO.includes(data.formaPagamento)) {
    errors.push(`formaPagamento inválida. Use: ${FORMAS_PAGAMENTO.join(", ")}`);
    campos.push("formaPagamento");
  }

  if (data.observacoes !== undefined && data.observacoes !== null) {
    if (typeof data.observacoes !== "string") {
      errors.push("observacoes deve ser texto");
      campos.push("observacoes");
    } else if (data.observacoes.length > 1000) {
      errors.push("observacoes deve ter no máximo 1000 caracteres");
      campos.push("observacoes");
    }
  }

  return resultado(errors, campos);
};

// Update aceita UM campo (DEC-032). A allowlist de
// `validations/shared/camposPermitidos.js` já recusou tudo o mais antes de
// chegar aqui; esta função valida o conteúdo do que passou.
export const validateUpdatePayment = (data = {}) => {
  const errors = [];

  if (!Object.prototype.hasOwnProperty.call(data, "observacoes")) {
    errors.push(
      "Informe `observacoes`. É o único campo editável de um pagamento — " +
        "valor, data e forma de pagamento se corrigem por estorno."
    );
    return errors;
  }

  const { observacoes } = data;
  if (observacoes !== null && typeof observacoes !== "string") {
    errors.push("observacoes deve ser texto ou null");
  } else if (typeof observacoes === "string" && observacoes.length > 1000) {
    errors.push("observacoes deve ter no máximo 1000 caracteres");
  }

  return errors;
};

// Exportada só para o teste conferir que esta lista e a allowlist canônica de
// `shared/camposPermitidos.js` não divergiram. Duas listas paralelas para a
// mesma pergunta divergem — foi assim que `ativo` sobreviveu aqui até a 4.5.
export const CAMPOS_PERMITIDOS_UPDATE_TESTE = Object.freeze(["observacoes"]);

export default { validateCreatePayment, validateUpdatePayment };
