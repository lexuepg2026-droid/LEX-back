// src/models/Payment.js
import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// PAGAMENTO — DEC-032 (Fase F-1): IMUTÁVEL depois de criado.
//
// ── O que mudou, e por quê ────────────────────────────────────────────────
// Até a F-0 o pagamento pertencia a UMA parcela (`installmentId` obrigatório) e
// podia ser editado por PATCH. As duas coisas caíram juntas, porque eram o
// mesmo problema: um registro de dinheiro que muda de valor não é registro, é
// rascunho.
//
//   • `installmentId` → morreu. O pagamento nasce contra o HONORÁRIO
//     (`honorarioId`), e o vínculo com parcelas virou `Allocation` (DEC-035).
//     Um PIX que cobre duas parcelas passa a ser UM pagamento com DUAS
//     alocações, em vez de dois pagamentos e dois recibos.
//   • `valorPago` → `valor`, `dataPagamento` → `data`. O nome antigo carregava
//     a ideia de "quanto desta parcela foi pago"; agora é o valor do pagamento,
//     e quanto foi para cada parcela é a alocação que diz.
//   • edição → estorno (DEC-033). A allowlist de PATCH tem UM campo:
//     `observacoes`.
//
// **Não há migração**: não existe base de produção, e o seed é a única
// população. O modelo antigo morre inteiro — está escrito na DEC-035.
//
// ── `ativo` continua aqui, e não é contradição ────────────────────────────
// O soft delete universal é regra central do projeto e a coleção mantém o
// campo por uniformidade de leitura (toda consulta filtra `ativo: true`). O que
// mudou é que **nenhuma rota o escreve**: `DELETE /payments/:id` deixou de
// existir. Estornar é o caminho, e estorno não apaga — registra.
// ═══════════════════════════════════════════════════════════════════════════

// `comum` é dinheiro que entra contra parcelas existentes. `adiantamento` é
// dinheiro que entra antes de haver parcelas, ou além delas (DEC-036) — cai em
// `Fee.saldoAdiantado` e se auto-aloca quando parcelas nascerem.
//
// A distinção é do PEDIDO, não do resultado: um pagamento `comum` que sobra
// também alimenta o saldo. O tipo diz o que a advogada quis fazer, e é isso que
// o extrato precisa mostrar meses depois.
export const TIPOS_PAGAMENTO = Object.freeze(["comum", "adiantamento"]);

export const FORMAS_PAGAMENTO = Object.freeze([
  "dinheiro",
  "pix",
  "boleto",
  "cartao_credito",
  "cartao_debito",
  "transferencia"
]);

const paymentSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    // A âncora do pagamento desde a F-1. Substitui `installmentId`.
    honorarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Fee",
      required: true,
      index: true
    },
    // Denormalizado do honorário, para a listagem por processo não precisar de
    // um `$lookup`. Escrito uma vez, na criação.
    processoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      index: true
    },
    valor: {
      type: Number,
      required: true,
      min: 0.01
    },
    data: {
      type: Date,
      required: true
    },
    tipo: {
      type: String,
      required: true,
      enum: TIPOS_PAGAMENTO,
      default: "comum"
    },
    // PRESERVADO da F-0, contra a lista de campos da Parte 5 desta fase — ver
    // "Decisões tomadas por conta própria". A advogada registra por onde o
    // dinheiro entrou, a listagem filtra por isso (`?formaPagamento=`), e o
    // recibo imprime. Tirar o campo seria perder informação real para encurtar
    // um contrato.
    formaPagamento: {
      type: String,
      required: true,
      enum: FORMAS_PAGAMENTO
    },
    // O ÚNICO campo que o PATCH aceita (DEC-032). É anotação da advogada sobre
    // o fato, não o fato.
    observacoes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
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

paymentSchema.index({ usuarioId: 1, honorarioId: 1, data: -1 });
paymentSchema.index({ usuarioId: 1, processoId: 1 });

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
