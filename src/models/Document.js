import mongoose from "mongoose";

// Vocabulário jurídico da cliente, em snake_case. Substitui o enum anterior
// ("petição", "contrato", "sentença", "comprovante"), que tinha acento e não
// cobria os documentos que ela de fato emite.
export const TIPOS_DOCUMENTO = [
  "procuracao",
  "contrato_prestacao_servicos",
  "declaracao_isencao_ir",
  "declaracao_autonomo",
  "declaracao_hipossuficiencia",
  "declaracao_renuncia",
  "peticao",
  "sentenca",
  "comprovante",
  "outro"
];

export const ORIGENS_DOCUMENTO = ["upload", "gerado"];

const documentSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    // Obrigatório apenas quando não é modelo — ver hook pre("validate").
    processoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      index: true
    },
    // De qual participante do processo saiu o documento. Preenchido na geração
    // (documentGenerationService), a partir do cliente informado ou do
    // principal. Opcional: documento de upload não tem cliente de origem, e os
    // gerados antes da Fase 2B também não têm.
    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
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
      enum: TIPOS_DOCUMENTO
    },
    descricao: {
      type: String,
      trim: true
    },
    origem: {
      type: String,
      required: true,
      trim: true,
      enum: ORIGENS_DOCUMENTO,
      default: "upload"
    },
    // Modelo pronto não é entidade nova: é um Documento sem processo, que serve
    // de fonte para clonagem.
    ehModelo: {
      type: Boolean,
      default: false
    },
    // Default false por decisão de segurança: nada aparece para o cliente sem
    // liberação explícita da advogada. Não inverter.
    visivelPortal: {
      type: Boolean,
      default: false
    },
    // Obrigatório apenas quando origem === "upload". Documento gerado é dado,
    // não arquivo — o binário sai sob demanda na Fase 2B.
    urlArquivo: {
      type: String,
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

    // ── Preenchidos somente na geração ───────────────────────────────────────
    // Documento gerado é CONGELADO: o texto resolvido fica gravado e não muda
    // quando o cadastro do cliente mudar depois. É artefato jurídico, com data
    // certa; modelos é que permanecem dinâmicos.
    textoResolvido: {
      type: String
    },
    variaveisResolvidas: {
      type: mongoose.Schema.Types.Mixed
    },
    dataGeracao: {
      type: Date
    },
    geradoDeModeloId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document"
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

const erroDeCampoObrigatorio = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

// Validação condicional no mesmo padrão do hook de Client.
documentSchema.pre("validate", function () {
  if (this.ehModelo === true) {
    // Modelo é composição de seções: não pertence a processo e nunca vai para
    // o portal do cliente.
    this.origem = "gerado";
    this.processoId = undefined;
    this.visivelPortal = false;
  }

  if (this.ehModelo !== true && !this.processoId) {
    throw erroDeCampoObrigatorio("processoId é obrigatório para documento que não é modelo");
  }

  if (this.origem === "upload" && !this.urlArquivo) {
    throw erroDeCampoObrigatorio('urlArquivo é obrigatório quando origem é "upload"');
  }
});

const Document = mongoose.model("Document", documentSchema);

export default Document;
