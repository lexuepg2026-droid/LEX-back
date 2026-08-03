import paymentService from "../services/paymentService.js";
import { emitirRecibo } from "../services/receiptService.js";
import {
  validateCreatePayment,
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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { installmentId, processoId, formaPagamento, inativos } = req.query;
    const result = await paymentService.findAll(req.user._id, { page, limit, installmentId, processoId, formaPagamento, inativos });
    return res.status(200).json(result);
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
    // `validateUpdatePayment` saiu daqui na Fase 4.5 e passou ao service, junto
    // com a allowlist: rodando antes dele, engolia a recusa de campo desconhecido.
    const erros = validatePaymentId(req.params.id);

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

// Recibo em PDF do pagamento. Mesmos headers do download de documento,
// inclusive o `Access-Control-Expose-Headers`: sem ele o frontend não lê o nome
// do arquivo do fetch.
const baixarRecibo = async (req, res, next) => {
  try {
    const { buffer, contentType, nomeArquivo } = await emitirRecibo(
      req.params.id,
      req.user._id
    );

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
};

const reativar = async (req, res, next) => {
  try {
    const payment = await paymentService.reativar(req.params.id, req.user._id);
    return res.status(200).json(payment);
  } catch (error) {
    return next(error);
  }
};

export default {
  create,
  findAll,
  findById,
  update,
  reativar,
  remove,
  baixarRecibo
};
