import portalAuthService, {
  NOME_COOKIE_PORTAL,
  MAX_AGE_COOKIE_PORTAL_MS
} from "../services/portalAuthService.js";
import {
  validateLoginPortal,
  validateTrocaSenhaPortal
} from "../validations/portalAuthValidation.js";

// Mesmas opções do cookie da advogada (`authController`), com maxAge próprio:
// httpOnly para JavaScript de página não conseguir ler, `sameSite` estrito em
// produção, `secure` só em produção — em `http://localhost` o navegador não
// grava cookie `Secure` e o login quebraria em silêncio no ambiente de
// desenvolvimento.
const COOKIE_PORTAL = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_COOKIE_PORTAL_MS
};

const login = async (req, res, next) => {
  try {
    const erro = validateLoginPortal(req.body);
    if (erro) {
      const err = new Error(erro);
      err.statusCode = 400;
      return next(err);
    }

    const data = await portalAuthService.login({
      codigoAcesso: req.body.codigoAcesso,
      senha: req.body.senha
    });

    res.cookie(NOME_COOKIE_PORTAL, data.token, COOKIE_PORTAL);

    // O token NÃO vai no corpo: ele vive só no cookie httpOnly. Devolvê-lo
    // também no JSON o tornaria legível por JavaScript e anularia o httpOnly.
    return res.status(200).json({
      senhaPortalProvisoria: data.senhaPortalProvisoria,
      processoId: data.processoId,
      clienteId: data.clienteId
    });
  } catch (error) {
    return next(error);
  }
};

const trocarSenha = async (req, res, next) => {
  try {
    const erro = validateTrocaSenhaPortal(req.body);
    if (erro) {
      const err = new Error(erro);
      err.statusCode = 400;
      return next(err);
    }

    const cliente = await portalAuthService.trocarSenha({
      clienteId: req.portal.clienteId,
      senhaAtual: req.body.senhaAtual,
      novaSenha: req.body.novaSenha
    });

    // Sessão reemitida: o token anterior foi assinado com o carimbo da senha
    // antiga e deixa de casar na requisição seguinte. Sem isto, a janela em que
    // a advogada conhecia a senha continuaria aberta pelo resto das 2 horas.
    const token = await portalAuthService.reemitirSessao(
      req.portal.processoClienteId,
      cliente
    );
    res.cookie(NOME_COOKIE_PORTAL, token, COOKIE_PORTAL);

    return res.status(200).json({
      message: "Senha alterada. A partir de agora só você a conhece.",
      senhaPortalProvisoria: false,
      senhaPortalDefinidaEm: cliente.senhaPortalDefinidaEm
    });
  } catch (error) {
    return next(error);
  }
};

const logout = (req, res) => {
  res.clearCookie(NOME_COOKIE_PORTAL, {
    httpOnly: COOKIE_PORTAL.httpOnly,
    sameSite: COOKIE_PORTAL.sameSite,
    secure: COOKIE_PORTAL.secure,
    path: COOKIE_PORTAL.path
  });
  return res.status(200).json({ message: "Sessão encerrada" });
};

// Estado da sessão, para o portal saber o que desenhar sem precisar adivinhar.
// Responde mesmo com senha provisória — é justamente quem precisa saber disso.
const sessao = (req, res) =>
  res.status(200).json({
    senhaPortalProvisoria: req.portal.senhaPortalProvisoria,
    papel: req.portal.papel,
    processoId: req.portal.processoId
  });

export default { login, trocarSenha, logout, sessao };
