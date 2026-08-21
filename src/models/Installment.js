import mongoose from "mongoose";

const installmentSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    feeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Fee",
      required: true,
      index: true
    },
    processoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      index: true
    },
    numeroParcela: {
      type: Number,
      required: true,
      min: 1
    },
    valor: {
      type: Number,
      required: true,
      min: 0
    },
    dataVencimento: {
      type: Date,
      required: true
    },
    // `cancelado` entrou na Fase F-1 (DEC-037): é o estado da parcela que um
    // reparcelamento tirou de circulação. Não é exclusão — a parcela continua
    // legível, com `reparcelamentoId` apontando a operação que a substituiu.
    status: {
      type: String,
      required: true,
      enum: ["pendente", "pago", "vencido", "parcial", "cancelado"],
      default: "pendente"
    },
    // A operação de reparcelamento que cancelou esta parcela, ou que a criou.
    // `null` na parcela comum. É o vínculo que faz o histórico contar a
    // história — "estas cinco viraram aquelas três" — em vez de as antigas
    // simplesmente sumirem (DEC-037).
    reparcelamentoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Renegotiation",
      default: null,
      index: true
    },
    // ── O PLANO A QUE ESTA PARCELA PERTENCE (DEC-048, F-1c.1) ───────────────
    //
    // `null` = plano ORIGINAL do honorário. Preenchido = a parcela nasceu
    // naquele reparcelamento.
    //
    // É um campo SEPARADO de `reparcelamentoId` de propósito, e a diferença é
    // a que mais confunde neste modelo:
    //
    //   `reparcelamentoId` = a operação que me CANCELOU  (só nas canceladas)
    //   `planoId`          = a operação que me CRIOU     (só nas de 2ª geração
    //                                                     em diante)
    //
    // Uma parcela cancelada da 2ª geração tem os DOIS preenchidos, com valores
    // DIFERENTES: nasceu no reparcelamento A e morreu no B. Um campo só não
    // conseguiria dizer isso, e foi por supor que `reparcelamentoId` queria
    // dizer "nasceu em" que a migração desta fase quase contou o conjunto
    // errado.
    //
    // É também o que torna a DEC-048 possível: o índice único passou a ser
    // `{feeId, planoId, numeroParcela}`, e é `planoId` que deixa a parcela 1
    // do plano vigente conviver com a parcela 1 do plano que saiu.
    planoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Renegotiation",
      default: null,
      index: true
    },
    // ── O "de N" CONGELADO (DEC-048, F-1c.1) ───────────────────────────────
    //
    // O tamanho do plano a que esta parcela pertence. `null` enquanto o plano
    // está ABERTO — a advogada cria parcela por parcela, e quando a primeira
    // nasce ninguém sabe que serão três. Com `null`, o rótulo conta o plano
    // vigente na leitura, que é a resposta verdadeira enquanto ele cresce.
    //
    // Passa a ter valor, e aí NUNCA MAIS muda, nos dois momentos em que o
    // plano deixa de ser editável:
    //
    //   • quando o reparcelamento CRIA as parcelas novas (o M é conhecido);
    //   • quando o reparcelamento CANCELA as antigas (congela o N que elas
    //     tinham naquele instante).
    //
    // **Por que gravado, e não contado na leitura.** Contar as parcelas do
    // honorário devolveria o total de TODAS as gerações somadas — o número
    // mudaria a cada reparcelamento, inclusive nas parcelas antigas, e um
    // recibo emitido em maio passaria a dizer outra coisa em setembro. Recibo
    // que muda de significado depois de entregue ao cliente é o defeito mais
    // grave que este projeto já corrigiu. Congelado é a única forma que não
    // reescreve o passado.
    //
    // NUNCA é recalculado por hook. Não há hook que o escreva.
    totalParcelas: {
      type: Number,
      default: null,
      min: 1
    },
    // Soma das ALOCAÇÕES ATIVAS desta parcela (Fase F-1, DEC-035).
    //
    // Era a soma dos pagamentos ativos até a F-0, quando pagamento pertencia a
    // uma parcela. Agora o dinheiro chega por alocação, e alocação desfeita por
    // estorno (`estornoId` preenchido) sai da soma — a parcela volta a
    // `parcial` ou `pendente` pelo recálculo normal.
    //
    // NUNCA é escrito por rota: `installmentService` recusa com 400 quem o
    // mandar no corpo, e o único ponto de escrita é
    // `recalcularStatusInstallment`. Campo desnormalizado com duas fontes de
    // escrita é campo que diverge — e aqui a divergência seria a advogada
    // vendo na ficha um valor recebido que não existe no extrato.
    valorPago: {
      type: Number,
      default: 0,
      min: 0
    },
    dataPagamento: {
      type: Date,
      default: null
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

installmentSchema.index({ usuarioId: 1, feeId: 1 });
// ── O ÍNDICE ÚNICO, e por que ele mudou (DEC-048, F-1c.1) ─────────────────
//
// Era `{feeId, numeroParcela}`. Com ele, um honorário não podia ter duas
// parcelas nº 1 — e era exatamente isso que obrigava o reparcelamento a
// numerar as novas CONTINUANDO a sequência (1, 2 canceladas → 3, 4, 5 vivas).
// "Parcela 3" de um plano de três é a primeira, e era o que a tela dizia.
//
// Passou a ser `{feeId, planoId, numeroParcela}`: a unicidade vale DENTRO do
// plano. O plano vigente é 1..N, o plano que saiu continua com os números que
// tinha, e os dois convivem.
//
// **A premissa da Fase 4.5 continua valendo**, e é o que este índice não podia
// quebrar: o índice segue SEM `partialFilterExpression`, então a parcela
// DESATIVADA (`ativo: false`) nunca solta o número dela — não existe segunda
// parcela para colidir numa reativação. Um índice parcial em `ativo: true`
// teria resolvido a DEC-048 e reaberto aquele buraco.
installmentSchema.index({ feeId: 1, planoId: 1, numeroParcela: 1 }, { unique: true });
installmentSchema.index({ usuarioId: 1, processoId: 1 });

const Installment = mongoose.model("Installment", installmentSchema);

export default Installment;