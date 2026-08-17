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
    // `cancelado` entrou na Fase F-1 (DEC-037): é o estado da parcela que um
    // reparcelamento tirou de circulação. Não é exclusão — a parcela continua
    // legível, com `reparcelamentoId` apontando a operação que a substituiu.
    status: {
      type: String,
      required: true,
      enum: ["pendente", "pago", "vencido", "parcial", "cancelado"],
      default: "pendente"
    },
    // A operação de reparcelamento que cancelou esta parcela, ou que a criou.
    // `null` na parcela comum. É o vínculo que faz o histórico contar a
    // história — "estas cinco viraram aquelas três" — em vez de as antigas
    // simplesmente sumirem (DEC-037).
    reparcelamentoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Renegotiation",
      default: null,
      index: true
    },
    // Soma das ALOCAÇÕES ATIVAS desta parcela (Fase F-1, DEC-035).
    //
    // Era a soma dos pagamentos ativos até a F-0, quando pagamento pertencia a
    // uma parcela. Agora o dinheiro chega por alocação, e alocação desfeita por
    // estorno (`estornoId` preenchido) sai da soma — a parcela volta a
    // `parcial` ou `pendente` pelo recálculo normal.
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