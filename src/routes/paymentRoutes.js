// src/routes/paymentRoutes.js
import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import paymentController from "../controllers/paymentController.js";

const router = Router();

router.use(authMiddleware);

router.post("/", paymentController.create);
router.get("/", paymentController.findAll);
router.get("/:id", paymentController.findById);
router.put("/:id", paymentController.update);
router.delete("/:id", paymentController.remove);

export default router;