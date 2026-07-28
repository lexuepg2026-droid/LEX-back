import mongoose from "mongoose";
import { TAMANHO_CODIGO } from "../utils/accessCode.js";

// ═══════════════════════════════════════════════════════════════════════════
// JUNÇÃO N:N ENTRE PROCESSO E CLIENTE (DEC-026)
//
// A realidade jurídica tem litisconsórcio: casal, herdeiros, empresa e sócio
// no mesmo polo. Um processo por cliente era simplificação do dicionário de
// dados, não do direito.
//
// Esta coleção é a VERDADE sobre quem participa de um processo.
// `Process.clientePrincipalId` é derivado dela e existe só para leitura rápida
// e para resolver as variáveis de template quando o cliente não é informado.
// ═══════════════════════════════════════════════════════════════════════════

export const PAPEIS_PROCESSO_CLIENTE = [
  "autor",
  "reu",
  "terceiro_interessado",
  "litisconsorte"
];

const processoClienteSchema = new mongoose.Schema(
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
    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true
    },
    papel: {
      type: String,
      required: true,
      trim: true,
      enum: PAPEIS_PROCESSO_CLIENTE
    },
    principal: {
      type: Boolean,
      required: true,
      default: false
    },
    // Gerado pelo serviço (src/utils/accessCode.js). Nunca aceito do cliente
    // HTTP e nunca derivado de _id, número do processo ou CPF.
    codigoAcesso: {
      type: String,
      required: true,
      trim: true,
      minlength: TAMANHO_CODIGO,
      maxlength: TAMANHO_CODIGO
    },
    ativo: {
      type: Boolean,
      required: true,
      default: true
    }
  },
  {
    timestamps: true,
    collection: "processo_clientes"
  }
);

// O mesmo cliente não entra duas vezes no mesmo processo. Parcial em
// `ativo: true` para que um vínculo removido possa ser recriado depois — o
// soft delete não pode virar bloqueio permanente.
processoClienteSchema.index(
  { processoId: 1, clienteId: 1 },
  {
    unique: true,
    partialFilterExpression: { ativo: true }
  }
);

// Único GLOBAL, sem filtro parcial: o código de um vínculo desativado continua
// reservado. Reaproveitá-lo daria acesso ao processo novo a quem guardou o
// código antigo.
processoClienteSchema.index({ codigoAcesso: 1 }, { unique: true });

// Apoia a integridade referencial do DELETE /api/clients/:id, que pergunta
// "este cliente está em algum processo?" — busca por clienteId + ativo, sem
// processoId, e portanto não aproveita o índice composto acima.
processoClienteSchema.index({ clienteId: 1, ativo: 1 });

const ProcessoCliente = mongoose.model("ProcessoCliente", processoClienteSchema);

export default ProcessoCliente;
