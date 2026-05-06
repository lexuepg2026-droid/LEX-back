import {
  createProcess,
  deleteProcess,
  getProcessById,
  listProcesses,
  updateProcess
} from "../services/processService.js";

export const create = async (req, res, next) => {
  try {
    const process = await createProcess(req.user._id, req.body);
    return res.status(201).json(process);
  } catch (error) {
    return next(error);
  }
};

export const list = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const result = await listProcesses(req.user._id, { page, limit });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getById = async (req, res, next) => {
  try {
    const process = await getProcessById(req.user._id, req.params.id);
    return res.status(200).json(process);
  } catch (error) {
    return next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const process = await updateProcess(req.user._id, req.params.id, req.body);
    return res.status(200).json(process);
  } catch (error) {
    return next(error);
  }
};

export const remove = async (req, res, next) => {
  try {
    await deleteProcess(req.user._id, req.params.id);
    return res.status(200).json({ message: "Processo removido com sucesso" });
  } catch (error) {
    return next(error);
  }
};
