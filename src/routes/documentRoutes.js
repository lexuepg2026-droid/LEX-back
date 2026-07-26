import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  createDocument,
  listDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  listDocumentSecoes,
  vincularSecao,
  desvincularSecao,
  reordenarSecoes,
  createModelo,
  listModelos,
  gerarDocumento,
  previewDocumento,
  alternarVisibilidadePortal
} from "../controllers/documentController.js";

const router = Router();

router.use(authMiddleware);

// ── Modelos ────────────────────────────────────────────────────────────────
// Declaradas ANTES de "/:id": na ordem inversa, "modelos" seria capturado como
// id de documento e toda chamada cairia em getDocumentById.
router.post("/modelos", createModelo);
router.get("/modelos", listModelos);
router.post("/modelos/:id/gerar", gerarDocumento);

// ── CRUD ───────────────────────────────────────────────────────────────────
router.post("/", createDocument);
router.get("/", listDocuments);

// ── Composição, preview e visibilidade ─────────────────────────────────────
// Também antes das rotas genéricas de "/:id", pelo mesmo motivo.
router.get("/:id/preview", previewDocumento);
router.get("/:id/secoes", listDocumentSecoes);
router.post("/:id/secoes", vincularSecao);
router.patch("/:id/secoes/reordenar", reordenarSecoes);
router.delete("/:id/secoes/:secaoId", desvincularSecao);
router.patch("/:id/visibilidade-portal", alternarVisibilidadePortal);

router.get("/:id", getDocumentById);
router.put("/:id", updateDocument);
router.delete("/:id", deleteDocument);

export default router;
