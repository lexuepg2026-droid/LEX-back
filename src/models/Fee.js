import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// HONORÁRIO
//
// DEC-027 (Fase 4.1): o model ganha `percentual` e `valorBase`, com validação
// CONDICIONAL ao tipo, num hook `pre("validate")`.
//
// O hook só vale porque, no MESMO commit, `feeService.updateFee` deixou de usar
// `findOneAndUpdate` e passou a `save()`. `findOneAndUpdate` não dispara
// `pre("validate")`: com ele vivo, a regra existiria no schema e não valeria no
// update — que é justamente onde uma advogada troca o tipo de cobrança.
//
// DEC-028 (Fase 4.1): `status` passa a ser DERIVADO das parcelas, com quatro
// valores. Quem deriva é `recalcularStatusFee` (`paymentService.js`), pendurado
// na mesma cadeia que já recalcula a parcela. `cancelado` é o único que o
// recálculo nunca sobrescreve — ver a guarda lá.
// ═══════════════════════════════════════════════════════════════════════════

// Vocabulário de tipo de honorário. Mora em `config/tiposHonorario.js` desde a
// Fase F-1 (DEC-039, PROVISÓRIA): valor gravado e rótulo de exibição separados,
// num arquivo só, para que ratificar a lista com a advogada vire acrescentar
// uma linha lá. Reexportado aqui porque é daqui que meio projeto importa desde
// a Fase 1 — trocar todos os imports de uma vez seria churn sem ganho.
//
// **PRECISA DE RATIFICAÇÃO DA ADVOGADA.** É vocabulário jurídico da prática
// dela, não decisão técnica, e esta fase não acrescentou nem tirou nenhum.
import {
  TIPOS_HONORARIO,
  TIPO_PERCENTUAL,
  rotuloDoTipo
} from "../config/tiposHonorario.js";

export { TIPOS_HONORARIO, TIPO_PERCENTUAL };

// DEC-028 (Fase 4.1). `parcialmente_pago` é novo, e o conjunto passa a ser
// DERIVADO das parcelas por `recalcularStatusFee` (`paymentService.js`).
// `cancelado` é o único que nunca sai do recálculo: só de escrita explícita.
export const STATUS_HONORARIO = Object.freeze([
  "pendente",
  "parcialmente_pago",
  "pago",
  "cancelado"
]);

export const STATUS_CANCELADO = "cancelado";

const ehVazio = (v) => v === undefined || v === null || v === "";

// Rótulo do tipo para a mensagem de erro. A advogada lê "Custas processuais",
// não "custas". O mapa local morreu na F-1: era a segunda lista de rótulos do
// projeto, e `config/tiposHonorario.js` passou a ser a única (DEC-039).

const feeSchema = new mongoose.Schema(
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
    descricao: {
      type: String,
      required: true,
      trim: true
    },
    // O campo ÚNICO que o resto do sistema lê. No honorário percentual ele é
    // calculado pelo hook a partir de `percentual` × `valorBase`; em todos os
    // outros é o que a advogada digitou. Nenhum consumidor — catálogo de
    // variáveis, dashboard, ficha financeira — precisa saber o tipo.
    valor: {
      type: Number,
      required: true,
      min: 0
    },
    tipo: {
      type: String,
      required: true,
      enum: TIPOS_HONORARIO
    },
    // Percentual contratado, em pontos percentuais (10 = 10%). Só existe no
    // tipo percentual — o hook recusa nos demais. `null` quando não há, nunca
    // `undefined`.
    percentual: {
      type: Number,
      default: null
    },
    // Sobre o que o percentual incide: valor da causa, monte-mor, proveito
    // econômico. Obrigatório sempre que houver percentual.
    valorBase: {
      type: Number,
      default: null
    },
    status: {
      type: String,
      required: true,
      enum: STATUS_HONORARIO,
      default: "pendente"
    },
    dataVencimento: {
      type: Date,
      required: true
    },
    // ── DEC-036 (F-1) — dinheiro recebido que ainda não achou parcela ──────
    //
    // Alimentado por pagamento do tipo `adiantamento` (honorário sem parcelas)
    // e pela SOBRA de um pagamento comum que cobriu tudo o que estava em
    // aberto. Consumido automaticamente quando parcelas novas nascem, do
    // primeiro vencimento em diante, virando `Allocation`s normais.
    //
    // Existe para que **nada se perca**: sem ele, o troco de um pagamento
    // maior que o saldo teria de ser recusado (e a advogada registraria um
    // valor que não foi o que entrou) ou descartado em silêncio (pior). Com
    // ele, o dinheiro fica visível no extrato até encontrar destino.
    //
    // NUNCA negativo, e nunca escrito por rota: o ponto único de escrita é
    // `allocationService`, pela mesma razão de `Installment.valorPago`.
    saldoAdiantado: {
      type: Number,
      default: 0,
      min: 0
    },
    // ── DEC-038 (F-1) — histórico append-only de status ───────────────────
    //
    // `status` é derivado (DEC-028) e muda sozinho quando uma parcela é paga,
    // estornada ou renegociada. Sem histórico, a advogada abre o honorário,
    // vê `parcialmente_pago` e não tem como saber que ele esteve `pago` semana
    // passada — nem por quê.
    //
    // **Append-only**: nunca editado, nunca podado. Quem escreve é o ponto
    // único de mudança de status (`registrarStatus`, em `statusHistory.js`);
    // não há rota que aceite este campo.
    historicoStatus: {
      type: [
        new mongoose.Schema(
          {
            de: { type: String, default: null },
            para: { type: String, required: true },
            data: { type: Date, required: true, default: Date.now },
            // `recalculo` (derivação normal da DEC-028), `cancelamento` e
            // `reparcelamento` (escrita explícita). Saber a ORIGEM é o que
            // distingue "o sistema derivou" de "alguém decidiu".
            origem: {
              type: String,
              required: true,
              enum: ["recalculo", "cancelamento", "reparcelamento", "criacao"]
            }
          },
          { _id: false }
        )
      ],
      default: []
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

// ── DEC-027 — validação condicional ao tipo ────────────────────────────────
//
// Uma mensagem por campo, em português, no padrão do projeto: `invalidate` com
// string produz `kind: "user defined"`, que o `errorMiddleware` repassa
// literalmente em vez de traduzir o texto cru do driver.
//
// A ordem dos `else if` importa: sem ela, um honorário fixo com percentual 150
// receberia "não admite percentual" e logo em seguida "fora de faixa" no mesmo
// path, e a advogada leria só a segunda — a menos útil das duas.
feeSchema.pre("validate", function validarPercentual() {
  const temPercentual = !ehVazio(this.percentual);
  const temValorBase = !ehVazio(this.valorBase);
  const ehTipoPercentual = this.tipo === TIPO_PERCENTUAL;

  if (ehTipoPercentual && !temPercentual) {
    this.invalidate(
      "percentual",
      "Honorário do tipo percentual exige o percentual contratado"
    );
  } else if (!ehTipoPercentual && temPercentual) {
    this.invalidate(
      "percentual",
      `Honorário do tipo ${rotuloDoTipo(this.tipo)} não admite percentual. ` +
      "Mude o tipo para percentual ou apague o campo."
    );
  } else if (temPercentual) {
    const numero = Number(this.percentual);
    if (!Number.isFinite(numero) || numero <= 0 || numero > 100) {
      this.invalidate(
        "percentual",
        "O percentual deve ser maior que zero e no máximo 100"
      );
    }
  }

  // Percentual sobre nada não é valor: sem base, 10% não descreve quantia
  // nenhuma e o contrato sairia com um número inventado.
  if (temPercentual && !temValorBase) {
    this.invalidate(
      "valorBase",
      "Informe o valor base sobre o qual o percentual incide"
    );
  }

  if (temValorBase) {
    const base = Number(this.valorBase);
    if (!Number.isFinite(base) || base < 0) {
      this.invalidate("valorBase", "O valor base deve ser um número maior ou igual a zero");
    }
  }

  // ── `valor` derivado ─────────────────────────────────────────────────────
  // Só depois de as duas parcelas da conta terem passado pela validação. O que
  // a requisição mandou em `valor` é descartado de propósito: num honorário
  // percentual o valor não é opinião, é conta.
  if (ehTipoPercentual && this.$isValid("percentual") && this.$isValid("valorBase")) {
    const percentual = Number(this.percentual);
    const base = Number(this.valorBase);
    if (Number.isFinite(percentual) && Number.isFinite(base)) {
      // Arredonda em centavos ANTES de dividir: 33,33% de 1.000 tem de virar
      // 333,30 e não 333,3000000000001.
      this.valor = Math.round(base * percentual) / 100;
    }
  }
});

const Fee = mongoose.model("Fee", feeSchema);

export default Fee;
