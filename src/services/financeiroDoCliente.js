import Fee from "../models/Fee.js";
import ProcessoCliente from "../models/ProcessoCliente.js";

// ═══════════════════════════════════════════════════════════════════════════
// O FINANCEIRO DE UM CLIENTE — `?clienteId=` em parcelas e pagamentos
// (Fase 4a2, DEC-166)
//
// A aba "Financeiro" do detalhe do cliente lista as parcelas e os pagamentos
// dos processos dele. O recorte é o mesmo do `GET /processes?clienteId=`
// (DEC-119): processos em que o cliente tem vínculo ATIVO, como principal ou
// não. Daí, os honorários desses processos — e é por honorário que as duas
// listagens recortam (`feeId` na parcela, `honorarioId` no pagamento), pelo
// mesmo processo que elas exibem na coluna (o do honorário, DEC-102).
//
// O vínculo é filtrado por `usuarioId`: o cliente de outra advogada não tem
// vínculo nenhum aqui, e a lista sai vazia — igual à de um id inexistente,
// sem dizer se ele existe. Processo desativado também fica fora: a cascata da
// DEC-052 derruba o vínculo.
// ═══════════════════════════════════════════════════════════════════════════
export const honorariosDoCliente = async (clienteId, usuarioId) => {
  const processoIds = await ProcessoCliente.distinct("processoId", {
    usuarioId,
    clienteId,
    ativo: true
  });
  if (processoIds.length === 0) return [];
  return Fee.distinct("_id", { usuarioId, processoId: { $in: processoIds } });
};

export default { honorariosDoCliente };
