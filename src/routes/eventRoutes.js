import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import idempotency from "../middleware/idempotencyMiddleware.js";
import {
  createEvent,
  getAllEvents,
  getEventById,
  updateEvent,
  concludeEvent,
  deleteEvent,
  reactivateEvent
} from "../controllers/eventController.js";

const router = Router();

router.use(authMiddleware);

// ── A FILA DA F-5b passa por aqui (DEC-059) ──────────────────────────────
//
// `idempotency` só age quando vem o cabeçalho `Idempotency-Key` — requisição
// sem ele passa direto, e nenhuma tela que grava online precisou mudar.
//
// Está nas TRÊS escritas que a fila envia, e em nenhuma outra: criar, editar e
// concluir compromisso. O `DELETE` fica de fora de propósito — apagar offline
// um compromisso que ainda não foi criado no servidor exige remapear
// identificador local, e essa é a armadilha clássica de fila que a fase não
// abriu.
router.post("/", idempotency, createEvent);
router.get("/", getAllEvents);

router.get("/:id", getEventById);

// `PATCH` é o verbo de update do projeto. **Sem alias `PUT`**: a convenção diz
// que recurso novo não ganha o alias depreciado — ele existe só em `/clients`,
// `/processes` e `/documents`, por compatibilidade com telas antigas.
router.patch("/:id", idempotency, updateEvent);

// Sub-rotas literais, como `/reactivate` em processos: não colidem com `/:id`,
// que só casa com um segmento.
//
// `/concluir` é rota própria porque `concluido` e `concluidoEm` são um fato só
// com carimbo — a mesma razão que deu rota própria à `fase` na DEC-054. O PATCH
// comum recusa os dois campos e a mensagem manda para cá.
router.patch("/:id/concluir", idempotency, concludeEvent);
router.patch("/:id/reactivate", reactivateEvent);

router.delete("/:id", deleteEvent);

export default router;
