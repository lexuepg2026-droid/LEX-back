import Secao from "../models/Secao.js";
import DocumentoSecao from "../models/DocumentoSecao.js";
import Document from "../models/Document.js";
import secaoValidation from "../validations/secaoValidation.js";

const erro = (message, statusCode, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

const assertIdValido = (secaoId) => {
  const invalido = secaoValidation.validarIdSecao(secaoId);
  if (invalido) throw erro(invalido, 400);
};

const handleDuplicateKeyError = (error) => {
  if (error?.code === 11000) {
    throw erro("Já existe uma seção ativa com este título", 409, { campo: "titulo" });
  }
  throw error;
};

export const createSecao = async (usuarioId, data) => {
  const validationError = secaoValidation.validateCreateSecaoPayload(data);
  if (validationError) throw erro(validationError, 400);

  try {
    return await Secao.create({
      usuarioId,
      titulo: data.titulo.trim(),
      tipo: data.tipo,
      texto: data.texto
    });
  } catch (error) {
    handleDuplicateKeyError(error);
  }
};

export const listSecoes = async (usuarioId, { page = 1, limit = 20, tipo, busca } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true };
  if (tipo) filter.tipo = tipo;
  if (busca && typeof busca === "string") {
    const termo = busca.slice(0, 80).trim();
    if (termo) {
      filter.titulo = new RegExp(termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
  }

  const [data, total] = await Promise.all([
    Secao.find(filter).sort({ titulo: 1 }).skip(skip).limit(limit),
    Secao.countDocuments(filter)
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const getSecaoById = async (usuarioId, secaoId) => {
  assertIdValido(secaoId);

  const secao = await Secao.findOne({ _id: secaoId, usuarioId, ativo: true });
  if (!secao) throw erro("Seção não encontrada", 404);

  return secao;
};

export const updateSecao = async (usuarioId, secaoId, payload) => {
  assertIdValido(secaoId);

  const validationError = secaoValidation.validateUpdateSecaoPayload(payload);
  if (validationError) throw erro(validationError, 400);

  const secao = await Secao.findOne({ _id: secaoId, usuarioId, ativo: true });
  if (!secao) throw erro("Seção não encontrada", 404);

  // Merge parcial: só sobrescreve o que veio no payload.
  if (payload.titulo !== undefined) secao.titulo = payload.titulo.trim();
  if (payload.tipo !== undefined) secao.tipo = payload.tipo;
  // O hook pre("validate") recalcula `variaveis` a partir do novo texto.
  if (payload.texto !== undefined) secao.texto = payload.texto;

  try {
    await secao.save();
  } catch (error) {
    handleDuplicateKeyError(error);
  }

  return secao;
};

// Quantos documentos ATIVOS usam esta seção. Usado para bloquear a exclusão.
export const contarDocumentosVinculados = async (usuarioId, secaoId) => {
  const vinculos = await DocumentoSecao.find({
    usuarioId,
    secaoId,
    ativo: true
  }).select("documentoId");

  if (vinculos.length === 0) return { total: 0, documentos: [] };

  // O vínculo pode ter sobrevivido a um documento já desativado; conta só os
  // documentos que ainda estão ativos.
  const documentos = await Document.find({
    _id: { $in: vinculos.map((v) => v.documentoId) },
    usuarioId,
    ativo: true
  }).select("nome ehModelo");

  return { total: documentos.length, documentos };
};

export const deleteSecao = async (usuarioId, secaoId) => {
  assertIdValido(secaoId);

  const secao = await Secao.findOne({ _id: secaoId, usuarioId, ativo: true });
  if (!secao) throw erro("Seção não encontrada", 404);

  // Mesma regra de integridade referencial já aplicada em honorário, parcela e
  // processo: não se apaga o que está em uso.
  const { total, documentos } = await contarDocumentosVinculados(usuarioId, secaoId);
  if (total > 0) {
    throw erro(
      `Seção vinculada a ${total} documento(s) ativo(s). Desvincule antes de excluir.`,
      409,
      { errors: { documentos: documentos.map((d) => d.nome) } }
    );
  }

  secao.ativo = false;
  await secao.save();

  return secao;
};

export default {
  createSecao,
  listSecoes,
  getSecaoById,
  updateSecao,
  deleteSecao,
  contarDocumentosVinculados
};
