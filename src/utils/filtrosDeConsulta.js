import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// GUARDAS DE TIPO NOS FILTROS DE QUERY STRING (achado #3 — Fase 4.5)
//
// ── O que a Fase 4.5 MEDIU antes de corrigir ──────────────────────────────
// Contra a base do seed, com o servidor de pé:
//
//     GET /api/secoes?tipo=clausula        → total 3    (o filtro funciona)
//     GET /api/secoes?tipo[$ne]=clausula   → total 11   (o operador foi IGNORADO)
//
// Ou seja: **não havia injeção ativa**. O Express 5 usa o query parser
// "simple" por padrão, que não monta objeto aninhado — `tipo[$ne]` chega como
// uma CHAVE LITERAL de nome `"tipo[$ne]"`, e `req.query.tipo` fica `undefined`.
// O filtro é descartado, não interpretado.
//
// ── Então por que corrigir ────────────────────────────────────────────────
// Porque a proteção é do FRAMEWORK, não do código. Uma linha
// `app.set("query parser", "extended")` — que alguém acrescenta no dia em que
// precisar de um filtro aninhado legítimo — devolve o objeto aninhado e
// transforma os quatro filtros em injeção de operador de uma vez, sem que
// nenhum teste existente caia. Depender de um default para não vazar dado de
// outro usuário é apostar que ninguém vai mexer numa linha de configuração.
//
// A guarda é a mesma dos dois lados: só string entra na query; id só entra se
// for ObjectId válido. Valor não-string é DESCARTADO em silêncio (o filtro
// simplesmente não se aplica), e não vira 400: filtro de listagem é
// conveniência, e derrubar a tela inteira porque um parâmetro veio torto seria
// pior que ignorá-lo — que é, aliás, o que já acontece hoje.
// ═══════════════════════════════════════════════════════════════════════════

// Devolve a string quando o valor é string não-vazia; senão `undefined`.
export const filtroTexto = (valor) => {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : undefined;
};

// Devolve o id quando é string e ObjectId válido; senão `undefined`.
//
// A checagem de `typeof` vem ANTES de `isValid`: `isValid` aceita coisas que
// não são string (um objeto de 12 bytes, por exemplo), e é justamente um objeto
// que a injeção de operador entregaria.
export const filtroObjectId = (valor) => {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  if (!mongoose.Types.ObjectId.isValid(limpo)) return undefined;
  return limpo;
};

export default { filtroTexto, filtroObjectId };
