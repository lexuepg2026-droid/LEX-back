import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  createDocument,
  listDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument
} from "../controllers/documentController.js";

const router = Router();

router.use(authMiddleware);

router.post("/", createDocument);
router.get("/", listDocuments);
router.get("/:id", getDocumentById);
router.put("/:id", updateDocument);
router.delete("/:id", deleteDocument);

export default router;