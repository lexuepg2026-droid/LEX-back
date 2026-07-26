import { Router } from "express";
import secaoController from "../controllers/secaoController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

router.post("/", secaoController.createSecao);
router.get("/", secaoController.listSecoes);
router.get("/:id", secaoController.getSecaoById);
// PATCH é o verbo principal: a atualização é merge parcial. Recurso novo não
// ganha alias PUT — o alias em /clients existe só por compatibilidade.
router.patch("/:id", secaoController.updateSecao);
router.delete("/:id", secaoController.deleteSecao);

export default router;
