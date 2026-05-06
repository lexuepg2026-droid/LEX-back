import mongoose from "mongoose";

const processSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true
    },
    titulo: {
      type: String,
      required: true,
      trim: true
    },
    numeroProcesso: {
      type: String,
      trim: true
    },
    tipoAcao: {
      type: String,
      trim: true
    },
    area: {
      type: String,
      trim: true
    },
    orgao: {
      type: String,
      trim: true
    },
    vara: {
      type: String,
      trim: true
    },
    comarca: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      trim: true,
      enum: ["ativo", "encerrado", "suspenso"],
      default: "ativo"
    },
    descricao: {
      type: String,
      trim: true
    },
    observacoes: {
      type: String,
      trim: true
    },
    dataDistribuicao: {
      type: Date
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

processSchema.index(
  { usuarioId: 1, numeroProcesso: 1 },
  {
    unique: true,
    partialFilterExpression: {
      numeroProcesso: { $exists: true, $type: "string" }
    }
  }
);

const Process = mongoose.model("Process", processSchema);

export default Process;