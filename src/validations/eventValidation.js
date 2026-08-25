// ═══════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO DO EVENTO — escrita à mão, no padrão de `clientValidation.js`
//
// Sem zod, joi ou yup: é convenção do projeto, e o motivo continua o mesmo —
// a regra que importa aqui não é "é string?", é "esta string é uma data de
// calendário e não um instante", e essa distinção nenhum esquema declarativo
// expressa sem função customizada de qualquer jeito.
//
// As funções ACUMULAM erros e devolvem um array, em vez de lançar no primeiro:
// um formulário de sete campos com dois errados precisa apontar os dois.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import { TIPOS_EVENTO } from "../config/tiposEvento.js";
import { lerDataDeCalendario, horaValida } from "../utils/dataDeCalendario.js";

const isObjectIdValido = (valor) =>
  typeof valor === "string" && mongoose.Types.ObjectId.isValid(valor);

// Texto opcional: aceita string, ou `null` para APAGAR. `undefined` é
// "não mexa" e nem chega aqui — quem separa os dois é o service, pelo
// `hasOwnProperty`.
//
// A distinção é a convenção do projeto ("campo apagado grava `null`, nunca
// `undefined`"), e é o que faz um PATCH parcial não zerar o que não foi
// enviado.
const validarTextoOpcional = (valor, nome, erros, { maximo = 2000 } = {}) => {
  if (valor === null) return;
  if (typeof valor !== "string") {
    erros.push(`${nome} deve ser texto ou null`);
    return;
  }
  if (valor.trim().length > maximo) {
    erros.push(`${nome} deve ter no máximo ${maximo} caracteres`);
  }
};

// A mensagem NOMEIA o formato esperado, e diz em voz alta que instante não
// serve. Um "data inválida" seco, para quem mandou `2026-09-01T00:00:00.000Z`,
// manda procurar o erro num valor que parece perfeitamente válido — e é
// exatamente esse o valor que a recusa existe para barrar.
export const MENSAGEM_FORMATO_DA_DATA =
  'data deve estar no formato AAAA-MM-DD (uma data de calendário, não um instante — "2026-09-01", e não "2026-09-01T00:00:00.000Z")';

export const MENSAGEM_FORMATO_DA_HORA = "hora deve estar no formato HH:MM (24 horas), ou null";

const validarData = (valor, erros) => {
  if (typeof valor !== "string" || !lerDataDeCalendario(valor)) {
    erros.push(MENSAGEM_FORMATO_DA_DATA);
  }
};

const validarHora = (valor, erros) => {
  if (valor === null) return;
  if (!horaValida(valor)) erros.push(MENSAGEM_FORMATO_DA_HORA);
};

const validarTipo = (valor, erros) => {
  if (!TIPOS_EVENTO.includes(valor)) {
    erros.push(`tipo inválido. Use um de: ${TIPOS_EVENTO.join(", ")}`);
  }
};

const validarTitulo = (valor, erros) => {
  if (typeof valor !== "string" || valor.trim().length === 0) {
    erros.push("título é obrigatório");
    return;
  }
  if (valor.trim().length > 200) {
    erros.push("título deve ter no máximo 200 caracteres");
  }
};

// `processoId` aceita `null` — é o evento solto, e é o caso comum. O que não
// se aceita é string vazia: ela chega de um `<select>` sem escolha e, tratada
// como id, produziria um 404 "processo não encontrado" para quem não quis
// vincular processo nenhum.
const validarProcessoId = (valor, erros) => {
  if (valor === null || valor === "") return;
  if (!isObjectIdValido(valor)) erros.push("processoId inválido");
};

export const validarCriacaoEvento = (dados) => {
  const erros = [];
  const corpo = dados ?? {};

  validarTipo(corpo.tipo, erros);
  validarTitulo(corpo.titulo, erros);

  if (corpo.data === undefined || corpo.data === null) {
    erros.push("data é obrigatória");
  } else {
    validarData(corpo.data, erros);
  }

  if (corpo.hora !== undefined) validarHora(corpo.hora, erros);
  if (corpo.descricao !== undefined) validarTextoOpcional(corpo.descricao, "descrição", erros);
  if (corpo.local !== undefined) validarTextoOpcional(corpo.local, "local", erros, { maximo: 200 });
  if (corpo.processoId !== undefined) validarProcessoId(corpo.processoId, erros);

  return erros;
};

export const validarAtualizacaoEvento = (dados) => {
  const erros = [];
  const corpo = dados ?? {};
  const enviou = (campo) => Object.prototype.hasOwnProperty.call(corpo, campo);

  if (enviou("tipo")) validarTipo(corpo.tipo, erros);
  if (enviou("titulo")) validarTitulo(corpo.titulo, erros);

  // `data: null` NÃO é apagar. A data é obrigatória, e um evento sem data não
  // tem onde existir num calendário: a recusa diz isso, em vez de deixar o
  // registro cair fora de toda consulta por intervalo e parecer que sumiu.
  if (enviou("data")) {
    if (corpo.data === null) erros.push("data não pode ser apagada — todo evento tem uma data");
    else validarData(corpo.data, erros);
  }

  if (enviou("hora")) validarHora(corpo.hora, erros);
  if (enviou("descricao")) validarTextoOpcional(corpo.descricao, "descrição", erros);
  if (enviou("local")) validarTextoOpcional(corpo.local, "local", erros, { maximo: 200 });
  if (enviou("processoId")) validarProcessoId(corpo.processoId, erros);

  return erros;
};

// ── Conclusão: rota própria, e por isso validação própria ────────────────
//
// `concluido` e `concluidoEm` NÃO entram na allowlist do PATCH comum: os dois
// descrevem um fato só e têm um ponto de escrita só, pela mesma razão que
// `fase` ganhou rota própria na DEC-054. Aceitá-los no PATCH deixaria gravar
// `concluido: true` com `concluidoEm: null` — dois campos discordando sobre o
// mesmo fato.
export const validarConclusaoEvento = (dados) => {
  const erros = [];
  const corpo = dados ?? {};

  if (typeof corpo.concluido !== "boolean") {
    erros.push("concluido deve ser booleano");
  }

  return erros;
};

export default {
  validarCriacaoEvento,
  validarAtualizacaoEvento,
  validarConclusaoEvento,
  MENSAGEM_FORMATO_DA_DATA,
  MENSAGEM_FORMATO_DA_HORA
};
