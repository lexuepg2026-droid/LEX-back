// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE DE SESSÃO DO PORTAL DO CLIENTE
//
// Lê APENAS `lex-portal-token` e valida APENAS com `JWT_PORTAL_SECRET`. Não
// conhece `lex-token` nem `JWT_SECRET`, e não deve passar a conhecer.
//
// As duas direções do isolamento, uma guarda em cada middleware:
//   - aqui: token SEM `tipo: "portal"` é rejeitado;
//   - em `authMiddleware`: token COM `tipo: "portal"` é rejeitado.
//
// A defesa primária não é nenhuma das duas: é o segredo distinto, que faz a
// assinatura de um domínio não conferir no outro. Estas checagens são a segunda
// tranca, para o dia em que alguém apontar as duas variáveis para o mesmo
// valor sem perceber.
// ═══════════════════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";

import ProcessoCliente from "../models/ProcessoCliente.js";
import Client from "../models/Client.js";
import Process from "../models/Process.js";
import { ERRO_PORTAL } from "../config/portalErrors.js";
import {
  NOME_COOKIE_PORTAL,
  TIPO_TOKEN_PORTAL,
  carimboDaSenha
} from "../services/portalAuthService.js";

const sessaoInvalida = (res) =>
  res.status(401).json({
    message: "Sessão do portal inválida ou expirada.",
    codigo: ERRO_PORTAL.SESSAO_INVALIDA
  });

export const portalAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies?.[NOME_COOKIE_PORTAL];
    if (!token) return sessaoInvalida(res);

    if (!process.env.JWT_PORTAL_SECRET) {
      return res.status(500).json({ message: "JWT_PORTAL_SECRET não configurado" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_PORTAL_SECRET);
    } catch {
      return sessaoInvalida(res);
    }

    // Segunda tranca: um token da advogada que por acaso passasse na assinatura
    // não tem `tipo` e morre aqui.
    if (decoded?.tipo !== TIPO_TOKEN_PORTAL) return sessaoInvalida(res);

    // O vínculo é revalidado a cada requisição, e não confiado ao token: a
    // advogada pode ter desativado o vínculo, o processo ou o cliente depois de
    // a sessão ser emitida. Sessão de 2 horas é tempo de sobra para isso
    // acontecer, e revogar acesso precisa ter efeito imediato.
    const vinculo = await ProcessoCliente.findOne({
      _id: decoded.processoClienteId,
      ativo: true
    });
    if (!vinculo) return sessaoInvalida(res);

    // Coerência entre token e vínculo. Se divergirem, o token foi forjado por
    // alguém com o segredo, ou o vínculo mudou de dono — nos dois casos, fora.
    if (
      String(vinculo.clienteId) !== String(decoded.clienteId) ||
      String(vinculo.processoId) !== String(decoded.processoId) ||
      String(vinculo.usuarioId) !== String(decoded.usuarioId)
    ) {
      return sessaoInvalida(res);
    }

    const cliente = await Client.findOne({ _id: vinculo.clienteId, ativo: true });
    if (!cliente) return sessaoInvalida(res);

    // Cliente sem senha = acesso revogado pela advogada. A sessão morre na
    // requisição seguinte, sem esperar as 2 horas.
    if (typeof cliente.senhaPortalProvisoria !== "boolean") return sessaoInvalida(res);

    // Carimbo da senha: é o que faz a troca de senha invalidar o token
    // anterior. Ver o comentário em `portalAuthService.carimboDaSenha`.
    if (decoded.senhaCarimbo !== carimboDaSenha(cliente)) return sessaoInvalida(res);

    const processo = await Process.findOne({ _id: vinculo.processoId, ativo: true });
    if (!processo) return sessaoInvalida(res);

    // Escopo da sessão, montado a partir do BANCO e não do token.
    req.portal = {
      processoClienteId: vinculo._id,
      clienteId: cliente._id,
      processoId: processo._id,
      usuarioId: vinculo.usuarioId,
      papel: vinculo.papel,
      principal: vinculo.principal,
      senhaPortalProvisoria: cliente.senhaPortalProvisoria === true,
      vinculo,
      cliente,
      processo
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

// ── Portão da senha provisória (DEC-029 ponto 4) ───────────────────────────
//
// 403, não 401. A sessão é VÁLIDA — o cliente autenticou e é quem diz ser. O
// que falta é um passo. Responder 401 mandaria o portal descartar a sessão e
// voltar ao login, e o cliente entraria em laço: logar de novo devolve
// exatamente o mesmo estado.
//
// Aplicado a todas as rotas do portal EXCETO a troca de senha e o logout — as
// duas únicas que fazem sentido com senha provisória.
export const exigirSenhaDefinitiva = (req, res, next) => {
  if (req.portal?.senhaPortalProvisoria === true) {
    return res.status(403).json({
      message:
        "Antes de continuar, defina uma senha pessoal. A senha que você recebeu é provisória.",
      codigo: ERRO_PORTAL.SENHA_PROVISORIA
    });
  }
  return next();
};

export default portalAuthMiddleware;
