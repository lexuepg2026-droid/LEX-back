import { getSummary, getStatusCounts, getFeesByMonth } from "../services/dashboardService.js";

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
