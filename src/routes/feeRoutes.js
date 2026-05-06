import { Router } from "express";
import feeController from "../controllers/feeController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

router.post("/", feeController.createFee);
router.get("/", feeController.listFees);
router.get("/:id", feeController.getFeeById);
router.put("/:id", feeController.updateFee);
router.delete("/:id", feeController.deleteFee);

export default router;