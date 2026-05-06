import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
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
    nome: {
      type: String,
      required: true,
      trim: true
    },
    tipo: {
      type: String,
      required: true,
      trim: true,
      enum: ["petição", "contrato", "sentença", "comprovante"]
    },
    descricao: {
      type: String,
      trim: true
    },
    urlArquivo: {
      type: String,
      required: true,
      trim: true
    },
    tamanho: {
      type: Number,
      min: 0
    },
    dataUpload: {
      type: Date,
      default: Date.now
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

const Document = mongoose.model("Document", documentSchema);

export default Document;