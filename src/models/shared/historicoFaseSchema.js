import mongoose from "mongoose";

import { FASES_PROCESSO } from "../../config/fasesProcesso.js";

// ═══════════════════════════════════════════════════════════════════════════
// HISTÓRICO DE FASE — DEC-054
//
// ── Por que existe, se ela dispensou o "porquê" ─────────────────────────
// Ela disse: *"não precisa anotar o porquê, só se ela quiser mesmo"*. Isso
// dispensa o **motivo**, e por isso `motivo` é opcional aqui e em toda a
// cadeia até a tela.
//
// **Não dispensa a TRANSIÇÃO.** São coisas diferentes: o motivo é a
// justificativa ("por que voltou para conhecimento"); a transição é o FATO
// ("voltou para conhecimento, em tal dia"). Ela pediu a linha do tempo do
// processo — *"finalizado por etapa — fazer linha do tempo"* — e uma linha do
// tempo é exatamente a sequência desses fatos.
//
// Gravar só a partir de quando a tela existir faria a linha do tempo **nascer
// sem passado**: todo processo apareceria como se nunca tivesse mudado de
// fase até o dia em que alguém implementou a tela. Por isso a gravação começa
// AGORA, na F-2d, e a tela vem na F-2e.
//
// ── Append-only ─────────────────────────────────────────────────────────
// Nunca editado, nunca podado, como `historicoAtivacao` (DEC-052) e
// `historicoStatus` do honorário (DEC-038). **Não há rota que aceite este
// campo** — ele está fora da allowlist de update, e o único ponto de escrita é
// `processService.mudarFase`.
//
// ── Por que NÃO é o `historicoAtivacao` ─────────────────────────────────
// `historicoAtivacao` responde "este registro esteve fora do sistema?".
// `historicoFase` responde "por onde este processo andou?". Um processo em
// execução e um processo desativado não têm nada em comum, e juntar os dois
// num vetor só obrigaria toda leitura a filtrar por tipo antes de entender o
// que está lendo. A nota em `historicoAtivacaoSchema.js` já previa esta
// separação — ela está cumprida aqui.
// ═══════════════════════════════════════════════════════════════════════════

const historicoFaseSchema = new mongoose.Schema(
  {
    // `null` só na primeira entrada, quando o processo nasce: não havia fase
    // anterior. Depois disso sempre preenchido. É a mesma forma do `de` de
    // `historicoStatus` (DEC-038), e pelo mesmo motivo.
    de: {
      type: String,
      enum: [...FASES_PROCESSO, null],
      default: null
    },
    para: {
      type: String,
      required: true,
      enum: FASES_PROCESSO
    },
    data: {
      type: Date,
      required: true,
      default: Date.now
    },
    // ── O "porquê" que ela dispensou ─────────────────────────────────────
    // *"Não precisa anotar o porquê, só se ela quiser mesmo."* Campo livre,
    // **nunca obrigatório**, `null` quando não houver.
    //
    // Exigir motivo aqui é a mutação (b) desta fase, e ela precisa derrubar
    // teste: é exatamente a regra que ela NÃO pediu, e regra inventada já
    // custou caro neste projeto.
    motivo: {
      type: String,
      trim: true,
      default: null
    },
    // Quem mudou. Hoje é sempre o dono do tenant — não há segundo perfil no
    // sistema —, e mesmo assim fica gravado: a linha do tempo da F-2e mostra
    // "quem", e um campo que nasce depois não tem como preencher o passado.
    autorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { _id: false }
);

export default historicoFaseSchema;
