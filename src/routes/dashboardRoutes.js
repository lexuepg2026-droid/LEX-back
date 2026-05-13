import { Router } from "express";
import {
  getDashboardSummary,
  getDashboardStatus,
  getDashboardFeesByMonth
} from "../controllers/dashboardController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);
router.get("/", getDashboardSummary);
router.get("/status", getDashboardStatus);
router.get("/honorarios-por-mes", getDashboardFeesByMonth);

export default router;
