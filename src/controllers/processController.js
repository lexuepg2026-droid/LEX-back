import {
  createProcess,
  deleteProcess,
  getProcessById,
  listProcesses,
  updateProcess
} from "../services/processService.js";
import {
  alterarPapel,
  desvincularCliente,
  listarParticipantes,
  obterCodigoAcesso,
  promoverAPrincipal,
  vincularCliente
} from "../services/processoClienteService.js";
import confirmacaoService from "../services/confirmacaoService.js";

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
    const { busca, status } = req.query;
    const result = await listProcesses(req.user._id, { page, limit, busca, status });
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

// ── Participantes do processo (junção processo × cliente) ──────────────────

export const listClientes = async (req, res, next) => {
  try {
    const participantes = await listarParticipantes(req.user._id, req.params.id);
    return res.status(200).json(participantes);
  } catch (error) {
    return next(error);
  }
};

export const addCliente = async (req, res, next) => {
  try {
    const vinculo = await vincularCliente(req.user._id, req.params.id, req.body);
    return res.status(201).json(vinculo);
  } catch (error) {
    return next(error);
  }
};

export const updateClientePapel = async (req, res, next) => {
  try {
    const vinculo = await alterarPapel(
      req.user._id,
      req.params.id,
      req.params.clienteId,
      req.body
    );
    return res.status(200).json(vinculo);
  } catch (error) {
    return next(error);
  }
};

export const setClientePrincipal = async (req, res, next) => {
  try {
    const vinculo = await promoverAPrincipal(
      req.user._id,
      req.params.id,
      req.params.clienteId
    );
    return res.status(200).json(vinculo);
  } catch (error) {
    return next(error);
  }
};

export const removeCliente = async (req, res, next) => {
  try {
    await desvincularCliente(req.user._id, req.params.id, req.params.clienteId);
    return res.status(200).json({ message: "Cliente desvinculado do processo" });
  } catch (error) {
    return next(error);
  }
};

// ── Confirmações de visualização do processo (Fase 3.1) ────────────────────

export const listConfirmacoes = async (req, res, next) => {
  try {
    const resultado = await confirmacaoService.listarConfirmacoesDoProcesso(
      req.user._id,
      req.params.id
    );
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

// Marca TODAS as não vistas do processo de uma vez. A advogada abre a ficha e
// vê todas juntas; marcar uma a uma exigiria N chamadas para a mesma ação
// humana. É a única mutação permitida sobre uma confirmação.
export const marcarConfirmacoesVistas = async (req, res, next) => {
  try {
    const resultado = await confirmacaoService.marcarComoVistas(
      req.user._id,
      req.params.id
    );
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

export const getCodigoAcesso = async (req, res, next) => {
  try {
    const resultado = await obterCodigoAcesso(
      req.user._id,
      req.params.id,
      req.params.clienteId
    );
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};
