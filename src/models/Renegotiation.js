import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// REPARCELAMENTO — DEC-037 (Fase F-1). Coleção `reparcelamentos`.
//
// ── Vínculo, nunca apagamento ─────────────────────────────────────────────
// Renegociar não apaga as parcelas antigas: as que estavam em aberto ganham
// `status: "cancelado"` E `reparcelamentoId` apontando para este registro. O
// histórico conta a história — "estas cinco viraram aquelas três, nesta data,
// por este motivo" — e some inteiro se as antigas forem deletadas.
//
// É a mesma tese da confirmação de visualização da DEC-029: prova que some não
// serve para nada. Aqui a prova é do que foi combinado antes, e é ela que a
// advogada mostra quando o cliente disser "mas a gente tinha acertado outra
// coisa".
//
// ── O snapshot ────────────────────────────────────────────────────────────
// `parcelasCanceladas` guarda id + valor + em aberto de cada parcela no
// MOMENTO do reparcelamento. Não é redundância com a coleção de parcelas: a
// parcela continua existindo e continua legível, mas o `valorPago` dela pode
// mudar depois (um estorno desaloca), e aí a leitura "quanto estava em aberto
// quando renegociamos" deixaria de ser recuperável. Snapshot congela o que a
// conta usou.
//
// ── Imutável ──────────────────────────────────────────────────────────────
// Sem PATCH e sem DELETE, como estorno e alocação. Desfazer um reparcelamento
// não é apagar este registro: é reparcelar de novo.
// ═══════════════════════════════════════════════════════════════════════════

const parcelaCanceladaSchema = new mongoose.Schema(
  {
    parcelaId: { type: mongoose.Schema.Types.ObjectId, ref: "Installment", required: true },
    numeroParcela: { type: Number, required: true },
    valor: { type: Number, required: true },
    // Quanto ainda faltava nesta parcela quando ela foi cancelada. É a soma
    // destes que forma `saldoRenegociado`.
    emAberto: { type: Number, required: true },
    // `parcial` quando a parcela já tinha recebido alocação. O valor alocado
    // NÃO volta — fica como histórico, e o saldo renegociado já o desconta.
    statusAnterior: { type: String, required: true }
  },
  { _id: false }
);

const renegotiationSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    honorarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Fee",
      required: true,
      index: true
    },
    data: {
      type: Date,
      required: true,
      default: Date.now
    },
    motivo: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null
    },
    // O em aberto do honorário no momento da operação. É o valor que a soma
    // das parcelas novas precisa igualar — e o número que o 422 devolve quando
    // não iguala.
    saldoRenegociado: {
      type: Number,
      required: true,
      min: 0
    },
    parcelasCanceladas: {
      type: [parcelaCanceladaSchema],
      default: []
    },
    parcelasNovas: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Installment" }],
      default: []
    }
  },
  {
    timestamps: true
  }
);

renegotiationSchema.index({ usuarioId: 1, honorarioId: 1, data: 1 });

const Renegotiation = mongoose.model("Renegotiation", renegotiationSchema, "reparcelamentos");

export default Renegotiation;
