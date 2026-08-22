import mongoose from "mongoose";
import historicoAtivacaoSchema from "./shared/historicoAtivacaoSchema.js";

const processSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    // CAMPO DERIVADO — a verdade sobre os participantes está em
    // `processo_clientes` (model ProcessoCliente), onde um processo pode ter
    // vários clientes com papéis diferentes.
    //
    // Mantido aqui por dois motivos, ambos de leitura:
    //   1. listagem e detalhe exibem "o cliente do processo" sem um join;
    //   2. a resolução de variáveis de template usa este cliente quando a
    //      geração do documento não informa de qual participante ela é.
    //
    // Só o processService escreve neste campo, sempre a partir do vínculo
    // marcado como `principal: true`. Nunca tratar como fonte da verdade: se
    // divergir da junção, a junção é que está certa.
    //
    // O nome anterior era `clienteId` — mentia, sugeria um cliente por
    // processo. `clientePrincipalId` deixa a desnormalização explícita.
    clientePrincipalId: {
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
    },

    // DEC-052 — append-only. Desativar e reativar são mudanças de estado, e
    // mudança de estado sem registro é o que este projeto já decidiu três vezes
    // que não se faz. Ver `models/shared/historicoAtivacaoSchema.js`.
    //
    // Fora da allowlist de update: nenhuma rota aceita este campo. Quem escreve
    // são os pontos de desativação e reativação do serviço.
    historicoAtivacao: {
      type: [historicoAtivacaoSchema],
      default: []
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