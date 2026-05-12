import Client from "../models/Client.js";
import Process from "../models/Process.js";
import Fee from "../models/Fee.js";
import Installment from "../models/Installment.js";
import Document from "../models/Document.js";
import Payment from "../models/Payment.js";

export const getSummary = async (usuarioId) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [
    processosAtivos,
    clientesCadastrados,
    honorariosAReceber,
    parcelasVencidas,
    documentosCadastrados,
    pagamentosResult
  ] = await Promise.all([
    Process.countDocuments({ usuarioId, status: "ativo", ativo: true }),
    Client.countDocuments({ usuarioId, ativo: true }),
    Fee.countDocuments({ usuarioId, status: "pendente", ativo: true }),
    Installment.countDocuments({ usuarioId, status: "vencido", ativo: true }),
    Document.countDocuments({ usuarioId, ativo: true }),
    Payment.aggregate([
      {
        $match: {
          usuarioId,
          ativo: true,
          dataPagamento: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$valorPago" }
        }
      }
    ])
  ]);

  return {
    processosAtivos,
    clientesCadastrados,
    honorariosAReceber,
    parcelasVencidas,
    documentosCadastrados,
    pagamentosRecebidosMes: pagamentosResult[0]?.total ?? 0
  };
};
