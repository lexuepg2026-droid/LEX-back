import paymentService from "../services/paymentService.js";
import { emitirRecibo } from "../services/receiptService.js";

// ═══════════════════════════════════════════════════════════════════════════
// PAGAMENTO — controller reescrito na Fase F-1a
//
// O que saiu, e para onde foi:
//   • `reativar`  → a rota morreu (DEC-034). Um pagamento não é "desativado"
//     para depois voltar: ele é estornado, e o estorno se desfaz por anulação.
//   • `remove`    → a rota morreu (DEC-032). Estornar é o caminho.
//   • `validatePaymentId` → nunca existiu no módulo reescrito. A checagem de
//     ObjectId mora no service, junto das demais, e responde 400 com `campo`
//     no padrão da F-0. Validar no controller era o único módulo financeiro
//     fora da convenção "validação sempre no service" (Fase 4.5).
//   • `validateCreatePayment` no controller → idem: `paymentService.create`
//     já a chama e monta o 400 com `campo`. Rodando aqui antes, engolia a
//     recusa da allowlist — foi exatamente o defeito que a 4.5 corrigiu no
//     `update` e que a F-1a não reintroduz no `create`.
// ═══════════════════════════════════════════════════════════════════════════

const create = async (req, res, next) => {
  try {
    const resultado = await paymentService.create(req.body, req.user._id);
    return res.status(201).json(resultado);
  } catch (error) {
    return next(error);
  }
};

// Preview de alocação: o que ACONTECERIA se este pagamento fosse registrado.
// Não grava nada. Usa a MESMA função de planejamento que a criação (decisão
// intocável da fundação) — é o que impede o preview de mentir.
//
// A tela que o consome é da F-1b; a rota nasce aqui porque quem a garante é o
// teste de invariante desta fase, não a interface.
const prever = async (req, res, next) => {
  try {
    const resultado = await paymentService.preverAlocacao(req.body, req.user._id);
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

const findAll = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    // `installmentId` continua existindo e agora filtra POR ALOCAÇÃO
    // ("pagamentos que tocaram esta parcela"). `honorarioId` e `tipo` são
    // novos — o pagamento passou a nascer contra o honorário, e a listagem
    // precisa poder recortar por ele.
    const { installmentId, honorarioId, processoId, formaPagamento, tipo } = req.query;
    const result = await paymentService.findAll(req.user._id, {
      page,
      limit,
      installmentId,
      honorarioId,
      processoId,
      formaPagamento,
      tipo
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

const findById = async (req, res, next) => {
  try {
    const payment = await paymentService.findById(req.params.id, req.user._id);
    return res.status(200).json(payment);
  } catch (error) {
    return next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const payment = await paymentService.update(req.params.id, req.body, req.user._id);
    return res.status(200).json(payment);
  } catch (error) {
    return next(error);
  }
};

// Recibo em PDF do pagamento. Mesmos headers do download de documento,
// inclusive o `Access-Control-Expose-Headers`: sem ele o frontend não lê o nome
// do arquivo do fetch.
const baixarRecibo = async (req, res, next) => {
  try {
    const { buffer, contentType, nomeArquivo } = await emitirRecibo(
      req.params.id,
      req.user._id
    );

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
};

export default {
  create,
  prever,
  findAll,
  findById,
  update,
  baixarRecibo
};
