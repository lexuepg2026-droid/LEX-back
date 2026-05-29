// src/models/Payment.js
import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    installmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Installment",
      required: true,
      index: true
    },
    processoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      index: true
    },
    valorPago: {
      type: Number,
      required: true,
      min: 0.01
    },
    dataPagamento: {
      type: Date,
      required: true
    },
    formaPagamento: {
      type: String,
      required: true,
      enum: ["dinheiro", "pix", "boleto", "cartao_credito", "cartao_debito", "transferencia"]
    },
    observacoes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
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

paymentSchema.index({ usuarioId: 1, installmentId: 1 });
paymentSchema.index({ installmentId: 1, dataPagamento: -1 });

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;