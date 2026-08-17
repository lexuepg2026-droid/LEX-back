import { montarExtrato } from "../services/statementService.js";

// ═══════════════════════════════════════════════════════════════════════════
// EXTRATO DO HONORÁRIO — controller (Fase F-1a)
//
// A paginação segue o padrão da F-0, byte a byte: `page` mínimo 1, `limit`
// entre 1 e 100 com default 20. O teto existe porque um honorário antigo com
// muitos pagamentos e estornos produz muitos eventos, e devolver todos numa
// resposta é o defeito que a F-0 corrigiu nas listagens de parcela e pagamento.
// ═══════════════════════════════════════════════════════════════════════════

const extrato = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    const resultado = await montarExtrato(req.params.id, req.user._id, { page, limit });
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

export default { extrato };
