import { Router } from "express";
import { getDashboardSummary } from "../controllers/dashboardController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);
router.get("/", getDashboardSummary);

export default router;
