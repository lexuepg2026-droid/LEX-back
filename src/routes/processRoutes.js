import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import idempotency from "../middleware/idempotencyMiddleware.js";
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

// ── DEC-054 — a fase tem rota própria ─────────────────────────────────────
//
// Não é `PATCH /:id` com mais um campo: toda mudança de fase grava uma entrada
// de histórico, e a rota genérica grava por `findOneAndUpdate`, que não teria
// onde pendurar isso. `fase` está fora da allowlist do PATCH comum de
// propósito, e a recusa de lá aponta para cá.
//
// Sub-rota literal, como `/reactivate`: não colide com `/:id`, que só pega um
// segmento.
// `idempotency`: a mudança de fase é a outra operação que a fila da F-5b
// envia (DEC-059). Sem o cabeçalho `Idempotency-Key`, o middleware passa
// direto e nada muda para quem grava online.
router.patch("/:id/fase", idempotency, processController.mudarFaseDoProcesso);

// DEC-052 — reativação e a contagem que a tela mostra antes de confirmar.
//
// O preview vem ANTES de `/:id/reactivate` na ordem de declaração? Não precisa:
// os dois são sub-rotas literais distintas, e nenhuma delas casa com `/:id`
// sozinho — `/:id` só pega um segmento.
router.get("/:id/activation-preview", processController.previewAtivacao);
router.patch("/:id/reactivate", processController.reactivate);

// DEC-056 (F-3) — a linha do tempo. Sub-rota literal, e só GET: é apresentação
// do que a DEC-054 já grava, e não há nada a escrever aqui.
router.get("/:id/timeline", processController.getTimeline);

export default router;
