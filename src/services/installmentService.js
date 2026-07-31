import mongoose from "mongoose";
import Installment from "../models/Installment.js";
import Fee from "../models/Fee.js";
import Payment from "../models/Payment.js";
import {
  validarCriacaoInstallment,
  validarAtualizacaoInstallment
} from "../validations/installmentValidation.js";
import { recalcularStatusInstallment, recalcularStatusFee } from "./paymentService.js";
import { DEPENDENCIA } from "../config/integrityConflicts.js";

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

const normalizarStatus = ({ status, dataVencimento, dataPagamento }) => {
  if (status === "pago") {
    return "pago";
  }

  if (!dataPagamento && new Date(dataVencimento) < new Date()) {
    return "vencido";
  }

  return "pendente";
};

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

  const atualizado = await recalcularStatusInstallment(installment._id, usuarioId);
  return atualizado || installment;
};

export const listarInstallments = async (usuarioId, { page = 1, limit = 20, processoId, status } = {}) => {
  const filter = { usuarioId, ativo: true };
  if (status && typeof status === 'string') filter.status = status;

  if (processoId) {
    if (!mongoose.Types.ObjectId.isValid(processoId)) {
      return { data: [], total: 0, page: 1, limit: 0, totalPages: 1 };
    }
    filter.processoId = processoId;
    const data = await Installment.find(filter)
      .populate("feeId")
      .sort({ numeroParcela: 1, createdAt: -1 });
    return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
  }

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

  if (dados.feeId !== undefined) {
    await Payment.updateMany(
      { installmentId: installment._id, ativo: true },
      { $set: { processoId: processoIdFinal } }
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

  const paymentsAtivos = await Payment.countDocuments({ installmentId: installment._id, ativo: true });
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