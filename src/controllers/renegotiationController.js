import {
  criarReparcelamento,
  listarReparcelamentos
} from "../services/renegotiationService.js";
import { validateCreateRenegotiation } from "../validations/renegotiationValidation.js";

// ═══════════════════════════════════════════════════════════════════════════
// REPARCELAMENTO — controller (DEC-037, Fase F-1a)
//
// Sub-recurso do honorário: `POST /api/fees/:id/renegotiations`. É onde ele
// pertence — reparcelar é uma operação SOBRE a cobrança, e o plano novo só faz
// sentido contra o saldo dela.
// ═══════════════════════════════════════════════════════════════════════════

const criar = async (req, res, next) => {
  try {
    const validacao = validateCreateRenegotiation(req.body);
    if (!validacao.isValid) {
      const err = new Error(validacao.errors.join("; "));
      err.statusCode = 400;
      err.errors = [...validacao.errors];
      if (validacao.campos.length === 1) err.campo = validacao.campos[0];
      throw err;
    }

    const resultado = await criarReparcelamento(req.params.id, req.body, req.user._id);
    return res.status(201).json(resultado);
  } catch (error) {
    return next(error);
  }
};

const listar = async (req, res, next) => {
  try {
    const reparcelamentos = await listarReparcelamentos(req.params.id, req.user._id);
    return res.status(200).json(reparcelamentos);
  } catch (error) {
    return next(error);
  }
};

export default { criar, listar };
