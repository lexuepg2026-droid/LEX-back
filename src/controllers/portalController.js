import portalService from "../services/portalService.js";
import confirmacaoService from "../services/confirmacaoService.js";
import { projetarConfirmacao, projetarConfirmacoes } from "../services/portalProjection.js";
import { renderizarDocumento, FORMATOS } from "../services/documentRenderService.js";
import { TEXTO_CONFIRMACAO, VERSAO_TEXTO_CONFIRMACAO } from "../config/textoConfirmacao.js";
import User from "../models/User.js";

// ═══════════════════════════════════════════════════════════════════════════
// Consulta do portal. Todo handler responde a partir do escopo em `req.portal`,
// montado pelo `portalAuthMiddleware` a partir do BANCO — nunca de parâmetro
// de rota ou de query. Não existe `:processoId` na URL do portal de propósito:
// o processo é o da sessão, e aceitar um id na URL criaria a possibilidade de
// pedir outro.
// ═══════════════════════════════════════════════════════════════════════════

const processo = async (req, res, next) => {
  try {
    return res.status(200).json(portalService.obterProcesso(req.portal));
  } catch (error) {
    return next(error);
  }
};

const documentos = async (req, res, next) => {
  try {
    return res.status(200).json(await portalService.obterDocumentos(req.portal));
  } catch (error) {
    return next(error);
  }
};

// Download PRÓPRIO do portal, e não o `baixarDocumentoService` da advogada.
//
// Aquele resolve o documento por `{ _id, usuarioId }` — escopo da advogada — e
// não conhece `visivelPortal` nem `clienteId` da sessão. Reaproveitá-lo aqui
// significaria confiar num filtro que foi escrito para outra pergunta, e
// bastaria alguém mexer nele para o portal passar a entregar documento não
// liberado. A resolução acontece em `portalService`, com a checagem tripla.
//
// A RENDERIZAÇÃO é a mesma (`documentRenderService`), e isso é proposital: o
// arquivo que o cliente baixa tem de ser byte a byte o que a advogada baixa.
// Dois renderizadores divergiriam, e o cliente receberia uma peça diferente da
// que está no processo.
const baixarDocumento = async (req, res, next) => {
  try {
    const formato = String(req.query.formato ?? "pdf").toLowerCase().trim();
    if (!FORMATOS.includes(formato)) {
      const err = new Error(`Formato inválido: use ${FORMATOS.join(" ou ")}.`);
      err.statusCode = 400;
      return next(err);
    }

    const documento = await portalService.obterDocumentoParaDownload(
      req.portal,
      req.params.id
    );

    // O timbrado é o do escritório da advogada dona do processo. Vem do
    // `usuarioId` do VÍNCULO, não de `req.user` — no portal não existe
    // `req.user`, e é essa a diferença que o middleware separado garante.
    const usuario = await User.findById(req.portal.usuarioId);
    if (!usuario) {
      const err = new Error("Documento não encontrado");
      err.statusCode = 404;
      return next(err);
    }

    const { buffer, contentType, nomeArquivo } = await renderizarDocumento({
      documento,
      usuario,
      cliente: req.portal.cliente,
      formato
    });

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
};

// O texto que o portal deve EXIBIR, e que será gravado no registro. Sai do
// backend para que a tela e o recibo não possam divergir: os dois vêm daqui.
const textoConfirmacao = (_req, res) =>
  res.status(200).json({
    texto: TEXTO_CONFIRMACAO,
    versao: VERSAO_TEXTO_CONFIRMACAO
  });

// `textoConfirmado` NÃO vem do corpo. Ver `config/textoConfirmacao.js`: o
// recibo tem de registrar o que o SISTEMA apresentou, não o que o navegador
// mandou.
const confirmar = async (req, res, next) => {
  try {
    const confirmacao = await confirmacaoService.registrarConfirmacao(req.portal);
    return res.status(201).json(projetarConfirmacao(confirmacao));
  } catch (error) {
    return next(error);
  }
};

// O cliente vê o próprio histórico de confirmações — é dele, e poder reler o
// que declarou faz parte de a declaração ser dele.
const minhasConfirmacoes = async (req, res, next) => {
  try {
    const confirmacoes = await confirmacaoService.listarConfirmacoesDoVinculo(
      req.portal.processoClienteId
    );
    const data = projetarConfirmacoes(confirmacoes);
    return res.status(200).json({
      data, total: data.length, page: 1, limit: data.length, totalPages: 1
    });
  } catch (error) {
    return next(error);
  }
};

export default {
  processo, documentos, baixarDocumento,
  textoConfirmacao, confirmar, minhasConfirmacoes
};
