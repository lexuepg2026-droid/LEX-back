// ═══════════════════════════════════════════════════════════════════════════
// ROTAS DO PORTAL DO CLIENTE — `/api/portal`
//
// Superfície separada da API da advogada: prefixo próprio, middleware próprio,
// segredo próprio. Nenhuma rota daqui usa `authMiddleware`, e nenhuma rota de
// lá usa `portalAuthMiddleware`.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { janelaMs, teto } from "../config/rateLimit.js";

import portalAuthController from "../controllers/portalAuthController.js";
import portalController from "../controllers/portalController.js";
import portalService from "../services/portalService.js";
import portalAuthMiddleware, {
  exigirSenhaDefinitiva,
  exigirVinculoLiberado
} from "../middleware/portalAuthMiddleware.js";

const router = Router();

// ── Rate limit ─────────────────────────────────────────────────────────────
// Quarto balde, INDEPENDENTE dos três de `authRoutes.js`: estourar o do portal
// não pode travar o login da advogada, e vice-versa.
//
// Construído na CARGA DO MÓDULO, lendo `process.env` uma vez — exatamente o
// mesmo padrão de `authRoutes.js`. Quem for afrouxar isto em teste precisa
// definir a variável ANTES de `src/app.js` ser importado; é o que
// `tests/helpers/env.js` faz, e é por isso que `server.js` da suíte carrega o
// app por import dinâmico.
//
// Teto default 5, mais apertado que o login da advogada (10), de propósito: o
// login do portal é a superfície mais atacável do sistema. O código de acesso
// circula por WhatsApp e por papel — é público-ish — e a senha é o único fator.
// O multiplicador por ambiente e a janela vêm de `config/rateLimit.js` (F-2b).
// Este bloco era uma cópia literal do de `authRoutes.js`.
const portalLoginLimiter = rateLimit({
  windowMs: janelaMs(),
  max: teto("RATE_LIMIT_PORTAL_LOGIN", 5),
  message: { message: "Muitas tentativas de acesso ao portal. Tente novamente em alguns minutos." },
  standardHeaders: true,
  legacyHeaders: false
});

// ── Públicas ───────────────────────────────────────────────────────────────
router.post("/login", portalLoginLimiter, portalAuthController.login);
router.post("/logout", portalAuthController.logout);

// ── Autenticadas ───────────────────────────────────────────────────────────
router.use(portalAuthMiddleware);

router.get("/sessao", portalAuthController.sessao);
router.patch("/senha", portalAuthController.trocarSenha);

// O texto da declaração é constante do backend e a tela precisa dele para
// renderizar a área de confirmação mesmo antes da troca — inclusive para
// explicar por que a confirmação ainda está bloqueada. Não é dado de processo
// nenhum, e por isso continua sem `:processoId`.
router.get("/confirmacoes/texto", portalController.textoConfirmacao);

// ── Fase 2.5 (DEC-092): todo dado de processo leva `:processoId` ──────────
// `exigirVinculoLiberado` confere, A CADA REQUISIÇÃO, que o vínculo (cliente
// da sessão, processo da URL) existe, está ativo e liberado, e que o processo
// está ativo. Desliberar no meio da sessão vale na próxima requisição.
//
// `POST .../confirmacoes` fica ANTES do portão genérico de propósito. Ele é
// bloqueado do mesmo jeito, mas por `confirmacaoService`, que devolve o código
// `confirmacaoExigeSenhaPropria` em vez do genérico `senhaPortalProvisoria`.
// Os dois 403 acontecem na mesma condição e mesmo assim são distintos, porque
// a tela precisa dizer coisas diferentes: "troque a senha para continuar" e "a
// confirmação só vale depois que você definir uma senha que só você conhece".
router.post(
  "/processos/:processoId/confirmacoes",
  exigirVinculoLiberado,
  portalController.confirmar
);

router.use(exigirSenhaDefinitiva);

// A lista dos processos LIBERADOS da pessoa. Não registra acesso: ver a lista
// não é abrir o processo, e é o "acessou" de UM processo que a advogada lê.
router.get("/processos", portalController.processos);

// ── Registro de acesso ─────────────────────────────────────────────────────
// Depois do portão da senha provisória, de propósito: enquanto o cliente não
// tiver assumido a senha, quem está entrando pode ser a advogada testando a
// credencial que acabou de criar. Registrar isso como "o cliente acessou"
// seria rastro falso.
//
// Aguardado, e não disparado e esquecido: sem `await` a escrita corria com a
// leitura da requisição seguinte e o rastro gravava de forma intermitente.
// Desde a 2.5 ele é do vínculo da URL — o processo que a pessoa abriu.
const registrarAcesso = async (req, _res, next) => {
  await portalService.registrarAcesso(req.portal.processoClienteId);
  next();
};

const doProcesso = [exigirVinculoLiberado, registrarAcesso];

router.get("/processos/:processoId", ...doProcesso, portalController.processo);
router.get("/processos/:processoId/documentos", ...doProcesso, portalController.documentos);
router.get(
  "/processos/:processoId/documentos/:id/download",
  ...doProcesso,
  portalController.baixarDocumento
);
// O histórico é DADO, e por isso fica depois do portão genérico.
router.get("/processos/:processoId/confirmacoes", ...doProcesso, portalController.minhasConfirmacoes);

export default router;
