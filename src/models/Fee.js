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
// ═══════════════════════════════════════════════════════════════════════════

// Vocabulário de tipo de honorário. PRECISA DE RATIFICAÇÃO DA ADVOGADA antes de
// a Fase 5 documentar: é vocabulário jurídico da prática dela, não decisão
// técnica. Os três valores são os que existiam desde a Fase 1 e não foram
// alterados nesta fase — só passaram a ter regra condicional em cima.
export const TIPOS_HONORARIO = Object.freeze(["fixo", "percentual", "custas"]);

// O único tipo que implica percentagem. Isolado em constante porque três
// arquivos precisam da mesma resposta para "este tipo admite percentual?".
export const TIPO_PERCENTUAL = "percentual";

export const STATUS_HONORARIO = Object.freeze(["pendente", "pago", "cancelado"]);

const ehVazio = (v) => v === undefined || v === null || v === "";

// Rótulo do tipo para a mensagem de erro. A advogada lê "custas processuais",
// não "custas".
const ROTULO_TIPO = {
  fixo: "fixo",
  percentual: "percentual",
  custas: "custas processuais"
};

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
      `Honorário do tipo ${ROTULO_TIPO[this.tipo] || this.tipo} não admite percentual. ` +
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
