import mongoose from "mongoose";
import Document from "../models/Document.js";
import Process from "../models/Process.js";
import Client from "../models/Client.js";
import User from "../models/User.js";
import DocumentoSecao from "../models/DocumentoSecao.js";
import { CATALOGO_VARIAVEIS, orientacaoPendencia } from "../config/templateVariables.js";
import { substituir } from "../utils/templateParser.js";
import formatadores from "../utils/templateFormatters.js";

const createError = (message, statusCode, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

const assertIdValido = (id, rotulo) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw createError(`Identificador de ${rotulo} inválido`, 400);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PONTO ÚNICO DE ACOPLAMENTO COM A MODELAGEM DE CLIENTE DO PROCESSO
//
// Hoje Process tem `clienteId` (um cliente por processo). A DEC-026 vai
// transformar isso em N:N com um cliente principal. Todo o resolvedor lê o
// cliente POR AQUI — quando a junção existir, muda esta função e nada mais.
// ═══════════════════════════════════════════════════════════════════════════
export const resolverClientePrincipal = async (processo, usuarioId) => {
  if (!processo?.clienteId) return null;

  const clienteId = processo.clienteId?._id ?? processo.clienteId;
  return Client.findOne({ _id: clienteId, usuarioId, ativo: true });
};

// Leitura por caminho em notação de ponto ("endereco.cidade", "oab.numero").
const lerCaminho = (origem, caminho) => {
  if (!origem || !caminho) return undefined;
  return caminho.split(".").reduce((acc, chave) => {
    if (acc === undefined || acc === null) return undefined;
    // Subdocumento do Mongoose responde a .get(); objeto simples, não.
    return typeof acc.get === "function" && acc.get(chave) !== undefined
      ? acc.get(chave)
      : acc[chave];
  }, origem);
};

// Monta o dicionário {variavel: valorFormatado} a partir do catálogo.
// Só o catálogo decide o que existe — nunca os dados.
export const montarValores = ({ usuario, cliente, processo, hoje = new Date() }) => {
  const fontes = {
    usuario,
    cliente,
    processo,
    sistema: { hoje }
  };

  const valores = {};

  for (const [nome, def] of Object.entries(CATALOGO_VARIAVEIS)) {
    const fonte = fontes[def.origem];
    const bruto = lerCaminho(fonte, def.caminho);
    const formatador = formatadores[def.formatador] || formatadores.texto;
    valores[nome] = formatador(bruto);
  }

  return valores;
};

// Concatena os textos das seções na ordem, separados por linha em branco.
export const montarTextoDoModelo = (vinculos) =>
  vinculos
    .map((v) => v.secaoId?.texto)
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .join("\n\n");

const carregarVinculosOrdenados = (documentoId, usuarioId) =>
  DocumentoSecao.find({ documentoId, usuarioId, ativo: true })
    .populate("secaoId", "titulo tipo texto variaveis")
    .sort({ ordem: 1 });

const carregarContexto = async (processoId, usuarioId) => {
  assertIdValido(processoId, "processo");

  const processo = await Process.findOne({ _id: processoId, usuarioId, ativo: true });
  if (!processo) {
    throw createError("Processo não encontrado para este usuário", 404);
  }

  const cliente = await resolverClientePrincipal(processo, usuarioId);
  if (!cliente) {
    throw createError("O processo não tem cliente ativo vinculado", 422);
  }

  const usuario = await User.findById(usuarioId);
  if (!usuario) {
    throw createError("Usuário não encontrado", 404);
  }

  return { processo, cliente, usuario };
};

// Resolve o texto do modelo para um processo, SEM persistir nada.
const resolver = async (modelo, processoId, usuarioId) => {
  const vinculos = await carregarVinculosOrdenados(modelo._id, usuarioId);

  if (vinculos.length === 0) {
    throw createError("O modelo não possui seções vinculadas", 422);
  }

  const { processo, cliente, usuario } = await carregarContexto(processoId, usuarioId);

  const valores = montarValores({ usuario, cliente, processo });
  const textoModelo = montarTextoDoModelo(vinculos);
  const { texto, pendencias } = substituir(textoModelo, valores);

  return {
    processo,
    cliente,
    vinculos,
    valores,
    textoResolvido: texto,
    pendencias: pendencias.map(orientacaoPendencia)
  };
};

export const criarModeloService = async (usuarioId, payload) => {
  // ehModelo e origem são impostos aqui; processoId enviado é ignorado pelo
  // hook do schema — modelo não pertence a processo.
  const modelo = await Document.create({
    usuarioId,
    nome: payload.nome,
    tipo: payload.tipo,
    descricao: payload.descricao,
    ehModelo: true,
    origem: "gerado"
  });

  return modelo;
};

export const listarModelosService = async (usuarioId, { page = 1, limit = 20, tipo } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true, ehModelo: true };
  if (tipo) filter.tipo = tipo;

  const [data, total] = await Promise.all([
    Document.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Document.countDocuments(filter)
  ]);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const carregarModelo = async (modeloId, usuarioId) => {
  assertIdValido(modeloId, "modelo");

  const modelo = await Document.findOne({
    _id: modeloId,
    usuarioId,
    ativo: true,
    ehModelo: true
  });

  if (!modelo) {
    throw createError("Modelo não encontrado", 404);
  }

  return modelo;
};

export const gerarDocumentoService = async (modeloId, usuarioId, { processoId } = {}) => {
  if (!processoId) {
    throw createError("processoId é obrigatório para gerar o documento", 400);
  }

  const modelo = await carregarModelo(modeloId, usuarioId);
  const { vinculos, valores, textoResolvido, pendencias } = await resolver(
    modelo,
    processoId,
    usuarioId
  );

  // Documento incompleto não é gerado: preferimos recusar a produzir uma peça
  // com lacuna que só apareceria na leitura do juiz.
  if (pendencias.length > 0) {
    throw createError(
      "Não é possível gerar o documento: há informações faltando no cadastro",
      422,
      { errors: { pendencias } }
    );
  }

  const gerado = await Document.create({
    usuarioId,
    processoId,
    nome: modelo.nome,
    tipo: modelo.tipo,
    descricao: modelo.descricao,
    origem: "gerado",
    ehModelo: false,
    // Congelado: o texto e os valores usados ficam gravados e não acompanham
    // alterações posteriores no cadastro do cliente.
    textoResolvido,
    variaveisResolvidas: valores,
    dataGeracao: new Date(),
    geradoDeModeloId: modelo._id
  });

  // Replica a composição, para o documento gerado saber de quais seções veio.
  if (vinculos.length > 0) {
    await DocumentoSecao.insertMany(
      vinculos.map((v, i) => ({
        usuarioId,
        documentoId: gerado._id,
        secaoId: v.secaoId?._id ?? v.secaoId,
        ordem: i + 1
      }))
    );
  }

  return gerado;
};

export const previewDocumentoService = async (documentoId, usuarioId, { processoId } = {}) => {
  assertIdValido(documentoId, "documento");

  const documento = await Document.findOne({ _id: documentoId, usuarioId, ativo: true });
  if (!documento) {
    throw createError("Documento não encontrado", 404);
  }

  // Documento já gerado devolve o texto congelado — é o que vale juridicamente.
  if (!documento.ehModelo && documento.textoResolvido) {
    return {
      documentoId: documento._id,
      ehModelo: false,
      congelado: true,
      dataGeracao: documento.dataGeracao,
      textoResolvido: documento.textoResolvido,
      pendencias: []
    };
  }

  if (!documento.ehModelo) {
    throw createError(
      "Documento não é modelo e não possui texto gerado para pré-visualizar",
      400
    );
  }

  if (!processoId) {
    throw createError(
      "Informe processoId na query para pré-visualizar um modelo",
      400
    );
  }

  const { textoResolvido, pendencias, cliente, processo } = await resolver(
    documento,
    processoId,
    usuarioId
  );

  // Preview NÃO persiste: é só leitura, inclusive quando há pendências.
  return {
    documentoId: documento._id,
    ehModelo: true,
    congelado: false,
    processoId: processo._id,
    clienteId: cliente._id,
    textoResolvido,
    pendencias
  };
};

export const alternarVisibilidadePortalService = async (documentoId, usuarioId, visivelPortal) => {
  assertIdValido(documentoId, "documento");

  const documento = await Document.findOne({ _id: documentoId, usuarioId, ativo: true });
  if (!documento) {
    throw createError("Documento não encontrado", 404);
  }

  // Modelo é peça interna de trabalho: nunca vai para o portal do cliente.
  if (documento.ehModelo) {
    throw createError("Modelo não pode ser exibido no portal do cliente", 400);
  }

  documento.visivelPortal =
    typeof visivelPortal === "boolean" ? visivelPortal : !documento.visivelPortal;

  await documento.save();

  return documento;
};

export default {
  resolverClientePrincipal,
  montarValores,
  montarTextoDoModelo,
  criarModeloService,
  listarModelosService,
  gerarDocumentoService,
  previewDocumentoService,
  alternarVisibilidadePortalService
};
