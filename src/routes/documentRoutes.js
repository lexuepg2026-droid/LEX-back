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
  atualizarTexto,
  baixarDocumento,
  alternarVisibilidadePortal,
  listarVariaveis,
  compatibilidadeModelo
} from "../controllers/documentController.js";

const router = Router();

router.use(authMiddleware);

// ── Catálogo de variáveis ──────────────────────────────────────────────────
// Antes de "/:id" pelo mesmo motivo de "modelos": senão "variaveis" viraria id.
router.get("/variaveis", listarVariaveis);

// ── Modelos ────────────────────────────────────────────────────────────────
// Declaradas ANTES de "/:id": na ordem inversa, "modelos" seria capturado como
// id de documento e toda chamada cairia em getDocumentById.
router.post("/modelos", createModelo);
router.get("/modelos", listModelos);
// Compatibilidade modelo × cliente (Fase 4.6). Antes das genéricas de
// `/:id`, no padrão do arquivo. É leitura e não bloqueia geração.
router.get("/modelos/:id/compatibilidade", compatibilidadeModelo);

router.post("/modelos/:id/gerar", gerarDocumento);

// ── CRUD ───────────────────────────────────────────────────────────────────
router.post("/", createDocument);
router.get("/", listDocuments);

// ── Composição, preview e visibilidade ─────────────────────────────────────
// Também antes das rotas genéricas de "/:id", pelo mesmo motivo.
router.get("/:id/preview", previewDocumento);
router.get("/:id/download", baixarDocumento);
router.patch("/:id/texto", atualizarTexto);
router.get("/:id/secoes", listDocumentSecoes);
router.post("/:id/secoes", vincularSecao);
router.patch("/:id/secoes/reordenar", reordenarSecoes);
router.delete("/:id/secoes/:secaoId", desvincularSecao);
router.patch("/:id/visibilidade-portal", alternarVisibilidadePortal);

router.get("/:id", getDocumentById);

// PATCH é o verbo correto: updateDocument faz merge parcial, só sobrescreve o
// que veio no payload. PUT fica como alias depreciado, mantido por
// compatibilidade — mesmo padrão adotado em /clients na Fase 1.3.
router.patch("/:id", updateDocument);
router.put("/:id", updateDocument);

router.delete("/:id", deleteDocument);

export default router;
