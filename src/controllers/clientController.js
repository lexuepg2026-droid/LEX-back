import clientService from "../services/clientService.js";
import clientValidation from "../validations/clientValidation.js";

const getErrorStatus = (error) => {
  if (error?.code === 11000) return 409;
  return 500;
};

const getErrorMessage = (error) => {
  if (error?.code === 11000) {
    if (error.keyPattern?.cpf) return "CPF já cadastrado para este usuário";
    if (error.keyPattern?.cnpj) return "CNPJ já cadastrado para este usuário";
    if (error.keyPattern?.email) return "Email já cadastrado para este usuário";
    return "Registro duplicado para este usuário";
  }
  return error.message || "Erro interno do servidor";
};

const createClient = async (req, res, next) => {
  try {
    const {
      tipoPessoa, nomeCompleto, cpf, razaoSocial, nomeFantasia,
      cnpj, email, telefone, endereco, observacoes, ativo
    } = req.body;

    const validationError = clientValidation.validateCreateClientPayload({
      tipoPessoa, nomeCompleto, cpf, razaoSocial, nomeFantasia,
      cnpj, email, telefone, endereco, observacoes, ativo
    });

    if (validationError) {
      const err = new Error(validationError);
      err.statusCode = 400;
      return next(err);
    }

    const client = await clientService.createClient(req.user._id, {
      tipoPessoa, nomeCompleto, cpf, razaoSocial, nomeFantasia,
      cnpj, email, telefone, endereco, observacoes, ativo
    });

    return res.status(201).json(client);
  } catch (error) {
    error.statusCode = getErrorStatus(error);
    error.message = getErrorMessage(error);
    return next(error);
  }
};

const getAllClients = async (req, res, next) => {
  try {
    const clients = await clientService.getAllClients(req.user._id);
    return res.status(200).json(clients);
  } catch (error) {
    error.statusCode = 500;
    error.message = "Erro ao listar clientes";
    return next(error);
  }
};

const getClientById = async (req, res, next) => {
  try {
    const client = await clientService.getClientById(req.user._id, req.params.id);

    if (!client) {
      const err = new Error("Cliente não encontrado");
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json(client);
  } catch (error) {
    error.statusCode = 500;
    error.message = "Erro ao buscar cliente";
    return next(error);
  }
};

const updateClient = async (req, res, next) => {
  try {
    const validationError = clientValidation.validateUpdateClientPayload(req.body);

    if (validationError) {
      const err = new Error(validationError);
      err.statusCode = 400;
      return next(err);
    }

    const client = await clientService.updateClient(req.user._id, req.params.id, req.body);

    if (!client) {
      const err = new Error("Cliente não encontrado");
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json(client);
  } catch (error) {
    error.statusCode = getErrorStatus(error);
    error.message = getErrorMessage(error);
    return next(error);
  }
};

const deleteClient = async (req, res, next) => {
  try {
    const client = await clientService.deleteClient(req.user._id, req.params.id);

    if (!client) {
      const err = new Error("Cliente não encontrado");
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json({ message: "Cliente removido com sucesso" });
  } catch (error) {
    error.statusCode = 500;
    error.message = "Erro ao remover cliente";
    return next(error);
  }
};

export default {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient
};
