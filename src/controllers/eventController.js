import { lerVersaoVista } from "../services/concurrencyGuard.js";
import {
  criarEvento,
  listarEventos,
  buscarEventoPorId,
  atualizarEvento,
  concluirEvento,
  deletarEvento,
  reativarEvento
} from "../services/eventService.js";

export const createEvent = async (req, res, next) => {
  try {
    const evento = await criarEvento(req.user._id, req.body);
    return res.status(201).json(evento);
  } catch (error) {
    return next(error);
  }
};

export const getAllEvents = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { processoId, tipo, situacao, concluido, busca } = req.query;
    const result = await listarEventos(req.user._id, {
      page, limit, processoId, tipo, situacao, concluido, busca
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getEventById = async (req, res, next) => {
  try {
    const evento = await buscarEventoPorId(req.user._id, req.params.id);
    return res.status(200).json(evento);
  } catch (error) {
    return next(error);
  }
};

// `X-If-Unmodified-Since` (DEC-060): o `updatedAt` que o cliente leu. Quem
// sabe de HTTP é a borda — o service recebe o valor e não conhece `req`.
export const updateEvent = async (req, res, next) => {
  try {
    const evento = await atualizarEvento(req.user._id, req.params.id, req.body, {
      versaoVista: lerVersaoVista(req)
    });
    return res.status(200).json(evento);
  } catch (error) {
    return next(error);
  }
};

export const concludeEvent = async (req, res, next) => {
  try {
    const evento = await concluirEvento(req.user._id, req.params.id, req.body, {
      versaoVista: lerVersaoVista(req)
    });
    return res.status(200).json(evento);
  } catch (error) {
    return next(error);
  }
};

export const deleteEvent = async (req, res, next) => {
  try {
    const resultado = await deletarEvento(req.user._id, req.params.id);
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

export const reactivateEvent = async (req, res, next) => {
  try {
    const evento = await reativarEvento(req.user._id, req.params.id);
    return res.status(200).json(evento);
  } catch (error) {
    return next(error);
  }
};
