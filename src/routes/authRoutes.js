import express from "express";
import rateLimit from "express-rate-limit";
import authController from "../controllers/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Um balde por operação. Compartilhar o mesmo limitador entre register e login
// fazia tentativas de cadastro consumirem a cota de login (e vice-versa): quem
// errasse o formulário de cadastro algumas vezes ficava sem conseguir entrar.
// A mensagem diz qual limite estourou, senão o usuário não sabe o que esperar.
//
// ── Limites por ambiente ───────────────────────────────────────────────────
// Os tetos vêm de variável de ambiente, com os valores de produção como
// default: quem não configurar nada continua com 5/10/5 por 15 minutos, que é
// o que já valia. NÃO baixar os defaults — eles são a proteção real contra
// força bruta.
//
// Fora de produção o teto é multiplicado por MULTIPLICADOR_DEV. Testar o
// cadastro seis vezes seguidas em desenvolvimento é rotina, e travar por 15
// minutos no meio de uma sessão de trabalho custa mais do que protege numa
// base local.
const MULTIPLICADOR_DEV = 20;
const ehProducao = () => process.env.NODE_ENV === "production";

const inteiroPositivo = (valor, padrao) => {
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) && n > 0 ? n : padrao;
};

const JANELA_MS = inteiroPositivo(process.env.RATE_LIMIT_JANELA_MINUTOS, 15) * 60 * 1000;

const limite = (variavel, padrao) => {
  const base = inteiroPositivo(process.env[variavel], padrao);
  return ehProducao() ? base : base * MULTIPLICADOR_DEV;
};

const criarLimiter = (variavel, padrao, message) =>
  rateLimit({
    windowMs: JANELA_MS,
    max: limite(variavel, padrao),
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

router.post("/register", registerLimiter, authController.register);
router.post("/login", loginLimiter, authController.login);
router.post("/logout", authController.logout);
router.get("/me", authMiddleware, authController.me);
router.patch("/me", authMiddleware, authController.updateMe);
router.post("/alterar-senha", authMiddleware, passwordLimiter, authController.changePassword);

export default router;