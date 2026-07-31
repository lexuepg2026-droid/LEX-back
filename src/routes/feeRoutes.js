import { Router } from "express";
import feeController from "../controllers/feeController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

router.post("/", feeController.createFee);
router.get("/", feeController.listFees);
router.get("/:id", feeController.getFeeById);
// PATCH é o verbo de update do projeto: o service só toca no que veio no
// payload. PUT fica como alias depreciado, no mesmo padrão de `/clients`,
// `/processes` e `/documents` — o frontend só migra na Fase 4.2, e alias
// depreciado é diferente de alias proibido.
router.patch("/:id", feeController.updateFee);
router.put("/:id", feeController.updateFee);
router.delete("/:id", feeController.deleteFee);

export default router;