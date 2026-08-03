import mongoose from "mongoose";
import Document from "../models/Document.js";
import Process from "../models/Process.js";
import Secao from "../models/Secao.js";
import DocumentoSecao from "../models/DocumentoSecao.js";
import { filtroObjectId } from "../utils/filtrosDeConsulta.js";

const createError = (message, statusCode, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

const assertIdValido = (id, rotulo = "documento") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw createError(`Identificador de ${rotulo} inválido`, 400);
  }
};

const ensureProcessBelongsToUser = async (processoId, usuarioId) => {
  const process = await Process.findOne({
    _id: processoId,
    usuarioId,
    ativo: true
  });

  if (!process) {
    throw createError("Processo não encontrado para este usuário", 404);
  }

  return process;
};

const ensureDocumentBelongsToUser = async (documentId, usuarioId) => {
  const document = await Document.findOne({
    _id: documentId,
    usuarioId,
    ativo: true
  });

  if (!document) {
    throw createError("Documento não encontrado", 404);
  }

  return document;
};

export const createDocumentService = async (usuarioId, payload) => {
  // Modelo não pertence a processo — só validamos o vínculo quando ele existe.
  if (payload.processoId) {
    await ensureProcessBelongsToUser(payload.processoId, usuarioId);
  }

  const document = await Document.create({
    usuarioId,
    processoId: payload.processoId,
    nome: payload.nome,
    tipo: payload.tipo,
    descricao: payload.descricao,
    origem: payload.origem,
    ehModelo: payload.ehModelo,
    visivelPortal: payload.visivelPortal,
    urlArquivo: payload.urlArquivo,
    tamanho: payload.tamanho,
    dataUpload: payload.dataUpload,
    ativo: payload.ativo
  });

  return document;
};

export const listDocumentsService = async (usuarioId, { page = 1, limit = 20, processoId } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true };
  // Guarda de tipo (Fase 4.5): só ObjectId em string entra na query.
  const processoFiltro = filtroObjectId(processoId);
  if (processoFiltro) filter.processoId = processoFiltro;
  const [data, total] = await Promise.all([
    Document.find(filter)
      .populate("processoId", "titulo numeroProcesso status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Document.countDocuments(filter)
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const getDocumentByIdService = async (documentId, usuarioId) => {
  const document = await Document.findOne({
    _id: documentId,
    usuarioId,
    ativo: true
  }).populate("processoId", "titulo numeroProcesso status");

  if (!document) {
    throw createError("Documento não encontrado", 404);
  }

  return document;
};

// Campos que o update aceita. `usuarioId` e os campos de geração
// (textoResolvido, variaveisResolvidas, dataGeracao, geradoDeModeloId) ficam de
// fora de propósito: documento gerado é congelado e não se reescreve por PATCH.
const CAMPOS_EDITAVEIS = [
  "processoId",
  "nome",
  "tipo",
  "descricao",
  "origem",
  "visivelPortal",
  "urlArquivo",
  "tamanho",
  "dataUpload"
];

export const updateDocumentService = async (documentId, usuarioId, payload) => {
  // Carrega o documento e aplica o merge EM MEMÓRIA, salvando com save().
  //
  // findOneAndUpdate não dispara o hook pre("validate"), então toda a validação
  // condicional do schema (processoId obrigatório fora de modelo, urlArquivo
  // obrigatório em upload) era contornável pelo update: regra que só valia na
  // criação não é regra. Mesma correção que a Fase 1.3 aplicou em clientService.
  const document = await ensureDocumentBelongsToUser(documentId, usuarioId);

  if (payload.processoId) {
    await ensureProcessBelongsToUser(payload.processoId, usuarioId);
  }

  // ehModelo é imutável depois da criação. Virar modelo descartaria o processo
  // (o hook zera processoId) e, num upload, deixaria órfão um arquivo real —
  // perda silenciosa de dado, sem caso de uso legítimo. Modelo se cria por
  // POST /documents/modelos.
  if (payload.ehModelo !== undefined && payload.ehModelo !== document.ehModelo) {
    throw createError(
      "ehModelo não pode ser alterado após a criação. Crie um modelo por POST /api/documents/modelos.",
      400,
      { campo: "ehModelo" }
    );
  }

  // `ativo` sai pelo DELETE, que cascateia nos vínculos. Aceitá-lo aqui criaria
  // um segundo caminho de exclusão, sem cascata — exatamente o tipo de
  // inconsistência que a Parte 2 corrige.
  if (payload.ativo === false) {
    throw createError(
      "Use DELETE /api/documents/:id para desativar o documento",
      400,
      { campo: "ativo" }
    );
  }

  for (const campo of CAMPOS_EDITAVEIS) {
    if (Object.prototype.hasOwnProperty.call(payload, campo)) {
      document[campo] = payload[campo];
    }
  }

  // save() roda o pre("validate") e os validadores do schema.
  await document.save();

  return document.populate("processoId", "titulo numeroProcesso status");
};

export const deleteDocumentService = async (documentId, usuarioId) => {
  const document = await ensureDocumentBelongsToUser(documentId, usuarioId);

  document.ativo = false;
  await document.save();

  // Cascata: sem isso ficavam vínculos ativos apontando para documento inativo,
  // e uma seção continuava "em uso" por um documento que já não existe — a
  // exclusão da seção era recusada para sempre.
  const { modifiedCount } = await DocumentoSecao.updateMany(
    { documentoId: document._id, usuarioId, ativo: true },
    { $set: { ativo: false } }
  );

  if (modifiedCount > 0) {
    console.log(
      `[documento ${document._id}] soft delete em cascata: ${modifiedCount} vínculo(s) de seção desativado(s)`
    );
  }

  return document;
};
// ═══════════════════════════════════════════════════════════════════════════
// Composição: vínculos documento ↔ seção
// ═══════════════════════════════════════════════════════════════════════════

// Reescreve as ordens em DUAS FASES, numa única bulkWrite ordenada.
//
// O índice único {documentoId, ordem} é verificado a cada operação, não ao fim
// do lote. Reatribuir 1..N direto colide no meio do caminho: inverter [1,2]
// tentaria gravar ordem 2 enquanto o outro vínculo ainda a ocupa.
//
// Fase 1 desloca todos para um intervalo temporário negativo — que nunca colide
// com ordem real (>= 1) nem consigo mesmo. Fase 2 grava as ordens definitivas,
// já com todas as posições livres. Os negativos passam porque bulkWrite não
// roda os validators do schema (o `min: 1` vale para save()/create()).
const aplicarOrdens = async (pares) => {
  if (pares.length === 0) return;

  const ops = [];
  pares.forEach(({ _id }, i) => {
    ops.push({ updateOne: { filter: { _id }, update: { $set: { ordem: -(i + 1) } } } });
  });
  pares.forEach(({ _id, ordem }) => {
    ops.push({ updateOne: { filter: { _id }, update: { $set: { ordem } } } });
  });

  await DocumentoSecao.bulkWrite(ops, { ordered: true });
};

const listarVinculosOrdenados = (documentoId, usuarioId) =>
  DocumentoSecao.find({ documentoId, usuarioId, ativo: true }).sort({ ordem: 1 });

// Autocorreção na leitura.
//
// A renumeração em duas fases não é transacional: uma queda entre a fase dos
// negativos e a das ordens definitivas deixaria vínculos com ordem < 1. Em vez
// de pagar o custo de uma transação para uma janela de milissegundos, a leitura
// conserta o estado — o `sort({ ordem: 1 })` já traz os negativos primeiro, na
// sequência relativa correta, então basta reescrever 1..N por cima.
const autocorrigirOrdens = async (documentoId, usuarioId) => {
  const vinculos = await listarVinculosOrdenados(documentoId, usuarioId);

  if (!vinculos.some((v) => v.ordem < 1)) return false;

  console.warn(
    `[documento ${documentoId}] ordens inválidas detectadas (${vinculos
      .map((v) => v.ordem)
      .join(", ")}) — renumerando ${vinculos.length} vínculo(s) de 1 a ${vinculos.length}`
  );

  await aplicarOrdens(vinculos.map((v, i) => ({ _id: v._id, ordem: i + 1 })));
  return true;
};

export const listDocumentSecoesService = async (documentoId, usuarioId) => {
  assertIdValido(documentoId);
  await ensureDocumentBelongsToUser(documentoId, usuarioId);

  await autocorrigirOrdens(documentoId, usuarioId);

  const data = await DocumentoSecao.find({ documentoId, usuarioId, ativo: true })
    .populate("secaoId", "titulo tipo texto variaveis")
    .sort({ ordem: 1 });

  // Mesmo envelope de toda listagem. O conjunto é limitado às seções de um
  // documento e não pagina: uma página só, `limit` igual ao tamanho — a mesma
  // forma que `listarInstallments` e `listarPayments` já usam quando filtram
  // por processo.
  return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
};

export const vincularSecaoService = async (documentoId, usuarioId, { secaoId, ordem } = {}) => {
  assertIdValido(documentoId);
  assertIdValido(secaoId, "seção");
  await ensureDocumentBelongsToUser(documentoId, usuarioId);

  const secao = await Secao.findOne({ _id: secaoId, usuarioId, ativo: true });
  if (!secao) {
    throw createError("Seção não encontrada para este usuário", 404);
  }

  const jaVinculada = await DocumentoSecao.findOne({
    documentoId,
    secaoId,
    usuarioId,
    ativo: true
  });
  if (jaVinculada) {
    throw createError("Esta seção já está vinculada ao documento", 409, { campo: "secaoId" });
  }

  const atuais = await listarVinculosOrdenados(documentoId, usuarioId);

  // Ordem omitida anexa ao final; informada insere na posição, empurrando as
  // seguintes. Fora do intervalo é encaixada na borda mais próxima.
  const posicao =
    ordem === undefined || ordem === null
      ? atuais.length + 1
      : Math.min(Math.max(parseInt(ordem, 10) || 1, 1), atuais.length + 1);

  // Cria fora da faixa disputada para não colidir com quem ainda ocupa a posição.
  const novo = await DocumentoSecao.create({
    usuarioId,
    documentoId,
    secaoId,
    ordem: atuais.length + 1000
  });

  const sequencia = [...atuais];
  sequencia.splice(posicao - 1, 0, novo);
  await aplicarOrdens(sequencia.map((v, i) => ({ _id: v._id, ordem: i + 1 })));

  return DocumentoSecao.findById(novo._id).populate("secaoId", "titulo tipo texto variaveis");
};

export const desvincularSecaoService = async (documentoId, usuarioId, secaoId) => {
  assertIdValido(documentoId);
  assertIdValido(secaoId, "seção");
  await ensureDocumentBelongsToUser(documentoId, usuarioId);

  const vinculo = await DocumentoSecao.findOne({
    documentoId,
    secaoId,
    usuarioId,
    ativo: true
  });
  if (!vinculo) {
    throw createError("Seção não está vinculada a este documento", 404);
  }

  vinculo.ativo = false;
  await vinculo.save();

  // Renumera o que sobrou para não deixar buraco na sequência.
  const restantes = await listarVinculosOrdenados(documentoId, usuarioId);
  await aplicarOrdens(restantes.map((v, i) => ({ _id: v._id, ordem: i + 1 })));

  return { message: "Seção desvinculada do documento", secoesRestantes: restantes.length };
};

export const reordenarSecoesService = async (documentoId, usuarioId, secoes) => {
  assertIdValido(documentoId);
  await ensureDocumentBelongsToUser(documentoId, usuarioId);

  if (!Array.isArray(secoes) || secoes.length === 0) {
    throw createError("Informe o array `secoes` com os ids na ordem desejada", 400);
  }

  const idsInformados = secoes.map(String);
  if (new Set(idsInformados).size !== idsInformados.length) {
    throw createError("O array `secoes` contém ids repetidos", 400);
  }

  const atuais = await listarVinculosOrdenados(documentoId, usuarioId);
  const idsAtuais = atuais.map((v) => String(v.secaoId));

  // Nem faltando nem sobrando: reordenar é permutar, não incluir nem remover.
  const faltando = idsAtuais.filter((id) => !idsInformados.includes(id));
  const sobrando = idsInformados.filter((id) => !idsAtuais.includes(id));

  if (faltando.length > 0 || sobrando.length > 0) {
    throw createError(
      "O array `secoes` deve conter exatamente as seções vinculadas ao documento",
      400,
      { errors: { faltando, sobrando, esperado: idsAtuais.length, recebido: idsInformados.length } }
    );
  }

  const porSecaoId = new Map(atuais.map((v) => [String(v.secaoId), v]));
  await aplicarOrdens(
    idsInformados.map((secaoId, i) => ({ _id: porSecaoId.get(secaoId)._id, ordem: i + 1 }))
  );

  return DocumentoSecao.find({ documentoId, usuarioId, ativo: true })
    .populate("secaoId", "titulo tipo texto variaveis")
    .sort({ ordem: 1 });
};
