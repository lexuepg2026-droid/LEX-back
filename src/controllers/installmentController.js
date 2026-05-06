import {
  criarInstallment,
  listarInstallments,
  buscarInstallmentPorId,
  atualizarInstallment,
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
    const installments = await listarInstallments(req.user._id);
    return res.status(200).json(installments);
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
