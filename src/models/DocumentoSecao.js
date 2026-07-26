import mongoose from "mongoose";

// Junção N:N entre Documento e Seção. Carrega `ordem` porque um documento é uma
// SEQUÊNCIA de seções — sem ordem não há como renderizar o texto final. O
// dicionário original previa só as duas chaves estrangeiras; a ordem é correção
// do modelo, não campo acessório.

const documentoSecaoSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    documentoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true
    },
    secaoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Secao",
      required: true,
      index: true
    },
    ordem: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "ordem deve ser um número inteiro"
      }
    },
    ativo: {
      type: Boolean,
      required: true,
      default: true
    }
  },
  {
    timestamps: true,
    collection: "documento_secao"
  }
);

// Duas seções na mesma posição tornariam a renderização não determinística.
documentoSecaoSchema.index(
  { documentoId: 1, ordem: 1 },
  {
    unique: true,
    partialFilterExpression: { ativo: true }
  }
);

// A mesma seção duas vezes no mesmo documento é sempre engano do usuário.
documentoSecaoSchema.index(
  { documentoId: 1, secaoId: 1 },
  {
    unique: true,
    partialFilterExpression: { ativo: true }
  }
);

const DocumentoSecao = mongoose.model("DocumentoSecao", documentoSecaoSchema);

export default DocumentoSecao;
