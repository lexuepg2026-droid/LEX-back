import mongoose from "mongoose";

const installmentSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    feeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Fee",
      required: true,
      index: true
    },
    processoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      index: true
    },
    numeroParcela: {
      type: Number,
      required: true,
      min: 1
    },
    valor: {
      type: Number,
      required: true,
      min: 0
    },
    dataVencimento: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      required: true,
      enum: ["pendente", "pago", "vencido", "parcial"],
      default: "pendente"
    },
    // Soma dos pagamentos ATIVOS desta parcela, desnormalizada (Fase 4.1).
    // Pagamento desativado sai da soma.
    //
    // NUNCA é escrito por rota: `installmentService` recusa com 400 quem o
    // mandar no corpo, e o único ponto de escrita é
    // `recalcularStatusInstallment`. Campo desnormalizado com duas fontes de
    // escrita é campo que diverge — e aqui a divergência seria a advogada
    // vendo na ficha um valor recebido que não existe no extrato.
    valorPago: {
      type: Number,
      default: 0,
      min: 0
    },
    dataPagamento: {
      type: Date,
      default: null
    },
    ativo: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

installmentSchema.index({ usuarioId: 1, feeId: 1 });
installmentSchema.index({ feeId: 1, numeroParcela: 1 }, { unique: true });
installmentSchema.index({ usuarioId: 1, processoId: 1 });

const Installment = mongoose.model("Installment", installmentSchema);

export default Installment;