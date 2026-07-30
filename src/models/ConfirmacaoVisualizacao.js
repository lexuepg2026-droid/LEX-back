import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIRMAÇÃO DE VISUALIZAÇÃO (Fase 3.1)
//
// O artefato que permite à advogada provar que o cliente foi informado.
//
// ── Confirmação NÃO é acesso ──────────────────────────────────────────────
// `ProcessoCliente.ultimoAcessoPortal` registra que alguém abriu a tela. É
// atividade, é automático e não notifica ninguém. Serve para ela saber se vale
// a pena ligar.
//
// Confirmação é CLIQUE DELIBERADO do cliente, é imutável, e é o que notifica.
// A diferença importa juridicamente: "o sistema registrou que a página foi
// aberta" e "a pessoa declarou que leu" são afirmações de força muito
// diferente, e misturar as duas produziria um recibo que não sustenta o que
// promete.
//
// ── Por que guardar o texto e um instantâneo ──────────────────────────────
// `textoConfirmado` guarda a redação EXATA que o cliente leu, copiada no
// momento. Se o texto da declaração mudar em 2027, o registro de 2026 continua
// dizendo o que foi de fato confirmado. Guardar só uma referência a um texto
// que muda transformaria o recibo antigo numa afirmação que ninguém fez.
//
// `instantaneo` guarda o que estava visível naquele momento — status do
// processo e quais documentos. Sem ele, "confirmo que li" não diz o que foi
// lido: a advogada poderia liberar um documento depois e o registro antigo
// pareceria cobri-lo.
//
// ── IMUTABILIDADE, e a exceção deliberada à cascata ───────────────────────
// A cascata de soft delete é padrão neste projeto desde a Fase 2A: desativar o
// pai desativa os filhos. AQUI NÃO.
//
// Desativar o vínculo, o processo ou o cliente NÃO desativa as confirmações.
// Elas são prova de que a informação foi entregue, e prova que some não serve
// para nada — o valor de um recibo está justamente em ele sobreviver ao fim da
// relação que o gerou. Encerrar o processo é exatamente quando a advogada mais
// pode precisar mostrar que informou.
//
// Nenhuma rota altera uma confirmação depois de criada, exceto marcar
// `vistaPelaAdvogada`. Nenhuma rota apaga confirmação — nem o cliente, nem a
// advogada.
//
// SE VOCÊ VEIO AQUI APLICAR A CASCATA DE SOFT DELETE POR CONSISTÊNCIA: não é
// esquecimento. É a exceção, e está escrita.
// ═══════════════════════════════════════════════════════════════════════════

const instantaneoSchema = new mongoose.Schema(
  {
    // Status do processo no momento da confirmação.
    statusProcesso: {
      type: String,
      required: true
    },
    // Os documentos que estavam liberados ao portal naquele instante. Guardados
    // como ids, e não como nomes: o nome pode ser editado depois, o id não.
    documentosVisiveis: {
      type: [mongoose.Schema.Types.ObjectId],
      default: []
    },
    // Redundante com `documentosVisiveis.length` de propósito: é o número que a
    // advogada vai ler na tela e citar, e deixá-lo gravado impede que uma
    // mudança futura na forma do array altere o que o recibo afirma.
    quantidadeDocumentos: {
      type: Number,
      required: true,
      default: 0
    }
  },
  { _id: false }
);

const confirmacaoVisualizacaoSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    processoClienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProcessoCliente",
      required: true,
      index: true
    },
    // Desnormalizados do vínculo para a consulta da advogada não precisar de
    // join só para filtrar por processo.
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

    dataHora: {
      type: Date,
      required: true,
      default: Date.now
    },

    textoConfirmado: {
      type: String,
      required: true,
      trim: true
    },

    instantaneo: {
      type: instantaneoSchema,
      required: true
    },

    // O único campo mutável. Marcado pela advogada quando ela vê a confirmação.
    vistaPelaAdvogada: {
      type: Boolean,
      required: true,
      default: false
    },

    // Existe por convenção do projeto (toda coleção tem `ativo`), mas NUNCA é
    // posto em `false` por cascata — ver o bloco de imutabilidade acima.
    // Nenhuma rota o altera hoje.
    ativo: {
      type: Boolean,
      required: true,
      default: true
    }
  },
  {
    timestamps: true,
    collection: "confirmacoes_visualizacao"
  }
);

// O contador do dashboard: "quantas confirmações eu ainda não vi?".
confirmacaoVisualizacaoSchema.index({ usuarioId: 1, vistaPelaAdvogada: 1 });

// A linha do tempo de um participante, na ficha do processo.
confirmacaoVisualizacaoSchema.index({ processoClienteId: 1, dataHora: -1 });

const ConfirmacaoVisualizacao = mongoose.model(
  "ConfirmacaoVisualizacao",
  confirmacaoVisualizacaoSchema
);

export default ConfirmacaoVisualizacao;
