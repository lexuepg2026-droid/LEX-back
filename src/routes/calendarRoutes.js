import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getCalendar, getAvisos } from "../controllers/calendarController.js";

const router = Router();

router.use(authMiddleware);

// ── Só LEITURA, e a ausência de POST é a DEC-055 escrita na fiação ──────
//
// Não há `POST /calendar`, não há `PATCH /calendar/:id`, não há
// `DELETE /calendar/:id`. O calendário é uma VISTA: quem grava evento é
// `/api/events`, quem grava vencimento é `/api/installments` e `/api/fees`.
//
// A ausência é deliberada e está travada por teste. Uma rota de escrita aqui
// seria, na prática, o lugar onde alguém gravaria a derivada — e é exatamente
// isso que a decisão proíbe.

// `/avisos` ANTES de nada que possa casar com um parâmetro: é literal, e aqui
// não há `/:id` nenhum para colidir. Fica registrado porque a próxima rota a
// nascer neste arquivo vai ter de olhar para esta ordem.
router.get("/avisos", getAvisos);
router.get("/", getCalendar);

export default router;
