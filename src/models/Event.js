import mongoose from "mongoose";
import { TIPOS_EVENTO } from "../config/tiposEvento.js";

// ═══════════════════════════════════════════════════════════════════════════
// EVENTO — a primeira entidade nova desde o Financeiro 2.0 (F-3)
//
// ── O que o evento É, e o que ele NÃO É ─────────────────────────────────
// É um FATO da agenda que a advogada digitou: uma audiência, um prazo que ela
// anotou, uma reunião. Ele se GRAVA.
//
// Ele não é, e não pode virar, a outra metade do calendário. Vencimento de
// parcela e de honorário são **data derivada** e se LEEM da origem no momento
// da consulta — DEC-055, e a razão está inteira em `services/calendarService.js`.
// Nenhuma linha deste projeto grava um vencimento como evento.
//
// ── Cada evento é UMA data ──────────────────────────────────────────────
// Não há recorrência. "Toda segunda às 14h" exigiria série, exceção e edição
// de "só esta ocorrência" — é subsistema próprio, e a Parte 0 desta fase o
// excluiu por escrito. Um evento, uma data.
// ═══════════════════════════════════════════════════════════════════════════

const eventSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // PROVISÓRIO. Ver `config/tiposEvento.js`: os quatro valores saíram do
    // enunciado da fase, não da Laís, e estão pendentes de ratificação — como
    // a DEC-039 fez com o tipo de honorário e a DEC-054 com o nome da primeira
    // fase processual.
    tipo: {
      type: String,
      required: true,
      enum: TIPOS_EVENTO,
      index: true
    },

    titulo: {
      type: String,
      required: true,
      trim: true
    },

    // Opcionais, e `null` quando apagados — nunca `undefined`. É a convenção do
    // projeto, e o que faz `PATCH { descricao: null }` significar "apague"
    // em vez de "não mexa".
    descricao: {
      type: String,
      trim: true,
      default: null
    },
    local: {
      type: String,
      trim: true,
      default: null
    },

    // ── A DATA — meia-noite UTC, sempre ─────────────────────────────────
    //
    // O ponto único que garante isso é `utils/dataDeCalendario.js`, e a razão
    // inteira está lá: **data sem hora não é um instante, é uma casa do
    // calendário**, e tratá-la como instante é o que faz a audiência de
    // segunda aparecer no domingo.
    //
    // Só `eventService` escreve aqui, e sempre pelo `lerDataDeCalendario` — a
    // entrada é ESTRITA (`AAAA-MM-DD`) e um instante ISO é recusado, não
    // normalizado em silêncio.
    //
    // O tipo é `Date` e não `String` porque é sobre este campo que o intervalo
    // do calendário consulta (`$gte`/`$lte`), e comparação de data em string no
    // Mongo dependeria de o formato nunca variar. O formato `AAAA-MM-DD` é
    // decisão de FRONTEIRA (o que cruza a rede), não de armazenamento.
    data: {
      type: Date,
      required: true,
      index: true
    },

    // ── A HORA — string, e nunca dentro do `Date` ───────────────────────
    //
    // `"14:30"` ou `null`. É hora de PAREDE do escritório: "a audiência é às
    // 14h30" não muda de número porque alguém abriu o sistema noutro fuso.
    //
    // Somá-la ao `data` devolveria o campo à condição de instante — o defeito
    // inteiro desta fase, reintroduzido pela porta dos fundos e só nas linhas
    // que têm horário. O mesmo campo mentiria em metade da grade.
    hora: {
      type: String,
      trim: true,
      default: null
    },

    // ── O PROCESSO é OPCIONAL, e a ausência é o caso comum ─────────────
    //
    // "Nem toda reunião é de um processo": reunião de captação, prazo interno,
    // compromisso do escritório. Exigir processo obrigaria a advogada a
    // inventar um vínculo para registrar o que ela de fato tem na agenda.
    //
    // Quando existe, o evento entra na DEC-053: não nasce nem reativa sob
    // processo inativo. Ver `services/activationHierarchy.js`.
    processoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      default: null,
      index: true
    },

    // ── CONCLUÍDO — booleano com carimbo, não dois fatos ────────────────
    //
    // `concluido` responde "já aconteceu / já foi resolvido"; `concluidoEm`
    // diz QUANDO ela marcou. Os dois andam juntos e num ponto só de escrita
    // (`eventService.concluir`), pela mesma razão que `transitoEmJulgadoEm` da
    // DEC-054 não tem um booleano ao lado: dois campos para um fato só podem
    // discordar.
    //
    // Aqui o booleano existe porque a pergunta do sino é "está pendente?", e
    // ela é feita milhares de vezes por consulta — um índice sobre booleano
    // responde; um `{ concluidoEm: null }` também responderia, mas o campo
    // teria de significar duas coisas.
    //
    // `concluidoEm` é `Date` com hora, e NÃO data de calendário: é o instante
    // em que a advogada clicou, um carimbo de auditoria como `createdAt` — não
    // uma casa do calendário que alguém vá ler numa grade.
    concluido: {
      type: Boolean,
      default: false,
      index: true
    },
    concluidoEm: {
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

// O índice que o calendário de fato usa: um usuário, uma janela de datas, só
// os ativos. Sem ele toda abertura de mês varre a coleção inteira do tenant.
eventSchema.index({ usuarioId: 1, ativo: 1, data: 1 });
// O do sino: os pendentes de um usuário, por data. `concluido` na frente
// porque é o campo que descarta mais linhas — o que o sino conta é justamente
// o que sobrou.
eventSchema.index({ usuarioId: 1, ativo: 1, concluido: 1, data: 1 });
// A linha do tempo do processo (Parte 5) e o filtro por processo do calendário.
eventSchema.index({ usuarioId: 1, processoId: 1, data: 1 });

const Event = mongoose.model("Event", eventSchema);

export default Event;
