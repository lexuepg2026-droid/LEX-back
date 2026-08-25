// ═══════════════════════════════════════════════════════════════════════════
// DEC-056 — A LINHA DO TEMPO É APRESENTAÇÃO, NÃO COLETA (F-3, Parte 5)
//
// > A Laís pediu: *"finalizado por etapa (fazer linha do tempo)"*.
//
// ── O substrato JÁ EXISTE, e isso é o ponto ────────────────────────────
// A DEC-054 (F-2d) começou a gravar toda transição de fase com de→para, data e
// autor — **antes** de existir tela para mostrá-las, e de propósito. A nota de
// `historicoFaseSchema.js` diz por quê: gravar só a partir de quando a tela
// existir faria a linha do tempo NASCER SEM PASSADO, com todo processo
// parecendo nunca ter mudado de fase até o dia da implementação.
//
// Esta parte, portanto, **não coleta nada**. Não há campo novo, não há
// histórico novo, não há gravação em lugar nenhum deste arquivo. Ele LÊ o que
// a F-2d já guardou e ordena.
//
// ── O FINANCEIRO NÃO ENTRA, e a exclusão é a decisão ──────────────────
// Nem honorário, nem parcela, nem pagamento, nem estorno, nem reparcelamento.
//
// O extrato do honorário responde outra pergunta — "quanto foi cobrado, quanto
// entrou, e o que voltou" — e já a responde bem, com a DEC-044 marcando toda
// linha que deixou de valer. Misturar as duas faria uma tela que não responde
// nenhuma: a sequência de fases de um processo de dois anos tem cinco entradas,
// e o extrato de um honorário parcelado em doze tem quarenta. O que a advogada
// veio ver aqui ficaria soterrado pelo que ela veio ver em outro lugar.
//
// Há teste travando a ausência, e ele é o que impede a próxima fase de
// "completar" a linha do tempo sem decisão.
//
// ── O que ENTRA, e por que cada coisa ────────────────────────────────
//   `fase`         a transição de→para, com o motivo QUANDO HOUVER. É o
//                  substrato da DEC-054, e é o que ela pediu.
//   `encerramento` o trânsito em julgado, com o motivo. É o outro EIXO da
//                  DEC-054, e a linha do tempo é onde os dois eixos se
//                  encontram: onde o processo andou, e onde ele parou.
//   `liminar`      a marcação, com a data e a observação. Ela disse que é
//                  "um plus dentro das fases" — e um plus tem um momento.
//   `evento`       os eventos do processo, PASSADOS E FUTUROS.
//
// ── Os FUTUROS entram, e ficam visivelmente à frente do "hoje" ───────
// Uma linha do tempo que parasse em hoje seria um histórico, e histórico já
// existe. O que ela pediu — "finalizado por etapa" — é ver o processo inteiro:
// o que já aconteceu e o que está marcado para acontecer.
//
// O corte entre os dois vai na resposta (`futuro: true/false`, mais o `hoje`
// do servidor), e não é deixado para a tela calcular: o navegador não sabe o
// "hoje" do servidor, e um relógio atrasado poria uma audiência de amanhã do
// lado errado da linha.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";

import Process from "../models/Process.js";
import Event from "../models/Event.js";
import { rotuloDaFase } from "../config/fasesProcesso.js";
import { rotuloDoTipoDeEvento } from "../config/tiposEvento.js";
import {
  escreverDataDeCalendario,
  hojeComoDataDeCalendario
} from "../utils/dataDeCalendario.js";

const erro = (status, message) => {
  const error = new Error(message);
  error.statusCode = status;
  return error;
};

// ── Os tipos de entrada, num lugar só ────────────────────────────────────
//
// A tela precisa distinguir os quatro para escolher ícone e cor. O
// discriminador é explícito e de primeiro nível, pela mesma razão da `natureza`
// da DEC-055: uma tela que tivesse de INFERIR o tipo inferiria errado no dia em
// que um quinto entrasse.
export const TIPOS_DA_LINHA = Object.freeze(["fase", "encerramento", "liminar", "evento"]);

// ── A data de cada entrada, e a assimetria que ela carrega ───────────────
//
// A transição de fase, o encerramento e a liminar são INSTANTES — carimbos de
// quando alguém registrou o fato, como `createdAt`. O evento é uma DATA DE
// CALENDÁRIO — a casa em que a audiência cai.
//
// Os dois viajam como `AAAA-MM-DD` para a ORDENAÇÃO e para o corte de "hoje"
// funcionarem sobre a mesma escala: comparar um instante com uma casa de
// calendário exigiria escolher um fuso, e é essa escolha que desloca dias.
//
// O instante original vai junto, em `instante`, para a tela poder mostrar a
// HORA de uma mudança de fase — que é informação real, e que a data de
// calendário sozinha perderia.
const entradaDeFase = (transicao) => ({
  tipo: "fase",
  data: escreverDataDeCalendario(transicao.data),
  instante: transicao.data ? new Date(transicao.data).toISOString() : null,
  de: transicao.de ?? null,
  para: transicao.para,
  // Os rótulos saem PRONTOS, do ponto único. Nenhuma tela monta rótulo de fase
  // por conta própria — é a mesma regra que a DEC-054 já aplicou.
  deRotulo: transicao.de ? rotuloDaFase(transicao.de) : null,
  paraRotulo: rotuloDaFase(transicao.para),
  // `null` quando ela não quis anotar. *"Não precisa anotar o porquê, só se ela
  // quiser mesmo"* — o motivo é opcional em toda a cadeia, e a linha do tempo é
  // o último elo dela.
  motivo: transicao.motivo ?? null,
  // `de: null` é o NASCIMENTO. Sem essa marca, um processo criado direto em
  // "execução" apareceria como se sempre tivesse estado lá, e não haveria como
  // distinguir "nasceu assim" de "nunca mudou".
  nascimento: !transicao.de
});

export const montarLinhaDoTempo = (processo, eventos, hoje) => {
  const entradas = [];

  for (const transicao of processo.historicoFase ?? []) {
    entradas.push(entradaDeFase(transicao));
  }

  // O encerramento — o OUTRO eixo da DEC-054. Não é a quinta fase, e por isso
  // não é uma entrada de `fase`: um processo transitado em julgado continua
  // tendo a fase em que parou, e representá-lo como transição apagaria isso.
  if (processo.transitoEmJulgadoEm) {
    entradas.push({
      tipo: "encerramento",
      data: escreverDataDeCalendario(processo.transitoEmJulgadoEm),
      instante: new Date(processo.transitoEmJulgadoEm).toISOString(),
      // Campo livre, e não enum: *"acordo cumprido"* é UM caminho, e a prática
      // dela certamente tem outros.
      motivo: processo.motivoEncerramento ?? null
    });
  }

  // A liminar. Entra só quando há DATA: `liminar: true` sem `liminarEm` é um
  // sinalizador sem momento, e uma linha do tempo não tem onde pô-lo.
  //
  // Ele continua aparecendo como SELO no cabeçalho da tela (DEC-054), que é
  // onde um sinalizador sem data pertence — e é por isso que omiti-lo aqui não
  // perde informação nenhuma.
  if (processo.liminar && processo.liminarEm) {
    entradas.push({
      tipo: "liminar",
      data: escreverDataDeCalendario(processo.liminarEm),
      instante: new Date(processo.liminarEm).toISOString(),
      observacao: processo.liminarObservacao ?? null
    });
  }

  for (const evento of eventos) {
    entradas.push({
      tipo: "evento",
      data: evento.data,
      // O evento NÃO tem instante: ele é uma casa do calendário, não um ponto
      // na linha do tempo. `null` explícito, e não a chave ausente — a forma
      // uniforme é o que permite à tela ler `instante` sem testar o tipo antes.
      instante: null,
      _id: evento._id,
      titulo: evento.titulo,
      tipoEvento: evento.tipo,
      tipoEventoRotulo: rotuloDoTipoDeEvento(evento.tipo),
      hora: evento.hora ?? null,
      local: evento.local ?? null,
      concluido: Boolean(evento.concluido)
    });
  }

  // ── A ORDEM, e o desempate ─────────────────────────────────────────────
  //
  // Por data, crescente — é a ordem em que os fatos aconteceram, e é a única
  // ordem que uma linha do tempo pode ter.
  //
  // No mesmo dia, o desempate é pelo INSTANTE quando os dois têm um; quando um
  // não tem (o evento), ele vai DEPOIS. A razão é substantiva: a mudança de
  // fase registrada hoje às 10h é um fato consumado, e a audiência marcada para
  // hoje pode ainda não ter acontecido. Pôr o que talvez não tenha ocorrido
  // antes do que certamente ocorreu inverteria a leitura no único dia em que
  // ela importa.
  entradas.sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    if (a.instante && b.instante) return a.instante < b.instante ? -1 : 1;
    if (a.instante) return -1;
    if (b.instante) return 1;
    return String(a.titulo ?? "").localeCompare(String(b.titulo ?? ""), "pt-BR");
  });

  // O corte do "hoje", calculado AQUI e não na tela. Comparação de string
  // `AAAA-MM-DD`, cuja ordem lexicográfica é a cronológica — a comparação que
  // não tem fuso para errar.
  return entradas.map((entrada) => ({ ...entrada, futuro: entrada.data > hoje }));
};

export const lerLinhaDoTempo = async (usuarioId, processoId) => {
  if (!mongoose.Types.ObjectId.isValid(processoId)) {
    throw erro(400, "processoId inválido");
  }

  // `ativo: true`, como toda leitura do projeto. Um processo desativado não é
  // alcançável por esta rota — e a tela que a chama é a do processo, que já
  // responde 404 antes de chegar aqui.
  const processo = await Process.findOne({ _id: processoId, usuarioId, ativo: true }).select(
    "titulo numeroProcesso fase historicoFase transitoEmJulgadoEm motivoEncerramento " +
    "liminar liminarObservacao liminarEm"
  );

  if (!processo) throw erro(404, "Processo não encontrado");

  const eventos = await Event.find({ usuarioId, processoId, ativo: true }).sort({
    data: 1,
    hora: 1
  });

  const hoje = hojeComoDataDeCalendario();

  const entradas = montarLinhaDoTempo(
    processo,
    eventos.map((e) => ({
      _id: String(e._id),
      titulo: e.titulo,
      tipo: e.tipo,
      data: escreverDataDeCalendario(e.data),
      hora: e.hora ?? null,
      local: e.local ?? null,
      concluido: Boolean(e.concluido)
    })),
    hoje
  );

  return {
    processoId: String(processo._id),
    hoje,
    // A fase ATUAL vai junto porque a linha do tempo termina no presente, e a
    // última transição nem sempre é a resposta: um processo sem transição
    // nenhuma no histórico (dado migrado) ainda tem uma fase.
    faseAtual: processo.fase,
    faseAtualRotulo: rotuloDaFase(processo.fase),
    entradas
  };
};

export default { lerLinhaDoTempo, montarLinhaDoTempo, TIPOS_DA_LINHA };
