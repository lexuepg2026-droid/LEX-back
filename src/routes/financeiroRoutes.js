import { Router } from "express";
import {
  getFinanceiro,
  getFichaFinanceiraDoProcesso,
  getPagamentosDoProcesso
} from "../controllers/dashboardController.js";
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

// Pagamentos do processo, com estornos e alocações resumidas (F-1a).
//
// Separado da ficha de propósito: a ficha é a árvore da COBRANÇA (honorário →
// parcela → alocação) e não pagina; esta é a lista do DINHEIRO que entrou, na
// ordem em que entrou, e pagina no padrão da regra central nº 4. São duas
// perguntas diferentes, e enfiar as duas na ficha faria o objeto que já é
// grande carregar uma listagem que a tela nem sempre mostra.
router.get("/processos/:processoId/payments", getPagamentosDoProcesso);

export default router;
