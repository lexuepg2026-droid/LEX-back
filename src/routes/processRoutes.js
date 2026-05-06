import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import * as processController from "../controllers/processController.js";

const router = Router();

router.use(authMiddleware);

router.post("/", processController.create);
router.get("/", processController.list);
router.get("/:id", processController.getById);
router.put("/:id", processController.update);
router.delete("/:id", processController.remove);

export default router;