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
//
// ── Fase 2.5 (DEC-092): DOIS portões, e não um ───────────────────────────
//   `portalAuthMiddleware`   — a SESSÃO: token válido, escopo de pessoa,
//                              cliente ativo, carimbo da senha conferindo.
//   `exigirVinculoLiberado`  — o PROCESSO: em toda rota com `:processoId`,
//                              o vínculo (cliente, processo) existe, está
//                              ativo e LIBERADO, e o processo está ativo.
//
// O segundo roda A CADA REQUISIÇÃO, e é de propósito que a liberação não vai
// no token: a advogada que desliga um processo no meio da sessão precisa que a
// próxima requisição já seja recusada, e não daqui a 2 horas.
// ═══════════════════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import ProcessoCliente from "../models/ProcessoCliente.js";
import Client from "../models/Client.js";
import Process from "../models/Process.js";
import { ERRO_PORTAL } from "../config/portalErrors.js";
import {
  NOME_COOKIE_PORTAL,
  TIPO_TOKEN_PORTAL,
  ESCOPO_SESSAO_PORTAL,
  carimboDaSenha
} from "../services/portalAuthService.js";

// 401 com código estável: o frontend distingue "a sessão acabou, volte ao
// login" de qualquer outro erro sem ler a frase.
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
      // Assinatura errada, expirado, malformado: tudo é "sessão inválida".
      return sessaoInvalida(res);
    }

    if (decoded?.tipo !== TIPO_TOKEN_PORTAL) return sessaoInvalida(res);

    // O token por VÍNCULO, de antes da 2.5, não tem escopo: volta ao login
    // (DEC-090, sem transição).
    if (decoded?.escopo !== ESCOPO_SESSAO_PORTAL) return sessaoInvalida(res);

    if (!mongoose.Types.ObjectId.isValid(decoded.clienteId)) return sessaoInvalida(res);

    // Cliente ATIVO, e da advogada que o token diz. Desativar o cliente
    // derruba a sessão na requisição seguinte.
    const cliente = await Client.findOne({
      _id: decoded.clienteId,
      usuarioId: decoded.usuarioId,
      ativo: true
    });
    if (!cliente) return sessaoInvalida(res);

    if (typeof cliente.senhaPortalProvisoria !== "boolean") return sessaoInvalida(res);

    // Senha trocada (ou revogada) depois da emissão: o carimbo não confere e
    // o token morre. É o que fecha a janela da senha provisória.
    if (decoded.senhaCarimbo !== carimboDaSenha(cliente)) return sessaoInvalida(res);

    req.portal = {
      clienteId: cliente._id,
      usuarioId: cliente.usuarioId,
      senhaPortalProvisoria: cliente.senhaPortalProvisoria === true,
      cliente
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

// ── "Não existe" e "não é seu" são a MESMA resposta (regra 7 da 2.5) ─────
// Processo de outra advogada, de outro cliente, não liberado, desativado ou
// com id malformado: 404 "Processo não encontrado", corpo idêntico. Distinguir
// diria a quem está logado quais ids existem no sistema.
const processoNaoEncontrado = () => {
  const error = new Error("Processo não encontrado");
  error.statusCode = 404;
  return error;
};

export const exigirVinculoLiberado = async (req, _res, next) => {
  try {
    const { processoId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(processoId)) return next(processoNaoEncontrado());

    const vinculo = await ProcessoCliente.findOne({
      processoId,
      clienteId: req.portal.clienteId,
      usuarioId: req.portal.usuarioId,
      ativo: true,
      liberadoNoPortal: true
    });
    if (!vinculo) return next(processoNaoEncontrado());

    const processo = await Process.findOne({
      _id: processoId,
      usuarioId: req.portal.usuarioId,
      ativo: true
    });
    if (!processo) return next(processoNaoEncontrado());

    Object.assign(req.portal, {
      processoClienteId: vinculo._id,
      processoId: processo._id,
      papel: vinculo.papel,
      principal: vinculo.principal,
      vinculo,
      processo
    });

    return next();
  } catch (error) {
    return next(error);
  }
};

// Toda rota de DADO exige senha definitiva — a troca obrigatória (DEC-029
// ponto 4). As exceções (sessão, troca de senha, texto da confirmação e a
// própria confirmação, que tem 403 com código próprio) são montadas ANTES
// deste portão em `portalRoutes.js`.
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
