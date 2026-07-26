import { Router } from "express";
import clientController from "../controllers/clientController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

router.post("/", clientController.createClient);
router.get("/", clientController.getAllClients);
router.get("/:id", clientController.getClientById);

// PATCH é o verbo correto: updateClient faz merge parcial (só sobrescreve o
// que veio no payload, via `pick`). PUT fica como alias depreciado, mantido
// por compatibilidade com clientes já publicados — não usar em código novo.
router.patch("/:id", clientController.updateClient);
router.put("/:id", clientController.updateClient);

router.delete("/:id", clientController.deleteClient);

export default router;