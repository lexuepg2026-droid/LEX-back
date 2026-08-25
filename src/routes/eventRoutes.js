import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
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

router.post("/", createEvent);
router.get("/", getAllEvents);

router.get("/:id", getEventById);

// `PATCH` é o verbo de update do projeto. **Sem alias `PUT`**: a convenção diz
// que recurso novo não ganha o alias depreciado — ele existe só em `/clients`,
// `/processes` e `/documents`, por compatibilidade com telas antigas.
router.patch("/:id", updateEvent);

// Sub-rotas literais, como `/reactivate` em processos: não colidem com `/:id`,
// que só casa com um segmento.
//
// `/concluir` é rota própria porque `concluido` e `concluidoEm` são um fato só
// com carimbo — a mesma razão que deu rota própria à `fase` na DEC-054. O PATCH
// comum recusa os dois campos e a mensagem manda para cá.
router.patch("/:id/concluir", concludeEvent);
router.patch("/:id/reactivate", reactivateEvent);

router.delete("/:id", deleteEvent);

export default router;
