import mongoose from "mongoose";
import { extrairVariaveis } from "../utils/templateParser.js";

// Seção é TEMPLATE reutilizável: não pertence a um documento. O mesmo texto de
// qualificação serve a procuração, contrato e declaração. A ligação com o
// documento — e a ordem dentro dele — vive em documento_secao.

export const TIPOS_SECAO = [
  "qualificacao",
  "objeto",
  "clausula",
  "fundamentacao",
  "pedido",
  "encerramento",
  "assinatura",
  "outro"
];

const secaoSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    titulo: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    tipo: {
      type: String,
      required: true,
      trim: true,
      enum: TIPOS_SECAO
    },
    texto: {
      type: String,
      required: true,
      trim: true
    },
    // Cache do parse de `texto`. Existe para listar/filtrar por variável sem
    // reprocessar o texto a cada leitura; a fonte da verdade continua sendo o
    // próprio `texto`, por isso o hook recalcula sempre.
    variaveis: {
      type: [String],
      default: []
    },
    ativo: {
      type: Boolean,
      required: true,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Título duplicado confunde na hora de montar o documento. Restrito a
// ativo: true para que o título volte a ficar livre depois da desativação.
secaoSchema.index(
  { usuarioId: 1, titulo: 1 },
  {
    unique: true,
    partialFilterExpression: { ativo: true }
  }
);

secaoSchema.pre("validate", function () {
  // Recalcula sempre: `variaveis` é derivado, nunca entrada do usuário.
  this.variaveis = extrairVariaveis(this.texto);
});

const Secao = mongoose.model("Secao", secaoSchema);

export default Secao;
