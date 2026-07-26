import mongoose from "mongoose";

// UFs brasileiras (27). Reutilizado pelo enderecoSchema, pelo schema de User
// (oab.estado) e pelas validações de auth/cliente. Fonte única de verdade.
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO"
];

const enderecoSchema = new mongoose.Schema(
  {
    cep: {
      type: String,
      trim: true
    },
    pais: {
      type: String,
      trim: true,
      default: "Brasil"
    },
    estado: {
      type: String,
      trim: true,
      uppercase: true,
      enum: UFS
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

export default enderecoSchema;
