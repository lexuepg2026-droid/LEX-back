import { getSummary, getStatusCounts, getFeesByMonth, getFinanceiroResumo } from "../services/dashboardService.js";
import { montarFichaFinanceira } from "../services/financeiroService.js";

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

export const getFinanceiro = async (req, res, next) => {
  try {
    const resumo = await getFinanceiroResumo(req.user._id);
    res.json(resumo);
  } catch (error) {
    next(error);
  }
};
