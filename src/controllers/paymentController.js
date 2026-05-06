import paymentService from "../services/paymentService.js";
import {
  validateCreatePayment,
  validateUpdatePayment,
  validatePaymentId
} from "../validations/paymentValidation.js";

const create = async (req, res, next) => {
  try {
    const erros = validateCreatePayment(req.body);

    if (erros.length > 0) {
      const err = new Error(erros[0]);
      err.statusCode = 400;
      err.errors = erros;
      return next(err);
    }

    const payment = await paymentService.create(req.body, req.user._id);
    return res.status(201).json(payment);
  } catch (error) {
    return next(error);
  }
};

const findAll = async (req, res, next) => {
  try {
    const payments = await paymentService.findAll(req.user._id);
    return res.status(200).json(payments);
  } catch (error) {
    return next(error);
  }
};

const findById = async (req, res, next) => {
  try {
    const erros = validatePaymentId(req.params.id);

    if (erros.length > 0) {
      const err = new Error(erros[0]);
      err.statusCode = 400;
      err.errors = erros;
      return next(err);
    }

    const payment = await paymentService.findById(req.params.id, req.user._id);
    return res.status(200).json(payment);
  } catch (error) {
    return next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const erros = [...validatePaymentId(req.params.id), ...validateUpdatePayment(req.body)];

    if (erros.length > 0) {
      const err = new Error(erros[0]);
      err.statusCode = 400;
      err.errors = erros;
      return next(err);
    }

    const payment = await paymentService.update(req.params.id, req.body, req.user._id);
    return res.status(200).json(payment);
  } catch (error) {
    return next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    const erros = validatePaymentId(req.params.id);

    if (erros.length > 0) {
      const err = new Error(erros[0]);
      err.statusCode = 400;
      err.errors = erros;
      return next(err);
    }

    const result = await paymentService.remove(req.params.id, req.user._id);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export default {
  create,
  findAll,
  findById,
  update,
  remove
};
