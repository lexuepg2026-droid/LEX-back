import express from "express";
import rateLimit from "express-rate-limit";
import authController from "../controllers/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { janelaMs, teto } from "../config/rateLimit.js";

const router = express.Router();

// Um balde por operação. Compartilhar o mesmo limitador entre register e login
// fazia tentativas de cadastro consumirem a cota de login (e vice-versa): quem
// errasse o formulário de cadastro algumas vezes ficava sem conseguir entrar.
// A mensagem diz qual limite estourou, senão o usuário não sabe o que esperar.
//
// ── Limites por ambiente ───────────────────────────────────────────────────
// Os tetos vêm de variável de ambiente, com os valores de PRODUÇÃO como
// default: quem não configurar nada continua com 5/10/5 por 15 minutos, que é
// o que já valia. NÃO baixar os defaults — eles são a proteção real contra
// força bruta.
//
// O multiplicador por ambiente e a janela moram em `config/rateLimit.js`
// (F-2b). Este bloco era DUPLICADO aqui e em `portalRoutes.js`, linha por
// linha; bastaria ajustar um dos dois para o portal e a área da advogada
// passarem a se comportar diferente sem ninguém notar.
const criarLimiter = (variavel, padrao, message) =>
  rateLimit({
    windowMs: janelaMs(),
    max: teto(variavel, padrao),
    message: { message },
    standardHeaders: true,
    legacyHeaders: false,
  });

const registerLimiter = criarLimiter(
  "RATE_LIMIT_CADASTRO",
  5,
  "Muitas tentativas de cadastro. Tente novamente em 15 minutos."
);

const loginLimiter = criarLimiter(
  "RATE_LIMIT_LOGIN",
  10,
  "Muitas tentativas de login. Tente novamente em 15 minutos."
);

// Balde próprio para troca de senha, para não haver consumo cruzado com
// register/login (errar a senha algumas vezes não deve travar a troca).
const passwordLimiter = criarLimiter(
  "RATE_LIMIT_SENHA",
  5,
  "Muitas tentativas de troca de senha. Tente novamente em 15 minutos."
);

// ── A-2 (DEC-064): três baldes novos, um por operação ──────────────────────
// Pedir e-mail é a operação que custa (provedor, caixa de entrada de terceiro),
// e por isso o teto é o mais baixo. Consumir o link não custa nada e é feito por
// quem já tem o token — o teto é folgado, só para não deixar a rota aberta a
// varredura.
const forgotLimiter = criarLimiter(
  "RATE_LIMIT_RECUPERACAO",
  5,
  "Muitos pedidos de recuperação de senha. Tente novamente em 15 minutos."
);

const resendLimiter = criarLimiter(
  "RATE_LIMIT_REENVIO",
  5,
  "Muitos pedidos de reenvio. Tente novamente em 15 minutos."
);

const tokenLimiter = criarLimiter(
  "RATE_LIMIT_TOKEN",
  20,
  "Muitas tentativas com links de e-mail. Tente novamente em 15 minutos."
);

router.post("/register", registerLimiter, authController.register);
router.post("/login", loginLimiter, authController.login);
router.post("/logout", authController.logout);
router.get("/me", authMiddleware, authController.me);
router.patch("/me", authMiddleware, authController.updateMe);
router.post("/alterar-senha", authMiddleware, passwordLimiter, authController.changePassword);

// Públicas, salvo o reenvio (só a advogada logada pede e-mail para a própria
// conta). Nomes em inglês: convenção do projeto para rotas novas.
router.post("/confirm-email", tokenLimiter, authController.confirmEmail);
router.post("/resend-confirmation", authMiddleware, resendLimiter, authController.resendConfirmation);
router.post("/forgot-password", forgotLimiter, authController.forgotPassword);
router.post("/reset-password", tokenLimiter, authController.resetPassword);

export default router;