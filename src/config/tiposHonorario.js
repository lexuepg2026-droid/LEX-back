// ═══════════════════════════════════════════════════════════════════════════
// DEC-039 (PROVISÓRIA) — vocabulário de tipo de honorário, centralizado
//
// ── Por que existe ────────────────────────────────────────────────────────
// Os três valores nasceram na Fase 1 e nunca foram conferidos com a advogada.
// O CLAUDE.md registra a dúvida desde a 4.6: "custas" é despesa processual e
// pode não ser honorário; "êxito" e "sucumbência" podem ser tipos que faltam.
//
// **Esta fase NÃO acrescenta tipo nenhum.** O enum fica congelado como está. O
// que muda é o LUGAR: valor gravado e rótulo de exibição passam a morar num
// arquivo só, de modo que ratificar a lista com a Laís vire acrescentar uma
// linha aqui — e não caçar strings em seis arquivos.
//
// ── Valor gravado ≠ rótulo de exibição ────────────────────────────────────
// O valor é o que vai para o banco e para a query string: minúsculo, sem
// acento, estável. O rótulo é o que a advogada lê, e pode ser reescrito sem
// migração nenhuma. Misturar os dois é o que faz um `enum` virar refém da
// redação — renomear "custas" para "Custas processuais" na tela quebraria
// todo documento gravado se fossem a mesma string.
//
// `ROTULO_TIPO` do `models/Fee.js` já vivia separado por essa razão, mas só
// para a mensagem de erro do hook. Agora é um só, e o model importa daqui.
//
// ── Espelho no frontend ───────────────────────────────────────────────────
// `lex-frontend/src/utils/enums.js` repete esta lista, de propósito e sem
// endpoint: é constante, não dado. Uma rota `/tipos-honorario` custaria uma
// viagem de rede em toda carga de formulário para entregar três strings que
// não mudam entre deploys. O preço é a duplicação — e há teste nos dois repos
// travando que as listas não divergiram.
// ═══════════════════════════════════════════════════════════════════════════

// Fonte única. Ordem = ordem de exibição no <select>.
export const TIPOS_HONORARIO_CATALOGO = Object.freeze([
  Object.freeze({
    valor: "fixo",
    rotulo: "Fixo",
    descricao: "Valor combinado em reais, digitado pela advogada."
  }),
  Object.freeze({
    valor: "percentual",
    rotulo: "Percentual",
    descricao: "Percentual sobre um valor base. O valor é calculado, não digitado."
  }),
  Object.freeze({
    valor: "custas",
    rotulo: "Custas processuais",
    descricao: "Despesa processual repassada. PENDENTE de ratificação — pode não ser honorário."
  })
]);

// Os valores gravados, na forma que `enum` do Mongoose e as validações usam.
export const TIPOS_HONORARIO = Object.freeze(
  TIPOS_HONORARIO_CATALOGO.map((t) => t.valor)
);

// O único tipo que implica percentagem. Isolado porque vários arquivos
// precisam da mesma resposta para "este tipo admite percentual?".
export const TIPO_PERCENTUAL = "percentual";

const POR_VALOR = Object.freeze(
  Object.fromEntries(TIPOS_HONORARIO_CATALOGO.map((t) => [t.valor, t]))
);

// Rótulo para a advogada ler. Cai no próprio valor se alguém acrescentar um
// tipo ao enum sem passar por aqui — degradação legível, não `undefined` na
// mensagem de erro.
export const rotuloDoTipo = (valor) => POR_VALOR[valor]?.rotulo ?? String(valor ?? "");

export default {
  TIPOS_HONORARIO_CATALOGO,
  TIPOS_HONORARIO,
  TIPO_PERCENTUAL,
  rotuloDoTipo
};
