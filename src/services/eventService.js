// ═══════════════════════════════════════════════════════════════════════════
// EVENTO — o CRUD do fato da agenda (F-3, Parte 1)
//
// Este arquivo grava eventos, e só eventos. A outra metade do calendário —
// vencimento de parcela e de honorário — é **data derivada** e não passa por
// aqui em momento nenhum: ela se LÊ da origem, em `calendarService.js`
// (DEC-055). Se alguma vez alguém precisar chamar uma função deste arquivo
// para pôr um vencimento no calendário, a DEC-055 foi quebrada.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";

import Event from "../models/Event.js";
import {
  assertProcessoAtivoParaCriar,
  findInactiveParentsOfEvent,
  erroDePaiInativo
} from "./activationHierarchy.js";
import {
  validarCriacaoEvento,
  validarAtualizacaoEvento,
  validarConclusaoEvento
} from "../validations/eventValidation.js";
import { checarUpdate } from "../validations/shared/camposPermitidos.js";
import {
  lerDataDeCalendario,
  escreverDataDeCalendario
} from "../utils/dataDeCalendario.js";
import { filtroTexto, filtroObjectIdExigido, filtroSituacao } from "../utils/filtrosDeConsulta.js";
import { assertVersaoAtual } from "./concurrencyGuard.js";
import { rotuloDoTipoDeEvento } from "../config/tiposEvento.js";

const erro = (status, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = status;
  Object.assign(error, extra);
  return error;
};

const validarObjectId = (id, nomeCampo = "id") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw erro(400, `${nomeCampo} inválido`);
  }
};

// ── A PROJEÇÃO — a data cruza a rede como STRING ─────────────────────────
//
// `data` sai `"2026-09-01"`, e não `"2026-09-01T00:00:00.000Z"`. É a decisão
// de fuso desta fase, e está inteira em `utils/dataDeCalendario.js`: uma data
// de calendário não tem fuso, e serializá-la como instante inventa um que todo
// consumidor depois precisa lembrar de desfazer.
//
// `concluidoEm`, ao contrário, sai como ISO completo — ele É um instante (o
// momento em que ela clicou), como `createdAt`. A assimetria é proposital e é
// o que diz, na própria resposta, quais campos são casa de calendário e quais
// são ponto na linha do tempo.
//
// `tipoRotulo` vai junto por decisão da fase: **nenhuma tela monta rótulo de
// tipo por conta própria**. Foi o que a tela de processos fazia com o `status`
// cru, capitalizando a string do enum, e é como "parcialmente_pago" chegou a
// aparecer com sublinhado na interface.
export const projetarEvento = (evento) => {
  if (!evento) return null;
  const doc = typeof evento.toObject === "function" ? evento.toObject() : evento;

  const processo = doc.processoId && typeof doc.processoId === "object" && doc.processoId._id
    ? {
        _id: String(doc.processoId._id),
        titulo: doc.processoId.titulo ?? null,
        numeroProcesso: doc.processoId.numeroProcesso ?? null
      }
    : null;

  return {
    _id: String(doc._id),
    tipo: doc.tipo,
    tipoRotulo: rotuloDoTipoDeEvento(doc.tipo),
    titulo: doc.titulo,
    descricao: doc.descricao ?? null,
    local: doc.local ?? null,
    data: escreverDataDeCalendario(doc.data),
    hora: doc.hora ?? null,
    processoId: processo ? processo._id : (doc.processoId ? String(doc.processoId) : null),
    processo,
    concluido: Boolean(doc.concluido),
    concluidoEm: doc.concluidoEm ? new Date(doc.concluidoEm).toISOString() : null,
    ativo: doc.ativo !== false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
};

// ── DEC-053, boca 2: o evento não NASCE sob processo desativado ──────────
//
// Só quando há processo. O evento solto não tem pai, e a pergunta não se
// aplica a ele — ver a nota de `Event` na árvore de `activationHierarchy.js`.
//
// `acao` é o verbo do que foi recusado, e vai para a frase da recusa
// ("Não é possível criar o evento: o processo X está desativado").
const assertProcessoDoEvento = async (usuarioId, processoId, acao) => {
  if (processoId === null || processoId === undefined || processoId === "") return null;
  validarObjectId(processoId, "processoId");
  return assertProcessoAtivoParaCriar(usuarioId, processoId, acao);
};

export const criarEvento = async (usuarioId, dados) => {
  const erros = validarCriacaoEvento(dados);
  if (erros.length > 0) throw erro(400, erros.join(", "));

  await assertProcessoDoEvento(usuarioId, dados.processoId, "criar o evento");

  const evento = await Event.create({
    usuarioId,
    tipo: dados.tipo,
    titulo: dados.titulo.trim(),
    descricao: dados.descricao?.trim() || null,
    local: dados.local?.trim() || null,
    // Ponto único de escrita da data. Nunca `new Date(dados.data)` solto: o
    // construtor aceitaria o instante ISO que a validação acabou de recusar, e
    // um caminho que aceita o que o outro recusa é como a regra vira opcional.
    data: lerDataDeCalendario(dados.data),
    hora: dados.hora?.trim() || null,
    processoId: dados.processoId || null
  });

  return buscarEventoPorId(usuarioId, evento._id);
};

export const buscarEventoPorId = async (usuarioId, eventoId) => {
  validarObjectId(eventoId, "id");

  const evento = await Event.findOne({ _id: eventoId, usuarioId, ativo: true })
    .populate("processoId", "titulo numeroProcesso");

  if (!evento) throw erro(404, "Evento não encontrado");

  return projetarEvento(evento);
};

// ── Listagem paginada ────────────────────────────────────────────────────
//
// Existe separada do calendário de propósito, e as duas NÃO se substituem:
//
//   `GET /events`   — a lista da entidade, paginada, com filtro e busca. É por
//                     onde se acha "aquela reunião de junho" sem saber o mês.
//   `GET /calendar` — o recorte por INTERVALO, com as derivadas junto, sem
//                     paginação. É o que a grade e a agenda consomem.
//
// Paginar o calendário não faria sentido — um mês tem os itens que tem, e uma
// "página 2 de setembro" não é uma pergunta que alguém faça olhando uma grade.
export const listarEventos = async (
  usuarioId,
  { page = 1, limit = 20, processoId, tipo, situacao, concluido, busca } = {}
) => {
  const skip = (page - 1) * limit;

  const filter = { usuarioId, ...filtroSituacao(situacao) };

  const processoFiltro = filtroObjectIdExigido(processoId, "processoId");
  if (processoFiltro) filter.processoId = processoFiltro;

  const tipoFiltro = filtroTexto(tipo);
  if (tipoFiltro) filter.tipo = tipoFiltro;

  // `"true"`/`"false"` da query string. Ausente é "os dois" — e é o padrão,
  // porque a lista da entidade não é o sino: aqui a advogada procura, e o que
  // ela procura pode muito bem já ter acontecido.
  if (concluido === "true") filter.concluido = true;
  else if (concluido === "false") filter.concluido = false;

  const termo = filtroTexto(busca);
  if (termo) {
    const regex = new RegExp(termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ titulo: regex }, { descricao: regex }, { local: regex }];
  }

  const [documentos, total] = await Promise.all([
    Event.find(filter)
      .populate("processoId", "titulo numeroProcesso")
      // Data crescente, e o desempate por hora. O evento sem hora vem antes do
      // que tem hora no mesmo dia: "sem hora" é o compromisso do dia inteiro, e
      // pô-lo depois do das 14h30 sugeriria que ele acontece à noite.
      .sort({ data: 1, hora: 1, createdAt: 1 })
      .skip(skip)
      .limit(limit),
    Event.countDocuments(filter)
  ]);

  return {
    data: documentos.map(projetarEvento),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 0
  };
};

// `opcoes.versaoVista` é o `updatedAt` que o cliente leu (DEC-060). Chega do
// controller, e não do corpo: o corpo passa por `checarUpdate`, que recusa
// campo desconhecido — e com razão. Ausente, a verificação não acontece e o
// comportamento é o de antes da F-5b.
export const atualizarEvento = async (usuarioId, eventoId, dados, opcoes = {}) => {
  validarObjectId(eventoId, "id");

  const recusa = checarUpdate("events", dados);
  if (recusa) throw erro(400, recusa.mensagem, { campo: recusa.campo });

  const erros = validarAtualizacaoEvento(dados);
  if (erros.length > 0) throw erro(400, erros.join(", "));

  const evento = await Event.findOne({ _id: eventoId, usuarioId, ativo: true });
  if (!evento) throw erro(404, "Evento não encontrado");

  // ⚠️ ANTES de qualquer escrita: a gravação atrasada de um aparelho que
  // ficou offline não pode atropelar a de outro (DEC-060).
  assertVersaoAtual(evento, opcoes.versaoVista, projetarEvento, "compromisso");

  const enviou = (campo) => Object.prototype.hasOwnProperty.call(dados, campo);

  // ── DEC-053, a TERCEIRA porta: MOVER para processo desativado ──────────
  //
  // A mesma porta que a F-2d fechou no `PATCH /fees/:id` com `processoId`. Sem
  // ela, o evento continuaria ativo e passaria a pender de um pai inativo —
  // o órfão nascendo pela edição em vez de pela criação.
  if (enviou("processoId")) {
    await assertProcessoDoEvento(usuarioId, dados.processoId, "mover o evento");
    evento.processoId = dados.processoId || null;
  }

  if (enviou("tipo")) evento.tipo = dados.tipo;
  if (enviou("titulo")) evento.titulo = dados.titulo.trim();
  if (enviou("data")) evento.data = lerDataDeCalendario(dados.data);

  // ── `null` APAGA; `undefined` não chega aqui ──────────────────────────
  //
  // A convenção do projeto, aplicada nos quatro opcionais. O `?? null` no fim
  // é o que faz `""` (string vazia vinda de um input limpo) virar `null` em vez
  // de gravar vazio: campo apagado é `null`, e um "" gravado apareceria como
  // preenchido em toda checagem de existência.
  if (enviou("descricao")) evento.descricao = dados.descricao?.trim() || null;
  if (enviou("local")) evento.local = dados.local?.trim() || null;
  if (enviou("hora")) evento.hora = dados.hora?.trim() || null;

  // `save()`, e não `findOneAndUpdate()`: é a regra 6 do projeto — o segundo
  // não dispara `pre("validate")`, e regra que só vale na criação não é regra.
  await evento.save();

  return buscarEventoPorId(usuarioId, eventoId);
};

// ── Conclusão — ponto ÚNICO de escrita dos dois campos ───────────────────
//
// Marca e desmarca. Desmarcar limpa o carimbo (`concluidoEm: null`): um
// `concluidoEm` sobrevivente num evento não concluído seria a data de uma
// conclusão que foi desfeita, e ninguém que a lesse depois saberia disso.
export const concluirEvento = async (usuarioId, eventoId, dados, opcoes = {}) => {
  validarObjectId(eventoId, "id");

  const erros = validarConclusaoEvento(dados);
  if (erros.length > 0) throw erro(400, erros.join(", "));

  const evento = await Event.findOne({ _id: eventoId, usuarioId, ativo: true });
  if (!evento) throw erro(404, "Evento não encontrado");

  assertVersaoAtual(evento, opcoes.versaoVista, projetarEvento, "compromisso");

  evento.concluido = dados.concluido;
  evento.concluidoEm = dados.concluido ? new Date() : null;
  await evento.save();

  return buscarEventoPorId(usuarioId, eventoId);
};

// Soft delete, como todo o resto do projeto.
//
// Sem 409 de integridade: nada pende de um evento. Ele é folha da árvore — não
// tem filho, e nenhuma outra coleção o referencia. O dia em que algo o
// referenciar, este é o lugar da checagem.
export const deletarEvento = async (usuarioId, eventoId) => {
  validarObjectId(eventoId, "id");

  const evento = await Event.findOne({ _id: eventoId, usuarioId, ativo: true });
  if (!evento) throw erro(404, "Evento não encontrado");

  evento.ativo = false;
  await evento.save();

  return { message: "Evento desativado com sucesso" };
};

// ── DEC-053, boca 1: o evento não SOBE sem o pai ─────────────────────────
export const reativarEvento = async (usuarioId, eventoId) => {
  validarObjectId(eventoId, "id");

  // `ativo: false` no filtro, como em `reactivateProcess`: reativar o que já
  // está ativo é sinal de que a tela ofereceu uma ação que não existia, e um
  // 200 esconderia isso.
  const evento = await Event.findOne({ _id: eventoId, usuarioId, ativo: false });
  if (!evento) throw erro(404, "Evento não encontrado ou já está ativo");

  const paisInativos = await findInactiveParentsOfEvent(usuarioId, evento);
  if (paisInativos.length > 0) throw erroDePaiInativo(paisInativos, "reativar");

  evento.ativo = true;
  await evento.save();

  return buscarEventoPorId(usuarioId, eventoId);
};

// ── Os eventos de um processo, para a linha do tempo (Parte 5) ───────────
//
// Sem paginação e sem filtro de conclusão: a linha do tempo é a história
// inteira daquele processo, e um "próxima página" no meio dela seria uma
// história cortada. O recorte de quantidade, se um dia fizer falta, é por
// PERÍODO — que é como se lê uma linha do tempo.
export const listarEventosDoProcesso = async (usuarioId, processoId) => {
  validarObjectId(processoId, "processoId");

  const eventos = await Event.find({
    usuarioId,
    processoId,
    ativo: true
  }).sort({ data: 1, hora: 1, createdAt: 1 });

  return eventos.map(projetarEvento);
};

export default {
  criarEvento,
  buscarEventoPorId,
  listarEventos,
  atualizarEvento,
  concluirEvento,
  deletarEvento,
  reativarEvento,
  listarEventosDoProcesso,
  projetarEvento
};
