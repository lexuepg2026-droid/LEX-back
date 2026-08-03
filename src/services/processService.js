import mongoose from "mongoose";
import Process from "../models/Process.js";
import { checarUpdate } from "../validations/shared/camposPermitidos.js";
import ProcessoCliente from "../models/ProcessoCliente.js";
import {
  normalizarClientesDoPayload,
  validateCreateProcess,
  validateProcessId,
  validateUpdateProcess
} from "../validations/processValidation.js";
import {
  assertClientesDoUsuario,
  CAMPOS_CLIENTE_POPULADO,
  desativarVinculosDoProcesso,
  ehColisaoDeCodigoAcesso,
  listarVinculosDeProcessos,
  montarVinculos
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
        const [processo] = await Process.create(
          [
            {
              ...payload,
              usuarioId,
              clientePrincipalId: new mongoose.Types.ObjectId(principal.clienteId)
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

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

export const listProcesses = async (usuarioId, { page = 1, limit = 20, busca, status } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true };
  if (busca && typeof busca === 'string') {
    const termo = busca.slice(0, 80).trim();
    if (termo) {
      const regex = new RegExp(escapeRegex(termo), 'i');
      filter.$or = [{ titulo: regex }, { numeroProcesso: regex }];
    }
  }
  if (status && typeof status === 'string') filter.status = status;
  const [data, total] = await Promise.all([
    // `lean` para que `participantes` possa ser anexado ao objeto devolvido —
    // um documento Mongoose ignoraria a propriedade por não estar no schema.
    // `-__v` na projeção porque `lean()` não passa por `toJSON`, que é onde a
    // chave sai em todo o resto da API (config/mongooseDefaults.js).
    Process.find(filter)
      .select("-__v")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("clientePrincipalId", CAMPOS_CLIENTE_POPULADO)
      .lean(),
    Process.countDocuments(filter)
  ]);

  await anexarParticipantes(usuarioId, data);

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

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Process.updateOne(
        { _id: processId, usuarioId, ativo: true },
        { $set: { ativo: false } },
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

export default {
  createProcess,
  listProcesses,
  getProcessById,
  updateProcess,
  deleteProcess
};
