import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// ALOCAÇÃO — DEC-035 (Fase F-1). Coleção `alocacoes`.
//
// ── O que muda ────────────────────────────────────────────────────────────
// Até a F-0, `Payment.installmentId` era obrigatório: um pagamento pertencia a
// UMA parcela, e um pagamento que cobrisse duas exigia registrar dois
// pagamentos — dois recibos para um PIX só. O pagamento passa a nascer contra
// o HONORÁRIO, e o vínculo com parcelas vira este registro.
//
// De onde veio → para onde foi. Uma linha por destino. **Nunca mágica**: se a
// advogada perguntar por que a parcela 2 aparece quitada, a resposta é uma
// linha desta coleção apontando o pagamento que a quitou.
//
// ── Valor NEGATIVO é proibido ─────────────────────────────────────────────
// A desalocação (o estorno desfazendo uma alocação) NÃO é uma alocação de
// valor negativo. É esta mesma linha com `estornoId` preenchido — a alocação
// deixa de contar, e o par continua visível no extrato: alocou em tal data,
// desalocou em tal outra, por causa daquele estorno.
//
// Somar linhas com sinal seria mais curto e teria custado a rastreabilidade: o
// extrato mostraria "-R$ 200,00" sem dizer qual alocação foi desfeita, e um
// relatório que somasse a coluna sem olhar o sinal daria um número errado que
// parece certo. `min: 0.01` no schema é a trava.
//
// **Alocação ativa** = `estornoId: null`. É a soma delas que dá
// `Installment.valorPago` e `pagoLiquidoAlocado` do honorário.
//
// ── Imutável, como o estorno ──────────────────────────────────────────────
// Sem PATCH e sem DELETE. O único campo que muda depois da criação é
// `estornoId`, escrito uma vez pela desalocação, num ponto único
// (`allocationService.desalocar`). Não é edição do fato — é o carimbo de que
// ele foi desfeito.
// ═══════════════════════════════════════════════════════════════════════════

const allocationSchema = new mongoose.Schema(
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
    parcelaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Installment",
      required: true,
      index: true
    },
    // Cópia de `Payment.honorarioId`, para o extrato do honorário ler as
    // alocações sem passar por todos os pagamentos. Gravada uma vez, em
    // registro que não muda.
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
    data: {
      type: Date,
      required: true,
      default: Date.now
    },
    // O estorno que DESFEZ esta alocação. `null` enquanto ela vale.
    estornoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reversal",
      default: null
    },
    // Quando a desalocação aconteceu. Fica ao lado de `estornoId` para o
    // extrato ordenar o par alocação/desalocação na linha do tempo sem ter de
    // carregar o estorno para descobrir a data.
    desalocadoEm: {
      type: Date,
      default: null
    },
    // De onde a alocação veio. `pagamento` = alocada no ato do POST;
    // `saldoAdiantado` = auto-alocação de saldo quando parcelas nasceram
    // (DEC-036). A tela precisa distinguir: uma parcela quitada por saldo
    // adiantado não teve dinheiro entrando naquela data.
    origem: {
      type: String,
      required: true,
      enum: ["pagamento", "saldoAdiantado"],
      default: "pagamento"
    }
  },
  {
    timestamps: true
  }
);

allocationSchema.index({ usuarioId: 1, honorarioId: 1, data: 1 });
allocationSchema.index({ parcelaId: 1, estornoId: 1 });

const Allocation = mongoose.model("Allocation", allocationSchema, "alocacoes");

export default Allocation;
