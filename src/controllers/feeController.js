import feeService from "../services/feeService.js";

const createFee = async (req, res, next) => {
  try {
    const fee = await feeService.createFee(req.user._id, req.body);
    return res.status(201).json(fee);
  } catch (error) {
    return next(error);
  }
};

const listFees = async (req, res, next) => {
  try {
    const fees = await feeService.listFees(req.user._id);
    return res.status(200).json(fees);
  } catch (error) {
    return next(error);
  }
};

const getFeeById = async (req, res, next) => {
  try {
    const fee = await feeService.getFeeById(req.params.id, req.user._id);
    return res.status(200).json(fee);
  } catch (error) {
    return next(error);
  }
};

const updateFee = async (req, res, next) => {
  try {
    const fee = await feeService.updateFee(req.params.id, req.user._id, req.body);
    return res.status(200).json(fee);
  } catch (error) {
    return next(error);
  }
};

const deleteFee = async (req, res, next) => {
  try {
    await feeService.deleteFee(req.params.id, req.user._id);
    return res.status(200).json({ message: "Honorário removido com sucesso" });
  } catch (error) {
    return next(error);
  }
};

export default {
  createFee,
  listFees,
  getFeeById,
  updateFee,
  deleteFee
};
