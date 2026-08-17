// ═══════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE REPARCELAMENTO — DEC-037 (Fase F-1a)
//
// Escrita à mão, no padrão do projeto. Sem zod/joi/yup.
//
// Valida a FORMA do plano novo: que há parcelas, que cada uma tem valor > 0 e
// vencimento válido. A regra de NEGÓCIO — a soma igualar o saldo em aberto —
// mora no service, porque depende do banco e devolve 422 com o valor esperado.
//
// `campos` acompanha `errors` no formato dos demais módulos: com exatamente um
// campo responsável, o controller o repassa como `campo`, e a tela destaca o
// input. Num plano de parcelas o campo é indexado (`parcelas[2].valor`), para
// a tela saber QUAL linha destacar — sem o índice, um erro na terceira parcela
// destacaria a primeira.
// ═══════════════════════════════════════════════════════════════════════════

const isDataValida = (valor) => !Number.isNaN(new Date(valor).getTime());

const resultado = (errors, campos) => ({ isValid: errors.length === 0, errors, campos });

// Teto de parcelas. Não é regra de negócio da advogada — é guarda de payload:
// sem ele, um corpo com 100.000 linhas viraria 100.000 `Installment.create`
// numa requisição. Doze é o parcelamento anual, vinte e quatro o bienal; 60 dá
// folga de sobra para o caso real e ainda recusa o absurdo.
export const MAX_PARCELAS_REPARCELAMENTO = 60;

export const validateCreateRenegotiation = (data = {}) => {
  const errors = [];
  const campos = [];

  const { parcelas } = data;

  if (!Array.isArray(parcelas)) {
    errors.push("parcelas é obrigatório e deve ser uma lista");
    campos.push("parcelas");
    return resultado(errors, campos);
  }

  if (parcelas.length === 0) {
    errors.push("Informe ao menos uma parcela nova");
    campos.push("parcelas");
    return resultado(errors, campos);
  }

  if (parcelas.length > MAX_PARCELAS_REPARCELAMENTO) {
    errors.push(
      `Um reparcelamento aceita no máximo ${MAX_PARCELAS_REPARCELAMENTO} parcelas`
    );
    campos.push("parcelas");
    return resultado(errors, campos);
  }

  parcelas.forEach((parcela, i) => {
    if (parcela === null || typeof parcela !== "object" || Array.isArray(parcela)) {
      errors.push(`parcelas[${i}] deve ser um objeto com valor e dataVencimento`);
      campos.push(`parcelas[${i}]`);
      return;
    }

    if (parcela.valor === undefined || parcela.valor === null || parcela.valor === "") {
      errors.push(`parcelas[${i}].valor é obrigatório`);
      campos.push(`parcelas[${i}].valor`);
    } else if (Number.isNaN(Number(parcela.valor))) {
      errors.push(`parcelas[${i}].valor deve ser numérico`);
      campos.push(`parcelas[${i}].valor`);
    } else if (Number(parcela.valor) <= 0) {
      errors.push(`parcelas[${i}].valor deve ser maior que zero`);
      campos.push(`parcelas[${i}].valor`);
    }

    if (!parcela.dataVencimento) {
      errors.push(`parcelas[${i}].dataVencimento é obrigatória`);
      campos.push(`parcelas[${i}].dataVencimento`);
    } else if (!isDataValida(parcela.dataVencimento)) {
      errors.push(`parcelas[${i}].dataVencimento inválida`);
      campos.push(`parcelas[${i}].dataVencimento`);
    }
  });

  if (data.motivo !== undefined && data.motivo !== null) {
    if (typeof data.motivo !== "string") {
      errors.push("motivo deve ser texto");
      campos.push("motivo");
    } else if (data.motivo.length > 500) {
      errors.push("motivo deve ter no máximo 500 caracteres");
      campos.push("motivo");
    }
  }

  if (data.data !== undefined && data.data !== null && !isDataValida(data.data)) {
    errors.push("data inválida");
    campos.push("data");
  }

  return resultado(errors, campos);
};

export default { validateCreateRenegotiation, MAX_PARCELAS_REPARCELAMENTO };
