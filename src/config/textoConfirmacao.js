// ═══════════════════════════════════════════════════════════════════════════
// TEXTO DA DECLARAÇÃO DE CIÊNCIA
//
// ── A decisão: o texto vem do BACKEND, nunca do cliente ───────────────────
// `POST /api/portal/confirmacoes` NÃO aceita `textoConfirmado` no corpo. O
// registro grava esta constante, copiada no momento.
//
// Se o texto viesse do cliente, o recibo passaria a afirmar o que o navegador
// mandou — e um portal desatualizado, um bug de tela ou alguém com o cookie na
// mão gravaria "declaro que li" com qualquer redação, inclusive uma que não
// diz nada. O recibo tem de registrar o que o SISTEMA apresentou, porque é o
// sistema que a advogada vai citar quando precisar sustentá-lo.
//
// O portal exibe exatamente este texto, buscado em
// `GET /api/portal/confirmacoes/texto`. Assim a tela e o registro não podem
// divergir: os dois saem daqui.
//
// ── E por que ele é COPIADO para dentro de cada registro ──────────────────
// Guardar só a versão, ou só uma referência a este arquivo, faria o recibo de
// 2026 mudar de sentido quando alguém reescrevesse a constante em 2027 — o
// registro passaria a afirmar algo que aquela pessoa nunca leu. Por isso
// `ConfirmacaoVisualizacao.textoConfirmado` guarda a string inteira.
//
// Mudar o texto abaixo é, portanto, seguro: os registros antigos continuam
// dizendo o que foi confirmado de fato. Suba `VERSAO_TEXTO_CONFIRMACAO` junto,
// para a origem de cada registro continuar rastreável.
// ═══════════════════════════════════════════════════════════════════════════

export const VERSAO_TEXTO_CONFIRMACAO = "1";

export const TEXTO_CONFIRMACAO =
  "Declaro que acessei o portal e tomei ciência das informações e dos " +
  "documentos disponibilizados pelo escritório sobre este processo nesta data.";

export default TEXTO_CONFIRMACAO;
