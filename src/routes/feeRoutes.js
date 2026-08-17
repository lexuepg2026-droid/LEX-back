import { Router } from "express";
import feeController from "../controllers/feeController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import renegotiationController from "../controllers/renegotiationController.js";
import statementController from "../controllers/statementController.js";

const router = Router();

router.use(authMiddleware);

router.post("/", feeController.createFee);
router.get("/", feeController.listFees);
// ── Sub-recursos do honorário (F-1a) ─────────────────────────────────────
//
// Declarados ANTES das rotas genéricas de `/:id`, no padrão de
// `documentRoutes`: ordem de declaração é o que decide qual rota captura o
// caminho.
//
// O EXTRATO é a linha do tempo do dinheiro desta cobrança — pagamentos,
// estornos, alocações com vínculo, reparcelamentos e mudanças de status,
// mesclados por data. Agregado por leitura, sem coleção de log nova.
router.get("/:id/statement", statementController.extrato);

// O REPARCELAMENTO (DEC-037) é operação SOBRE a cobrança: o plano novo só faz
// sentido contra o saldo dela. Sem PATCH e sem DELETE — desfazer um
// reparcelamento é reparcelar de novo.
router.post("/:id/renegotiations", renegotiationController.criar);
router.get("/:id/renegotiations", renegotiationController.listar);

router.get("/:id", feeController.getFeeById);
// PATCH é o verbo de update do projeto: o service só toca no que veio no
// payload. PUT fica como alias depreciado, no mesmo padrão de `/clients`,
// `/processes` e `/documents` — o frontend só migra na Fase 4.2, e alias
// depreciado é diferente de alias proibido.
router.patch("/:id", feeController.updateFee);
router.put("/:id", feeController.updateFee);
router.delete("/:id", feeController.deleteFee);

export default router;