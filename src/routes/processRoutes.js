import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import * as processController from "../controllers/processController.js";

const router = Router();

router.use(authMiddleware);

// ── Participantes ──────────────────────────────────────────────────────────
// Declaradas ANTES de "/:id" pelo mesmo motivo das rotas de /documents: na
// ordem inversa, um GET /:id capturaria o prefixo e a rota nunca seria
// alcançada. A mais específica (.../principal) vem antes da genérica.
// Antes das rotas genéricas de `/:id`, como as de participantes.
router.get("/:id/confirmacoes", processController.listConfirmacoes);
router.patch("/:id/confirmacoes/vistas", processController.marcarConfirmacoesVistas);

router.get("/:id/clientes", processController.listClientes);
router.post("/:id/clientes", processController.addCliente);
router.get("/:id/clientes/:clienteId/codigo-acesso", processController.getCodigoAcesso);
router.patch("/:id/clientes/:clienteId/principal", processController.setClientePrincipal);
router.patch("/:id/clientes/:clienteId", processController.updateClientePapel);
router.delete("/:id/clientes/:clienteId", processController.removeCliente);

// ── CRUD ───────────────────────────────────────────────────────────────────
router.post("/", processController.create);
router.get("/", processController.list);
router.get("/:id", processController.getById);
router.put("/:id", processController.update);
router.patch("/:id", processController.update);
router.delete("/:id", processController.remove);

export default router;
