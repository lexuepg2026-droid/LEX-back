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
  alternarVisibilidadePortalService
} from "../services/documentGenerationService.js";
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

    const { isValid, errors, data } = validateUpdateDocument(req.body);

    if (!isValid) {
      const err = new Error("Dados inválidos");
      err.statusCode = 400;
      err.errors = errors;
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
      clienteId: req.query.clienteId
    });
    return res.status(200).json(preview);
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
