import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import Process from "../models/Process.js";
import Installment from "../models/Installment.js";
import Client from "../models/Client.js";
import Renegotiation from "../models/Renegotiation.js";
// A conta dos totais (DEC-040) é a MESMA da ficha do processo. Ver o
// cabeçalho de `feeTotals.js`.
import { totaisDoHonorario, emCentavos } from "./feeTotals.js";
import {
  validateCreateFee,
  validateUpdateFee,
  validateFeeId
} from "../validations/feeValidation.js";
import { DEPENDENCIA } from "../config/integrityConflicts.js";
import { checarUpdate } from "../validations/shared/camposPermitidos.js";
import { recalcularStatusFee } from "./paymentService.js";
import { registrarStatus, registrarCriacao, ORIGEM_STATUS } from "./statusHistory.js";
import {
  filtroTexto,
  filtroObjectIdExigido,
  filtroPeriodo
} from "../utils/filtrosDeConsulta.js";
import { alvosDaBusca, clausulasDaBusca } from "./buscaFinanceira.js";

// ═══════════════════════════════════════════════════════════════════════════
// DEC-027 (Fase 4.1) — as três peças que saíram no MESMO commit
//
//   1. o hook condicional de `percentual`/`valorBase` (`models/Fee.js`);
//   2. este service migrado de `findOneAndUpdate` para `save()`;
//   3. `campo` nos erros de campo, que só nascem com a regra do item 1.
//
// Separadas, cada uma entrega menos do que parece: o hook sem o `save()` não
// roda no update, e o `campo` sem o hook não tem erro nenhum para descrever.
// ═══════════════════════════════════════════════════════════════════════════

const hasOwn = (data, campo) => Object.prototype.hasOwnProperty.call(data, campo);

// Apagar campo grava `null`, nunca `undefined` — convenção do projeto.
// `Number(null)` é 0, e 0 é um percentual que o hook recusa: sem este cuidado,
// "apagar o percentual" viraria "percentual zero" e a mensagem de erro falaria
// de faixa em vez de dizer que o campo não pode ficar ali.
const numeroOuNulo = (valor) => {
  if (valor === null || valor === "" || valor === undefined) return null;
  return Number(valor);
};

const sanitizeFeeData = (data) => {
  const sanitized = {};

  if (hasOwn(data, "processoId")) {
    sanitized.processoId = data.processoId;
  }

  if (hasOwn(data, "descricao")) {
    sanitized.descricao = data.descricao?.trim();
  }

  if (hasOwn(data, "valor")) {
    sanitized.valor = Number(data.valor);
  }

  if (hasOwn(data, "tipo")) {
    sanitized.tipo = data.tipo?.trim();
  }

  if (hasOwn(data, "status")) {
    sanitized.status = data.status?.trim();
  }

  if (hasOwn(data, "dataVencimento")) {
    sanitized.dataVencimento = new Date(data.dataVencimento);
  }

  if (hasOwn(data, "ativo")) {
    sanitized.ativo = data.ativo;
  }

  if (hasOwn(data, "percentual")) {
    sanitized.percentual = numeroOuNulo(data.percentual);
  }

  if (hasOwn(data, "valorBase")) {
    sanitized.valorBase = numeroOuNulo(data.valorBase);
  }

  return sanitized;
};

// ── DEC-027, item 3: `campo` nos erros de campo do honorário ───────────────
//
// `campo` é o nome do input a destacar. Só sai quando exatamente UM campo é
// responsável: com dois erros, mandar a tela destacar o primeiro esconderia o
// segundo, que é pior do que não destacar nada — a advogada corrigiria um,
// reenviaria e levaria o mesmo 400.
//
// NÃO se usa no 409 de integridade (`deleteFee`). Lá não há input em conflito:
// o conflito é entre registros já gravados, e destacar um campo do formulário
// mandaria corrigir o que não tem nada de errado. A distinção está no
// CLAUDE.md e tem teste travando as duas pontas.
const erroDeCampo = (message, statusCode, campos, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (Array.isArray(campos)) {
    const unicos = [...new Set(campos)];
    if (unicos.length === 1) error.campo = unicos[0];
  }
  Object.assign(error, extra);
  return error;
};

// Separador ponto-e-vírgula, e não vírgula (Fase F-0).
//
// Vários erros desta validação CONTÊM vírgula — `tipo inválido. Use: fixo,
// percentual, custas` e `status inválido. Use: pendente, parcialmente_pago,
// pago, cancelado`. Juntando com vírgula, a lista do enum se fundia com o erro
// seguinte e a frase virava:
//
//   "status inválido. Use: pendente, parcialmente_pago, pago, cancelado,
//    dataVencimento é obrigatória"
//
// que se lê como se `dataVencimento é obrigatória` fosse mais um valor válido
// de status. Era o caso raiz da Fase 4.6 — mensagem gramaticalmente correta
// que aponta para o lugar errado — sobrevivendo no separador.
//
// O array vai junto em `errors`, no formato que o `errorHandler` já repassa e
// que a allowlist de PATCH também usa: a tela que quiser listar um erro por
// linha não precisa desfazer a concatenação.
const erroDeValidacao = (validation) =>
  erroDeCampo(validation.errors.join("; "), 400, validation.campos, {
    errors: [...validation.errors]
  });

// O `pre("validate")` do model lança `ValidationError`, que o `errorHandler`
// já converte em 400 com `errors` por caminho. Falta só o `campo`: sem ele o
// `getApiErrorField` do FeeFormPage continuaria inerte, que é exatamente a
// dívida que a DEC-027 mandou fechar.
const comCampoDoModel = (erro) => {
  if (erro?.name !== "ValidationError") return erro;
  const caminhos = Object.keys(erro.errors || {});
  if (caminhos.length === 1) erro.campo = caminhos[0];
  return erro;
};

const gravar = async (documento) => {
  try {
    return await documento.save();
  } catch (erro) {
    throw comCampoDoModel(erro);
  }
};

const ensureProcessBelongsToUser = async (processoId, usuarioId) => {
  const process = await Process.findOne({
    _id: processoId,
    usuarioId,
    ativo: true
  });

  if (!process) {
    const error = new Error("Processo não encontrado para este usuário");
    error.statusCode = 404;
    throw error;
  }

  return process;
};

const createFee = async (usuarioId, feeData) => {
  const validation = validateCreateFee(feeData);

  if (!validation.isValid) {
    throw erroDeValidacao(validation);
  }

  await ensureProcessBelongsToUser(feeData.processoId, usuarioId);

  const sanitizedData = sanitizeFeeData(feeData);

  // `new` + `save()`, e não `Fee.create()`: são equivalentes hoje, mas escrever
  // as duas gravações do service pelo mesmo caminho é o que impede alguém de
  // "otimizar" só uma delas de volta para um método que pula o hook.
  const fee = new Fee({ ...sanitizedData, usuarioId });
  // DEC-038 (F-1a): a linha de nascimento do histórico. Registrada ANTES do
  // `save()`, para o honorário já chegar ao banco com a cadeia começada — e
  // não num segundo `save()` que uma falha de rede deixaria pela metade.
  registrarCriacao(fee);
  await gravar(fee);

  // DEC-028: `status` é derivado. O que veio no corpo vale como intenção
  // inicial e é imediatamente reconciliado com as parcelas — que num honorário
  // recém-criado são zero, logo `pendente`. A exceção é `cancelado`, que a
  // guarda de `recalcularStatusFee` preserva: é o único status que a advogada
  // escreve e o sistema respeita.
  const derivado = await recalcularStatusFee(fee._id, usuarioId);

  return derivado || fee;
};

const listFees = async (
  usuarioId,
  { page = 1, limit = 20, processoId, busca, tipo, status, de, ate } = {}
) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true };
  // Guarda de tipo (Fase 4.5), que na F-0 passou a RECUSAR em vez de descartar.
  const processoFiltro = filtroObjectIdExigido(processoId, "processoId");
  if (processoFiltro) filter.processoId = processoFiltro;

  // ── A busca ALARGOU na F-1b.3 ────────────────────────────────────────────
  //
  // Era `filter.descricao = regex`: casava só a descrição. Passou a casar
  // também o NÚMERO DO PROCESSO, que é o dado que o cliente manda por
  // mensagem — quem chega com um número na mão não tem como adivinhar a
  // descrição que a advogada digitou meses atrás.
  //
  // `escapeRegex` era uma cópia local, idêntica às de `clientService`,
  // `processService` e `utils/texto.js`. Unificada na Fase F-0; o alcance
  // novo sai de `buscaFinanceira.js`, compartilhado com as outras duas
  // listagens — três buscas com três alcances diferentes seria o formato de
  // dívida que a F-0 desfez no `escapeRegex`.
  //
  // Sem `observacoes`: o campo não existe em `Fee`.
  const alvos = await alvosDaBusca(busca, usuarioId);
  if (alvos) {
    filter.$and = [
      { $or: clausulasDaBusca(alvos, { campoHonorario: "_id" }) }
    ];
  }

  // Período por VENCIMENTO do honorário — mesma escolha da listagem de
  // parcelas, e pelo mesmo motivo.
  const periodo = filtroPeriodo(de, ate);
  if (periodo) filter.dataVencimento = periodo;

  const tipoFiltro = filtroTexto(tipo);
  if (tipoFiltro) filter.tipo = tipoFiltro;

  const statusFiltro = filtroTexto(status);
  if (statusFiltro) filter.status = statusFiltro;
  const [data, total] = await Promise.all([
    Fee.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("processoId", "titulo numeroProcesso"),
    Fee.countDocuments(filter)
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

// ═══════════════════════════════════════════════════════════════════════════
// A LEITURA QUE SUSTENTA A PÁGINA DO HONORÁRIO (Fase F-1b)
//
// Até a F-1a esta rota devolvia o documento cru com o processo populado, e era
// o bastante: quem a chamava era o FORMULÁRIO de edição, que só precisa dos
// campos que edita.
//
// A F-1b abre `/dashboard/honorarios/:id`, a página onde a advogada vai
// procurar "quanto entrou nesta cobrança" sem ter de lembrar o número da
// parcela. Essa página precisa, de uma vez: o processo e o CLIENTE (para os
// dois links do cabeçalho), os quatro números da DEC-040, e as parcelas.
//
// ── Por que as parcelas vêm AQUI, e não de `GET /installments?feeId=` ─────
// Porque esse filtro não existe, e criá-lo é trabalho de LISTAGEM — que é o
// escopo declarado da F-1b.2, junto do paginador e dos demais recortes. Fazer
// meio filtro agora entregaria à F-1b.2 uma decisão já tomada pela metade.
//
// As parcelas de um honorário não são uma listagem: são o próprio honorário
// visto por baixo, do mesmo jeito que a ficha do processo já as aninha. Não
// paginam pelo mesmo motivo que a ficha não pagina — meia lista de parcelas
// faria os totais do cabeçalho não fecharem com as linhas embaixo.
//
// ── O acréscimo é ADITIVO ────────────────────────────────────────────────
// As chaves antigas continuam onde estavam, no topo do objeto: `chain.test.js`
// e `derivacao.test.js` leem `.status` e `.valor` da raiz, e a página de
// edição lê o resto. O que entra são chaves novas ao lado.
// ═══════════════════════════════════════════════════════════════════════════
const getFeeById = async (feeId, usuarioId) => {
  const validation = validateFeeId(feeId);

  if (!validation.isValid) {
    throw erroDeValidacao(validation);
  }

  const fee = await Fee.findOne({
    _id: feeId,
    usuarioId,
    ativo: true
  }).populate("processoId", "titulo numeroProcesso clientePrincipalId");

  if (!fee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  const parcelas = await Installment.find({
    feeId: fee._id,
    usuarioId,
    ativo: true
  }).sort({ numeroParcela: 1 });

  // A data da operação que substituiu cada parcela reparcelada, para a página
  // escrever "Substituída pelo reparcelamento de …" sem uma ida ao banco por
  // linha — mesma solução da ficha do processo (F-1a.1).
  const reparcelamentos = await Renegotiation.find({
    honorarioId: fee._id,
    usuarioId
  }).select("data");
  const dataDoReparcelamento = new Map(
    reparcelamentos.map((r) => [String(r._id), r.data])
  );

  // O cliente principal do processo. `clientePrincipalId` é a desnormalização
  // que o `Process` mantém justamente para esta pergunta (DEC-026) — a verdade
  // sobre participação está em `ProcessoCliente`, e lê-la inteira aqui traria
  // o litisconsórcio todo para um cabeçalho que mostra UM nome.
  const clienteId = fee.processoId?.clientePrincipalId ?? null;
  const clienteDoc = clienteId
    ? await Client.findOne({ _id: clienteId, usuarioId, ativo: true })
        .select("nomeCompleto razaoSocial tipoPessoa")
    : null;

  // O nome sai resolvido do servidor, no mesmo critério de `portalProjection`
  // e `documentRenderService`: PJ mostra razão social, PF mostra nome
  // completo. Os dois campos crus seguem ao lado — a tela que quiser
  // distinguir não precisa refazer a escolha, e a que só quer escrever o nome
  // não precisa conhecê-la.
  const cliente = clienteDoc
    ? {
        _id: clienteDoc._id,
        tipoPessoa: clienteDoc.tipoPessoa,
        nomeCompleto: clienteDoc.nomeCompleto ?? null,
        razaoSocial: clienteDoc.razaoSocial ?? null,
        nome:
          clienteDoc.tipoPessoa === "juridica"
            ? clienteDoc.razaoSocial
            : clienteDoc.nomeCompleto
      }
    : null;

  const totais = totaisDoHonorario({
    valorContratado: fee.valor,
    saldoAdiantado: fee.saldoAdiantado,
    parcelas
  });

  // Contagem por status, para o cabeçalho dizer "5 parcelas" sem a tela
  // recontar o array — e sem errar no dia em que a lista ganhar recorte.
  const porStatus = {};
  for (const p of parcelas) {
    porStatus[p.status] = (porStatus[p.status] ?? 0) + 1;
  }

  return {
    ...fee.toObject(),
    cliente,
    totais,
    parcelas: parcelas.map((p) => ({
      _id: p._id,
      numeroParcela: p.numeroParcela,
      valor: emCentavos(p.valor),
      valorPago: emCentavos(p.valorPago),
      // Piso zero, pela mesma razão da ficha: `PATCH /installments/:id` aceita
      // reduzir o valor da parcela depois de ela ter recebido alocação, e sem
      // o piso a página exibiria "em aberto −R$ 500,00".
      emAberto: Math.max(0, emCentavos(Number(p.valor) - Number(p.valorPago || 0))),
      dataVencimento: p.dataVencimento,
      dataPagamento: p.dataPagamento ?? null,
      status: p.status,
      // `null` quando não houve reparcelamento, nunca omitido: campo ausente e
      // campo vazio são coisas diferentes para quem monta a tela.
      reparcelamentoId: p.reparcelamentoId ?? null,
      reparceladaEm: p.reparcelamentoId
        ? dataDoReparcelamento.get(String(p.reparcelamentoId)) ?? null
        : null
    })),
    contagemParcelas: {
      total: parcelas.length,
      porStatus
    }
  };
};

const updateFee = async (feeId, usuarioId, updateData) => {
  // Allowlist da Fase 4.5 — `ativo` fora do corpo (achados #1/#2/#11).
  const recusado = checarUpdate("fees", updateData);
  if (recusado) {
    throw erroDeCampo(recusado.mensagem, 400, recusado.campo ? [recusado.campo] : null);
  }
  const idValidation = validateFeeId(feeId);

  if (!idValidation.isValid) {
    throw erroDeValidacao(idValidation);
  }

  const validation = validateUpdateFee(updateData);

  if (!validation.isValid) {
    throw erroDeValidacao(validation);
  }

  // O escopo `{ usuarioId, ativo: true }` desta leitura é o que sustenta o 404
  // para recurso de outro usuário. Ele estava no filtro do `findOneAndUpdate` e
  // continua aqui: a migração para `save()` não pode transformar "não é seu" em
  // "não existe mais" nem, muito pior, em 200.
  const existingFee = await Fee.findOne({
    _id: feeId,
    usuarioId,
    ativo: true
  });

  if (!existingFee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  if (hasOwn(updateData, "processoId")) {
    await ensureProcessBelongsToUser(updateData.processoId, usuarioId);
  }

  const sanitizedData = sanitizeFeeData(updateData);

  delete sanitizedData.usuarioId;

  // ── DEC-027, item 2 ──────────────────────────────────────────────────────
  // Era `Fee.findOneAndUpdate(..., { runValidators: true })`. `runValidators`
  // roda os validadores de CAMINHO do schema, e não `pre("validate")`: a regra
  // condicional do item 1 — que precisa enxergar `tipo`, `percentual` e
  // `valorBase` juntos — não teria como rodar por ali. O update é justamente
  // onde a advogada troca o tipo de cobrança, ou seja, exatamente o caminho que
  // ficaria sem regra.
  //
  // Semântica preservada: só os campos presentes no corpo são atribuídos, como
  // no `$set` implícito de antes.
  // ── `status` NÃO entra por `Object.assign` (DEC-038, F-1a) ──────────────
  //
  // O campo tem UM ponto de escrita, `statusHistory.registrarStatus`, e é
  // essa exclusividade que faz o histórico valer: uma atribuição direta aqui
  // mudaria o status sem deixar linha, e a advogada leria o array com um
  // buraco — que é pior que histórico nenhum, porque um incompleto parece
  // completo.
  //
  // O que o corpo pede continua valendo como INTENÇÃO, e a reconciliação com
  // as parcelas logo abaixo continua mandando (DEC-028). A única intenção que
  // o sistema respeita é `cancelado` — e o seu inverso, descancelar, que
  // precisa de escrita explícita justamente porque a guarda do recálculo não
  // sobrescreve `cancelado` e o honorário ficaria preso para sempre.
  const statusPedido = sanitizedData.status;
  delete sanitizedData.status;

  Object.assign(existingFee, sanitizedData);

  if (statusPedido !== undefined) {
    const cancelando = statusPedido === STATUS_CANCELADO;
    const descancelando =
      existingFee.status === STATUS_CANCELADO && statusPedido !== STATUS_CANCELADO;

    if (cancelando || descancelando) {
      registrarStatus(existingFee, statusPedido, ORIGEM_STATUS.CANCELAMENTO);
    }
    // Qualquer outro status pedido é ignorado de propósito: as parcelas
    // decidem, e o recálculo abaixo grava o que elas disserem.
  }

  await gravar(existingFee);

  // Reconcilia com as parcelas depois da gravação: se o corpo trouxe um
  // `status` que contradiz o que as parcelas dizem, quem manda são as
  // parcelas. `cancelado` é a exceção, e é assim que se cancela um honorário.
  const derivado = await recalcularStatusFee(existingFee._id, usuarioId);

  return derivado || existingFee;
};

const deleteFee = async (feeId, usuarioId) => {
  const validation = validateFeeId(feeId);

  if (!validation.isValid) {
    throw erroDeValidacao(validation);
  }

  const fee = await Fee.findOne({
    _id: feeId,
    usuarioId,
    ativo: true
  });

  if (!fee) {
    const error = new Error("Honorário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  const installmentsAtivas = await Installment.countDocuments({ feeId: fee._id, ativo: true });
  if (installmentsAtivas > 0) {
    const uma = installmentsAtivas === 1;
    // `dependencia` e `quantidade` são para o frontend; a prosa é o que a
    // advogada lê, e passa a citar o número em vez de só dizer que existem.
    //
    // DEC-027, item 3, a metade que NÃO muda: este 409 continua SEM `campo`.
    // A fase acrescentou `campo` aos erros de campo do honorário, e este não é
    // um deles — não há input em conflito, há parcela gravada. Ver o contrato
    // dos dois tipos de 409 no CLAUDE.md.
    const error = new Error(
      `Não é possível excluir este honorário: ${uma ? "existe" : "existem"} ${installmentsAtivas} ` +
      `${uma ? "parcela ativa vinculada" : "parcelas ativas vinculadas"}. Exclua as parcelas antes.`
    );
    error.statusCode = 409;
    error.dependencia = DEPENDENCIA.PARCELAS;
    error.quantidade = installmentsAtivas;
    throw error;
  }

  fee.ativo = false;
  await fee.save();
  return fee;
};

export default {
  createFee,
  listFees,
  getFeeById,
  updateFee,
  deleteFee
};