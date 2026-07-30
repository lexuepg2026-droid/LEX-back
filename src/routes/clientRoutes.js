import { Router } from "express";
import clientController from "../controllers/clientController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

// Antes das rotas genéricas de `/:id`, pela mesma razão que em documentRoutes:
// na ordem inversa "senha-portal" seria capturado como id.
router.delete("/:id/senha-portal", clientController.revokePortalAccess);

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