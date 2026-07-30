// ═══════════════════════════════════════════════════════════════════════════
// CONFIRMAÇÃO DE VISUALIZAÇÃO — os dois lados.
//
// Lado do cliente: registrar (e só isso — nunca alterar, nunca apagar).
// Lado da advogada: listar, contar as não vistas, marcar como vistas.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";

import ConfirmacaoVisualizacao from "../models/ConfirmacaoVisualizacao.js";
import ProcessoCliente from "../models/ProcessoCliente.js";
import Process from "../models/Process.js";
import { listarDocumentosVisiveis } from "./portalService.js";
import { TEXTO_CONFIRMACAO } from "../config/textoConfirmacao.js";
import { ERRO_PORTAL } from "../config/portalErrors.js";

// ── Lado do cliente ────────────────────────────────────────────────────────

// Registra uma confirmação. Cada chamada cria um EVENTO NOVO.
//
// Idempotência deliberadamente ausente: confirmar de novo é permitido e gera
// outro registro. O cliente pode confirmar hoje, a advogada liberar um
// documento amanhã, e ele confirmar de novo — são dois fatos distintos, em
// datas distintas, sobre conteúdos distintos. Sobrescrever a anterior apagaria
// a primeira ciência, que é a que talvez importe num prazo.
export const registrarConfirmacao = async (portal) => {
  // O portão da senha provisória é o núcleo do desenho, e por isso é conferido
  // AQUI também, e não só no middleware de rota: se um dia alguém montar esta
  // rota fora da cadeia que tem `exigirSenhaDefinitiva`, o recibo continuaria
  // sendo recusado. Código de erro próprio, distinto do 403 genérico, porque a
  // tela precisa explicar o PORQUÊ — não é "troque a senha para continuar", é
  // "a confirmação só vale depois que você tiver uma senha que só você conhece".
  if (portal.senhaPortalProvisoria === true) {
    const error = new Error(
      "A confirmação só pode ser registrada depois que você definir uma senha pessoal. " +
      "Enquanto a senha for a provisória, entregue pelo escritório, não é possível " +
      "atribuir a confirmação a você com segurança."
    );
    error.statusCode = 403;
    error.codigo = ERRO_PORTAL.CONFIRMACAO_EXIGE_SENHA_PROPRIA;
    throw error;
  }

  // O instantâneo é lido do ESTADO REAL, agora, e nunca do que o cliente
  // mandou. Aceitar a lista do cliente permitiria registrar "confirmo os 5
  // documentos" quando só 2 estavam liberados.
  const documentos = await listarDocumentosVisiveis({
    processoId: portal.processoId,
    clienteId: portal.clienteId
  });

  const confirmacao = await ConfirmacaoVisualizacao.create({
    usuarioId: portal.usuarioId,
    processoClienteId: portal.processoClienteId,
    processoId: portal.processoId,
    clienteId: portal.clienteId,
    dataHora: new Date(),
    // Do backend, não do corpo da requisição. Ver `config/textoConfirmacao.js`.
    textoConfirmado: TEXTO_CONFIRMACAO,
    instantaneo: {
      statusProcesso: portal.processo.status,
      documentosVisiveis: documentos.map((d) => d._id),
      quantidadeDocumentos: documentos.length
    },
    vistaPelaAdvogada: false,
    ativo: true
  });

  // Desnormalização para a listagem de participantes da advogada não fazer
  // N+1. A coleção continua sendo a verdade; isto é atalho de leitura.
  await ProcessoCliente.updateOne(
    { _id: portal.processoClienteId },
    { $set: { ultimaConfirmacaoEm: confirmacao.dataHora } }
  );

  return confirmacao;
};

export const listarConfirmacoesDoVinculo = (processoClienteId) =>
  ConfirmacaoVisualizacao.find({ processoClienteId }).sort({ dataHora: -1 });

// ── Lado da advogada ───────────────────────────────────────────────────────

const erro = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const assertProcessoDoUsuario = async (usuarioId, processoId) => {
  if (!mongoose.Types.ObjectId.isValid(processoId)) {
    throw erro("Identificador de processo inválido", 400);
  }
  const processo = await Process.findOne({ _id: processoId, usuarioId, ativo: true });
  if (!processo) throw erro("Processo não encontrado", 404);
  return processo;
};

// Confirmações de um processo, com o participante que confirmou.
//
// Sem filtro de `ativo` nas confirmações: elas nunca são desativadas, e filtrar
// aqui sugeriria que podem ser. O filtro por `usuarioId` continua, como em toda
// leitura do projeto.
export const listarConfirmacoesDoProcesso = async (usuarioId, processoId) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const data = await ConfirmacaoVisualizacao.find({ usuarioId, processoId })
    .sort({ dataHora: -1 })
    .populate("clienteId", "nomeCompleto razaoSocial tipoPessoa");

  return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
};

export const contarNaoVistas = (usuarioId) =>
  ConfirmacaoVisualizacao.countDocuments({ usuarioId, vistaPelaAdvogada: false });

// Marca como vistas POR PROCESSO, não uma a uma: a advogada abre a ficha do
// processo e vê todas de uma vez. Marcar individualmente exigiria N chamadas
// para a mesma ação humana.
//
// É a ÚNICA mutação permitida sobre uma confirmação.
export const marcarComoVistas = async (usuarioId, processoId) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const resultado = await ConfirmacaoVisualizacao.updateMany(
    { usuarioId, processoId, vistaPelaAdvogada: false },
    { $set: { vistaPelaAdvogada: true } }
  );

  return { marcadas: resultado.modifiedCount ?? 0 };
};

// O estado por participante vive em `config/portalEstados.js`: é função pura do
// vínculo, e deixá-la aqui obrigaria `processoClienteService` a importar este
// service para calcular um `if`.
export { estadoDoParticipante, ESTADO_PORTAL } from "../config/portalEstados.js";

export default {
  registrarConfirmacao,
  listarConfirmacoesDoVinculo,
  listarConfirmacoesDoProcesso,
  contarNaoVistas,
  marcarComoVistas
};
