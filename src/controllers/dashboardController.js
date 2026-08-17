import { getSummary, getStatusCounts, getFeesByMonth, getFinanceiroResumo } from "../services/dashboardService.js";
import {
  montarFichaFinanceira,
  listarPagamentosDoProcesso
} from "../services/financeiroService.js";

export const getDashboardSummary = async (req, res, next) => {
  try {
    const summary = await getSummary(req.user._id);
    res.json(summary);
  } catch (error) {
    next(error);
  }
};

export const getDashboardStatus = async (req, res, next) => {
  try {
    const counts = await getStatusCounts(req.user._id);
    res.json(counts);
  } catch (error) {
    next(error);
  }
};

export const getDashboardFeesByMonth = async (req, res, next) => {
  try {
    const data = await getFeesByMonth(req.user._id);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

export const getFichaFinanceiraDoProcesso = async (req, res, next) => {
  try {
    const ficha = await montarFichaFinanceira(req.user._id, req.params.processoId);
    res.json(ficha);
  } catch (error) {
    next(error);
  }
};

// Pagamentos do processo, paginados no padrão da F-0 (teto de 100).
export const getPagamentosDoProcesso = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const resultado = await listarPagamentosDoProcesso(
      req.user._id,
      req.params.processoId,
      { page, limit }
    );
    res.json(resultado);
  } catch (error) {
    next(error);
  }
};

export const getFinanceiro = async (req, res, next) => {
  try {
    const resumo = await getFinanceiroResumo(req.user._id);
    res.json(resumo);
  } catch (error) {
    next(error);
  }
};
