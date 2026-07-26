import mongoose from "mongoose";
import enderecoSchema, { UFS } from "./shared/enderecoSchema.js";

// A usuária do sistema é uma advogada autônoma (pessoa física).
// Não existe CNPJ de escritório — apenas dados pessoais + OAB + advocacia.

const oabSchema = new mongoose.Schema(
  {
    numero: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{1,6}$/, "OAB deve ter de 1 a 6 dígitos"]
    },
    estado: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: UFS
    }
  },
  {
    _id: false
  }
);

const advocaciaSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    chavePix: {
      type: String,
      trim: true,
      maxlength: 120
    },
    instagram: {
      type: String,
      trim: true,
      maxlength: 50
    },
    site: {
      type: String,
      trim: true,
      maxlength: 200
    }
  },
  {
    _id: false
  }
);

const userSchema = new mongoose.Schema(
  {
    nomeCompleto: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    senhaHash: {
      type: String,
      required: true
    },
    cpf: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{11}$/, "CPF deve conter 11 dígitos"]
    },
    telefone: {
      type: String,
      trim: true
    },
    oab: {
      type: oabSchema,
      required: true
    },
    advocacia: {
      type: advocaciaSchema,
      required: true
    },
    endereco: {
      type: enderecoSchema,
      default: {}
    },
    ativo: {
      type: Boolean,
      required: true,
      default: true
    },
    ultimoLogin: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

userSchema.index({ cpf: 1 }, { unique: true });
// O número da OAB só é único dentro da UF; unicidade global estaria errada.
userSchema.index({ "oab.numero": 1, "oab.estado": 1 }, { unique: true });

const User = mongoose.model("User", userSchema);

export default User;
