import { Router } from "express";
import clientController from "../controllers/clientController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

router.post("/", clientController.createClient);
router.get("/", clientController.getAllClients);
router.get("/:id", clientController.getClientById);
router.put("/:id", clientController.updateClient);
router.delete("/:id", clientController.deleteClient);

export default router;