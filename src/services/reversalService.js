import mongoose from "mongoose";
import Reversal from "../models/Reversal.js";
import Payment from "../models/Payment.js";
import Fee from "../models/Fee.js";
import Allocation from "../models/Allocation.js";
import {
  desalocarPorEstorno,
  planejarAlocacao,
  listarAlocaveis,
  mapaDeAlocado,
  emCentavos
} from "./allocationService.js";

// ═══════════════════════════════════════════════════════════════════════════
// ESTORNO — DEC-033 (Fase F-1)
//
// Dono da pergunta "quanto deste pagamento ainda vale". A resposta é
// `valor − Σ estornos ATIVOS`, e "ativo" significa "que ninguém anulou".
//
// ── Por que a anulação não é um campo no estorno ──────────────────────────
// Seria mais curto marcar `anulado: true` no registro. Seria também uma
// edição de registro imutável, e a data da anulação — que é o que interessa
// num extrato — não teria onde morar. Um estorno se desfaz com OUTRO estorno,
// do tipo `anulacao`, apontando o anulado por `estornoAnuladoId`. Três fatos,
// três linhas, nenhuma reescrita.
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

// Todos os estornos de um pagamento, com a marcação de quais foram anulados.
// Uma consulta, não N.
export const carregarEstornos = async (pagamentoId, usuarioId) => {
  const estornos = await Reversal.find({ pagamentoId, usuarioId }).sort({ data: 1, createdAt: 1 });

  const anulados = new Set(
    estornos.filter((e) => e.estornoAnuladoId).map((e) => String(e.estornoAnuladoId))
  );

  return estornos.map((e) => ({
    doc: e,
    // Um estorno de anulação não é ele mesmo um débito: ele DESFAZ um. Só os
    // estornos comuns não anulados entram na conta do líquido.
    ehAnulacao: Boolean(e.estornoAnuladoId),
    anulado: anulados.has(String(e._id))
  }));
};

// Σ estornos ativos = os comuns que ninguém anulou.
export const totalEstornado = (estornos) =>
  emCentavos(
    estornos
      .filter((e) => !e.ehAnulacao && !e.anulado)
      .reduce((t, e) => t + Number(e.doc.valor), 0)
  );

// O que ainda vale de um pagamento. Nunca negativo — a validação de criação
// garante, e o teste de invariante confere.
export const valorLiquido = (pagamento, estornos) =>
  emCentavos(Number(pagamento.valor) - totalEstornado(estornos));

// ═══════════════════════════════════════════════════════════════════════════
// CRIAÇÃO
// ═══════════════════════════════════════════════════════════════════════════
export const criarEstorno = async (pagamentoId, dados, usuarioId) => {
  validarObjectId(pagamentoId, "pagamentoId");

  const pagamento = await Payment.findOne({ _id: pagamentoId, usuarioId, ativo: true });
  if (!pagamento) throw erro(404, "Pagamento não encontrado");

  const fee = await Fee.findOne({ _id: pagamento.honorarioId, usuarioId, ativo: true });
  if (!fee) throw erro(404, "Honorário do pagamento não encontrado");

  const estornos = await carregarEstornos(pagamento._id, usuarioId);

  // ── Anulação de estorno ────────────────────────────────────────────────
  if (dados.estornoAnuladoId !== undefined && dados.estornoAnuladoId !== null) {
    return anularEstorno({ pagamento, fee, estornos, dados, usuarioId });
  }

  // ── Estorno comum ──────────────────────────────────────────────────────
  const motivo = typeof dados.motivo === "string" ? dados.motivo.trim() : "";
  if (motivo.length < 3) {
    throw erro(
      400,
      "Informe o motivo do estorno (mínimo de 3 caracteres). " +
        "É o que explica, meses depois, por que este dinheiro voltou.",
      { campo: "motivo" }
    );
  }

  const valor = Number(dados.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw erro(400, "O valor do estorno deve ser maior que zero", { campo: "valor" });
  }

  const liquido = valorLiquido(pagamento, estornos);

  if (liquido <= 0) {
    throw erro(
      422,
      "Este pagamento já foi estornado por inteiro. Não há valor a estornar. " +
        "Para desfazer um estorno, anule-o pelo extrato.",
      { errors: { estornavel: 0 }, regra: "pagamentoTotalmenteEstornado" }
    );
  }

  if (emCentavos(valor) > liquido) {
    throw erro(
      422,
      `Este pagamento admite estorno de no máximo R$ ${liquido.toFixed(2).replace(".", ",")}. ` +
        "Informe um valor até esse limite, ou estorne o restante em outro lançamento.",
      { errors: { estornavel: liquido }, regra: "estornoAcimaDoLiquido" }
    );
  }

  const valorEstorno = emCentavos(valor);
  const [estorno] = await Reversal.create([
    {
      usuarioId,
      pagamentoId: pagamento._id,
      honorarioId: fee._id,
      valor: valorEstorno,
      motivo,
      data: dados.data ? new Date(dados.data) : new Date(),
      // `total` quando zera o líquido. Derivável, gravado para a tela não
      // repetir a regra — ver o cabeçalho do model.
      tipo: valorEstorno >= liquido ? "total" : "parcial",
      estornoAnuladoId: null
    }
  ]);

  const desalocacao = await desalocarPorEstorno({
    pagamento,
    fee,
    estorno,
    usuarioId,
    jaEstornado: totalEstornado(estornos)
  });

  return { estorno, desalocacao, fee };
};

// ═══════════════════════════════════════════════════════════════════════════
// ANULAÇÃO — o estorno-do-estorno
//
// Restaura o valor líquido e RE-ALOCA o que voltou, pela regra normal (mais
// antigo primeiro). Não tenta recolocar o dinheiro exatamente nas parcelas de
// onde saiu: entre o estorno e a anulação o mundo pode ter mudado — uma
// parcela pode ter sido reparcelada, outra quitada por outro pagamento. Repor
// no estado antigo criaria alocação em parcela cancelada.
// ═══════════════════════════════════════════════════════════════════════════
const anularEstorno = async ({ pagamento, fee, estornos, dados, usuarioId }) => {
  const alvoId = String(dados.estornoAnuladoId);
  validarObjectId(alvoId, "estornoAnuladoId");

  const alvo = estornos.find((e) => String(e.doc._id) === alvoId);

  if (!alvo) {
    throw erro(
      409,
      "O estorno que se quer anular não existe neste pagamento. " +
        "Confira o extrato: a anulação aponta para um estorno do próprio pagamento.",
      { regra: "estornoInexistente" }
    );
  }

  if (alvo.ehAnulacao) {
    throw erro(
      409,
      "Este registro é uma anulação, e anulação não se anula. " +
        "Para estornar de novo, registre um estorno novo.",
      { regra: "anulacaoDeAnulacao" }
    );
  }

  if (alvo.anulado) {
    throw erro(
      409,
      "Este estorno já foi anulado uma vez, e só pode ser anulado uma. " +
        "O valor dele já voltou ao pagamento — confira o extrato.",
      { regra: "estornoJaAnulado" }
    );
  }

  const motivo = typeof dados.motivo === "string" ? dados.motivo.trim() : "";
  if (motivo.length < 3) {
    throw erro(400, "Informe o motivo da anulação (mínimo de 3 caracteres).", {
      campo: "motivo"
    });
  }

  const [anulacao] = await Reversal.create([
    {
      usuarioId,
      pagamentoId: pagamento._id,
      honorarioId: fee._id,
      valor: alvo.doc.valor,
      motivo,
      data: dados.data ? new Date(dados.data) : new Date(),
      tipo: "anulacao",
      estornoAnuladoId: alvo.doc._id
    }
  ]);

  // O valor volta a procurar destino, pela regra normal de alocação.
  const parcelas = await listarAlocaveis(fee._id, usuarioId);
  const alocado = await mapaDeAlocado(fee._id, usuarioId);
  const { destinos, sobra } = planejarAlocacao(alvo.doc.valor, parcelas, alocado);

  const realocadas = destinos.length
    ? await Allocation.insertMany(
        destinos.map((d) => ({
          usuarioId,
          pagamentoId: pagamento._id,
          parcelaId: d.parcelaId,
          honorarioId: fee._id,
          valor: d.valor,
          data: anulacao.data,
          origem: "pagamento"
        }))
      )
    : [];

  if (sobra > 0) {
    fee.saldoAdiantado = emCentavos(Number(fee.saldoAdiantado || 0) + sobra);
    await fee.save();
  }

  return {
    estorno: anulacao,
    desalocacao: {
      doSaldo: 0,
      dasParcelas: 0,
      naoAbsorvido: 0,
      parcelasAfetadas: realocadas.map((a) => String(a.parcelaId))
    },
    realocadas,
    fee
  };
};

export default { criarEstorno, carregarEstornos, totalEstornado, valorLiquido };
