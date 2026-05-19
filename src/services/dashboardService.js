import mongoose from "mongoose";
import Client from "../models/Client.js";
import Process from "../models/Process.js";
import Fee from "../models/Fee.js";
import Installment from "../models/Installment.js";
import Document from "../models/Document.js";
import Payment from "../models/Payment.js";

const toCountMap = (arr) =>
  arr.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

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

export const getStatusCounts = async (usuarioId) => {
  const groupByStatus = { _id: "$status", count: { $sum: 1 } };

  const [processResults, feeResults, installmentResults] = await Promise.all([
    Process.aggregate([
      { $match: { usuarioId, ativo: true } },
      { $group: groupByStatus }
    ]),
    Fee.aggregate([
      { $match: { usuarioId, ativo: true } },
      { $group: groupByStatus }
    ]),
    Installment.aggregate([
      { $match: { usuarioId, ativo: true } },
      { $group: groupByStatus }
    ])
  ]);

  return {
    processos:  toCountMap(processResults),
    honorarios: toCountMap(feeResults),
    parcelas:   toCountMap(installmentResults)
  };
};

export const getFinanceiroResumo = async (usuarioId) => {
  const uid = new mongoose.Types.ObjectId(usuarioId);
  const hoje = new Date();

  const [valorContratadoRes, recebidoRes, pendenteRes, vencidas] = await Promise.all([
    Fee.aggregate([
      { $match: { usuarioId: uid, ativo: true } },
      { $group: { _id: null, total: { $sum: "$valor" } } }
    ]),

    Payment.aggregate([
      { $match: { usuarioId: uid, ativo: true } },
      { $group: { _id: null, total: { $sum: "$valorPago" } } }
    ]),

    Installment.aggregate([
      { $match: { usuarioId: uid, ativo: true } },
      {
        $lookup: {
          from: "payments",
          let: { instId: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$installmentId", "$$instId"] },
              { $eq: ["$ativo", true] }
            ]}}}
          ],
          as: "pagamentos"
        }
      },
      {
        $addFields: {
          saldo: { $max: [0, { $subtract: ["$valor", { $sum: "$pagamentos.valorPago" }] }] }
        }
      },
      { $group: { _id: null, totalPendente: { $sum: "$saldo" } } }
    ]),

    Installment.countDocuments({ usuarioId: uid, ativo: true, status: "vencido" })
  ]);

  return {
    valorContratado: valorContratadoRes[0]?.total ?? 0,
    recebido: recebidoRes[0]?.total ?? 0,
    pendente: pendenteRes[0]?.totalPendente ?? 0,
    vencidas
  };
};

export const getFeesByMonth = async (usuarioId) => {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const results = await Fee.aggregate([
    { $match: { usuarioId, ativo: true, createdAt: { $gte: sixMonthsAgo } } },
    {
      $group: {
        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
        total: { $sum: "$valor" }
      }
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } }
  ]);

  return results.map(({ _id, total }) => ({
    mes: `${_id.year}-${String(_id.month).padStart(2, "0")}`,
    total
  }));
};
