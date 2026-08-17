import mongoose from "mongoose";
import Installment from "../models/Installment.js";
import Fee from "../models/Fee.js";
import Allocation from "../models/Allocation.js";
import Payment from "../models/Payment.js";
import {
  validarCriacaoInstallment,
  validarAtualizacaoInstallment
} from "../validations/installmentValidation.js";
import { recalcularStatusInstallment, recalcularStatusFee } from "./paymentService.js";
import { autoAlocarSaldo } from "./allocationService.js";
import { DEPENDENCIA } from "../config/integrityConflicts.js";
import { checarUpdate } from "../validations/shared/camposPermitidos.js";
import { filtroTexto, filtroObjectIdExigido } from "../utils/filtrosDeConsulta.js";

const erro = (status, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = status;
  Object.assign(error, extra);
  return error;
};

const validarObjectId = (id, nomeCampo) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw erro(400, `${nomeCampo} inválido`);
  }
};

const buscarFeeDoUsuario = async (feeId, usuarioId) => {
  validarObjectId(feeId, "feeId");

  const fee = await Fee.findOne({
    _id: feeId,
    usuarioId,
    ativo: true
  });

  if (!fee) {
    throw erro(404, "Honorário não encontrado");
  }

  return fee;
};

// `normalizarStatus` vivia aqui e foi REMOVIDA na Fase 4.5 (DEC-020 revogada).
//
// Ela nasceu no Bloco 11 como derivação de status da parcela e foi declarada
// intencional na época. Depois, a DEC-028 (Fase 4.1) passou a derivar status
// pela cadeia de pagamento, e `definirStatusInstallment` (`paymentService.js`)
// virou a única fonte — com três estados a mais e a conta feita sobre os
// pagamentos ativos, não sobre a data. Esta função ficou sem nenhum call site
// e a Auditoria Geral nº 2 confirmou a ausência de referências.
//
// Mantê-la seria pior que ruído: quem lesse o arquivo encontraria duas
// derivações de status da parcela, uma delas errada (não conhece `parcial`,
// não olha pagamento), sem nada dizendo qual vale.

// ── `valorPago` NÃO é escrito por rota (Fase 4.1) ──────────────────────────
//
// O campo é a soma dos pagamentos ativos da parcela e tem um único ponto de
// escrita: `recalcularStatusInstallment`. Aceitá-lo no corpo criaria uma
// segunda fonte, e a partir daí a ficha financeira mostraria um recebido que
// não corresponde a pagamento nenhum.
//
// Recusa explícita, e não descarte silencioso: quem mandou o campo acreditava
// estar registrando um recebimento, e ficar em silêncio o deixaria achando que
// registrou. O caminho certo é `POST /payments`, e a mensagem diz isso.
const recusarValorPagoNoCorpo = (dados) => {
  if (!Object.prototype.hasOwnProperty.call(dados ?? {}, "valorPago")) return;

  throw erro(
    400,
    "`valorPago` da parcela é calculado a partir dos pagamentos e não pode ser " +
    "enviado. Registre um pagamento em POST /payments.",
    { campo: "valorPago" }
  );
};

const verificarNumeroParcelaDuplicado = async ({
  feeId,
  numeroParcela,
  installmentId = null
}) => {
  const filtro = {
    feeId,
    numeroParcela
  };

  if (installmentId) {
    filtro._id = { $ne: installmentId };
  }

  const existente = await Installment.findOne(filtro);

  if (existente) {
    // Conflito de campo de formulário, e não de integridade: leva `campo`, no
    // mesmo padrão de `processService` e `secaoService`.
    throw erro(409, "Já existe uma parcela com esse número para este honorário", {
      campo: "numeroParcela"
    });
  }
};

export const criarInstallment = async (usuarioId, dados) => {
  recusarValorPagoNoCorpo(dados);

  const erros = validarCriacaoInstallment(dados);

  if (erros.length > 0) {
    throw erro(400, erros.join(", "));
  }

  const fee = await buscarFeeDoUsuario(dados.feeId, usuarioId);

  await verificarNumeroParcelaDuplicado({
    feeId: dados.feeId,
    numeroParcela: dados.numeroParcela
  });

  const installment = await Installment.create({
    usuarioId,
    feeId: dados.feeId,
    processoId: fee.processoId,
    numeroParcela: dados.numeroParcela,
    valor: dados.valor,
    dataVencimento: dados.dataVencimento,
    status: "pendente",
    dataPagamento: null,
    ativo: dados.ativo !== undefined ? dados.ativo : true
  });

  // ── AUTO-ALOCAÇÃO DO SALDO ADIANTADO (DEC-036, F-1a) ────────────────────
  //
  // Parcela que NASCE é o evento que dá destino ao dinheiro que já tinha
  // entrado. Sem isto, a advogada registraria um adiantamento, emitiria as
  // parcelas e veria todas em aberto com o dinheiro parado no saldo — e teria
  // de "registrar o pagamento de novo" para casar as duas coisas, criando um
  // recebimento que nunca existiu.
  //
  // Usa a MESMA `planejarAlocacao` do pagamento e do preview, do primeiro
  // vencimento em diante. Chamada depois do `create` e antes do recálculo,
  // para o status já nascer refletindo o que foi alocado.
  await autoAlocarSaldo({ fee, usuarioId, pagamentoOrigemId: await origemDoSaldo(fee._id, usuarioId) });

  const atualizado = await recalcularStatusInstallment(installment._id, usuarioId);
  return atualizado || installment;
};

// Qual pagamento originou o saldo que está sendo consumido. É o mais ANTIGO
// que ainda alimenta o honorário — sem ele a alocação de origem
// `saldoAdiantado` ficaria sem "de onde veio", e é justamente a linha do
// extrato que mais precisa da explicação.
//
// `null` quando não há pagamento nenhum (base montada à mão, ou saldo escrito
// por outro caminho): o model aceita, e uma alocação sem origem é melhor que
// uma alocação que mente sobre a origem.
export const origemDoSaldo = async (feeId, usuarioId) => {
  const primeiro = await Payment.findOne({ honorarioId: feeId, usuarioId, ativo: true })
    .sort({ data: 1, createdAt: 1 })
    .select("_id");
  return primeiro?._id ?? null;
};

export const listarInstallments = async (usuarioId, { page = 1, limit = 20, processoId, status, inativos } = {}) => {
  // ── `?inativos=true` — a listagem do desativado (Fase 4.5) ────────────────
  //
  // Existe para a tela poder oferecer "Reativar". Sem ela, o registro
  // desativado é invisível na interface e a rota de reativação só seria
  // alcançável por curl — a funcionalidade existiria sem porta de entrada.
  //
  // É um MODO, não um "incluir": `?inativos=true` lista SÓ os desativados. Um
  // parâmetro que misturasse os dois conjuntos mudaria o significado da
  // listagem padrão conforme uma caixa de seleção, e as somas da tela passariam
  // a incluir o que foi removido sem nada dizendo isso na linha.
  //
  // O default não muda: sem o parâmetro, `ativo: true`, como sempre.
  const somenteInativos = inativos === true || inativos === "true";
  const filter = { usuarioId, ativo: !somenteInativos };

  const statusFiltro = filtroTexto(status);
  if (statusFiltro) filter.status = statusFiltro;

  // ── Fase F-0: o `processoId` deixou de ter caminho próprio ────────────────
  //
  // Havia aqui um `return` antecipado que, com `processoId` presente,
  // devolvia TODAS as parcelas do processo sem `skip` nem `limit`, montando o
  // envelope com `limit: data.length`. A regra central nº 4 do projeto manda
  // paginar todo `GET /`, com teto de 100 — e este caminho, que é justamente
  // o que a aba financeira do processo usa, não tinha teto nenhum.
  //
  // O id inválido também mudou: devolvia `{ data: [], total: 0 }`, ou seja,
  // "este processo não tem parcelas", para uma requisição malformada. Agora é
  // 400 com `campo`, uniforme com os outros três módulos.
  const processoFiltro = filtroObjectIdExigido(processoId, "processoId");
  if (processoFiltro) filter.processoId = processoFiltro;

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Installment.find(filter)
      .populate("feeId")
      .sort({ numeroParcela: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Installment.countDocuments(filter)
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const buscarInstallmentPorId = async (usuarioId, installmentId) => {
  validarObjectId(installmentId, "installmentId");

  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId,
    ativo: true
  }).populate("feeId");

  if (!installment) {
    throw erro(404, "Parcela não encontrada");
  }

  return installment;
};

export const atualizarInstallment = async (
  usuarioId,
  installmentId,
  dados
) => {
  // Allowlist da Fase 4.5 — `ativo` fora do corpo (achados #1/#2/#11).
  const recusado = checarUpdate("installments", dados);
  if (recusado) {
    throw erro(400, recusado.mensagem, recusado.campo ? { campo: recusado.campo } : {});
  }
  validarObjectId(installmentId, "installmentId");

  recusarValorPagoNoCorpo(dados);

  const erros = validarAtualizacaoInstallment(dados);

  if (erros.length > 0) {
    throw erro(400, erros.join(", "));
  }

  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId,
    ativo: true
  });

  if (!installment) {
    throw erro(404, "Parcela não encontrada");
  }

  const feeIdOriginal = String(installment.feeId);
  let feeIdFinal = installment.feeId;
  let processoIdFinal = installment.processoId;
  if (dados.feeId !== undefined) {
    const novaFee = await buscarFeeDoUsuario(dados.feeId, usuarioId);
    feeIdFinal = dados.feeId;
    processoIdFinal = novaFee.processoId;
  }

  const numeroParcelaFinal =
    dados.numeroParcela !== undefined
      ? dados.numeroParcela
      : installment.numeroParcela;

  await verificarNumeroParcelaDuplicado({
    feeId: feeIdFinal,
    numeroParcela: numeroParcelaFinal,
    installmentId
  });

  const dataVencimentoFinal =
    dados.dataVencimento !== undefined
      ? dados.dataVencimento
      : installment.dataVencimento;

  installment.feeId = feeIdFinal;
  installment.processoId = processoIdFinal;
  installment.numeroParcela = numeroParcelaFinal;
  installment.valor =
    dados.valor !== undefined ? dados.valor : installment.valor;
  installment.dataVencimento = dataVencimentoFinal;
  installment.ativo =
    dados.ativo !== undefined ? dados.ativo : installment.ativo;

  await installment.save();

  // Mudar a parcela de honorário move as ALOCAÇÕES dela junto: a alocação
  // guarda `honorarioId` denormalizado, e deixá-lo apontando para o honorário
  // antigo faria `totalAlocadoDoFee` somar dinheiro num honorário que não tem
  // mais a parcela. O `processoId` do pagamento NÃO é reescrito — o pagamento
  // é imutável (DEC-032), e ele pode ter outras alocações que não se mudaram.
  if (dados.feeId !== undefined) {
    await Allocation.updateMany(
      { parcelaId: installment._id, usuarioId },
      { $set: { honorarioId: feeIdFinal } }
    );
  }

  // Recalcula a parcela — e, pela cadeia, o honorário de destino.
  const atualizado = await recalcularStatusInstallment(installmentId, usuarioId);

  // Mudar a parcela de honorário tira uma parcela do conjunto do honorário
  // ANTIGO. Sem este segundo recálculo, um honorário que perdeu a sua única
  // parcela em aberto continuaria `parcialmente_pago` para sempre.
  if (String(feeIdFinal) !== feeIdOriginal) {
    await recalcularStatusFee(feeIdOriginal, usuarioId);
  }

  return atualizado || installment;
};

export const deletarInstallment = async (usuarioId, installmentId) => {
  validarObjectId(installmentId, "installmentId");

  const installment = await Installment.findOne({
    _id: installmentId,
    usuarioId,
    ativo: true
  });

  if (!installment) {
    throw erro(404, "Parcela não encontrada");
  }

  // ── O dependente da parcela virou a ALOCAÇÃO (F-1a) ─────────────────────
  //
  // Até a F-0 o pagamento pertencia à parcela e a contagem era direta. Agora o
  // vínculo é `Allocation`, e a pergunta certa é "quantos pagamentos AINDA
  // apontam para esta parcela" — alocações com `estornoId` preenchido saíram
  // de circulação e não seguram a exclusão, do mesmo jeito que um pagamento
  // desativado não segurava antes.
  //
  // A contagem é de PAGAMENTOS DISTINTOS, não de linhas de alocação: um
  // pagamento parcialmente estornado deixa a linha carimbada e uma substituta,
  // e contar linhas diria "2 pagamentos" onde há um. O contrato do 409 não
  // muda — `dependencia: "pagamentos"` + `quantidade` (Fase 2E.1).
  const alocacoesAtivas = await Allocation.find({
    parcelaId: installment._id,
    usuarioId,
    estornoId: null
  }).select("pagamentoId");

  const paymentsAtivos = new Set(
    alocacoesAtivas.map((a) => String(a.pagamentoId)).filter((id) => id !== "null")
  ).size;

  if (paymentsAtivos > 0) {
    const um = paymentsAtivos === 1;
    // `dependencia` e `quantidade` são para o frontend; a prosa é o que a
    // advogada lê, e passa a citar o número em vez de só dizer que existem.
    throw erro(
      409,
      `Não é possível excluir esta parcela: ${um ? "existe" : "existem"} ${paymentsAtivos} ` +
      `${um ? "pagamento ativo vinculado" : "pagamentos ativos vinculados"}. Exclua os pagamentos antes.`,
      { dependencia: DEPENDENCIA.PAGAMENTOS, quantidade: paymentsAtivos }
    );
  }

  installment.ativo = false;
  await installment.save();

  // Desativar uma parcela muda o conjunto do qual o status do honorário é
  // derivado. `recalcularStatusInstallment` não serve aqui — ela filtra
  // `ativo: true` e devolveria `null` para a parcela que acabou de sair.
  await recalcularStatusFee(installment.feeId, usuarioId);

  return installment;
};

// ═══════════════════════════════════════════════════════════════════════════
// `reativarInstallment` FOI REMOVIDA na Fase F-1a (DEC-034)
//
// Ela nasceu na Fase 4.5, junto com a de pagamento, e as duas saem juntas
// agora — pela mesma razão, que é uma razão do MODELO e não de escopo.
//
// A reativação de parcela existia para desfazer uma exclusão. Com o Financeiro
// 2.0 a exclusão de parcela com dinheiro em cima deixou de ser alcançável (o
// 409 de alocação ativa a barra), e a parcela que sai por decisão da advogada
// sai por REPARCELAMENTO — que a cancela com `reparcelamentoId` apontando para
// o plano novo, deixando o histórico legível. "Reativar" uma parcela cancelada
// por reparcelamento ressuscitaria uma cobrança que foi substituída, ao lado
// da que a substituiu: as duas somariam, e a advogada cobraria duas vezes.
//
// A rota `PATCH /api/installments/:id/reativar` respondia 200 e passa a
// responder 404 pelo `notFoundMiddleware`. Há teste travando as duas rotas
// (esta e a de pagamento) — ver `tests/financial/invariantes2.test.js`.
//
// O que substitui cada caso de uso:
//   • excluí sem querer          → a parcela sem alocação continua excluível e
//                                  recriável por `POST /installments`;
//   • quis desfazer o pagamento  → estorno (DEC-033);
//   • quis refazer o plano       → reparcelamento (DEC-037).
// ═══════════════════════════════════════════════════════════════════════════
