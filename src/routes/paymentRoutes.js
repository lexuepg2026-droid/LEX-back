// src/routes/paymentRoutes.js
import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import paymentController from "../controllers/paymentController.js";
import reversalController from "../controllers/reversalController.js";

const router = Router();

router.use(authMiddleware);

router.post("/", paymentController.create);
router.get("/", paymentController.findAll);

// Preview de alocação (F-1a). POST porque recebe corpo e porque o cliente não
// deve cachear "o que aconteceria" — mas NÃO grava nada.
router.post("/preview", paymentController.prever);

// Antes das rotas genéricas de `/:id`, pelo mesmo motivo de `documentRoutes`:
// ordem de declaração é o que decide qual rota captura o caminho.
//
// O recibo NÃO é um `Document`: nada é gravado, nada entra no portal. Emissão
// sob demanda — ver `receiptService.js`.
router.get("/:id/recibo", paymentController.baixarRecibo);

// ── Estornos (DEC-033, F-1a) ─────────────────────────────────────────────
//
// Sub-recurso do pagamento porque é isso que ele é: um estorno não existe
// sozinho, e a pergunta "quanto deste pagamento ainda vale" só tem resposta
// com o pagamento em mãos. Sem PATCH e sem DELETE — estorno errado se desfaz
// com outro estorno, apontando o anulado por `estornoAnuladoId`.
router.post("/:id/reversals", reversalController.criar);
router.get("/:id/reversals", reversalController.listar);

// ── A rota `PATCH /:id/reativar` MORREU na F-1a (DEC-034) ────────────────
//
// Ela existia porque pagamento tinha soft delete por rota. Com o pagamento
// imutável, "desfazer" é estorno, e "desfazer o estorno" é anulação — as duas
// coisas registram um fato novo em vez de reescrever o antigo. Uma rota que
// devolvesse o pagamento ao ar apagaria o motivo pelo qual ele saiu.
//
// `DELETE /:id` morreu junto, e pelo mesmo motivo (DEC-032). As duas
// respondem 404 pelo `notFoundMiddleware`, e há teste travando isso.

router.get("/:id", paymentController.findById);
// PATCH é o verbo de update do projeto; PUT fica como alias depreciado, no
// mesmo padrão de `/clients`, `/processes` e `/documents`. A allowlist por trás
// dos dois tem UM campo: `observacoes`.
router.patch("/:id", paymentController.update);
router.put("/:id", paymentController.update);

export default router;
