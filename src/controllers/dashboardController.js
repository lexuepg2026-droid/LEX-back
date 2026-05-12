import { getSummary } from "../services/dashboardService.js";

export const getDashboardSummary = async (req, res, next) => {
  try {
    const summary = await getSummary(req.user._id);
    res.json(summary);
  } catch (error) {
    next(error);
  }
};
