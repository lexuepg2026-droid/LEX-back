import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// CHAVE DE IDEMPOTÊNCIA — a ÚNICA adição ao MongoDB na F-5b (DEC-059)
//
// ── Por que ela existe ──────────────────────────────────────────────────
// A fila do navegador REENVIA. O caso comum — não o raro — é a rede cair
// **depois** de o servidor gravar e **antes** de a resposta chegar: para o
// aparelho, a requisição falhou; para o banco, ela aconteceu. Sem proteção, o
// reenvio cria um segundo compromisso idêntico, e a advogada descobre isso
// olhando a agenda com duas audiências no mesmo horário.
//
// ── Por que no SERVIDOR, e não no cliente ───────────────────────────────
// Resolver no cliente ("não reenvie o que já mandou") confiaria a garantia
// justamente a quem perdeu a conexão: o aparelho não tem como saber se o que
// ele mandou chegou. **Idempotência é uma promessa de quem recebe.** Sem
// armazenamento do lado de cá, não há promessa nenhuma — há esperança.
//
// ── Nenhum model existente muda ─────────────────────────────────────────
// A chave não entra em `Event` nem em `Process`: ela é sobre a REQUISIÇÃO, não
// sobre o registro. Guardá-la dentro do evento faria toda consulta de agenda
// carregar um dado de transporte, e não haveria onde pendurar a chave de uma
// operação que falhou antes de criar coisa alguma.
//
// ── Expiração ───────────────────────────────────────────────────────────
// TTL de 30 dias (`expiraEm` + índice `expireAfterSeconds: 0`). Sem expiração
// a coleção cresce para sempre; com expiração curta demais, uma fila que
// ficou dias sem sinal voltaria a duplicar. Trinta dias cobre com folga o
// aparelho que passou uma temporada offline — e um aparelho que volta com
// fila de mais de um mês é caso que a advogada vai revisar de qualquer jeito,
// na tela de pendências.
//
// O TTL do Mongo passa a cada ~60s, então um documento pode sobreviver alguns
// segundos ao próprio vencimento. Quem lê a chave **confere a data** em vez de
// confiar no coletor — ver `middleware/idempotencyMiddleware.js`.
// ═══════════════════════════════════════════════════════════════════════════

// 30 dias. Exportado porque o teste confere o prazo e o middleware o calcula:
// dois lugares com o mesmo número escrito à mão divergiriam na primeira
// mudança.
export const VALIDADE_DA_CHAVE_MS = 30 * 24 * 60 * 60 * 1000;

export const calcularExpiracao = (agora = new Date()) =>
  new Date(agora.getTime() + VALIDADE_DA_CHAVE_MS);

// "A chave ainda vale?" — função pura, porque o middleware precisa dela e o
// teste precisa poder perguntar sem esperar 30 dias.
export const chaveExpirada = (registro, agora = new Date()) => {
  if (!registro?.expiraEm) return true;
  return new Date(registro.expiraEm).getTime() <= agora.getTime();
};

const idempotencyKeySchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // O UUID gerado no aparelho, no instante em que a advogada apertou salvar.
    chave: {
      type: String,
      required: true,
      trim: true
    },

    // "POST /api/events", "PATCH /api/events/<id>". Guardada para recusar a
    // chave REUTILIZADA em outra operação: repetir a chave de um compromisso
    // numa mudança de fase é defeito de cliente, e devolver a resposta do
    // compromisso ali seria pior do que recusar.
    operacao: {
      type: String,
      required: true,
      trim: true
    },

    // `emAndamento` é a RESERVA: ela existe entre o início do processamento e
    // a resposta. Uma segunda requisição com a mesma chave nesse intervalo não
    // pode executar nem pode receber resposta inventada — ela é recusada e a
    // fila tenta de novo.
    estado: {
      type: String,
      required: true,
      enum: ["emAndamento", "concluida"],
      default: "emAndamento"
    },

    respostaStatus: { type: Number, default: null },
    respostaCorpo: { type: mongoose.Schema.Types.Mixed, default: null },

    expiraEm: {
      type: Date,
      required: true
    }
  },
  { timestamps: true, collection: "idempotency_keys" }
);

// A unicidade é POR USUÁRIO. Duas advogadas podem, em tese, gerar o mesmo UUID
// — a probabilidade é desprezível, mas o escopo por usuário custa nada e é a
// mesma regra que vale para todo o resto do banco.
idempotencyKeySchema.index({ usuarioId: 1, chave: 1 }, { unique: true });

// O coletor do Mongo apaga sozinho quando `expiraEm` passa.
idempotencyKeySchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

const IdempotencyKey = mongoose.model("IdempotencyKey", idempotencyKeySchema);

export default IdempotencyKey;
