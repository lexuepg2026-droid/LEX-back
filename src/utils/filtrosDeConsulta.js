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
// transforma os filtros em injeção de operador de uma vez, sem que nenhum
// teste existente caia. Depender de um default para não vazar dado de outro
// usuário é apostar que ninguém vai mexer numa linha de configuração.
//
// ── O que a Fase F-0 acrescentou ──────────────────────────────────────────
// A 4.5 aplicou a guarda em QUATRO filtros. Os outros oito repetiam a regra à
// mão (`typeof x === "string"`) ou não tinham guarda nenhuma, e dois deles
// chamavam `ObjectId.isValid` ANTES do `typeof` — exatamente a ordem que o
// comentário de `filtroObjectId` existe para proibir. A auditoria de retomada
// mediu a consequência: o MESMO parâmetro inválido tinha quatro
// comportamentos diferentes.
//
//     GET /documents?processoId=xyz     → 200, total 19  (filtro descartado)
//     GET /fees?processoId=xyz          → 200, total 12  (idem)
//     GET /installments?processoId=xyz  → 200, total 0   (lista vazia)
//     GET /payments?processoId=xyz      → 200, total 0   (idem)
//
// Os dois primeiros são o pior: um id torto vindo da tela mostra a base
// INTEIRA no lugar do recorte pedido, e nada na resposta diz que o filtro não
// foi aplicado. Os dois últimos mentem ao contrário — "não há nada aqui".
//
// **MUDANÇA DE CONTRATO DELIBERADA (Fase F-0):** id malformado agora responde
// **400 com `campo`**, nos quatro módulos. É erro do chamador, e a única
// resposta honesta é dizer qual campo veio errado — as outras três alternativas
// (ignorar, esvaziar, adivinhar) inventam um resultado para uma pergunta que
// não foi feita direito. Filtro AUSENTE continua sendo "sem filtro"; o 400 é
// só para o que foi enviado e não serve.
// ═══════════════════════════════════════════════════════════════════════════

const erroDeFiltro = (campo, mensagem) => {
  const error = new Error(mensagem);
  error.statusCode = 400;
  error.campo = campo;
  return error;
};

// Devolve a string quando o valor é string não-vazia; senão `undefined`.
//
// Texto NÃO vira 400: `?busca=` vazio, ou um valor torto num campo de busca, é
// conveniência de listagem, e derrubar a tela porque o termo veio estranho
// seria pior que ignorá-lo. A assimetria com o id é proposital — um id
// malformado significa que a tela montou uma URL errada; um texto estranho
// significa que alguém digitou algo estranho.
export const filtroTexto = (valor) => {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : undefined;
};

// Devolve o id quando é string e ObjectId válido; senão `undefined`.
//
// A checagem de `typeof` vem ANTES de `isValid`: `isValid` aceita coisas que
// não são string (um Buffer de 12 bytes, por exemplo), e é justamente um valor
// não-string que a injeção de operador entregaria.
export const filtroObjectId = (valor) => {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  if (!mongoose.Types.ObjectId.isValid(limpo)) return undefined;
  return limpo;
};

// A versão que RECUSA em vez de descartar (Fase F-0). Ausente ⇒ `undefined`
// (sem filtro). Presente e inválido ⇒ lança 400 com `campo`.
//
// `campo` é o nome do parâmetro na query string, e não um nome interno: é o
// que a tela precisa para saber qual input ou qual link montou a URL errada.
export const filtroObjectIdExigido = (valor, campo) => {
  if (valor === undefined || valor === null) return undefined;

  if (typeof valor !== "string") {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser um id válido.`);
  }

  const limpo = valor.trim();
  if (limpo === "") return undefined;

  if (!mongoose.Types.ObjectId.isValid(limpo)) {
    throw erroDeFiltro(campo, `O filtro "${campo}" não é um id válido.`);
  }

  return limpo;
};

export default { filtroTexto, filtroObjectId, filtroObjectIdExigido };
