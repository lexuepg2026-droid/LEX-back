import {
  criarEstorno,
  carregarEstornos,
  totalEstornado,
  valorLiquido
} from "../services/reversalService.js";
import { recalcularParcelas } from "../services/paymentService.js";
import { validateCreateReversal } from "../validations/reversalValidation.js";
import Payment from "../models/Payment.js";
import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// ESTORNO — controller (DEC-033, Fase F-1a)
//
// O service já existia na fundação desta branch e é ele que decide tudo: o
// líquido, a desalocação espelhada, a anulação. O que faltava era a porta.
//
// ── Por que o recálculo mora aqui, e não no service ───────────────────────
// `reversalService` não importa `paymentService`, e não deve: `paymentService`
// importa `reversalService` (para o líquido de cada linha da listagem), e
// fechar o ciclo faria os dois módulos carregarem um ao outro pela metade —
// em ESM isso não estoura, produz `undefined` no primeiro a ser avaliado.
// O controller é o ponto onde os dois já se encontram sem ciclo.
// ═══════════════════════════════════════════════════════════════════════════

const erro = (status, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = status;
  Object.assign(error, extra);
  return error;
};

const criar = async (req, res, next) => {
  try {
    const validacao = validateCreateReversal(req.body);
    if (!validacao.isValid) {
      throw erro(400, validacao.errors.join("; "), {
        errors: [...validacao.errors],
        ...(validacao.campos.length === 1 ? { campo: validacao.campos[0] } : {})
      });
    }

    const { estorno, desalocacao, realocadas } = await criarEstorno(
      req.params.id,
      req.body,
      req.user._id
    );

    // As parcelas que o estorno tocou precisam voltar ao status certo: uma
    // parcela que estava `pago` por dinheiro que voltou não é mais `pago`.
    // Na anulação são as parcelas que RECEBERAM o valor de volta.
    const tocadas = [
      ...(desalocacao?.parcelasAfetadas ?? []),
      ...(realocadas ?? []).map((a) => String(a.parcelaId))
    ];
    await recalcularParcelas(tocadas, req.user._id);

    // O líquido resultante é o que a tela precisa para saber se ainda há o que
    // estornar. Relido depois do recálculo, e não montado a partir do que
    // acabamos de gravar — releitura é a única forma de o número conferir com
    // o que um GET seguinte devolveria.
    const pagamento = await Payment.findOne({
      _id: req.params.id,
      usuarioId: req.user._id,
      ativo: true
    });
    const estornos = await carregarEstornos(pagamento._id, req.user._id);

    return res.status(201).json({
      estorno,
      desalocacao,
      ...(realocadas ? { realocadas } : {}),
      valorLiquido: valorLiquido(pagamento, estornos),
      totalEstornado: totalEstornado(estornos)
    });
  } catch (error) {
    return next(error);
  }
};

// O extrato do pagamento em si. O extrato do HONORÁRIO — a linha do tempo
// mesclada — é outra rota (`GET /fees/:id/statement`).
const listar = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      throw erro(400, "paymentId inválido", { campo: "paymentId" });
    }

    const pagamento = await Payment.findOne({
      _id: id,
      usuarioId: req.user._id,
      ativo: true
    });
    if (!pagamento) throw erro(404, "Pagamento não encontrado");

    const estornos = await carregarEstornos(pagamento._id, req.user._id);

    return res.status(200).json({
      pagamentoId: pagamento._id,
      valor: pagamento.valor,
      valorLiquido: valorLiquido(pagamento, estornos),
      totalEstornado: totalEstornado(estornos),
      estornos: estornos.map((e) => ({
        _id: e.doc._id,
        valor: e.doc.valor,
        motivo: e.doc.motivo,
        data: e.doc.data,
        tipo: e.doc.tipo,
        estornoAnuladoId: e.doc.estornoAnuladoId,
        ehAnulacao: e.ehAnulacao,
        anulado: e.anulado
      }))
    });
  } catch (error) {
    return next(error);
  }
};

export default { criar, listar };
