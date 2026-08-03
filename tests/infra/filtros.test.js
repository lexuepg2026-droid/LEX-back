// ═══════════════════════════════════════════════════════════════════════════
// GUARDAS DE TIPO NOS FILTROS DE QUERY STRING (achado #3 — Fase 4.5)
//
// ── A medição que antecedeu a correção, e a premissa que ela corrigiu ─────
// O achado descrevia "filtros nus" como injeção de operador. Medido contra o
// servidor real, ANTES de tocar no código:
//
//     GET /api/secoes?tipo=clausula        → total 3    (o filtro funciona)
//     GET /api/secoes?tipo[$ne]=clausula   → total 11   (o operador foi IGNORADO)
//
// **Não havia injeção ativa.** O Express 5 usa o query parser `simple`, que não
// monta objeto aninhado: `tipo[$ne]` chega como uma CHAVE LITERAL chamada
// `"tipo[$ne]"` e `req.query.tipo` fica `undefined`. O filtro é descartado.
//
// ── Então o que este arquivo protege ──────────────────────────────────────
// A proteção era do FRAMEWORK, não do código. Uma linha
// `app.set("query parser", "extended")` — que alguém acrescenta no dia em que
// precisar de um filtro aninhado legítimo — devolveria o objeto e transformaria
// os quatro filtros em injeção de uma vez, sem nenhum teste cair.
//
// Por isso o arquivo tem DUAS metades:
//   1. o comportamento observável pela API (o operador não altera o resultado);
//   2. a guarda em si, exercitada como função pura — que continua valendo
//      mesmo que o parser mude, e é a única metade que a mudança de parser não
//      pode enganar.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarSecao, criarModelo, esperado
} from "../helpers/setup.js";
import { filtroTexto, filtroObjectId } from "../../src/utils/filtrosDeConsulta.js";

describe("guardas de tipo nos filtros de listagem", () => {
  let api, processo, parcela;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("filtros");
    const pf = await criarClientePF(api);
    processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
    const honorario = await criarHonorario(api, processo._id);
    parcela = await criarParcela(api, honorario._id, 1);
    await criarPagamento(api, parcela._id);

    // Duas seções de tipos diferentes: sem isso o teste discriminante não
    // discrimina — `$ne` sobre um conjunto homogêneo devolve o mesmo total que
    // filtro nenhum, e o teste passaria com a guarda desligada.
    await criarSecao(api, { titulo: `Cláusula ${Date.now()}`, tipo: "clausula" });
    await criarSecao(api, { titulo: `Objeto ${Date.now()}`, tipo: "objeto" });
    await criarModelo(api);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const totalDe = async (rota) =>
    esperado(await api.get(rota), 200, `listagem ${rota}`).total;

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — O teste DISCRIMINANTE: o filtro legítimo funciona
  //
  // Sem esta asserção, tudo abaixo passaria com os filtros quebrados.
  // ═════════════════════════════════════════════════════════════════════════
  test("os filtros legítimos continuam filtrando", async () => {
    const todas = await totalDe("/secoes");
    const clausulas = await totalDe("/secoes?tipo=clausula");

    assert.ok(todas >= 2, "arranjo: ao menos duas seções");
    assert.equal(clausulas, 1, "o filtro por tipo precisa filtrar de verdade");
    assert.notEqual(clausulas, todas, "se filtrar devolvesse tudo, o teste abaixo não valeria nada");

    const doProcesso = await totalDe(`/fees?processoId=${processo._id}`);
    assert.equal(doProcesso, 1, "o filtro por processoId precisa filtrar");

    const daParcela = await totalDe(`/payments?installmentId=${parcela._id}`);
    assert.equal(daParcela, 1, "o filtro por installmentId precisa filtrar");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — O operador não é interpretado nas quatro rotas
  // ═════════════════════════════════════════════════════════════════════════
  test("`?campo[$ne]=` não é interpretado como operador nas quatro rotas", async () => {
    const casos = [
      ["/secoes", "tipo", "clausula"],
      ["/documents", "processoId", String(processo._id)],
      ["/fees", "processoId", String(processo._id)],
      ["/payments", "installmentId", String(parcela._id)]
    ];

    for (const [rota, campo, valor] of casos) {
      const semFiltro = await totalDe(rota);
      const comOperador = await totalDe(`${rota}?${campo}[$ne]=${valor}`);

      assert.equal(
        comOperador, semFiltro,
        `${rota}: o operador foi INTERPRETADO — o total mudou de ${semFiltro} para ${comOperador}. ` +
        "É injeção de operador: o filtro passou a excluir registros em vez de ser descartado."
      );
    }
  });

  test("valor com `$` ou objeto não derruba a listagem — é descartado", async () => {
    // Filtro torto não vira 400: listagem é conveniência, e derrubar a tela
    // inteira porque um parâmetro veio errado é pior que ignorá-lo.
    for (const sufixo of ["?tipo[$gt]=", "?tipo=%7B%22%24ne%22%3A%22x%22%7D", "?tipo[]=a&tipo[]=b"]) {
      const r = await api.get(`/secoes${sufixo}`);
      assert.equal(r.status, 200, `/secoes${sufixo} deveria responder 200 e ignorar o filtro`);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — A guarda como função pura
  //
  // Esta metade é a que sobrevive a uma troca de `query parser`: ela não
  // depende de como o Express entrega o valor, só do que a guarda faz com ele.
  // ═════════════════════════════════════════════════════════════════════════
  test("filtroTexto só deixa passar string não-vazia", () => {
    assert.equal(filtroTexto("clausula"), "clausula");
    assert.equal(filtroTexto("  clausula  "), "clausula", "apara as bordas");

    for (const hostil of [{ $ne: "x" }, ["a", "b"], 42, true, null, undefined, "", "   "]) {
      assert.equal(
        filtroTexto(hostil), undefined,
        `${JSON.stringify(hostil)} não pode virar filtro`
      );
    }
  });

  test("filtroObjectId só deixa passar ObjectId em string", () => {
    const valido = String(processo._id);
    assert.equal(filtroObjectId(valido), valido);

    for (const hostil of [{ $ne: "x" }, ["a"], null, undefined, "", "nao-e-objectid", 42]) {
      assert.equal(
        filtroObjectId(hostil), undefined,
        `${JSON.stringify(hostil)} não pode virar filtro de id`
      );
    }
  });

  test("filtroObjectId recusa objeto de 12 bytes, que `isValid` aceitaria", () => {
    // `mongoose.Types.ObjectId.isValid` devolve true para qualquer string de 12
    // caracteres e para Buffers — por isso o `typeof` vem ANTES dele na guarda.
    // Um objeto de 12 bytes é exatamente o que a injeção entregaria.
    assert.equal(filtroObjectId(Buffer.from("123456789012")), undefined);
    assert.equal(filtroObjectId({ length: 12 }), undefined);
  });
});
