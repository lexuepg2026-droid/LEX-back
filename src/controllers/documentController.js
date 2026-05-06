import {
  createDocumentService,
  listDocumentsService,
  getDocumentByIdService,
  updateDocumentService,
  deleteDocumentService
} from "../services/documentService.js";
import {
  validateCreateDocument,
  validateUpdateDocument,
  validateDocumentId
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
    const documents = await listDocumentsService(req.user._id);
    return res.status(200).json(documents);
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
