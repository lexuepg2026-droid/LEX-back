// src/routes/paymentRoutes.js
import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import paymentController from "../controllers/paymentController.js";

const router = Router();

router.use(authMiddleware);

router.post("/", paymentController.create);
router.get("/", paymentController.findAll);
// Antes das rotas genéricas de `/:id`, pelo mesmo motivo de `documentRoutes`:
// ordem de declaração é o que decide qual rota captura o caminho.
//
// O recibo NÃO é um `Document`: nada é gravado, nada entra no portal. Emissão
// sob demanda — ver `receiptService.js`.
router.get("/:id/recibo", paymentController.baixarRecibo);

router.get("/:id", paymentController.findById);
// PATCH é o verbo de update do projeto; PUT fica como alias depreciado, no
// mesmo padrão de `/clients`, `/processes` e `/documents`.
router.patch("/:id", paymentController.update);
router.put("/:id", paymentController.update);
router.delete("/:id", paymentController.remove);

export default router;