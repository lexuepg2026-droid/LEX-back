import clientService from "../services/clientService.js";

const createClient = async (req, res, next) => {
  try {
    const client = await clientService.createClient(req.user._id, req.body);
    return res.status(201).json(client);
  } catch (error) {
    return next(error);
  }
};

const getAllClients = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { busca } = req.query;
    const result = await clientService.getAllClients(req.user._id, { page, limit, busca });
    return res.status(200).json(result);
  } catch (error) {
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
    return next(error);
  }
};

const updateClient = async (req, res, next) => {
  try {
    const client = await clientService.updateClient(req.user._id, req.params.id, req.body);

    if (!client) {
      const err = new Error("Cliente não encontrado");
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json(client);
  } catch (error) {
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
    return next(error);
  }
};

// Revoga o acesso do cliente ao portal, zerando os três campos de senha.
// Rota própria em vez de `PATCH { senhaPortal: null }` porque tirar o acesso de
// uma pessoa é ação deliberada, e merece um verbo que diga isso.
const revokePortalAccess = async (req, res, next) => {
  try {
    const client = await clientService.revogarAcessoPortal(req.user._id, req.params.id);

    if (!client) {
      const err = new Error("Cliente não encontrado");
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json({
      message: "Acesso ao portal revogado",
      clienteId: client._id,
      senhaPortalProvisoria: client.senhaPortalProvisoria,
      senhaPortalDefinidaEm: client.senhaPortalDefinidaEm
    });
  } catch (error) {
    return next(error);
  }
};

export default {
  revokePortalAccess,
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient
};
