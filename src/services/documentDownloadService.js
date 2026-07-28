import mongoose from "mongoose";
import Document from "../models/Document.js";
import User from "../models/User.js";
import Client from "../models/Client.js";
import { renderizarDocumento, FORMATOS } from "./documentRenderService.js";

// Camada fina entre a rota e o renderizador: carrega o que o timbrado precisa e
// delega. O `documentRenderService` não toca no banco de propósito — sem acesso
// a Mongoose ele é testável com objetos literais, e o layout pode ser conferido
// sem subir base.

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const baixarDocumentoService = async (documentoId, usuarioId, formato) => {
  if (!mongoose.Types.ObjectId.isValid(documentoId)) {
    throw createError("Identificador de documento inválido", 400);
  }

  const normalizado = String(formato ?? "pdf").toLowerCase().trim();
  if (!FORMATOS.includes(normalizado)) {
    throw createError(
      `Formato inválido: "${formato}". Use ${FORMATOS.join(" ou ")}.`,
      400
    );
  }

  const documento = await Document.findOne({ _id: documentoId, usuarioId, ativo: true });
  if (!documento) {
    throw createError("Documento não encontrado", 404);
  }

  // Modelo não é peça: é a composição de seções que produz peças. Baixar um
  // modelo entregaria um arquivo com {{variáveis}} por resolver.
  if (documento.ehModelo) {
    throw createError(
      "Modelos não podem ser baixados. Gere o documento a partir do modelo e baixe o resultado.",
      400
    );
  }

  // Upload é arquivo que já existe em `urlArquivo` — não há texto para
  // renderizar, e gerar um PDF vazio seria pior que recusar.
  if (documento.origem !== "gerado" || !documento.textoResolvido) {
    throw createError(
      "Apenas documentos gerados podem ser baixados em PDF ou DOCX.",
      400
    );
  }

  const [usuario, cliente] = await Promise.all([
    User.findById(usuarioId),
    documento.clienteId
      ? Client.findOne({ _id: documento.clienteId, usuarioId })
      : null
  ]);

  if (!usuario) {
    throw createError("Usuário não encontrado", 404);
  }

  return renderizarDocumento({ documento, usuario, cliente, formato: normalizado });
};

export default { baixarDocumentoService };
