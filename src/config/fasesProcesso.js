// ═══════════════════════════════════════════════════════════════════════════
// DEC-054 — FASE PROCESSUAL E ENCERRAMENTO SÃO EIXOS SEPARADOS
//
// ── De onde vem o vocabulário ────────────────────────────────────────────
// Da Laís, em 23/08/2026, textualmente:
//
//   "Fase inicial (fase de conhecimento) / Sentença / Execução / Recursos"
//   "Sim, pode voltar"
//   "Não precisa anotar o porquê, só se ela quiser mesmo"
//   "Liminar é um plus dentro das fases, você pede algo com urgência, mas não
//    é uma fase nova"
//   "Trânsito em julgado — processo encerrou completamente, acabou todos os
//    processos de recurso"
//   "Acordo cumprido — aí o processo finalizado e muda para trânsito em
//    julgado"
//
// ── A leitura: ela descreveu DUAS coisas, não uma ────────────────────────
// **Fase processual** — onde o processo está: conhecimento → sentença →
// execução → recursos. Anda nos DOIS sentidos.
//
// **Encerramento** — se acabou: o trânsito em julgado. **Não é a quinta
// fase**, é outro eixo. Um processo em recursos e um processo transitado não
// estão em pontos diferentes da mesma régua: um está andando, o outro parou.
//
// Modelar as duas como um enum só faria "trânsito em julgado" competir com
// "execução" numa lista onde elas não se comparam — e a advogada teria de
// escolher entre dizer em que fase o processo está e dizer que ele acabou.
//
// ── O nome da primeira fase: ESCOLHA REGISTRADA, PENDENTE DE RATIFICAÇÃO ──
// Ela deu DUAS palavras para a mesma coisa: "fase inicial" e "fase de
// conhecimento". Adotado **"Fase de conhecimento"**, e a razão é substantiva,
// não estética:
//
//   "inicial" é POSICIONAL, e a posição deixa de valer no instante em que o
//   processo volta. Ela disse "sim, pode voltar" — um processo que retorna de
//   recursos para a primeira fase não está numa fase "inicial" coisa nenhuma;
//   está de novo em conhecimento. O rótulo posicional mentiria justamente no
//   movimento que ela pediu.
//
//   "conhecimento" é o nome técnico da fase, e é o que a distingue das outras
//   três — que também são fases, e nenhuma delas é "inicial".
//
// **PENDENTE DE RATIFICAÇÃO DA LAÍS.** É vocabulário da prática dela. Se ela
// preferir "Fase inicial", muda-se o RÓTULO aqui e nenhuma migração acontece:
// o valor gravado é `conhecimento`, e valor gravado ≠ rótulo de exibição —
// a mesma separação da DEC-039, pela mesma razão.
//
// ── Falta alguma fase? ───────────────────────────────────────────────────
// Ela citou quatro. Não inventamos uma quinta. Se faltar (cumprimento de
// sentença como fase própria, por exemplo), acrescentar é uma linha aqui.
// Também está na lista de ratificação.
// ═══════════════════════════════════════════════════════════════════════════

// Fonte única. A ordem é a ordem em que ela as disse — que também é a ordem
// cronológica comum — e serve para EXIBIR num `<select>`.
//
// **Ordem de exibição NÃO é ordem obrigatória.** Não existe máquina de estados
// aqui: qualquer fase vai para qualquer fase, inclusive de volta. Ver
// `processService.mudarFase`, que não tem uma única comparação de ordem.
export const FASES_PROCESSO_CATALOGO = Object.freeze([
  Object.freeze({
    valor: "conhecimento",
    rotulo: "Fase de conhecimento",
    descricao:
      "Onde o processo começa e onde se produz prova. Ela chamou também de " +
      "'fase inicial' — a escolha do rótulo está pendente de ratificação."
  }),
  Object.freeze({
    valor: "sentenca",
    rotulo: "Sentença",
    descricao: "O juiz decidiu."
  }),
  Object.freeze({
    valor: "execucao",
    rotulo: "Execução",
    descricao: "Cobrança do que a decisão determinou."
  }),
  Object.freeze({
    valor: "recursos",
    rotulo: "Recursos",
    descricao: "Discussão da decisão nas instâncias superiores."
  })
]);

export const FASES_PROCESSO = Object.freeze(
  FASES_PROCESSO_CATALOGO.map((f) => f.valor)
);

// A fase em que um processo nasce, e para onde a migração manda o que não se
// sabe mapear. Não é "a primeira" por posição — é a única das quatro que não
// pressupõe que algo já aconteceu.
export const FASE_PADRAO = "conhecimento";

const POR_VALOR = Object.freeze(
  Object.fromEntries(FASES_PROCESSO_CATALOGO.map((f) => [f.valor, f]))
);

// Rótulo para a advogada ler. Cai no próprio valor se alguém acrescentar uma
// fase sem passar por aqui — degradação legível, não `undefined` na mensagem.
export const rotuloDaFase = (valor) => POR_VALOR[valor]?.rotulo ?? String(valor ?? "");

export default {
  FASES_PROCESSO_CATALOGO,
  FASES_PROCESSO,
  FASE_PADRAO,
  rotuloDaFase
};
