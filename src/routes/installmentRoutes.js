import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  createInstallment,
  getAllInstallments,
  getInstallmentById,
  updateInstallment,
  deleteInstallment
} from "../controllers/installmentController.js";

const router = Router();

router.use(authMiddleware);

router.post("/", createInstallment);
router.get("/", getAllInstallments);
// A rota `PATCH /:id/reativar` MORREU na Fase F-1a (DEC-034) e passa a
// responder 404 pelo `notFoundMiddleware`. Ver o registro no fim de
// `installmentService.js` — e o teste que trava as duas rotas de reativação.

router.get("/:id", getInstallmentById);
// PATCH é o verbo de update do projeto; PUT fica como alias depreciado, no
// mesmo padrão de `/clients`, `/processes` e `/documents`.
router.patch("/:id", updateInstallment);
router.put("/:id", updateInstallment);
router.delete("/:id", deleteInstallment);

export default router;