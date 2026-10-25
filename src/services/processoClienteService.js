import mongoose from "mongoose";
import Client from "../models/Client.js";
import { erroDePaiInativo, nomeDoCliente } from "./activationHierarchy.js";
import Process from "../models/Process.js";
import ProcessoCliente from "../models/ProcessoCliente.js";
import { gerarCodigoAcessoUnico } from "../utils/accessCode.js";
import { codigoEmUso } from "./codigoPessoal.js";
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

// Fase 2.5 (DEC-090): o código de vínculo não autentica mais, mas continua
// sendo gerado e reservado — e não pode coincidir com nenhum código PESSOAL.
// `codigoEmUso` consulta os dois espaços; ver `services/codigoPessoal.js`.
export const gerarCodigoParaVinculo = (session) =>
  gerarCodigoAcessoUnico(
    (candidato) => codigoEmUso(candidato, session ?? null),
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

// ── F-2d: os processos que BLOQUEIAM a desativação do cliente, nomeados ────
//
// A contagem acima já existia e continua sendo a autoridade do 409. O que esta
// função acrescenta é QUAIS são — e é a diferença entre "desvincule-o dos
// processos antes" e "desvincule-o de *Execução Fiscal – IPTU*".
//
// O relato que a motivou (passo 201, 24/08/2026): *"tive que desativar todos os
// processos que o cliente estava vinculado, mesmo o que ele não é o principal,
// para poder desativar"*. A guarda estava certa (ver a nota longa em
// `clientService.deleteClient`); o que faltava era a advogada saber ONDE ir, e
// que o caminho é DESVINCULAR — não desativar o processo de um terceiro.
//
// `papel` e `principal` entram porque é exatamente aí que mora a surpresa: um
// litisconsorte no processo de outra pessoa bloqueia igual, e a linha que diz
// "litisconsorte" explica por que aquele processo está na lista.
export const listarProcessosQueBloqueiam = async (usuarioId, clienteId) => {
  const vinculos = await ProcessoCliente.find({ usuarioId, clienteId, ativo: true })
    .select("processoId papel principal")
    .populate("processoId", "titulo numeroProcesso")
    .sort({ principal: -1, createdAt: 1 });

  return vinculos.map((v) => ({
    id: String(v.processoId?._id ?? v.processoId),
    titulo: v.processoId?.titulo?.trim() || v.processoId?.numeroProcesso?.trim() || "(sem título)",
    numeroProcesso: v.processoId?.numeroProcesso ?? null,
    papel: v.papel,
    principal: v.principal === true
  }));
};

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
  // Fase 2.5: quem TEM portal (senha definida) ganha o controle de liberação
  // na tela. Uma consulta para todos os participantes, e não uma por linha.
  // O hash não sai daqui — só o booleano.
  const comSenha = await Client.find({
    _id: { $in: vinculos.map((v) => v.clienteId?._id ?? v.clienteId) },
    usuarioId
  }).select("+senhaPortalHash");
  const temPortal = new Set(
    comSenha.filter((c) => Boolean(c.senhaPortalHash)).map((c) => String(c._id))
  );

  const data = vinculos.map((vinculo) => ({
    ...vinculo.toJSON(),
    estadoPortal: estadoDoParticipante(vinculo),
    temAcessoPortal: temPortal.has(String(vinculo.clienteId?._id ?? vinculo.clienteId))
  }));

  // Mesmo envelope de toda listagem. O conjunto é limitado aos participantes de
  // um processo e não pagina: uma página só, `limit` igual ao tamanho — a mesma
  // forma que `listarInstallments` e `listarPayments` já usam quando filtram
  // por processo.
  return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
};

// ── O código para a advogada entregar (DEC-093, Fase 2.5) ─────────────────
// A rota continua a mesma — `GET /processes/:id/clientes/:clienteId/
// codigo-acesso` — e a chave `codigoAcesso` também, porque a tela de entrega
// (`AccessDelivery`) e a suíte a leem. O que mudou é QUAL código sai: o
// PESSOAL do cliente, que é a credencial desde a DEC-089. O código do vínculo
// não sai mais por rota nenhuma — não abre nada, e mostrá-lo à advogada seria
// convidá-la a entregar um papel que não funciona.
//
// Junto vêm as duas perguntas que a entrega precisa responder: este processo
// está LIBERADO para este cliente? e ele tem senha (provisória ou dele)?
// `codigoAcesso` é `null` enquanto o cliente não tem senha de portal: sem
// senha não há código, e a tela diz para definir a senha primeiro.
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
    .select("clienteId processoId papel principal liberadoNoPortal")
    .populate("clienteId", CAMPOS_CLIENTE_POPULADO);

  if (!vinculo) throw erro("Cliente não vinculado a este processo", 404);

  const cliente = await Client.findOne({ _id: clienteId, usuarioId }).select(
    "+senhaPortalHash codigoAcessoPessoal senhaPortalProvisoria"
  );
  const temSenhaPortal = Boolean(cliente?.senhaPortalHash);

  return {
    processoId: vinculo.processoId,
    cliente: vinculo.clienteId,
    papel: vinculo.papel,
    principal: vinculo.principal,
    codigoAcesso: temSenhaPortal ? cliente.codigoAcessoPessoal ?? null : null,
    liberadoNoPortal: vinculo.liberadoNoPortal === true,
    temSenhaPortal,
    senhaPortalProvisoria: temSenhaPortal && cliente.senhaPortalProvisoria === true
  };
};

// ── Liberar ou desligar um processo no portal (DEC-091) ────────────────────
// `PATCH /processes/:id/clientes/:clienteId/liberacao { liberadoNoPortal }`.
// Só o vínculo ATIVO, só da advogada. O corpo aceita UMA chave, booleana: o
// resto é 400 com `campo`, no padrão da allowlist da Fase 4.5. Desligar vale
// na próxima requisição do cliente — o middleware do portal confere a cada
// uma (`exigirVinculoLiberado`).
export const alterarLiberacao = async (usuarioId, processoId, clienteId, data) => {
  await assertProcessoDoUsuario(usuarioId, processoId);

  const erros = validateClienteId(clienteId);
  if (erros.length > 0) throw erro(erros.join(", "), 400);

  const corpo = data && typeof data === "object" ? data : {};
  const desconhecido = Object.keys(corpo).find((k) => k !== "liberadoNoPortal");
  if (desconhecido) {
    throw erro(`Campo não permitido: ${desconhecido}`, 400, { campo: desconhecido });
  }
  if (typeof corpo.liberadoNoPortal !== "boolean") {
    throw erro("Informe liberadoNoPortal como true ou false.", 400, { campo: "liberadoNoPortal" });
  }

  const vinculo = await ProcessoCliente.findOne({ usuarioId, processoId, clienteId, ativo: true });
  if (!vinculo) throw erro("Cliente não vinculado a este processo", 404);

  vinculo.liberadoNoPortal = corpo.liberadoNoPortal;
  await vinculo.save();

  return {
    processoId: vinculo.processoId,
    clienteId: vinculo.clienteId,
    liberadoNoPortal: vinculo.liberadoNoPortal
  };
};

// ── O acesso de UM cliente ao portal, para a advogada (Fase 2.5) ───────────
// `GET /clients/:id/acesso-portal`. O código pessoal, a situação da senha e
// TODOS os processos do cliente — inclusive os de vínculo ou processo
// desativado, marcados como tal: a advogada precisa ver por que um processo
// não aparece para a pessoa, e "não está na lista" não diz por quê.
//
// Não é listagem paginada: é UM cliente, com a árvore dele embaixo — o mesmo
// formato da ficha financeira (objeto, sem envelope).
export const obterAcessoPortal = async (usuarioId, clienteId) => {
  const erros = validateClienteId(clienteId);
  if (erros.length > 0) throw erro(erros.join(", "), 400);

  const cliente = await Client.findOne({ _id: clienteId, usuarioId }).select(
    "+senhaPortalHash codigoAcessoPessoal senhaPortalProvisoria senhaPortalDefinidaEm ativo"
  );
  if (!cliente) throw erro("Cliente não encontrado", 404);

  const vinculos = await ProcessoCliente.find({ usuarioId, clienteId })
    .select(PROJECAO_SEM_CODIGO)
    .populate("processoId", "titulo numeroProcesso ativo")
    .sort({ ativo: -1, createdAt: 1 });

  const temSenhaPortal = Boolean(cliente.senhaPortalHash);

  const processos = vinculos.map((v) => {
    const processo = v.processoId && typeof v.processoId === "object" ? v.processoId : null;
    const situacao = !v.ativo
      ? "vinculoDesativado"
      : processo && processo.ativo === false
        ? "processoDesativado"
        : "ativo";
    return {
      processoId: processo ? processo._id : v.processoId,
      titulo: processo?.titulo ?? null,
      numeroProcesso: processo?.numeroProcesso ?? null,
      papel: v.papel,
      principal: v.principal === true,
      liberadoNoPortal: v.liberadoNoPortal === true,
      situacao,
      primeiroAcessoPortal: v.primeiroAcessoPortal,
      ultimoAcessoPortal: v.ultimoAcessoPortal,
      ultimaConfirmacaoEm: v.ultimaConfirmacaoEm
    };
  });

  const ativos = processos.filter((p) => p.situacao === "ativo");

  return {
    clienteId: cliente._id,
    codigoAcessoPessoal: temSenhaPortal ? cliente.codigoAcessoPessoal ?? null : null,
    temSenhaPortal,
    senhaPortalProvisoria: temSenhaPortal && cliente.senhaPortalProvisoria === true,
    senhaPortalDefinidaEm: cliente.senhaPortalDefinidaEm ?? null,
    // "N de M processos liberados": M são os vínculos e processos ATIVOS — os
    // únicos que a liberação alcança.
    processosLiberados: ativos.filter((p) => p.liberadoNoPortal).length,
    processosAtivos: ativos.length,
    processos
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
  // quem assina. A saída é DESATIVAR o processo, não esvaziá-lo.
  //
  // F-2d: a frase dizia "exclua o processo". A F-2b renomeou a ação para
  // "Desativar" em Processos — sempre foi soft delete, e o nome antigo prometia
  // uma destruição que não acontece. Mandar "excluir" numa tela cujo botão diz
  // "Desativar" faz a advogada procurar um botão que não existe.
  if (ativos <= 1) {
    throw erro(
      "Não é possível remover o único participante do processo. Vincule outro cliente ou desative o processo.",
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
  alterarLiberacao,
  obterAcessoPortal,
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
  listarProcessosQueBloqueiam,
  buscarVinculoAtivo,
  montarVinculos,
  assertClientesDoUsuario
};
