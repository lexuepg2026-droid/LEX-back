import mongoose from "mongoose";

const enderecoSchema = new mongoose.Schema(
  {
    cep: {
      type: String,
      trim: true
    },
    pais: {
      type: String,
      trim: true
    },
    estado: {
      type: String,
      trim: true
    },
    cidade: {
      type: String,
      trim: true
    },
    bairro: {
      type: String,
      trim: true
    },
    logradouro: {
      type: String,
      trim: true
    },
    numero: {
      type: String,
      trim: true
    },
    complemento: {
      type: String,
      trim: true
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

clientSchema.pre("validate", function () {
  if (this.tipoPessoa === "fisica") {
    this.razaoSocial = undefined;
    this.nomeFantasia = undefined;
    this.cnpj = undefined;

    if (!this.nomeCompleto) {
      throw new Error("Nome completo é obrigatório para pessoa física");
    }

    if (!this.cpf) {
      throw new Error("CPF é obrigatório para pessoa física");
    }
  }

  if (this.tipoPessoa === "juridica") {
    this.nomeCompleto = undefined;
    this.cpf = undefined;

    if (!this.razaoSocial) {
      throw new Error("Razão social é obrigatória para pessoa jurídica");
    }

    if (!this.nomeFantasia) {
      throw new Error("Nome fantasia é obrigatório para pessoa jurídica");
    }

    if (!this.cnpj) {
      throw new Error("CNPJ é obrigatório para pessoa jurídica");
    }
  }
});

const Client = mongoose.model("Client", clientSchema);

export default Client;