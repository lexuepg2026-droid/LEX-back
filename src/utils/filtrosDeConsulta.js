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

// ═══════════════════════════════════════════════════════════════════════════
// O PAR DE PERÍODO `de` / `ate` (Fase F-1b.3)
//
// ── Por que o recorte é em UTC, e não no fuso local do servidor ───────────
// O enunciado desta fase pediu "interpretação em fuso local, o mesmo
// tratamento que o resumo do dashboard já usa para `mesReferencia`". Medido
// no código, o resumo faz o CONTRÁRIO do que o enunciado supõe: ele recorta o
// mês em UTC (`Date.UTC(ano, mes, 1)`), e o comentário de lá diz por quê —
// `dataVencimento` e `dataPagamento` são datas SEM hora, chegam como
// `"2026-08-31"`, o Mongoose as grava em meia-noite UTC e o frontend as
// renderiza com `timeZone: "UTC"`.
//
// Recortar em fuso local devolveria, num servidor a oeste de Greenwich, uma
// parcela de 01/09 dentro de um filtro `ate=2026-08-31` — porque 01/09T00:00Z
// é 31/08 às 21h em Brasília. A data é gravada, exibida e agora filtrada no
// mesmo fuso; é essa coerência, e não o fuso em si, que faz o filtro devolver
// o que a linha da tabela mostra.
//
// Então: **adotado UTC**, que é o que o dashboard de fato faz. A divergência
// está declarada no relatório da fase.
//
// ── As bordas são INCLUSIVAS ─────────────────────────────────────────────
// `de` vira 00:00:00.000Z do dia; `ate` vira 23:59:59.999Z do MESMO dia. Um
// `ate` em meia-noite excluiria o dia inteiro que a pessoa acabou de digitar —
// e "de 01/06 a 10/06" que não mostra o pagamento de 10/06 é o tipo de recorte
// que faz alguém concluir que o lançamento sumiu.
//
// Um sem o outro é período aberto de um lado: só `de` é "daqui em diante", só
// `ate` é "até aqui".
// ═══════════════════════════════════════════════════════════════════════════

const AAAA_MM_DD = /^(\d{4})-(\d{2})-(\d{2})$/;

// Converte `"2026-06-10"` no instante UTC pedido. Ausente ⇒ `undefined` (sem
// borda). Presente e inválido ⇒ 400 com `campo`, no mesmo padrão do id: data
// torta significa que a tela montou uma URL errada, e adivinhar um dia
// devolveria um recorte que ninguém pediu.
//
// A checagem de `typeof` vem antes de tudo pelo mesmo motivo de
// `filtroObjectId`: um valor não-string é o que a injeção de operador
// entregaria, e `new Date({...})` não recusa nada de forma útil.
export const filtroDataExigida = (valor, campo, { fimDoDia = false } = {}) => {
  if (valor === undefined || valor === null) return undefined;

  if (typeof valor !== "string") {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser uma data no formato AAAA-MM-DD.`);
  }

  const limpo = valor.trim();
  if (limpo === "") return undefined;

  const partes = AAAA_MM_DD.exec(limpo);
  if (!partes) {
    throw erroDeFiltro(campo, `O filtro "${campo}" precisa ser uma data no formato AAAA-MM-DD.`);
  }

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  // `Date.UTC` normaliza silenciosamente: 2026-02-31 vira 03/03. A volta pelo
  // `getUTC*` é o que recusa a data que não existe em vez de deslizá-la —
  // filtrar por um dia que o calendário não tem e receber outro é pior que 400.
  const instante = new Date(
    Date.UTC(ano, mes - 1, dia, fimDoDia ? 23 : 0, fimDoDia ? 59 : 0, fimDoDia ? 59 : 0, fimDoDia ? 999 : 0)
  );

  const real =
    instante.getUTCFullYear() === ano &&
    instante.getUTCMonth() === mes - 1 &&
    instante.getUTCDate() === dia;

  if (!real) {
    throw erroDeFiltro(campo, `O filtro "${campo}" não é uma data existente.`);
  }

  return instante;
};

// O par completo, já no formato que o Mongo espera (`{ $gte, $lte }`), ou
// `undefined` quando nenhuma das duas bordas veio — filtro ausente não filtra.
//
// `de` posterior a `ate` é 400 e não lista vazia: uma lista vazia para um
// período impossível é indistinguível de "não há lançamentos nesse período", e
// a pessoa procuraria o lançamento em vez de olhar as duas datas que digitou.
export const filtroPeriodo = (de, ate, { campoDe = "de", campoAte = "ate" } = {}) => {
  const inicio = filtroDataExigida(de, campoDe);
  const fim = filtroDataExigida(ate, campoAte, { fimDoDia: true });

  if (!inicio && !fim) return undefined;

  if (inicio && fim && inicio > fim) {
    throw erroDeFiltro(
      campoDe,
      `O início do período ("${campoDe}") é posterior ao fim ("${campoAte}"). ` +
      "Inverta as duas datas."
    );
  }

  const intervalo = {};
  if (inicio) intervalo.$gte = inicio;
  if (fim) intervalo.$lte = fim;
  return intervalo;
};

export default {
  filtroTexto,
  filtroObjectId,
  filtroObjectIdExigido,
  filtroDataExigida,
  filtroPeriodo
};
