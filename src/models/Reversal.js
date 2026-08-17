import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// ESTORNO — DEC-033 (Fase F-1). Coleção `estornos`.
//
// ── Por que existe ────────────────────────────────────────────────────────
// Pagamento passou a ser IMUTÁVEL (DEC-032). Corrigir valor, data ou qualquer
// erro deixa de ser edição e passa a ser um registro novo, que aponta para o
// anterior. O que a advogada precisa conseguir responder meses depois é
// "quanto entrou, quando, e por que parte disso voltou" — e um `PATCH` que
// reescreve o valor apaga exatamente essa pergunta.
//
// ── Imutável de verdade ───────────────────────────────────────────────────
// Sem PATCH e sem DELETE. Um estorno errado se desfaz com OUTRO estorno, que
// aponta para ele por `estornoAnuladoId`. A cadeia inteira fica legível: houve
// um pagamento, houve um estorno, o estorno foi anulado. Três fatos, três
// registros, nenhuma reescrita.
//
// ── `ativo` NÃO é soft delete aqui ────────────────────────────────────────
// O campo não existe neste model, e a ausência é deliberada. Em todo o resto
// do projeto `ativo: false` significa "excluído"; aqui, "estorno que não vale
// mais" é o que `estornoAnuladoId` de um SEGUNDO estorno descreve. Ter os dois
// mecanismos daria duas maneiras de anular a mesma coisa, e um relatório que
// somasse por um deles ficaria errado sem ninguém notar.
//
// **Estorno ativo** = estorno que ninguém anulou. Quem responde isso é a
// consulta (`reversalService.mapaDeAnulacoes`), não um campo gravado: campo
// desnormalizado com duas fontes de escrita é campo que diverge, e esta é a
// mesma razão pela qual `Installment.valorPago` tem um ponto único de escrita.
// ═══════════════════════════════════════════════════════════════════════════

// `total` e `parcial` são DERIVÁVEIS de valor × valor do pagamento, e mesmo
// assim ficam gravados: é o campo que a tela lê para escolher a frase, e
// recalcular a classificação em cada leitura significaria repetir a regra em
// todo consumidor. Quem grava é o service, num ponto só, no ato da criação —
// e o teste de invariante confere a coerência, para o campo não virar mentira.
export const TIPOS_ESTORNO = Object.freeze(["total", "parcial", "anulacao"]);

const reversalSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    pagamentoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      index: true
    },
    // Denormalizado para o extrato do honorário não precisar carregar todo
    // pagamento só para saber a qual honorário o estorno pertence. É cópia de
    // `Payment.honorarioId`, gravada uma vez, num registro que nunca muda —
    // não há janela para divergir.
    honorarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Fee",
      required: true,
      index: true
    },
    valor: {
      type: Number,
      required: true,
      min: 0.01
    },
    motivo: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 500
    },
    data: {
      type: Date,
      required: true,
      default: Date.now
    },
    tipo: {
      type: String,
      required: true,
      enum: TIPOS_ESTORNO
    },
    // Preenchido só quando este registro ANULA outro estorno. Nulo no estorno
    // comum — a convenção do projeto para campo ausente é `null`, nunca
    // `undefined`.
    estornoAnuladoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reversal",
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Um estorno só pode ser anulado UMA vez. O índice único parcial é quem
// garante — a checagem no service é a mensagem amigável (409 que orienta), e
// esta linha é a que segura numa corrida entre duas requisições.
reversalSchema.index(
  { estornoAnuladoId: 1 },
  { unique: true, partialFilterExpression: { estornoAnuladoId: { $type: "objectId" } } }
);

reversalSchema.index({ usuarioId: 1, honorarioId: 1, data: 1 });

const Reversal = mongoose.model("Reversal", reversalSchema, "estornos");

export default Reversal;
