import mongoose from "mongoose";
import { PAPEIS_PROCESSO_CLIENTE } from "../models/ProcessoCliente.js";
import { FASES_PROCESSO } from "../config/fasesProcesso.js";

const validStatus = ["ativo", "encerrado", "suspenso"];

// Teto do texto livre. Não é regra de negócio — é o mesmo teto que os demais
// campos de observação do projeto têm, para um payload absurdo não virar
// documento de megabytes no banco.
const MAX_TEXTO_LIVRE = 2000;

const ehVazio = (v) => v === undefined || v === null || v === "";

// ── DEC-054 — as três validações da fase e do encerramento ────────────────
//
// Escritas à mão, como todo o resto do projeto. O que elas NÃO fazem é tão
// importante quanto o que fazem:
//
//   • não comparam a fase nova com a atual — qualquer fase vai para qualquer
//     fase, inclusive de volta (*"sim, pode voltar"*);
//   • não exigem motivo — *"só se ela quiser mesmo"*;
//   • não exigem que a fase seja "recursos" para o processo transitar em
//     julgado — o encerramento é independente da fase.
//
// As três ausências são as regras que a Laís NÃO pediu, e são exatamente o que
// as mutações obrigatórias desta fase tentam introduzir.
export const validateFasePayload = (data) => {
  const errors = [];

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return ["Payload inválido"];
  }

  if (ehVazio(data.fase)) {
    errors.push("fase é obrigatória");
  } else if (!FASES_PROCESSO.includes(String(data.fase).trim())) {
    errors.push(`fase inválida. Valores aceitos: ${FASES_PROCESSO.join(", ")}`);
  }

  // Motivo OPCIONAL. Ausente, `null` e "" são todos "não quis anotar" — e os
  // três precisam passar, senão a tela teria de escolher qual forma do vazio
  // mandar.
  if (!ehVazio(data.motivo)) {
    if (typeof data.motivo !== "string") {
      errors.push("motivo deve ser texto");
    } else if (data.motivo.length > MAX_TEXTO_LIVRE) {
      errors.push(`motivo deve ter no máximo ${MAX_TEXTO_LIVRE} caracteres`);
    }
  }

  return errors;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isValidDate = (value) => {
  if (!value) return true;

  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

export const PAPEL_PADRAO = "autor";

// Normaliza os participantes do payload de criação para a forma única
// { clienteId, papel, principal } que o service grava na junção.
//
// Aceita dois formatos:
//   1. `clientes: [{ clienteId, papel, principal }]` — o formato da Fase 2B;
//   2. `clientePrincipalId` isolado — compatibilidade com o seed e com
//      chamadas anteriores à junção, tratado como participante único
//      `principal: true` e `papel: "autor"`.
//
// Devolve `{ errors, clientes }`. Com `errors` não vazio, `clientes` não deve
// ser usado.
export const normalizarClientesDoPayload = (data) => {
  const errors = [];

  if (data.clientes !== undefined && !Array.isArray(data.clientes)) {
    return { errors: ["clientes deve ser um array"], clientes: [] };
  }

  const temArray = Array.isArray(data.clientes) && data.clientes.length > 0;

  // Compatibilidade: sem array, um clientePrincipalId isolado vira o único
  // participante. Aceita também o nome antigo `clienteId` para não quebrar
  // integrações que ainda não migraram.
  if (!temArray) {
    const legado = data.clientePrincipalId ?? data.clienteId;

    if (legado === undefined || legado === null || legado === "") {
      return {
        errors: ["informe ao menos um cliente no processo (campo clientes)"],
        clientes: []
      };
    }

    if (!isValidObjectId(legado)) {
      return { errors: ["clientePrincipalId inválido"], clientes: [] };
    }

    return {
      errors: [],
      clientes: [{ clienteId: String(legado), papel: PAPEL_PADRAO, principal: true }]
    };
  }

  const clientes = [];
  const vistos = new Set();

  data.clientes.forEach((item, indice) => {
    const posicao = `clientes[${indice}]`;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${posicao} deve ser um objeto`);
      return;
    }

    const clienteId = item.clienteId;

    if (!clienteId) {
      errors.push(`${posicao}.clienteId é obrigatório`);
    } else if (!isValidObjectId(clienteId)) {
      errors.push(`${posicao}.clienteId inválido`);
    } else if (vistos.has(String(clienteId))) {
      errors.push(`${posicao}.clienteId repetido no mesmo processo`);
    } else {
      vistos.add(String(clienteId));
    }

    const papel = item.papel === undefined ? PAPEL_PADRAO : String(item.papel).trim();

    if (!PAPEIS_PROCESSO_CLIENTE.includes(papel)) {
      errors.push(
        `${posicao}.papel inválido. Valores aceitos: ${PAPEIS_PROCESSO_CLIENTE.join(", ")}`
      );
    }

    if (item.principal !== undefined && typeof item.principal !== "boolean") {
      errors.push(`${posicao}.principal deve ser booleano`);
    }

    clientes.push({
      clienteId: String(clienteId),
      papel,
      principal: item.principal === true
    });
  });

  const principais = clientes.filter((c) => c.principal).length;

  // Zero ou dois principais deixariam `clientePrincipalId` indefinido ou
  // ambíguo — e é dele que sai a qualificação do documento gerado sem cliente
  // explícito. Exigir exatamente um aqui evita processo em estado inválido.
  if (principais === 0) {
    errors.push("exatamente um cliente deve ser marcado como principal");
  } else if (principais > 1) {
    errors.push(`exatamente um cliente deve ser marcado como principal (recebidos ${principais})`);
  }

  return { errors, clientes };
};

// ── DEC-054 — encerramento e liminar, os campos que o PATCH comum aceita ──
//
// Ao contrário da `fase`, estes NÃO exigem entrada de histórico: o
// encerramento é um carimbo (a data que existe ou não existe) e a liminar é um
// sinalizador. Nenhum dos dois é "por onde o processo andou", que é o que a
// linha do tempo mostra.
//
// **O encerramento não olha a fase, e isso é regra.** Um processo pode
// transitar em julgado a partir de QUALQUER uma das quatro — a Laís descreveu
// "acordo cumprido → trânsito em julgado", e acordo se cumpre em conhecimento,
// em execução, em qualquer lugar. Exigir `fase === "recursos"` seria inventar
// um caminho único onde ela descreveu vários.
//
// `null` é valor legítimo nos quatro campos, e não "campo ausente": é assim
// que se desfaz um encerramento registrado por engano e se tira a marca da
// liminar. Convenção do projeto — campo apagado envia `null`, nunca
// `undefined`.
const validarCamposDeAndamento = (data) => {
  const errors = [];

  if (data.transitoEmJulgadoEm !== undefined && data.transitoEmJulgadoEm !== null) {
    if (!isValidDate(data.transitoEmJulgadoEm) || data.transitoEmJulgadoEm === "") {
      errors.push("transitoEmJulgadoEm inválida");
    }
  }

  if (!ehVazio(data.motivoEncerramento)) {
    if (typeof data.motivoEncerramento !== "string") {
      errors.push("motivoEncerramento deve ser texto");
    } else if (data.motivoEncerramento.length > MAX_TEXTO_LIVRE) {
      errors.push(`motivoEncerramento deve ter no máximo ${MAX_TEXTO_LIVRE} caracteres`);
    }
  }

  if (data.liminar !== undefined && typeof data.liminar !== "boolean") {
    errors.push("liminar deve ser booleano");
  }

  if (!ehVazio(data.liminarObservacao)) {
    if (typeof data.liminarObservacao !== "string") {
      errors.push("liminarObservacao deve ser texto");
    } else if (data.liminarObservacao.length > MAX_TEXTO_LIVRE) {
      errors.push(`liminarObservacao deve ter no máximo ${MAX_TEXTO_LIVRE} caracteres`);
    }
  }

  if (data.liminarEm !== undefined && data.liminarEm !== null) {
    if (!isValidDate(data.liminarEm) || data.liminarEm === "") {
      errors.push("liminarEm inválida");
    }
  }

  return errors;
};

export const validateCreateProcess = (data) => {
  const errors = [];

  const { errors: errosClientes } = normalizarClientesDoPayload(data);
  errors.push(...errosClientes);

  if (!data.titulo || !String(data.titulo).trim()) {
    errors.push("titulo é obrigatório");
  }

  if (data.status && !validStatus.includes(data.status)) {
    errors.push("status inválido");
  }

  // DEC-054: a fase é opcional na criação — sem ela o processo nasce na fase
  // de conhecimento, pelo `default` do model. Informada, tem de ser uma das
  // quatro.
  if (data.fase !== undefined && !FASES_PROCESSO.includes(String(data.fase).trim())) {
    errors.push(`fase inválida. Valores aceitos: ${FASES_PROCESSO.join(", ")}`);
  }

  errors.push(...validarCamposDeAndamento(data));

  if (!isValidDate(data.dataDistribuicao)) {
    errors.push("dataDistribuicao inválida");
  }

  return errors;
};

export const validateUpdateProcess = (data) => {
  const errors = [];

  if (data.clientePrincipalId !== undefined && !isValidObjectId(data.clientePrincipalId)) {
    errors.push("clientePrincipalId inválido");
  }

  if (data.titulo !== undefined && !String(data.titulo).trim()) {
    errors.push("titulo não pode ser vazio");
  }

  if (data.status !== undefined && !validStatus.includes(data.status)) {
    errors.push("status inválido");
  }

  // ── DEC-054: `fase` NÃO entra aqui, e a ausência é deliberada ────────────
  //
  // Ela não está na allowlist de update do processo. Mudar de fase é o FATO que
  // a linha do tempo da F-2e vai mostrar, e um `PATCH /processes/:id` que
  // aceitasse `fase` gravaria a mudança sem entrada de histórico — a mesma
  // falha que `historicoAtivacao` (DEC-052) e `historicoStatus` (DEC-038) já
  // fecharam nos módulos deles.
  //
  // Quem muda a fase é `PATCH /api/processes/:id/fase`, e a allowlist responde
  // com a mensagem que manda a pessoa para lá.

  errors.push(...validarCamposDeAndamento(data));

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

// Corpo de POST /api/processes/:id/clientes e PATCH .../:clienteId.
export const validateVinculoPayload = (data, { exigirClienteId = true } = {}) => {
  const errors = [];

  if (exigirClienteId) {
    if (!data?.clienteId) {
      errors.push("clienteId é obrigatório");
    } else if (!isValidObjectId(data.clienteId)) {
      errors.push("clienteId inválido");
    }
  }

  if (data?.papel === undefined) {
    if (!exigirClienteId) {
      errors.push("papel é obrigatório");
    }
  } else if (!PAPEIS_PROCESSO_CLIENTE.includes(String(data.papel).trim())) {
    errors.push(
      `papel inválido. Valores aceitos: ${PAPEIS_PROCESSO_CLIENTE.join(", ")}`
    );
  }

  return errors;
};

export const validateClienteId = (id) => {
  if (!isValidObjectId(id)) {
    return ["id do cliente inválido"];
  }

  return [];
};
