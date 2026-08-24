import mongoose from "mongoose";
import Process from "../models/Process.js";
import { checarUpdate } from "../validations/shared/camposPermitidos.js";
import { filtroTexto, filtroSituacao } from "../utils/filtrosDeConsulta.js";
import { regexTermoSimples } from "../utils/texto.js";
import ProcessoCliente from "../models/ProcessoCliente.js";
import {
  normalizarClientesDoPayload,
  validateCreateProcess,
  validateFasePayload,
  validateProcessId,
  validateUpdateProcess
} from "../validations/processValidation.js";
import { FASE_PADRAO } from "../config/fasesProcesso.js";
import {
  findInactiveParentsOfProcess,
  findInactiveParentsForProcesses,
  erroDePaiInativo
} from "./activationHierarchy.js";
import {
  assertClientesDoUsuario,
  CAMPOS_CLIENTE_POPULADO,
  contarVinculosAtivosDoProcesso,
  contarVinculosDaCascata,
  desativarVinculosDoProcesso,
  ehColisaoDeCodigoAcesso,
  listarVinculosDeProcessos,
  montarVinculos,
  reativarVinculosDaCascata
} from "./processoClienteService.js";

const createError = (message, statusCode, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

// Campos que descrevem os participantes. Não são colunas de Process: são
// consumidos aqui e nunca chegam ao documento gravado.
const CAMPOS_DE_PARTICIPANTES = ["clientes", "clienteId", "clientePrincipalId"];

const ehTextoVazio = (v) => v === null || v === undefined || String(v).trim() === "";

const normalizePayload = (data) => {
  const payload = { ...data };

  for (const campo of CAMPOS_DE_PARTICIPANTES) delete payload[campo];

  if (payload.titulo !== undefined) payload.titulo = String(payload.titulo).trim();
  if (payload.numeroProcesso !== undefined) payload.numeroProcesso = String(payload.numeroProcesso).trim();
  if (payload.tipoAcao !== undefined) payload.tipoAcao = String(payload.tipoAcao).trim();
  if (payload.area !== undefined) payload.area = String(payload.area).trim();
  if (payload.orgao !== undefined) payload.orgao = String(payload.orgao).trim();
  if (payload.vara !== undefined) payload.vara = String(payload.vara).trim();
  if (payload.comarca !== undefined) payload.comarca = String(payload.comarca).trim();
  if (payload.status !== undefined) payload.status = String(payload.status).trim();
  if (payload.descricao !== undefined) payload.descricao = String(payload.descricao).trim();
  if (payload.observacoes !== undefined) payload.observacoes = String(payload.observacoes).trim();

  if (payload.numeroProcesso === "") payload.numeroProcesso = undefined;

  // ── DEC-054 — os campos de andamento ───────────────────────────────────
  //
  // Texto vazio vira `null`, e não `""`: apagar a observação da liminar e
  // nunca tê-la escrito são o mesmo estado, e guardar `""` faria a tela ter de
  // distinguir dois vazios. Convenção do projeto — campo apagado é `null`.
  if (payload.motivoEncerramento !== undefined) {
    payload.motivoEncerramento = ehTextoVazio(payload.motivoEncerramento)
      ? null
      : String(payload.motivoEncerramento).trim();
  }

  if (payload.liminarObservacao !== undefined) {
    payload.liminarObservacao = ehTextoVazio(payload.liminarObservacao)
      ? null
      : String(payload.liminarObservacao).trim();
  }

  // `null` explícito DESFAZ o carimbo — é assim que se corrige um trânsito em
  // julgado registrado por engano, e é por isso que ele não é confundido com
  // "campo ausente".
  for (const campo of ["transitoEmJulgadoEm", "liminarEm"]) {
    if (payload[campo] === undefined) continue;
    payload[campo] = ehTextoVazio(payload[campo]) ? null : new Date(payload[campo]);
  }

  if (
    payload.dataDistribuicao !== undefined &&
    payload.dataDistribuicao !== null &&
    payload.dataDistribuicao !== ""
  ) {
    payload.dataDistribuicao = new Date(payload.dataDistribuicao);
  }

  return payload;
};

const handleDuplicateKeyError = (error) => {
  if (error?.code === 11000 && error?.keyPattern?.numeroProcesso) {
    throw createError("Já existe um processo com este número para este usuário", 409, {
      campo: "numeroProcesso"
    });
  }

  throw error;
};

// Quantas vezes a transação inteira é repetida quando o índice único de
// `codigoAcesso` acusa colisão. A geração já consulta antes de gravar, então
// chegar aqui é raro; o retry existe para a janela de corrida entre a consulta
// e o insert, não para o caso comum.
const TENTATIVAS_TRANSACAO = 3;

// ═══════════════════════════════════════════════════════════════════════════
// CRIAÇÃO — processo e vínculos na mesma transação
//
// Processo e participantes são um fato só: um processo sem cliente não tem a
// quem atribuir a peça nem quem assine, e um vínculo sem processo é lixo que
// nenhuma listagem alcança. Gravar em duas etapas soltas deixaria a falha da
// segunda produzir exatamente um desses estados.
//
// Via escolhida: TRANSAÇÃO do MongoDB (`session.withTransaction`), não
// compensação por rollback manual. O banco é um replica set (Atlas), então
// transação multi-documento está disponível, e ela é a única opção que fecha
// a janela por completo: na compensação, o `deleteOne` do processo órfão pode
// falhar pelo mesmo motivo que derrubou o insert dos vínculos (queda de rede,
// failover), e aí não há mais a quem recorrer. A transação também esconde o
// estado intermediário de qualquer leitura concorrente — com compensação, uma
// listagem disparada no meio enxergaria o processo sem participante.
// ═══════════════════════════════════════════════════════════════════════════
export const createProcess = async (usuarioId, data) => {
  const errors = validateCreateProcess(data);

  if (errors.length > 0) {
    throw createError(errors.join(", "), 400);
  }

  const { clientes } = normalizarClientesDoPayload(data);

  // Fora da transação de propósito: é leitura de validação, e mantê-la aqui
  // encurta o tempo em que a transação fica aberta.
  await assertClientesDoUsuario(
    usuarioId,
    clientes.map((c) => c.clienteId)
  );

  const payload = normalizePayload(data);
  const principal = clientes.find((c) => c.principal);

  for (let tentativa = 1; tentativa <= TENTATIVAS_TRANSACAO; tentativa += 1) {
    const session = await mongoose.startSession();

    try {
      let criado = null;

      await session.withTransaction(async () => {
        // ── DEC-054: a linha do tempo começa no nascimento ─────────────────
        //
        // A primeira entrada tem `de: null` — não havia fase anterior. Sem ela
        // um processo criado direto em "execução" apareceria na linha do tempo
        // da F-2e como se sempre tivesse estado lá, e a advogada não teria como
        // distinguir "nasceu assim" de "nunca mudou".
        const faseInicial = payload.fase
          ? String(payload.fase).trim()
          : FASE_PADRAO;

        const [processo] = await Process.create(
          [
            {
              ...payload,
              fase: faseInicial,
              usuarioId,
              clientePrincipalId: new mongoose.Types.ObjectId(principal.clienteId),
              historicoFase: [
                { de: null, para: faseInicial, data: new Date(), motivo: null, autorId: usuarioId }
              ]
            }
          ],
          { session }
        );

        await montarVinculos(usuarioId, processo._id, clientes, session);

        criado = processo;
      });

      return getProcessById(usuarioId, criado._id);
    } catch (error) {
      if (ehColisaoDeCodigoAcesso(error) && tentativa < TENTATIVAS_TRANSACAO) {
        continue;
      }
      handleDuplicateKeyError(error);
    } finally {
      await session.endSession();
    }
  }

  throw createError("Não foi possível gerar um código de acesso único para os vínculos", 500);
};

// Anexa os participantes a processos já lidos. Uma consulta só para a página
// inteira — não uma por processo.
const anexarParticipantes = async (usuarioId, processos) => {
  if (processos.length === 0) return processos;

  const vinculos = await listarVinculosDeProcessos(
    usuarioId,
    processos.map((p) => p._id)
  );

  // `clienteId` populado, e não renomeado para `cliente`: é a convenção do
  // repositório (feeService popula `processoId` no lugar) e faz esta resposta
  // ter exatamente a mesma forma da de GET /api/processes/:id/clientes. Duas
  // formas para o mesmo objeto obrigariam o frontend a saber de qual endpoint
  // o participante veio.
  const porProcesso = new Map();
  for (const vinculo of vinculos) {
    const chave = String(vinculo.processoId);
    if (!porProcesso.has(chave)) porProcesso.set(chave, []);
    porProcesso.get(chave).push({
      _id: vinculo._id,
      clienteId: vinculo.clienteId,
      papel: vinculo.papel,
      principal: vinculo.principal
    });
  }

  for (const processo of processos) {
    processo.participantes = porProcesso.get(String(processo._id)) ?? [];
  }

  return processos;
};

// ── DEC-053 na listagem ───────────────────────────────────────────────────
//
// Cada processo DESATIVADO leva junto quem impede a reativação dele, se
// alguém impedir. A tela usa isso para desabilitar "Reativar" com o motivo ao
// lado, em vez de oferecer uma ação que o backend recusaria.
//
// `impedimentosDeReativacao` só existe na linha desativada — num processo
// ativo a chave não aparece, porque a pergunta não se aplica. Mandar `[]` em
// toda linha ativa seria mandar um vetor vazio por página inteira para dizer
// "não pergunte".
//
// **A tela é conveniência; a autoridade é do serviço.** `reactivateProcess`
// recusa de qualquer forma — inclusive para quem chamar a rota direto, sem
// passar por tela nenhuma. Esta função existe para a advogada não descobrir a
// recusa depois de clicar, não para ser o lugar onde a regra mora.
const anexarImpedimentosDeReativacao = async (usuarioId, processos) => {
  if (processos.length === 0) return processos;

  const porProcesso = await findInactiveParentsForProcesses(usuarioId, processos);
  if (porProcesso.size === 0) return processos;

  for (const processo of processos) {
    const bloqueadores = porProcesso.get(String(processo._id));
    if (bloqueadores) processo.impedimentosDeReativacao = bloqueadores;
  }

  return processos;
};

// ── DEC-054 — o filtro de liminar ─────────────────────────────────────────
//
// Três estados, e o padrão é NÃO filtrar. `com` e `sem` são os únicos valores
// que recortam; qualquer outra coisa (inclusive `todos`, vazio e ausente) devolve
// a listagem inteira.
//
// Valor desconhecido é IGNORADO em silêncio, e não recusado: o filtro é
// conveniência de leitura, e um 400 numa query string mal digitada tiraria a
// listagem inteira da advogada por causa de um parâmetro que ela não digitou.
// É a mesma escolha que `filtroSituacao` faz — e diferente de `processoId`, que
// RECUSA, porque lá o filtro ignorado devolveria dados de outro processo.
const filtroLiminar = (liminar) => {
  if (liminar === "com") return { liminar: true };
  if (liminar === "sem") return { liminar: { $ne: true } };
  return {};
};

export const listProcesses = async (
  usuarioId,
  { page = 1, limit = 20, busca, status, situacao, fase, liminar } = {}
) => {
  const skip = (page - 1) * limit;
  // DEC-052: `ativo: true` deixou de ser fixo, para a reativação ter onde
  // acontecer. Sem `situacao`, o filtro é exatamente o de antes.
  //
  // Não confundir com `status`, logo abaixo: `status` é o andamento jurídico
  // ("ativo", "encerrado", "suspenso") e `situacao` é se o REGISTRO existe para
  // o sistema. Um processo `status: "encerrado"` está vivo no cadastro; um
  // desativado não aparece em lugar nenhum — e é por isso que ele precisa deste
  // filtro para voltar a ser alcançável.
  const filter = { usuarioId, ...filtroSituacao(situacao), ...filtroLiminar(liminar) };
  // `escapeRegex` era uma cópia local; unificada em `utils/texto.js` na F-0.
  const regex = regexTermoSimples(busca);
  if (regex) {
    filter.$or = [{ titulo: regex }, { numeroProcesso: regex }];
  }
  const statusFiltro = filtroTexto(status);
  if (statusFiltro) filter.status = statusFiltro;
  // DEC-054: recorte por fase, no mesmo padrão do `status`. Independentes de
  // propósito — são eixos diferentes, e combiná-los ("em execução E suspenso")
  // é pergunta legítima.
  const faseFiltro = filtroTexto(fase);
  if (faseFiltro) filter.fase = faseFiltro;
  const [data, total] = await Promise.all([
    // `lean` para que `participantes` possa ser anexado ao objeto devolvido —
    // um documento Mongoose ignoraria a propriedade por não estar no schema.
    // `-__v` na projeção porque `lean()` não passa por `toJSON`, que é onde a
    // chave sai em todo o resto da API (config/mongooseDefaults.js).
    Process.find(filter)
      // `-historicoAtivacao`: o histórico da DEC-052 é append-only e cresce a
      // cada desativação. Ele não é lido na listagem, e mandá-lo em toda linha
      // de toda página é peso por nada. Continua disponível no detalhe.
      // `-historicoFase` sai junto com `-historicoAtivacao`, pela mesma razão:
      // é append-only, cresce a cada mudança de fase, não é lido na listagem e
      // continua disponível no detalhe.
      .select("-__v -historicoAtivacao -historicoFase")
      // ── DEC-054: a lista NÃO se reordena por liminar ───────────────────
      //
      // A ordenação é a de sempre — mais recente primeiro. Ela pediu
      // DESTAQUE ("liminar é um plus"), não PRIORIDADE, e são coisas
      // diferentes: reordenar muda o que a advogada espera encontrar onde ela
      // deixou, e transforma um selo visual numa mudança de mapa mental.
      //
      // Quem quiser ver só as liminares usa o filtro `?liminar=com`, e decide
      // QUANDO.
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("clientePrincipalId", CAMPOS_CLIENTE_POPULADO)
      .lean(),
    Process.countDocuments(filter)
  ]);

  await anexarParticipantes(usuarioId, data);
  await anexarImpedimentosDeReativacao(usuarioId, data);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const getProcessById = async (usuarioId, processId) => {
  const errors = validateProcessId(processId);

  if (errors.length > 0) {
    throw createError(errors.join(", "), 400);
  }

  // `-__v` na projeção porque `lean()` não passa por `toJSON`, que é onde a
  // chave sai em todo o resto da API (config/mongooseDefaults.js).
  const process = await Process.findOne({
    _id: processId,
    usuarioId,
    ativo: true
  })
    .select("-__v")
    .populate("clientePrincipalId", CAMPOS_CLIENTE_POPULADO)
    .lean();

  if (!process) {
    throw createError("Processo não encontrado", 404);
  }

  // `listarVinculosDeProcessos` projeta `-codigoAcesso`: o código não sai no
  // detalhe do processo, só em GET .../clientes/:clienteId/codigo-acesso.
  await anexarParticipantes(usuarioId, [process]);

  return process;
};

export const updateProcess = async (usuarioId, processId, data) => {
  // Allowlist da Fase 4.5. Aqui o contorno era o PIOR dos seis: o
  // `normalizePayload` faz `{ ...data }`, então `ativo: false` chegava ao
  // `findOneAndUpdate`, a escrita acontecia, e a releitura por
  // `getProcessById` (que filtra `ativo: true`) devolvia 404. A rota
  // respondia "Processo nao encontrado" DEPOIS de desativar o processo.
  const recusado = checarUpdate("processes", data);
  if (recusado) {
    throw createError(recusado.mensagem, 400, recusado.campo ? { campo: recusado.campo } : {});
  }
  const idErrors = validateProcessId(processId);
  const bodyErrors = validateUpdateProcess(data);
  const errors = [...idErrors, ...bodyErrors];

  if (errors.length > 0) {
    throw createError(errors.join(", "), 400);
  }

  const existingProcess = await Process.findOne({
    _id: processId,
    usuarioId,
    ativo: true
  });

  if (!existingProcess) {
    throw createError("Processo não encontrado", 404);
  }

  // Trocar o principal por aqui deixaria `clientePrincipalId` apontando para
  // um cliente que a junção não marcou como principal — ou que nem participa
  // do processo. Quem promove é PATCH .../clientes/:clienteId/principal, que
  // move os dois lados na mesma transação. Reenviar o valor atual é aceito
  // para o formulário poder devolver o objeto inteiro sem tratamento especial.
  const novoPrincipal = data.clientePrincipalId ?? data.clienteId;

  if (
    novoPrincipal !== undefined &&
    novoPrincipal !== null &&
    novoPrincipal !== "" &&
    String(novoPrincipal) !== String(existingProcess.clientePrincipalId)
  ) {
    throw createError(
      "O cliente principal não é alterado por esta rota. Use PATCH /api/processes/:id/clientes/:clienteId/principal",
      400
    );
  }

  const payload = normalizePayload(data);

  try {
    await Process.findOneAndUpdate(
      { _id: processId, usuarioId, ativo: true },
      payload,
      {
        new: true,
        runValidators: true
      }
    );
  } catch (error) {
    handleDuplicateKeyError(error);
  }

  return getProcessById(usuarioId, processId);
};

// ═══════════════════════════════════════════════════════════════════════════
// DEC-054 — MUDAR DE FASE
//
// ── O que esta função NÃO faz, e é o ponto inteiro ────────────────────────
// **Não compara a fase nova com a atual.** Não há máquina de estados, não há
// ordem, não há transição proibida. *"Sim, pode voltar."* — recursos volta
// para conhecimento, execução volta para sentença, e nenhuma dessas passagens
// encontra um `if` no caminho.
//
// Procure por uma comparação de ordem neste arquivo: não há nenhuma. A
// ausência é a implementação da regra, e a mutação (a) desta fase — travar
// recursos → conhecimento — existe para provar que o teste cai quando alguém
// inventar uma.
//
// **Não exige motivo.** *"Não precisa anotar o porquê, só se ela quiser
// mesmo."* Motivo ausente grava `null` e a transição acontece igual.
//
// **Não mexe no encerramento.** Um processo transitado em julgado pode mudar
// de fase (a advogada errou o registro e está corrigindo), e um processo em
// qualquer fase pode transitar. Os dois eixos não se consultam.
//
// ── O que ela FAZ, e por que ─────────────────────────────────────────────
// Grava a transição no `historicoFase`, com `de → para`, data e autor. É o
// substrato da linha do tempo que a Laís pediu, e não é o "porquê" que ela
// dispensou: o motivo é a justificativa, a transição é o fato.
//
// **Mudar para a MESMA fase também grava.** Pode parecer ruído, mas não é: a
// advogada só faz isso ao reafirmar a fase junto de um motivo ("conferi, segue
// em execução"), e descartar a entrada apagaria justamente a anotação que ela
// se deu ao trabalho de escrever.
// ═══════════════════════════════════════════════════════════════════════════
export const mudarFase = async (usuarioId, processId, data) => {
  const idErrors = validateProcessId(processId);
  const bodyErrors = validateFasePayload(data ?? {});
  const errors = [...idErrors, ...bodyErrors];

  if (errors.length > 0) {
    throw createError(errors.join(", "), 400);
  }

  const processo = await Process.findOne({ _id: processId, usuarioId, ativo: true });

  if (!processo) {
    throw createError("Processo não encontrado", 404);
  }

  const para = String(data.fase).trim();
  const de = processo.fase ?? null;
  const motivo = ehTextoVazio(data.motivo) ? null : String(data.motivo).trim();

  // `$push` e `$set` no MESMO update: o histórico gravado fora da escrita da
  // fase poderia registrar uma transição que não aconteceu — a mesma razão
  // pela qual a DEC-052 põe os dois dentro da transação.
  await Process.updateOne(
    { _id: processId, usuarioId, ativo: true },
    {
      $set: { fase: para },
      $push: {
        historicoFase: { de, para, data: new Date(), motivo, autorId: usuarioId }
      }
    },
    { runValidators: true }
  );

  return getProcessById(usuarioId, processId);
};

// Soft delete em cascata: o processo sai e os vínculos saem junto. Vínculo
// ativo apontando para processo inativo faria o cliente parecer ocupado —
// e o DELETE /api/clients/:id recusaria a exclusão por um processo que já
// não existe.
export const deleteProcess = async (usuarioId, processId) => {
  const errors = validateProcessId(processId);

  if (errors.length > 0) {
    throw createError(errors.join(", "), 400);
  }

  const process = await Process.findOne({
    _id: processId,
    usuarioId,
    ativo: true
  });

  if (!process) {
    throw createError("Processo não encontrado", 404);
  }

  // Quantos vão cair junto. Lido ANTES da transação porque é o número que vai
  // para o histórico — depois da cascata ele já é zero.
  const vinculosAfetados = await contarVinculosAtivosDoProcesso(usuarioId, processId);

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Process.updateOne(
        { _id: processId, usuarioId, ativo: true },
        {
          $set: { ativo: false },
          // Append-only (DEC-052). Dentro da MESMA transação: histórico gravado
          // fora dela poderia registrar uma desativação que não aconteceu.
          $push: {
            historicoAtivacao: {
              acao: "desativacao",
              data: new Date(),
              vinculosAfetados
            }
          }
        },
        { session }
      );

      await desativarVinculosDoProcesso(usuarioId, processId, session);
    });
  } finally {
    await session.endSession();
  }

  process.ativo = false;
  return process;
};

// ── DEC-052: a volta ──────────────────────────────────────────────────────
//
// Restaura o processo e SÓ os vínculos que a cascata dele derrubou. Participante
// removido à mão continua fora — é o ponto inteiro da decisão, e o motivo de a
// Parte 4 da F-2a ter parado.
//
// **Não cascateia para o cliente**, e isso é regra, não omissão: reativar um
// processo não reativa o cliente dele, do mesmo jeito que reativar um cliente
// não reativa os processos. Cada registro se reativa por si — a tela diz isso,
// senão a advogada reativa um e presume que voltou tudo.
export const reactivateProcess = async (usuarioId, processId) => {
  const errors = validateProcessId(processId);

  if (errors.length > 0) {
    throw createError(errors.join(", "), 400);
  }

  // `ativo: false` no filtro: reativar o que já está ativo não é operação
  // idempotente inofensiva — é sinal de que a tela ofereceu uma ação que não
  // existia, e responder 200 esconderia isso. O 404 é o mesmo que o
  // `deleteProcess` dá para processo já desativado.
  const process = await Process.findOne({
    _id: processId,
    usuarioId,
    ativo: false
  });

  if (!process) {
    throw createError("Processo não encontrado ou já está ativo", 404);
  }

  // ── DEC-053: o filho não sobe sem o pai ─────────────────────────────────
  //
  // ANTES da checagem e FORA da transação, de propósito: é leitura de
  // validação, e abrir uma transação para desfazê-la em seguida deixaria a
  // sessão aberta pelo tempo de duas consultas que não escrevem nada. Mesma
  // escolha que `createProcess` faz com `assertClientesDoUsuario`.
  //
  // A recusa nomeia o cliente. Ver `activationHierarchy.js` para por que a
  // mensagem genérica é o defeito, e não uma variação aceitável.
  const paisInativos = await findInactiveParentsOfProcess(usuarioId, process);
  if (paisInativos.length > 0) {
    throw erroDePaiInativo(paisInativos, "reativar");
  }

  const vinculosAfetados = await contarVinculosDaCascata(usuarioId, processId);

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Process.updateOne(
        { _id: processId, usuarioId, ativo: false },
        {
          $set: { ativo: true },
          $push: {
            historicoAtivacao: {
              acao: "reativacao",
              data: new Date(),
              vinculosAfetados
            }
          }
        },
        { session }
      );

      await reativarVinculosDaCascata(usuarioId, processId, session);
    });
  } finally {
    await session.endSession();
  }

  return getProcessById(usuarioId, processId);
};

// O que a tela precisa saber ANTES de confirmar qualquer uma das duas ações.
// Um número só, e o verbo que ele acompanha depende do estado do processo.
export const previewDeAtivacao = async (usuarioId, processId) => {
  const errors = validateProcessId(processId);
  if (errors.length > 0) throw createError(errors.join(", "), 400);

  // `clientePrincipalId` entra na projeção por causa da DEC-053: o preview
  // precisa responder também "isso pode ser reativado?", e o principal é um
  // dos candidatos a pai inativo.
  const process = await Process.findOne({ _id: processId, usuarioId }).select(
    "ativo clientePrincipalId"
  );
  if (!process) throw createError("Processo não encontrado", 404);

  if (process.ativo) {
    return {
      ativo: true,
      vinculosAfetados: await contarVinculosAtivosDoProcesso(usuarioId, processId)
    };
  }

  // ── DEC-053 no preview ──────────────────────────────────────────────────
  //
  // O modal da reativação já consultava este endpoint para saber quantos
  // vínculos voltam. Agora ele também descobre aqui se a reativação é
  // possível — e é isto que impede a tela de abrir um modal cujo botão
  // "Reativar" levaria a um 409.
  //
  // Fica no MESMO endpoint em vez de num novo: as duas perguntas são feitas no
  // mesmo instante, pelo mesmo motivo, e um segundo endpoint significaria duas
  // idas ao servidor para montar um modal só.
  const impedimentos = await findInactiveParentsOfProcess(usuarioId, process);

  return {
    ativo: false,
    vinculosAfetados: await contarVinculosDaCascata(usuarioId, processId),
    // Sempre presente no ramo do desativado, mesmo vazio: aqui a tela PERGUNTOU
    // se pode reativar, e um vetor vazio é a resposta "pode". Omitir a chave
    // obrigaria o frontend a distinguir "não perguntei" de "perguntei e não há".
    impedimentosDeReativacao: impedimentos.map((p) => ({
      tipo: p.tipo,
      id: String(p.id),
      nome: p.nome
    }))
  };
};

export default {
  createProcess,
  listProcesses,
  getProcessById,
  updateProcess,
  mudarFase,
  deleteProcess,
  reactivateProcess,
  previewDeAtivacao
};
