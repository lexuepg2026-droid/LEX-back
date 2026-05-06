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
      enum: ["pendente", "pago", "vencido"],
      default: "pendente"
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

const Installment = mongoose.model("Installment", installmentSchema);

export default Installment;