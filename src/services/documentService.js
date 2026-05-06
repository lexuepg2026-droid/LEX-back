import Document from "../models/Document.js";
import Process from "../models/Process.js";

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const ensureProcessBelongsToUser = async (processoId, usuarioId) => {
  const process = await Process.findOne({
    _id: processoId,
    usuarioId
  });

  if (!process) {
    throw createError("Processo não encontrado para este usuário", 404);
  }

  return process;
};

const ensureDocumentBelongsToUser = async (documentId, usuarioId) => {
  const document = await Document.findOne({
    _id: documentId,
    usuarioId
  });

  if (!document) {
    throw createError("Documento não encontrado", 404);
  }

  return document;
};

export const createDocumentService = async (usuarioId, payload) => {
  await ensureProcessBelongsToUser(payload.processoId, usuarioId);

  const document = await Document.create({
    usuarioId,
    processoId: payload.processoId,
    nome: payload.nome,
    tipo: payload.tipo,
    descricao: payload.descricao,
    urlArquivo: payload.urlArquivo,
    tamanho: payload.tamanho,
    dataUpload: payload.dataUpload,
    ativo: payload.ativo
  });

  return document;
};

export const listDocumentsService = async (usuarioId) => {
  const documents = await Document.find({ usuarioId })
    .populate("processoId", "titulo numeroProcesso status")
    .sort({ createdAt: -1 });

  return documents;
};

export const getDocumentByIdService = async (documentId, usuarioId) => {
  const document = await Document.findOne({
    _id: documentId,
    usuarioId
  }).populate("processoId", "titulo numeroProcesso status");

  if (!document) {
    throw createError("Documento não encontrado", 404);
  }

  return document;
};

export const updateDocumentService = async (documentId, usuarioId, payload) => {
  const existingDocument = await ensureDocumentBelongsToUser(documentId, usuarioId);

  if (payload.processoId) {
    await ensureProcessBelongsToUser(payload.processoId, usuarioId);
  }

  const updateData = {
    ...payload
  };

  const updatedDocument = await Document.findOneAndUpdate(
    {
      _id: existingDocument._id,
      usuarioId
    },
    updateData,
    {
      new: true,
      runValidators: true
    }
  ).populate("processoId", "titulo numeroProcesso status");

  return updatedDocument;
};

export const deleteDocumentService = async (documentId, usuarioId) => {
  const document = await ensureDocumentBelongsToUser(documentId, usuarioId);

  await Document.deleteOne({
    _id: document._id,
    usuarioId
  });

  return {
    message: "Documento removido com sucesso"
  };
};