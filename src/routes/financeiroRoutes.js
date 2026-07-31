import { Router } from "express";
import { getFinanceiro, getFichaFinanceiraDoProcesso } from "../controllers/dashboardController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

// Resumo global do escritório, do dashboard.
router.get("/resumo", getFinanceiro);

// Ficha financeira de UM processo (Fase 4.1): honorários, parcelas, pagamentos
// e totais consolidados.
//
// Mora aqui, e não em `/processes/:id/financeiro`, para não empurrar leitura de
// honorário, parcela e pagamento para dentro do `processService` — que não
// conhece nenhum dos três. `/api/financeiro` já é a superfície de consolidação
// financeira, e o sub-recurso em português segue a mesma exceção de `/secoes` e
// `/clientes`.
router.get("/processos/:processoId", getFichaFinanceiraDoProcesso);

export default router;
