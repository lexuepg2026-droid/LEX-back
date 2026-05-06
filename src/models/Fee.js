import mongoose from "mongoose";

const feeSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    processoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      required: true,
      index: true
    },
    descricao: {
      type: String,
      required: true,
      trim: true
    },
    valor: {
      type: Number,
      required: true,
      min: 0
    },
    tipo: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      required: true,
      trim: true,
      default: "pendente"
    },
    dataVencimento: {
      type: Date,
      required: true
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

const Fee = mongoose.model("Fee", feeSchema);

export default Fee;