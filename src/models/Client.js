import mongoose from "mongoose";
import enderecoSchema from "./shared/enderecoSchema.js";

const representanteLegalSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      trim: true,
      maxlength: 255
    },
    cpf: {
      type: String,
      trim: true
    },
    cargo: {
      type: String,
      trim: true,
      maxlength: 60
    }
  },
  {
    _id: false
  }
);

const clientSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    tipoPessoa: {
      type: String,
      enum: ["fisica", "juridica"],
      required: true
    },

    nomeCompleto: {
      type: String,
      trim: true
    },
    cpf: {
      type: String,
      trim: true
    },

    // ── Campos exclusivos de pessoa física (todos opcionais nesta fase) ──────
    rg: {
      type: String,
      trim: true,
      maxlength: 20
    },
    dataNascimento: {
      type: Date
    },
    sexo: {
      type: String,
      enum: ["feminino", "masculino"]
    },
    // estadoCivil: o valor "uniao_estavel" atende ao apontamento da banca sobre "amasiado".
    // Mantido o termo do Código Civil como valor técnico; o frontend exibe o rótulo
    // "União estável (amasiado)". São a mesma situação jurídica, nomes diferentes.
    estadoCivil: {
      type: String,
      enum: ["solteiro", "casado", "separado_judicialmente", "divorciado", "viuvo", "uniao_estavel"]
    },
    profissao: {
      type: String,
      trim: true,
      maxlength: 60
    },
    nacionalidade: {
      type: String,
      trim: true,
      maxlength: 50,
      default: "brasileira"
    },

    razaoSocial: {
      type: String,
      trim: true
    },
    nomeFantasia: {
      type: String,
      trim: true
    },
    cnpj: {
      type: String,
      trim: true
    },
    // representanteLegal: quem assina pela empresa em procuração/contrato de PJ.
    // Opcional nesta fase; obrigatoriedade será reavaliada na Fase 2.
    representanteLegal: {
      type: representanteLegalSchema
    },

    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    telefone: {
      type: String,
      trim: true
    },
    endereco: {
      type: enderecoSchema,
      default: {}
    },
    observacoes: {
      type: String,
      trim: true
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

clientSchema.index(
  { usuarioId: 1, cpf: 1 },
  {
    unique: true,
    partialFilterExpression: {
      cpf: { $exists: true, $type: "string" }
    }
  }
);

clientSchema.index(
  { usuarioId: 1, cnpj: 1 },
  {
    unique: true,
    partialFilterExpression: {
      cnpj: { $exists: true, $type: "string" }
    }
  }
);

clientSchema.index(
  { usuarioId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $exists: true, $type: "string" }
    }
  }
);

// Rede de segurança do schema (o clientValidation já barra estes casos antes).
// Precisa de statusCode: sem ele o errorHandler trata como falha interna e
// mascara a mensagem, que aqui é informação útil para o cliente.
const erroDeCampoObrigatorio = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

clientSchema.pre("validate", function () {
  if (this.tipoPessoa === "fisica") {
    this.razaoSocial = undefined;
    this.nomeFantasia = undefined;
    this.cnpj = undefined;
    this.representanteLegal = undefined;

    if (!this.nomeCompleto) {
      throw erroDeCampoObrigatorio("Nome completo é obrigatório para pessoa física");
    }

    if (!this.cpf) {
      throw erroDeCampoObrigatorio("CPF é obrigatório para pessoa física");
    }
  }

  if (this.tipoPessoa === "juridica") {
    this.nomeCompleto = undefined;
    this.cpf = undefined;
    this.rg = undefined;
    this.dataNascimento = undefined;
    this.sexo = undefined;
    this.estadoCivil = undefined;
    this.profissao = undefined;
    this.nacionalidade = undefined;

    if (!this.razaoSocial) {
      throw erroDeCampoObrigatorio("Razão social é obrigatória para pessoa jurídica");
    }

    if (!this.nomeFantasia) {
      throw erroDeCampoObrigatorio("Nome fantasia é obrigatório para pessoa jurídica");
    }

    if (!this.cnpj) {
      throw erroDeCampoObrigatorio("CNPJ é obrigatório para pessoa jurídica");
    }
  }
});

const Client = mongoose.model("Client", clientSchema);

export default Client;
