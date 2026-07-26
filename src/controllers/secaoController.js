import secaoService from "../services/secaoService.js";

const createSecao = async (req, res, next) => {
  try {
    const secao = await secaoService.createSecao(req.user._id, req.body);
    return res.status(201).json(secao);
  } catch (error) {
    return next(error);
  }
};

const listSecoes = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { tipo, busca } = req.query;

    const result = await secaoService.listSecoes(req.user._id, { page, limit, tipo, busca });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const getSecaoById = async (req, res, next) => {
  try {
    const secao = await secaoService.getSecaoById(req.user._id, req.params.id);
    return res.status(200).json(secao);
  } catch (error) {
    return next(error);
  }
};

const updateSecao = async (req, res, next) => {
  try {
    const secao = await secaoService.updateSecao(req.user._id, req.params.id, req.body);
    return res.status(200).json(secao);
  } catch (error) {
    return next(error);
  }
};

const deleteSecao = async (req, res, next) => {
  try {
    const secao = await secaoService.deleteSecao(req.user._id, req.params.id);
    return res.status(200).json({ message: "Seção excluída com sucesso", secao });
  } catch (error) {
    return next(error);
  }
};

export default {
  createSecao,
  listSecoes,
  getSecaoById,
  updateSecao,
  deleteSecao
};
