import mongoose from "mongoose";
import Client from "../models/Client.js";
import { erroDePaiInativo, nomeDoCliente } from "./activationHierarchy.js";
import Process from "../models/Process.js";
import ProcessoCliente from "../models/ProcessoCliente.js";
import { gerarCodigoAcessoUnico } from "../utils/accessCode.js";
import { estadoDoParticipante } from "../config/portalEstados.js";
import {
  validateClienteId,
  validateProcessId,
  validateVinculoPayload
} from "../validations/processValidation.js";

const erro = (message, statusCode, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

// Campos do cliente que a interface precisa para identificar o participante.
// Deliberadamente mínimo: quem quiser o cadastro completo chama /api/clients.
export const CAMPOS_CLIENTE_POPULADO = "nomeCompleto razaoSocial tipoPessoa cpf cnpj";

// `codigoAcesso` sai de TODA leitura ampla. Ele só é devolvido pelo endpoint
// dedicado — assim não vaza em log de resposta, em print de tela nem em
// listagem que alguém copia inteira para um chamado de suporte.
export const PROJECAO_SEM_CODIGO = "-codigoAcesso";

export const TENTATIVAS_CODIGO = 5;

// Colisão do índice único de `codigoAcesso`. Distinta das outras 11000
// (participante repetido, número de processo repetido) porque só esta pede
// nova tentativa em vez de erro para o usuário.
export const ehColisaoDeCodigoAcesso = (error) =>
  error?.code === 11000 && Boolean(error?.keyPattern?.codigoAcesso);

export const ehParticipanteDuplicado = (error) =>
  error?.code === 11000 &&
  Boolean(error?.keyPattern?.processoId) &&
  Boolean(error?.keyPattern?.clienteId);

export const gerarCodigoParaVinculo = (session) =>
  gerarCodigoAcessoUnico(
    async (candidato) =>
      Boolean(
        await ProcessoCliente.exists({ codigoAcesso: candidato }).session(session ?? null)
      ),
    TENTATIVAS_CODIGO
  );

const assertProcessoDoUsuario = async (usuarioId, processoId, session) => {
  const erros = validateProcessId(processoId);
  if (erros.length > 0) throw erro(erros.join(", "), 400);

  const processo = await Process.findOne({
    _id: processoId,
    usuarioId,
    ativo: true
  }).session(session ?? null);

  if (!processo) throw erro("Processo não encontrado", 404);

  return processo;
};

// Cliente de outro usuário devolve 404, não 403: confirmar que o id existe
// mas pertence a terceiro já entrega a existência do cadastro alheio. Para
// este usuário o cliente simplesmente não existe.
export const assertClientesDoUsuario = async (usuarioId, clienteIds, session, acao = "criar o processo") => {
  const ids = clienteIds.map((id) => new mongoose.Types.ObjectId(id));

  // ── DEC-053, boca 2 ─────────────────────────────────────────────────────
  //
  // A consulta perdeu o `ativo: true` e ganhou o campo `ativo` na projeção —
  // não para AFROUXAR a regra, mas para poder distinguir os dois motivos de
  // recusa. Antes, cliente inexistente e cliente desativado saíam pela mesma
  // frase ("Cliente não encontrado"), e a segunda é falsa: o cliente existe, a
  // advogada acabou de vê-lo na listagem com a tag "Desativado".
  //
  // As duas continuam sendo RECUSA. O que muda é que uma delas passa a dizer o
  // que fazer.
  const encontrados = await Client.find({
    _id: { $in: ids },
    usuarioId
  })
    .select("_id ativo nomeCompleto razaoSocial nomeFantasia")
    .session(session ?? null);

  const achados = new Set(encontrados.map((c) => String(c._id)));
  const faltando = clienteIds.filter((id) => !achados.has(String(id)));

  // Inexistente primeiro: um id que não existe não tem nome para nomear, e
  // tentar descrevê-lo confirmaria a existência de registro de outro usuário.
  if (faltando.length > 0) {
    throw erro(
      `Cliente não encontrado para este usuário: ${faltando.join(", ")}`,
      400,
      { errors: { clientesInvalidos: faltando } }
    );
  }

  const inativos = encontrados.filter((c) => !c.ativo);
  if (inativos.length > 0) {
    throw erroDePaiInativo(
      inativos.map((c) => ({ tipo: "Client", id: c._id, nome: nomeDoCliente(c) })),
      acao
    );
  }

  return encontrados;
};

// ── Escrita usada pela criação do processo (dentro da transação) ────────────

export const montarVinculos = async (usuarioId, processoId, clientes, session) => {
  const documentos = [];

  for (const cliente of clientes) {
    documentos.push({
      usuarioId,
      processoId,
      clienteId: new mongoose.Types.ObjectId(cliente.clienteId),
      papel: cliente.papel,
      principal: cliente.principal === true,
      codigoAcesso: await gerarCodigoParaVinculo(session),
      ativo: true
    });
  }

  return ProcessoCliente.create(documentos, { session, ordered: true });
};

// ── Cascata e integridade referencial ──────────────────────────────────────

// ── DEC-052: a cascata marca o que derrubou ───────────────────────────────
//
// Antes da F-2b esta função gravava só `ativo: false` — o MESMO que
// `desvincularCliente` grava numa remoção manual —, e os dois estados ficavam
// indistinguíveis. Ver a nota longa em `models/ProcessoCliente.js`.
//
// Só toca em vínculo ATIVO. O que já estava fora (removido à mão antes desta
// desativação) não é marcado, e por isso não volta na reativação — que é
// exatamente o comportamento que se quer.
export const desativarVinculosDoProcesso = (usuarioId, processoId, session) =>
  ProcessoCliente.updateMany(
    { usuarioId, processoId, ativo: true },
    { $set: { ativo: false, desativadoPorCascataDe: processoId } },
    { session: session ?? null }
  );

// A volta: restaura SÓ os que esta cascata derrubou, e limpa a marca.
//
// O filtro exige `desativadoPorCascataDe: processoId` — não basta `ativo:
// false`. Um vínculo removido à mão tem a marca `null` e **continua fora**, que
// é o ponto inteiro da DEC-052.
//
// A marca é limpa na mesma escrita. Vínculo restaurado volta a ser vínculo
// comum: se ficasse marcado, uma remoção manual posterior dele carregaria marca
// de cascata velha e ele ressuscitaria sozinho na reativação seguinte.
export const reativarVinculosDaCascata = (usuarioId, processoId, session) =>
  ProcessoCliente.updateMany(
    { usuarioId, processoId, ativo: false, desativadoPorCascataDe: processoId },
    { $set: { ativo: true, desativadoPorCascataDe: null } },
    { session: session ?? null }
  );

// Quantos vínculos ATIVOS o processo tem — o número que a tela mostra antes de
// confirmar a desativação. A advogada precisa saber o tamanho do efeito antes
// de causá-lo; é a regra do modal de estorno (passo 161).
export const contarVinculosAtivosDoProcesso = (usuarioId, processoId) =>
  ProcessoCliente.countDocuments({ usuarioId, processoId, ativo: true });

// Quantos voltariam numa reativação — os marcados por esta cascata. É o número
// que a tela mostra antes de confirmar a reativação, e ele é MENOR que o total
// de desativados sempre que houve remoção manual.
export const contarVinculosDaCascata = (usuarioId, processoId) =>
  ProcessoCliente.countDocuments({
    usuarioId,
    processoId,
    ativo: false,
    desativadoPorCascataDe: processoId
  });

export const contarProcessosDoCliente = (usuarioId, clienteId) =>
  ProcessoCliente.countDocuments({ usuarioId, clienteId, ativo: true });

// Vínculo ativo do par cliente/processo. É o ponto único que a geração de
// documento consulta para saber se um cliente pode assinar por um processo.
export const buscarVinculoAtivo = (usuarioId, processoId, clienteId, session) =>
  ProcessoCliente.findOne({
    usuarioId,
    processoId,
    clienteId,
    ativo: true
  }).session(session ?? null);

// ── Leitura ────────────────────────────────────────────────────────────────

// Principal primeiro: é o participante que a interface destaca e o que resolve
// as variáveis do documento quando ninguém é informado.
export const listarVinculosDeProcessos = (usuarioId, processoIds) =>
  ProcessoCliente.find({
    usuarioId,
    processoId: { $in: processoIds },
    ativo: true
  })
    .select(PROJECAO_SEM_CODIGO)
    .populate("clienteId", CAMPOS_CLIENTE_POPULADO)
    .sort({ principal: -1, createdAt: 1 });

export const listarParticipantes = async (usuarioId, processoId) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const vinculos = await ProcessoCliente.find({ usuarioId, processoId, ativo: true })
    .select(PROJECAO_SEM_CODIGO)
    .populate("clienteId", CAMPOS_CLIENTE_POPULADO)
    .sort({ principal: -1, createdAt: 1 });

  // Estado do portal, pronto, para a interface da Fase 3.2 não derivá-lo.
  // `codigoAcesso` CONTINUA fora — `PROJECAO_SEM_CODIGO` acima —, e a Fase 3.1
  // não abriu exceção: ele segue saindo só na rota dedicada.
  //
  // Sai de `ultimaConfirmacaoEm` e `primeiroAcessoPortal`, ambos desnormalizados
  // no próprio vínculo: a listagem não faz consulta por participante, e portanto
  // não tem N+1.
  const data = vinculos.map((vinculo) => ({
    ...vinculo.toJSON(),
    estadoPortal: estadoDoParticipante(vinculo)
  }));

  // Mesmo envelope de toda listagem. O conjunto é limitado aos participantes de
  // um processo e não pagina: uma página só, `limit` igual ao tamanho — a mesma
  // forma que `listarInstallments` e `listarPayments` já usam quando filtram
  // por processo.
  return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
};

export const obterCodigoAcesso = async (usuarioId, processoId, clienteId) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const erros = validateClienteId(clienteId);
  if (erros.length > 0) throw erro(erros.join(", "), 400);

  const vinculo = await ProcessoCliente.findOne({
    usuarioId,
    processoId,
    clienteId,
    ativo: true
  })
    .select("codigoAcesso clienteId processoId papel principal")
    .populate("clienteId", CAMPOS_CLIENTE_POPULADO);

  if (!vinculo) throw erro("Cliente não vinculado a este processo", 404);

  return {
    processoId: vinculo.processoId,
    cliente: vinculo.clienteId,
    papel: vinculo.papel,
    principal: vinculo.principal,
    codigoAcesso: vinculo.codigoAcesso
  };
};

// ── Escrita avulsa ─────────────────────────────────────────────────────────

export const vincularCliente = async (usuarioId, processoId, data) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const erros = validateVinculoPayload(data);
  if (erros.length > 0) throw erro(erros.join(", "), 400);

  // DEC-053: vincular cliente desativado criaria vínculo ATIVO sob pai inativo.
  await assertClientesDoUsuario(usuarioId, [data.clienteId], undefined, "vincular o cliente");

  const papel = data.papel === undefined ? "autor" : String(data.papel).trim();

  for (let tentativa = 1; tentativa <= TENTATIVAS_CODIGO; tentativa += 1) {
    try {
      // Nunca `principal: true` por esta via: promover é operação própria,
      // que também rebaixa o anterior e atualiza o processo. Deixar a criação
      // marcar principal abriria a porta para dois principais.
      return await ProcessoCliente.create({
        usuarioId,
        processoId,
        clienteId: data.clienteId,
        papel,
        principal: false,
        codigoAcesso: await gerarCodigoParaVinculo(),
        ativo: true
      });
    } catch (error) {
      if (ehParticipanteDuplicado(error)) {
        throw erro("Cliente já vinculado a este processo", 409);
      }
      if (ehColisaoDeCodigoAcesso(error) && tentativa < TENTATIVAS_CODIGO) {
        continue;
      }
      throw error;
    }
  }

  throw erro("Não foi possível gerar um código de acesso único para o vínculo", 500);
};

export const alterarPapel = async (usuarioId, processoId, clienteId, data) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const errosId = validateClienteId(clienteId);
  if (errosId.length > 0) throw erro(errosId.join(", "), 400);

  const erros = validateVinculoPayload(data, { exigirClienteId: false });
  if (erros.length > 0) throw erro(erros.join(", "), 400);

  const vinculo = await ProcessoCliente.findOneAndUpdate(
    { usuarioId, processoId, clienteId, ativo: true },
    { $set: { papel: String(data.papel).trim() } },
    { new: true, runValidators: true }
  )
    .select(PROJECAO_SEM_CODIGO)
    .populate("clienteId", CAMPOS_CLIENTE_POPULADO);

  if (!vinculo) throw erro("Cliente não vinculado a este processo", 404);

  return vinculo;
};

// Promoção é uma operação só: rebaixar o principal atual, promover o novo e
// alinhar `clientePrincipalId`. Fora de transação, uma falha entre os passos
// deixaria o processo com zero ou dois principais — estado que a resolução de
// variáveis do documento não sabe interpretar.
export const promoverAPrincipal = async (usuarioId, processoId, clienteId) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const erros = validateClienteId(clienteId);
  if (erros.length > 0) throw erro(erros.join(", "), 400);

  const session = await mongoose.startSession();

  try {
    let promovido = null;

    await session.withTransaction(async () => {
      const alvo = await ProcessoCliente.findOne({
        usuarioId,
        processoId,
        clienteId,
        ativo: true
      }).session(session);

      if (!alvo) throw erro("Cliente não vinculado a este processo", 404);

      await ProcessoCliente.updateMany(
        { usuarioId, processoId, ativo: true, principal: true, _id: { $ne: alvo._id } },
        { $set: { principal: false } },
        { session }
      );

      alvo.principal = true;
      await alvo.save({ session });

      await Process.updateOne(
        { _id: processoId, usuarioId, ativo: true },
        { $set: { clientePrincipalId: alvo.clienteId } },
        { session }
      );

      promovido = alvo;
    });

    return ProcessoCliente.findById(promovido._id)
      .select(PROJECAO_SEM_CODIGO)
      .populate("clienteId", CAMPOS_CLIENTE_POPULADO);
  } finally {
    await session.endSession();
  }
};

export const desvincularCliente = async (usuarioId, processoId, clienteId) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const erros = validateClienteId(clienteId);
  if (erros.length > 0) throw erro(erros.join(", "), 400);

  const vinculo = await ProcessoCliente.findOne({
    usuarioId,
    processoId,
    clienteId,
    ativo: true
  });

  if (!vinculo) throw erro("Cliente não vinculado a este processo", 404);

  const ativos = await ProcessoCliente.countDocuments({ usuarioId, processoId, ativo: true });

  // Processo sem cliente não faz sentido: não há a quem atribuir a peça nem
  // quem assina. A saída é excluir o processo, não esvaziá-lo.
  if (ativos <= 1) {
    throw erro(
      "Não é possível remover o único participante do processo. Vincule outro cliente ou exclua o processo.",
      409
    );
  }

  // Remover o principal deixaria o processo sem principal e
  // `clientePrincipalId` apontando para quem saiu. Quem decide o substituto é
  // o usuário, não o sistema por ordem de cadastro.
  if (vinculo.principal) {
    throw erro(
      "Não é possível remover o participante principal. Promova outro participante a principal antes.",
      409
    );
  }

  vinculo.ativo = false;
  // DEC-052: remoção MANUAL não leva marca de cascata — é o que faz este
  // vínculo NÃO voltar quando o processo for reativado.
  //
  // Escrito explicitamente, e não deixado por conta do default: o vínculo aqui
  // está ativo, então a marca já deveria ser `null` (a reativação limpa). Este
  // `null` é a rede — se algum caminho futuro esquecer de limpar, a remoção
  // manual continua significando "removido à mão", que é a invariante que a
  // DEC-052 sustenta.
  vinculo.desativadoPorCascataDe = null;
  await vinculo.save();

  return vinculo;
};

export default {
  listarParticipantes,
  listarVinculosDeProcessos,
  obterCodigoAcesso,
  vincularCliente,
  alterarPapel,
  promoverAPrincipal,
  desvincularCliente,
  desativarVinculosDoProcesso,
  reativarVinculosDaCascata,
  contarVinculosAtivosDoProcesso,
  contarVinculosDaCascata,
  contarProcessosDoCliente,
  buscarVinculoAtivo,
  montarVinculos,
  assertClientesDoUsuario
};
