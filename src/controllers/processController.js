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
    const processes = await listProcesses(req.user._id);
    return res.status(200).json(processes);
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
