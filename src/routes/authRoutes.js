import express from "express";
import rateLimit from "express-rate-limit";
import authController from "../controllers/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Um balde por operação. Compartilhar o mesmo limitador entre register e login
// fazia tentativas de cadastro consumirem a cota de login (e vice-versa): quem
// errasse o formulário de cadastro algumas vezes ficava sem conseguir entrar.
// A mensagem diz qual limite estourou, senão o usuário não sabe o que esperar.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Muitas tentativas de cadastro. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Muitas tentativas de login. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Balde próprio para troca de senha, para não haver consumo cruzado com
// register/login (errar a senha algumas vezes não deve travar a troca).
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Muitas tentativas de troca de senha. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/register", registerLimiter, authController.register);
router.post("/login", loginLimiter, authController.login);
router.post("/logout", authController.logout);
router.get("/me", authMiddleware, authController.me);
router.patch("/me", authMiddleware, authController.updateMe);
router.post("/alterar-senha", authMiddleware, passwordLimiter, authController.changePassword);

export default router;