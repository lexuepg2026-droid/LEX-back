import {
  criarInstallment,
  listarInstallments,
  buscarInstallmentPorId,
  atualizarInstallment,
  reativarInstallment,
  deletarInstallment
} from "../services/installmentService.js";

export const createInstallment = async (req, res, next) => {
  try {
    const installment = await criarInstallment(req.user._id, req.body);
    return res.status(201).json(installment);
  } catch (error) {
    return next(error);
  }
};

export const getAllInstallments = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { processoId, status, inativos } = req.query;
    const result = await listarInstallments(req.user._id, { page, limit, processoId, status, inativos });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getInstallmentById = async (req, res, next) => {
  try {
    const installment = await buscarInstallmentPorId(req.user._id, req.params.id);
    return res.status(200).json(installment);
  } catch (error) {
    return next(error);
  }
};

export const updateInstallment = async (req, res, next) => {
  try {
    const installment = await atualizarInstallment(req.user._id, req.params.id, req.body);
    return res.status(200).json(installment);
  } catch (error) {
    return next(error);
  }
};

export const deleteInstallment = async (req, res, next) => {
  try {
    const resultado = await deletarInstallment(req.user._id, req.params.id);
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

export const reactivateInstallment = async (req, res, next) => {
  try {
    const resultado = await reativarInstallment(req.user._id, req.params.id);
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};
