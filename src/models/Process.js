import mongoose from "mongoose";
import historicoAtivacaoSchema from "./shared/historicoAtivacaoSchema.js";
import historicoFaseSchema from "./shared/historicoFaseSchema.js";
import { FASES_PROCESSO, FASE_PADRAO } from "../config/fasesProcesso.js";

const processSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    // CAMPO DERIVADO — a verdade sobre os participantes está em
    // `processo_clientes` (model ProcessoCliente), onde um processo pode ter
    // vários clientes com papéis diferentes.
    //
    // Mantido aqui por dois motivos, ambos de leitura:
    //   1. listagem e detalhe exibem "o cliente do processo" sem um join;
    //   2. a resolução de variáveis de template usa este cliente quando a
    //      geração do documento não informa de qual participante ela é.
    //
    // Só o processService escreve neste campo, sempre a partir do vínculo
    // marcado como `principal: true`. Nunca tratar como fonte da verdade: se
    // divergir da junção, a junção é que está certa.
    //
    // O nome anterior era `clienteId` — mentia, sugeria um cliente por
    // processo. `clientePrincipalId` deixa a desnormalização explícita.
    clientePrincipalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true
    },
    titulo: {
      type: String,
      required: true,
      trim: true
    },
    numeroProcesso: {
      type: String,
      trim: true
    },
    tipoAcao: {
      type: String,
      trim: true
    },
    area: {
      type: String,
      trim: true
    },
    orgao: {
      type: String,
      trim: true
    },
    vara: {
      type: String,
      trim: true
    },
    comarca: {
      type: String,
      trim: true
    },
    // ── `status` — o eixo VELHO, mantido de propósito (DEC-054) ────────────
    //
    // Três valores administrativos, nascidos na Fase 2 e nunca conferidos com
    // a advogada: "ativo", "encerrado", "suspenso". **Nenhum deles diz em que
    // FASE o processo está** — e foi essa a descoberta da F-2d: `status` e
    // `fase` não são o mesmo eixo renomeado, são eixos diferentes.
    //
    // Fica onde está, e a migração NÃO o apaga: a listagem filtra por ele
    // desde a Fase 2, e derrubá-lo trocaria uma pergunta sem resposta ("o que
    // é 'suspenso' em fase?") por uma tela quebrada.
    status: {
      type: String,
      trim: true,
      enum: ["ativo", "encerrado", "suspenso"],
      default: "ativo"
    },

    // ── DEC-054 — EIXO 1: onde o processo ESTÁ ────────────────────────────
    //
    // Os quatro valores são da Laís (23/08/2026). Ver `config/fasesProcesso.js`
    // para o vocabulário inteiro e para por que a primeira se chama
    // "conhecimento" e não "inicial".
    //
    // **Anda nos dois sentidos.** *"Sim, pode voltar."* Não há máquina de
    // estados, não há transição travada, não há ordem exigida — e a ausência é
    // REGRA, não omissão. Regra que ela não pediu é requisito inventado, e
    // neste projeto já custou caro.
    fase: {
      type: String,
      required: true,
      enum: FASES_PROCESSO,
      default: FASE_PADRAO,
      index: true
    },

    // Append-only (DEC-054). Fora da allowlist de update: nenhuma rota aceita
    // este campo. Quem escreve é `processService.mudarFase`, ponto único.
    // Ver `models/shared/historicoFaseSchema.js` para por que a transição é
    // gravada mesmo com o motivo dispensado.
    historicoFase: {
      type: [historicoFaseSchema],
      default: []
    },

    // ── DEC-054 — EIXO 2: se o processo ACABOU ────────────────────────────
    //
    // *"Trânsito em julgado — processo encerrou completamente, acabou todos os
    // processos de recurso."*
    //
    // **Não é a quinta fase.** É outro eixo, e por isso é outro campo: um
    // processo transitado em julgado continua tendo uma fase — a última em que
    // esteve —, e apagá-la para escrever "transitado" perderia a informação de
    // onde ele parou.
    //
    // `null` enquanto não houver. A data É o encerramento: não existe um
    // booleano `encerrado` ao lado dela, porque dois campos para um fato só
    // podem discordar, e aí ninguém sabe qual está certo.
    transitoEmJulgadoEm: {
      type: Date,
      default: null
    },

    // COMO se chegou ao fim. *"Acordo cumprido — aí o processo finalizado e
    // muda para trânsito em julgado."* É aqui que "acordo cumprido" mora: o
    // caminho que ela descreveu leva ao trânsito em julgado, então o fim é UM
    // só e o motivo EXPLICA como se chegou nele.
    //
    // Campo livre, e não enum: ela citou um caminho ("acordo cumprido") e a
    // prática dela certamente tem outros. Congelar a lista com um exemplo
    // dentro obrigaria a advogada a escolher entre mentir e não registrar.
    motivoEncerramento: {
      type: String,
      trim: true,
      default: null
    },

    // ── DEC-054 — LIMINAR: sinalizador, não estado ────────────────────────
    //
    // *"Liminar é um plus dentro das fases, você pede algo com urgência, mas
    // não é uma fase nova."*
    //
    // Por isso é um booleano ao lado da fase, e não um valor DENTRO dela: um
    // processo em qualquer uma das quatro fases pode ter liminar, e pôr
    // "liminar" no enum forçaria a advogada a apagar a fase real para marcar a
    // urgência.
    liminar: {
      type: Boolean,
      default: false,
      index: true
    },
    // Observação OPCIONAL sobre a liminar, e a data dela. Os dois `null`
    // quando não houver — nunca `undefined`.
    //
    // `liminarEm` e não `liminarConcedidaEm`: ela disse "você pede algo com
    // urgência", e pedido e concessão são momentos diferentes. Nomear o campo
    // por um dos dois decidiria, por conta própria, qual deles a advogada
    // deveria estar registrando.
    liminarObservacao: {
      type: String,
      trim: true,
      default: null
    },
    liminarEm: {
      type: Date,
      default: null
    },
    descricao: {
      type: String,
      trim: true
    },
    observacoes: {
      type: String,
      trim: true
    },
    dataDistribuicao: {
      type: Date
    },
    ativo: {
      type: Boolean,
      default: true
    },

    // DEC-052 — append-only. Desativar e reativar são mudanças de estado, e
    // mudança de estado sem registro é o que este projeto já decidiu três vezes
    // que não se faz. Ver `models/shared/historicoAtivacaoSchema.js`.
    //
    // Fora da allowlist de update: nenhuma rota aceita este campo. Quem escreve
    // são os pontos de desativação e reativação do serviço.
    historicoAtivacao: {
      type: [historicoAtivacaoSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

processSchema.index(
  { usuarioId: 1, numeroProcesso: 1 },
  {
    unique: true,
    partialFilterExpression: {
      numeroProcesso: { $exists: true, $type: "string" }
    }
  }
);

const Process = mongoose.model("Process", processSchema);

export default Process;