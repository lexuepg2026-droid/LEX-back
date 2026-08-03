import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  createInstallment,
  getAllInstallments,
  getInstallmentById,
  updateInstallment,
  deleteInstallment,
  reactivateInstallment
} from "../controllers/installmentController.js";

const router = Router();

router.use(authMiddleware);

router.post("/", createInstallment);
router.get("/", getAllInstallments);
// Reativação (Fase 4.5). Guarda própria: parcela só volta com o honorário
// ativo. Antes das genéricas de `/:id`.
router.patch("/:id/reativar", reactivateInstallment);

router.get("/:id", getInstallmentById);
// PATCH é o verbo de update do projeto; PUT fica como alias depreciado, no
// mesmo padrão de `/clients`, `/processes` e `/documents`.
router.patch("/:id", updateInstallment);
router.put("/:id", updateInstallment);
router.delete("/:id", deleteInstallment);

export default router;