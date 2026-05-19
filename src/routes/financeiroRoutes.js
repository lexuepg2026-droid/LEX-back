import { Router } from "express";
import { getFinanceiro } from "../controllers/dashboardController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);
router.get("/resumo", getFinanceiro);

export default router;
