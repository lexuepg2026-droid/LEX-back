import mongoose from "mongoose";
import Renegotiation from "../models/Renegotiation.js";
import Installment from "../models/Installment.js";
import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import Allocation from "../models/Allocation.js";
import Payment from "../models/Payment.js";
import { autoAlocarSaldo, emCentavos, totalAlocadoDoFee } from "./allocationService.js";
import { recalcularParcelas } from "./paymentService.js";
import { ORIGEM_STATUS } from "./statusHistory.js";
import { moeda } from "../utils/templateFormatters.js";

// ═══════════════════════════════════════════════════════════════════════════
// REPARCELAMENTO — DEC-037 (Fase F-1a)
//
// "As cinco parcelas que sobraram viram três, a partir de março." É a operação
// que a advogada faz no telefone com o cliente e que, até a F-0, ela só
// conseguia registrar apagando parcelas e criando outras — sem nada ligando as
// duas pontas.
//
// ── O que acontece, em ordem ──────────────────────────────────────────────
//   1. mede o saldo em aberto AGORA (contratado − alocado líquido − saldo);
//   2. exige que a soma das parcelas novas iguale esse saldo (422 se não);
//   3. cancela as antigas EM ABERTO, carimbando `reparcelamentoId`;
//   4. cria as novas;
//   5. auto-aloca `saldoAdiantado` nelas, se houver.
//
// ── Por que a soma tem de bater EXATAMENTE ────────────────────────────────
// Aceitar soma diferente seria aceitar que a operação mude o valor devido sem
// dizer. Renegociar prazo é uma coisa; dar desconto é outra, e tem nome, tem
// consequência contábil e precisa de decisão explícita da advogada — não pode
// acontecer como efeito colateral de uma conta que não fechou. O 422 devolve o
// valor esperado justamente para ela ver o número e decidir.
//
// ── As parcelas PAGAS ficam intactas ──────────────────────────────────────
// Não entram no cancelamento, não entram no snapshot, não entram na conta. O
// dinheiro já foi recebido e a cobrança correspondente foi cumprida —
// cancelá-las apagaria a quitação. As PARCIAIS são canceladas COM vínculo, e o
// que já foi alocado nelas fica onde está, como histórico: o `emAberto` do
// snapshot é o que faltava, e é só isso que entra no saldo renegociado.
// ═══════════════════════════════════════════════════════════════════════════

const erro = (status, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = status;
  Object.assign(error, extra);
  return error;
};

const validarObjectId = (id, campo) => {
  if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
    throw erro(400, `${campo} inválido`, { campo });
  }
};

// Moeda para a PROSA da mensagem. Reaproveita `moeda` de
// `utils/templateFormatters.js`, que é o formatador do projeto desde a Fase 2C
// — `toFixed(2).replace(".", ",")` escrevia "R$ 6000,00", sem separador de
// milhar, e é esta frase que a advogada lê no 422.
const reais = (n) => moeda(Number(n));

// O em aberto do honorário AGORA — a mesma fórmula da ficha financeira
// (`contratado − pagoLiquidoAlocado − saldoAdiantado`), e de propósito: duas
// fórmulas para "quanto ainda se deve" divergem, e a advogada compararia a
// ficha com o 422 e veria dois números.
export const saldoEmAberto = async (fee, usuarioId) => {
  const alocado = await totalAlocadoDoFee(fee._id, usuarioId);
  return emCentavos(
    Number(fee.valor) - alocado - emCentavos(fee.saldoAdiantado || 0)
  );
};

export const criarReparcelamento = async (honorarioId, dados, usuarioId) => {
  validarObjectId(honorarioId, "honorarioId");

  const fee = await Fee.findOne({ _id: honorarioId, usuarioId, ativo: true });
  if (!fee) throw erro(404, "Honorário não encontrado");

  if (fee.status === STATUS_CANCELADO) {
    throw erro(
      409,
      "Este honorário está cancelado e não pode ser reparcelado. " +
        "Se a cobrança voltou a valer, mude o status do honorário antes de reparcelar.",
      { regra: "honorarioCancelado" }
    );
  }

  const parcelasNovas = dados.parcelas;

  // ── 1. O saldo a renegociar ───────────────────────────────────────────────
  const saldo = await saldoEmAberto(fee, usuarioId);

  if (saldo <= 0) {
    throw erro(
      422,
      "Este honorário não tem saldo em aberto para reparcelar. " +
        "Não há o que redistribuir entre parcelas novas.",
      { errors: { saldoEsperado: saldo }, regra: "semSaldoParaReparcelar" }
    );
  }

  // ── 2. A soma tem de bater ────────────────────────────────────────────────
  const somaNovas = emCentavos(
    parcelasNovas.reduce((t, p) => t + Number(p.valor), 0)
  );

  if (somaNovas !== saldo) {
    throw erro(
      422,
      `A soma das parcelas novas (${reais(somaNovas)}) precisa ser igual ao saldo em ` +
        `aberto deste honorário (${reais(saldo)}). ` +
        "Ajuste os valores, ou registre um desconto no honorário antes de reparcelar.",
      {
        errors: { saldoEsperado: saldo, somaInformada: somaNovas },
        regra: "somaDivergeDoSaldo"
      }
    );
  }

  // ── 3. As antigas em aberto saem, COM vínculo ─────────────────────────────
  //
  // "Em aberto" = tudo o que não está `pago` nem já `cancelado`. Uma parcela
  // `parcial` entra: o que foi alocado nela fica, e só o que faltava é
  // redistribuído.
  const antigas = await Installment.find({
    feeId: fee._id,
    usuarioId,
    ativo: true,
    status: { $nin: ["pago", "cancelado"] }
  }).sort({ dataVencimento: 1, numeroParcela: 1 });

  const alocadoPorParcela = new Map();
  if (antigas.length > 0) {
    const alocacoes = await Allocation.find({
      parcelaId: { $in: antigas.map((p) => p._id) },
      usuarioId,
      estornoId: null
    }).select("parcelaId valor");
    for (const a of alocacoes) {
      const chave = String(a.parcelaId);
      alocadoPorParcela.set(
        chave,
        emCentavos((alocadoPorParcela.get(chave) ?? 0) + Number(a.valor))
      );
    }
  }

  const [reparcelamento] = await Renegotiation.create([
    {
      usuarioId,
      honorarioId: fee._id,
      data: dados.data ? new Date(dados.data) : new Date(),
      motivo: dados.motivo?.trim() || null,
      saldoRenegociado: saldo,
      parcelasCanceladas: antigas.map((p) => ({
        parcelaId: p._id,
        numeroParcela: p.numeroParcela,
        valor: emCentavos(p.valor),
        emAberto: emCentavos(
          Number(p.valor) - (alocadoPorParcela.get(String(p._id)) ?? 0)
        ),
        statusAnterior: p.status
      })),
      parcelasNovas: []
    }
  ]);

  for (const parcela of antigas) {
    parcela.status = "cancelado";
    parcela.reparcelamentoId = reparcelamento._id;
    await parcela.save();
  }

  // ── 4. As novas nascem ────────────────────────────────────────────────────
  //
  // A numeração continua de onde parou, e não recomeça em 1: o índice único
  // `{feeId, numeroParcela}` NÃO é parcial (ver Fase 4.5), então a parcela
  // cancelada nunca solta o número dela. Recomeçar em 1 colidiria na primeira.
  const ultimo = await Installment.findOne({ feeId: fee._id, usuarioId })
    .sort({ numeroParcela: -1 })
    .select("numeroParcela");
  let proximoNumero = (ultimo?.numeroParcela ?? 0) + 1;

  const criadas = [];
  for (const nova of parcelasNovas) {
    const criada = await Installment.create({
      usuarioId,
      feeId: fee._id,
      processoId: fee.processoId,
      numeroParcela: proximoNumero++,
      valor: emCentavos(nova.valor),
      dataVencimento: new Date(nova.dataVencimento),
      status: "pendente",
      dataPagamento: null,
      ativo: true
    });
    criadas.push(criada);
  }

  reparcelamento.parcelasNovas = criadas.map((p) => p._id);
  await reparcelamento.save();

  // ── 5. O saldo adiantado encontra destino nas parcelas novas ──────────────
  //
  // Mesma `planejarAlocacao` de sempre, do primeiro vencimento em diante.
  // Chamada UMA vez, depois de todas as parcelas nascerem — chamá-la dentro do
  // laço faria o saldo se esgotar na primeira e as demais nascerem sem chance.
  const feeAtual = await Fee.findById(fee._id);
  const { alocacoes: autoAlocadas } = await autoAlocarSaldo({
    fee: feeAtual,
    usuarioId,
    pagamentoOrigemId: await primeiroPagamentoDoFee(fee._id, usuarioId)
  });

  // O status do honorário passa a `parcialmente_pago`/`pendente` conforme as
  // parcelas NOVAS. A origem da transição viaja pela cadeia de recálculo como
  // `reparcelamento`, e não `recalculo`: quem lê o histórico precisa
  // distinguir "mudou porque entrou dinheiro" de "mudou porque o plano foi
  // refeito".
  //
  // Carimbar a origem DEPOIS do recálculo não funcionaria, e a primeira versão
  // desta função tentou: quando o bloco explícito rodava, o recálculo já tinha
  // gravado a transição como `recalculo` e `registrarStatus` devolvia `false`
  // por status igual. O teste do invariante 9 pegou.
  await recalcularParcelas(
    [...criadas.map((p) => p._id), ...antigas.map((p) => p._id)],
    usuarioId,
    ORIGEM_STATUS.REPARCELAMENTO
  );

  return {
    reparcelamento: await Renegotiation.findById(reparcelamento._id),
    parcelasCanceladas: antigas.length,
    parcelasCriadas: criadas,
    autoAlocadas,
    saldoRenegociado: saldo,
    fee: await Fee.findById(fee._id)
  };
};

// Não há derivação de status aqui, e é deliberado: ela mora em
// `paymentService`, num ponto só. Uma cópia local "para o reparcelamento" seria
// a segunda fórmula para a mesma pergunta — e as duas divergiriam na primeira
// fase que acrescentasse um estado.

const primeiroPagamentoDoFee = async (feeId, usuarioId) => {
  const primeiro = await Payment.findOne({ honorarioId: feeId, usuarioId, ativo: true })
    .sort({ data: 1, createdAt: 1 })
    .select("_id");
  return primeiro?._id ?? null;
};

export const listarReparcelamentos = async (honorarioId, usuarioId) => {
  validarObjectId(honorarioId, "honorarioId");
  return Renegotiation.find({ honorarioId, usuarioId }).sort({ data: 1, createdAt: 1 });
};

export default { criarReparcelamento, listarReparcelamentos, saldoEmAberto };
