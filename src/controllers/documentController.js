import {
  createDocumentService,
  listDocumentsService,
  getDocumentByIdService,
  updateDocumentService,
  deleteDocumentService,
  listDocumentSecoesService,
  vincularSecaoService,
  desvincularSecaoService,
  reordenarSecoesService
} from "../services/documentService.js";
import {
  criarModeloService,
  listarModelosService,
  gerarDocumentoService,
  previewDocumentoService,
  atualizarTextoService,
  alternarVisibilidadePortalService
} from "../services/documentGenerationService.js";
import { baixarDocumentoService } from "../services/documentDownloadService.js";
import { montarCatalogoParaExibicao } from "../config/variableLabels.js";
import {
  validateCreateDocument,
  validateUpdateDocument,
  validateDocumentId,
  validateCreateModelo
} from "../validations/documentValidation.js";

export const createDocument = async (req, res, next) => {
  try {
    const { isValid, errors, data } = validateCreateDocument(req.body);

    if (!isValid) {
      const err = new Error("Dados inválidos");
      err.statusCode = 400;
      err.errors = errors;
      return next(err);
    }

    const document = await createDocumentService(req.user._id, data);
    return res.status(201).json(document);
  } catch (error) {
    return next(error);
  }
};

export const listDocuments = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { processoId } = req.query;
    const result = await listDocumentsService(req.user._id, { page, limit, processoId });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getDocumentById = async (req, res, next) => {
  try {
    const idValidation = validateDocumentId(req.params.id);

    if (!idValidation.isValid) {
      const err = new Error(idValidation.error);
      err.statusCode = 400;
      return next(err);
    }

    const document = await getDocumentByIdService(req.params.id, req.user._id);
    return res.status(200).json(document);
  } catch (error) {
    return next(error);
  }
};

export const updateDocument = async (req, res, next) => {
  try {
    const idValidation = validateDocumentId(req.params.id);

    if (!idValidation.isValid) {
      const err = new Error(idValidation.error);
      err.statusCode = 400;
      return next(err);
    }

    const { isValid, errors, data, campo } = validateUpdateDocument(req.body);

    if (!isValid) {
      // `campo` só vem quando a allowlist recusou um campo nomeado; nesse caso
      // a mensagem dele é a redação final e vale mais que o "Dados inválidos"
      // genérico, que a tela não sabe onde destacar.
      const err = new Error(campo ? errors[0] : "Dados inválidos");
      err.statusCode = 400;
      err.errors = errors;
      if (campo) err.campo = campo;
      return next(err);
    }

    const document = await updateDocumentService(req.params.id, req.user._id, data);
    return res.status(200).json(document);
  } catch (error) {
    return next(error);
  }
};

export const deleteDocument = async (req, res, next) => {
  try {
    const idValidation = validateDocumentId(req.params.id);

    if (!idValidation.isValid) {
      const err = new Error(idValidation.error);
      err.statusCode = 400;
      return next(err);
    }

    const result = await deleteDocumentService(req.params.id, req.user._id);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

// ── Composição: vínculos documento ↔ seção ────────────────────────────────

export const listDocumentSecoes = async (req, res, next) => {
  try {
    const vinculos = await listDocumentSecoesService(req.params.id, req.user._id);
    return res.status(200).json(vinculos);
  } catch (error) {
    return next(error);
  }
};

export const vincularSecao = async (req, res, next) => {
  try {
    const vinculo = await vincularSecaoService(req.params.id, req.user._id, req.body);
    return res.status(201).json(vinculo);
  } catch (error) {
    return next(error);
  }
};

export const desvincularSecao = async (req, res, next) => {
  try {
    const result = await desvincularSecaoService(
      req.params.id,
      req.user._id,
      req.params.secaoId
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const reordenarSecoes = async (req, res, next) => {
  try {
    const vinculos = await reordenarSecoesService(
      req.params.id,
      req.user._id,
      req.body?.secoes
    );
    return res.status(200).json(vinculos);
  } catch (error) {
    return next(error);
  }
};

// ── Modelos e geração ──────────────────────────────────────────────────────

export const createModelo = async (req, res, next) => {
  try {
    const { isValid, errors, data } = validateCreateModelo(req.body);

    if (!isValid) {
      const err = new Error("Dados inválidos");
      err.statusCode = 400;
      err.errors = errors;
      return next(err);
    }

    const modelo = await criarModeloService(req.user._id, data);
    return res.status(201).json(modelo);
  } catch (error) {
    return next(error);
  }
};

export const listModelos = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const result = await listarModelosService(req.user._id, { page, limit, tipo: req.query.tipo });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const gerarDocumento = async (req, res, next) => {
  try {
    const documento = await gerarDocumentoService(req.params.id, req.user._id, req.body);
    return res.status(201).json(documento);
  } catch (error) {
    return next(error);
  }
};

export const previewDocumento = async (req, res, next) => {
  try {
    const preview = await previewDocumentoService(req.params.id, req.user._id, {
      processoId: req.query.processoId,
      clienteId: req.query.clienteId,
      honorarioId: req.query.honorarioId
    });
    return res.status(200).json(preview);
  } catch (error) {
    return next(error);
  }
};

export const atualizarTexto = async (req, res, next) => {
  try {
    const resultado = await atualizarTextoService(
      req.params.id,
      req.user._id,
      req.body?.textoResolvido
    );
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

export const baixarDocumento = async (req, res, next) => {
  try {
    const { buffer, contentType, nomeArquivo } = await baixarDocumentoService(
      req.params.id,
      req.user._id,
      req.query.formato
    );

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.setHeader("Content-Length", buffer.length);
    // O nome do arquivo não é um header padrão que o navegador exponha ao JS
    // por conta própria: sem isto o frontend não consegue lê-lo do fetch.
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
};

// Catálogo de variáveis para o seletor da tela de seção. Somente leitura e
// autenticado (o router aplica authMiddleware): é conteúdo estático do sistema,
// não dado de usuário, mas não há motivo para expô-lo fora da sessão.
export const listarVariaveis = async (req, res, next) => {
  try {
    return res.status(200).json(montarCatalogoParaExibicao());
  } catch (error) {
    return next(error);
  }
};

export const alternarVisibilidadePortal = async (req, res, next) => {
  try {
    const documento = await alternarVisibilidadePortalService(
      req.params.id,
      req.user._id,
      req.body?.visivelPortal
    );
    return res.status(200).json(documento);
  } catch (error) {
    return next(error);
  }
};
