import Fee from "../models/Fee.js";
import Process from "../models/Process.js";
import Installment from "../models/Installment.js";
import {
  validateCreateFee,
  validateUpdateFee,
  validateFeeId
} from "../validations/feeValidation.js";
import { DEPENDENCIA } from "../config/integrityConflicts.js";
import { checarUpdate } from "../validations/shared/camposPermitidos.js";
import { recalcularStatusFee } from "./paymentService.js";
import { filtroObjectId } from "../utils/filtrosDeConsulta.js";

// ═══════════════════════════════════════════════════════════════════════════
// DEC-027 (Fase 4.1) — as três peças que saíram no MESMO commit
//
//   1. o hook condicional de `percentual`/`valorBase` (`models/Fee.js`);
//   2. este service migrado de `findOneAndUpdate` para `save()`;
//   3. `campo` nos erros de campo, que só nascem com a regra do item 1.
//
// Separadas, cada uma entrega menos do que parece: o hook sem o `save()` não
// roda no update, e o `campo` sem o hook não tem erro nenhum para descrever.
// ═══════════════════════════════════════════════════════════════════════════

const hasOwn = (data, campo) => Object.prototype.hasOwnProperty.call(data, campo);

// Apagar campo grava `null`, nunca `undefined` — convenção do projeto.
// `Number(null)` é 0, e 0 é um percentual que o hook recusa: sem este cuidado,
// "apagar o percentual" viraria "percentual zero" e a mensagem de erro falaria
// de faixa em vez de dizer que o campo não pode ficar ali.
const numeroOuNulo = (valor) => {
  if (valor === null || valor === "" || valor === undefined) return null;
  return Number(valor);
};

const sanitizeFeeData = (data) => {
  const sanitized = {};

  if (hasOwn(data, "processoId")) {
    sanitized.processoId = data.processoId;
  }

  if (hasOwn(data, "descricao")) {
    sanitized.descricao = data.descricao?.trim();
  }

  if (hasOwn(data, "valor")) {
    sanitized.valor = Number(data.valor);
  }

  if (hasOwn(data, "tipo")) {
    sanitized.tipo = data.tipo?.trim();
  }

  if (hasOwn(data, "status")) {
    sanitized.status = data.status?.trim();
  }

  if (hasOwn(data, "dataVencimento")) {
    sanitized.dataVencimento = new Date(data.dataVencimento);
  }

  if (hasOwn(data, "ativo")) {
    sanitized.ativo = data.ativo;
  }

  if (hasOwn(data, "percentual")) {
    sanitized.percentual = numeroOuNulo(data.percentual);
  }

  if (hasOwn(data, "valorBase")) {
    sanitized.valorBase = numeroOuNulo(data.valorBase);
  }

  return sanitized;
};

// ── DEC-027, item 3: `campo` nos erros de campo do honorário ───────────────
//
// `campo` é o nome do input a destacar. Só sai quando exatamente UM campo é
// responsável: com dois erros, mandar a tela destacar o primeiro esconderia o
// segundo, que é pior do que não destacar nada — a advogada corrigiria um,
// reenviaria e levaria o mesmo 400.
//
// NÃO se usa no 409 de integridade (`deleteFee`). Lá não há input em conflito:
// o conflito é entre registros já gravados, e destacar um campo do formulário
// mandaria corrigir o que não tem nada de errado. A distinção está no
// CLAUDE.md e tem teste travando as duas pontas.
const erroDeCampo = (message, statusCode, campos, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (Array.isArray(campos)) {
    const unicos = [...new Set(campos)];
    if (unicos.length === 1) error.campo = unicos[0];
  }
  Object.assign(error, extra);
  return error;
};

const erroDeValidacao = (validation) =>
  erroDeCampo(validation.errors.join(", "), 400, validation.campos);

// O `pre("validate")` do model lança `ValidationError`, que o `errorHandler`
// já converte em 400 com `errors` por caminho. Falta só o `campo`: sem ele o
// `getApiErrorField` do FeeFormPage continuaria inerte, que é exatamente a
// dívida que a DEC-027 mandou fechar.
const comCampoDoModel = (erro) => {
  if (erro?.name !== "ValidationError") return erro;
  const caminhos = Object.keys(erro.errors || {});
  if (caminhos.length === 1) erro.campo = caminhos[0];
  return erro;
};

const gravar = async (documento) => {
  try {
    return await documento.save();
  } catch (erro) {
    throw comCampoDoModel(erro);
  }
};

const ensureProcessBelongsToUser = async (processoId, usuarioId) => {
  const process = await Process.findOne({
    _id: processoId,
    usuarioId,
    ativo: true
  });

  if (!process) {
    const error = new Error("Processo não encontrado para este usuário");
    error.statusCode = 404;
    throw error;
  }

  return process;
};

const createFee = async (usuarioId, feeData) => {
  const validation = validateCreateFee(feeData);

  if (!validation.isValid) {
    throw erroDeValidacao(validation);
  }

  await ensureProcessBelongsToUser(feeData.processoId, usuarioId);

  const sanitizedData = sanitizeFeeData(feeData);

  // `new` + `save()`, e não `Fee.create()`: são equivalentes hoje, mas escrever
  // as duas gravações do service pelo mesmo caminho é o que impede alguém de
  // "otimizar" só uma delas de volta para um método que pula o hook.
  const fee = new Fee({ ...sanitizedData, usuarioId });
  await gravar(fee);

  // DEC-028: `status` é derivado. O que veio no corpo vale como intenção
  // inicial e é imediatamente reconciliado com as parcelas — que num honorário
  // recém-criado são zero, logo `pendente`. A exceção é `cancelado`, que a
  // guarda de `recalcularStatusFee` preserva: é o único status que a advogada
  // escreve e o sistema respeita.
  const derivado = await recalcularStatusFee(fee._id, usuarioId);

  return derivado || fee;
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const listFees = async (usuarioId, { page = 1, limit = 20, processoId, busca, tipo, status } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true };
  // Guarda de tipo (Fase 4.5): só ObjectId em string entra na query.
  const processoFiltro = filtroObjectId(processoId);
  if (processoFiltro) filter.processoId = processoFiltro;
  if (busca && typeof busca === 'string') {
    const termo = busca.slice(0, 80).trim();
    if (termo) filter.descricao = new RegExp(escapeRegex(termo), 'i');
  }
  if (tipo && typeof tipo === 'string') filter.tipo = tipo;
  if (status && typeof status === 'string') filter.status = status;
  const [data, total] = await Promise.all([
    Fee.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("processoId", "titulo numeroProcesso"),
    Fee.countDocuments(filter)
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getFeeById = async (feeId, usuarioId) => {
  const validation = validateFeeId(feeId);

  if (!validation.isValid) {
    throw erroDeValidacao(validation);
  }

  const fee = await Fee.findOne({
    _id: feeId,
    usuarioId,
    ativo: true
  }).populate("processoId", "titulo numeroProcesso");

  if (!fee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  return fee;
};

const updateFee = async (feeId, usuarioId, updateData) => {
  // Allowlist da Fase 4.5 — `ativo` fora do corpo (achados #1/#2/#11).
  const recusado = checarUpdate("fees", updateData);
  if (recusado) {
    throw erroDeCampo(recusado.mensagem, 400, recusado.campo ? [recusado.campo] : null);
  }
  const idValidation = validateFeeId(feeId);

  if (!idValidation.isValid) {
    throw erroDeValidacao(idValidation);
  }

  const validation = validateUpdateFee(updateData);

  if (!validation.isValid) {
    throw erroDeValidacao(validation);
  }

  // O escopo `{ usuarioId, ativo: true }` desta leitura é o que sustenta o 404
  // para recurso de outro usuário. Ele estava no filtro do `findOneAndUpdate` e
  // continua aqui: a migração para `save()` não pode transformar "não é seu" em
  // "não existe mais" nem, muito pior, em 200.
  const existingFee = await Fee.findOne({
    _id: feeId,
    usuarioId,
    ativo: true
  });

  if (!existingFee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  if (hasOwn(updateData, "processoId")) {
    await ensureProcessBelongsToUser(updateData.processoId, usuarioId);
  }

  const sanitizedData = sanitizeFeeData(updateData);

  delete sanitizedData.usuarioId;

  // ── DEC-027, item 2 ──────────────────────────────────────────────────────
  // Era `Fee.findOneAndUpdate(..., { runValidators: true })`. `runValidators`
  // roda os validadores de CAMINHO do schema, e não `pre("validate")`: a regra
  // condicional do item 1 — que precisa enxergar `tipo`, `percentual` e
  // `valorBase` juntos — não teria como rodar por ali. O update é justamente
  // onde a advogada troca o tipo de cobrança, ou seja, exatamente o caminho que
  // ficaria sem regra.
  //
  // Semântica preservada: só os campos presentes no corpo são atribuídos, como
  // no `$set` implícito de antes.
  Object.assign(existingFee, sanitizedData);

  await gravar(existingFee);

  // Reconcilia com as parcelas depois da gravação: se o corpo trouxe um
  // `status` que contradiz o que as parcelas dizem, quem manda são as
  // parcelas. `cancelado` é a exceção, e é assim que se cancela um honorário.
  const derivado = await recalcularStatusFee(existingFee._id, usuarioId);

  return derivado || existingFee;
};

const deleteFee = async (feeId, usuarioId) => {
  const validation = validateFeeId(feeId);

  if (!validation.isValid) {
    throw erroDeValidacao(validation);
  }

  const fee = await Fee.findOne({
    _id: feeId,
    usuarioId,
    ativo: true
  });

  if (!fee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  const installmentsAtivas = await Installment.countDocuments({ feeId: fee._id, ativo: true });
  if (installmentsAtivas > 0) {
    const uma = installmentsAtivas === 1;
    // `dependencia` e `quantidade` são para o frontend; a prosa é o que a
    // advogada lê, e passa a citar o número em vez de só dizer que existem.
    //
    // DEC-027, item 3, a metade que NÃO muda: este 409 continua SEM `campo`.
    // A fase acrescentou `campo` aos erros de campo do honorário, e este não é
    // um deles — não há input em conflito, há parcela gravada. Ver o contrato
    // dos dois tipos de 409 no CLAUDE.md.
    const error = new Error(
      `Não é possível excluir este honorário: ${uma ? "existe" : "existem"} ${installmentsAtivas} ` +
      `${uma ? "parcela ativa vinculada" : "parcelas ativas vinculadas"}. Exclua as parcelas antes.`
    );
    error.statusCode = 409;
    error.dependencia = DEPENDENCIA.PARCELAS;
    error.quantidade = installmentsAtivas;
    throw error;
  }

  fee.ativo = false;
  await fee.save();
  return fee;
};

export default {
  createFee,
  listFees,
  getFeeById,
  updateFee,
  deleteFee
};