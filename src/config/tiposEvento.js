// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DE EVENTO — PROVISÓRIO, PENDENTE DE RATIFICAÇÃO DA LAÍS (F-3)
//
// ── O que este vocabulário É ─────────────────────────────────────────────
// Quatro valores: audiência, prazo, reunião, outro. Eles saíram do enunciado
// da fase, **não da advogada**, e por isso nascem marcados — do mesmo modo que
// a DEC-039 marcou o tipo de honorário e a DEC-054 marcou o nome da primeira
// fase processual.
//
// A marca não é formalidade. Vocabulário jurídico é da prática de quem
// advoga, e este projeto já aprendeu, na F-2d, que um enum inventado por nós
// (`status`: ativo/encerrado/suspenso) sobrevive fases inteiras parecendo
// decidido — até alguém perguntar e descobrir que ele não responde à pergunta
// que a advogada faz.
//
// ── O que já se sabe que pode faltar, e não foi inventado ────────────────
// "Perícia", "diligência", "despacho", "sustentação oral" são candidatos
// óbvios de quem lê a lista, e nenhum entrou. Acrescentar é uma linha aqui.
// O que NÃO se faz é adivinhar a lista dela e depois migrar dado gravado sob
// um valor que ela nunca usou.
//
// ── Valor gravado ≠ rótulo de exibição ──────────────────────────────────
// Mesma separação da DEC-039, pela mesma razão: o valor vai para o banco e
// para a query string (minúsculo, sem acento, estável); o rótulo é o que ela
// lê e pode ser reescrito sem migração nenhuma. Se ela disser "audiência" de
// outro jeito, muda-se o rótulo e nada no banco se move.
//
// ── "prazo" NÃO é prazo processual calculado ────────────────────────────
// O valor `prazo` marca uma DATA QUE A ADVOGADA DIGITOU. Ele não conta dias
// úteis, não conhece suspensão forense e não sabe de feriado — contagem de
// prazo processual está explicitamente FORA desta fase (Parte 0), porque exige
// tabela de feriados e regra por tribunal.
//
// Está escrito aqui, e não só no CLAUDE.md, porque é deste arquivo que a
// pergunta "então o sistema calcula o prazo?" vai nascer.
//
// ── Espelho no frontend ─────────────────────────────────────────────────
// `lex-frontend/src/utils/enums.js` repete esta lista, sem endpoint, pela
// mesma razão do tipo de honorário: é constante, não dado. Há teste nos dois
// repos travando que as listas não divergiram.
// ═══════════════════════════════════════════════════════════════════════════

// A ordem é de EXIBIÇÃO, e não de importância nem de precedência. "outro" fica
// por último porque é o escape da lista, não porque valha menos.
export const TIPOS_EVENTO_CATALOGO = Object.freeze([
  Object.freeze({
    valor: "audiencia",
    rotulo: "Audiência",
    descricao: "Ato designado pelo juízo, com hora marcada."
  }),
  Object.freeze({
    valor: "prazo",
    rotulo: "Prazo",
    descricao:
      "Data-limite anotada pela advogada. O sistema NÃO a calcula — " +
      "contagem de prazo processual está fora do escopo desta fase."
  }),
  Object.freeze({
    valor: "reuniao",
    rotulo: "Reunião",
    descricao: "Encontro com cliente ou terceiro. Pode não ter processo."
  }),
  Object.freeze({
    valor: "outro",
    rotulo: "Outro",
    descricao: "O que não couber nos três acima, enquanto a lista não é ratificada."
  })
]);

export const TIPOS_EVENTO = Object.freeze(TIPOS_EVENTO_CATALOGO.map((t) => t.valor));

const POR_VALOR = Object.freeze(
  Object.fromEntries(TIPOS_EVENTO_CATALOGO.map((t) => [t.valor, t]))
);

// Cai no próprio valor se alguém acrescentar um tipo sem passar por aqui —
// degradação legível, e não `undefined` no meio de uma frase.
export const rotuloDoTipoDeEvento = (valor) =>
  POR_VALOR[valor]?.rotulo ?? String(valor ?? "");

export default {
  TIPOS_EVENTO_CATALOGO,
  TIPOS_EVENTO,
  rotuloDoTipoDeEvento
};
