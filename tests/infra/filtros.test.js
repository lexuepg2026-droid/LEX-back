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
import {
  filtroTexto,
  filtroObjectId,
  filtroObjectIdExigido
} from "../../src/utils/filtrosDeConsulta.js";

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

// ═══════════════════════════════════════════════════════════════════════════
// FASE F-0 — as três divergências que a auditoria de retomada mediu
//
// Os testes acima provam que o operador não é interpretado. Não provavam nada
// sobre o que acontece com um id MALFORMADO — e era ali que os quatro módulos
// discordavam entre si:
//
//     GET /documents?processoId=xyz     → 200, total 19  (filtro descartado)
//     GET /fees?processoId=xyz          → 200, total 12  (idem)
//     GET /installments?processoId=xyz  → 200, total 0   (lista vazia)
//     GET /payments?processoId=xyz      → 200, total 0   (idem)
//
// Mais dois defeitos do mesmo `return` antecipado em `installmentService` e
// `paymentService`: a paginação era pulada, e o segundo filtro era descartado.
// ═══════════════════════════════════════════════════════════════════════════
describe("F-0: id inválido, filtros compostos e paginação", () => {
  let api, processo, honorario, parcelas = [], pagamentos = [];

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("filtros-f0");
    const pf = await criarClientePF(api);
    processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
    honorario = await criarHonorario(api, processo._id);

    // TRÊS parcelas e três pagamentos, um por parcela. O número importa: com
    // uma só, `limit=1` devolveria o mesmo que sem limite e o teste de
    // paginação passaria com o `return` antecipado de volta no lugar.
    for (let n = 1; n <= 3; n += 1) {
      const parcela = await criarParcela(api, honorario._id, n);
      parcelas.push(parcela);
      pagamentos.push(await criarPagamento(api, parcela._id));
    }
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — MUDANÇA DE CONTRATO: id malformado responde 400 com `campo`
  // ═════════════════════════════════════════════════════════════════════════
  test("id malformado → 400 com `campo`, nos QUATRO módulos", async () => {
    const casos = [
      ["/documents?processoId=xyz", "processoId"],
      ["/fees?processoId=xyz", "processoId"],
      ["/installments?processoId=xyz", "processoId"],
      ["/payments?processoId=xyz", "processoId"],
      ["/payments?installmentId=xyz", "installmentId"]
    ];

    for (const [rota, campo] of casos) {
      const r = await api.get(rota);

      assert.equal(
        r.status, 400,
        `${rota}: id malformado precisa responder 400. ` +
        "Descartar o filtro devolve a listagem INTEIRA no lugar do recorte pedido, " +
        "e devolver lista vazia afirma que o recurso não tem nada — as duas mentem."
      );
      assert.equal(
        r.body.campo, campo,
        `${rota}: o 400 precisa nomear o campo, para a tela saber qual link montou a URL errada`
      );
    }
  });

  test("filtro AUSENTE continua sendo `sem filtro`, e não 400", async () => {
    // A recusa é só para o que foi ENVIADO e não serve. `?processoId=` vazio,
    // ou parâmetro nenhum, é a listagem normal.
    for (const rota of ["/payments", "/payments?processoId=", "/installments?processoId="]) {
      const r = await api.get(rota);
      assert.equal(r.status, 200, `${rota} não pode virar 400 — não há filtro inválido aqui`);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — Os dois filtros de pagamento COMPÕEM (AND)
  //
  // O `return` antecipado ficava ANTES da linha que aplicava `installmentId`.
  // Medido na auditoria: `?processoId=X&installmentId=Y` devolvia 3 e
  // `?installmentId=Y` devolvia 1 — combinar dois filtros dava MAIS linhas.
  // ═════════════════════════════════════════════════════════════════════════
  test("`?processoId` e `?installmentId` compõem por AND", async () => {
    const total = async (rota) => esperado(await api.get(rota), 200, rota).total;

    const soProcesso = await total(`/payments?processoId=${processo._id}`);
    const soParcela = await total(`/payments?installmentId=${parcelas[0]._id}`);
    const ambos = await total(
      `/payments?processoId=${processo._id}&installmentId=${parcelas[0]._id}`
    );

    assert.equal(soProcesso, 3, "arranjo: três pagamentos no processo");
    assert.equal(soParcela, 1, "arranjo: um pagamento na primeira parcela");
    assert.equal(
      ambos, 1,
      "os dois filtros precisam compor. Dando 3, o `installmentId` foi descartado — " +
      "e combinar dois filtros teria devolvido MAIS linhas do que um só."
    );
    assert.ok(
      ambos <= soProcesso && ambos <= soParcela,
      "a interseção nunca pode ser maior que qualquer um dos conjuntos"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — Paginação nos dois caminhos que a pulavam (regra central nº 4)
  // ═════════════════════════════════════════════════════════════════════════
  test("`?processoId` respeita page/limit em parcelas e pagamentos", async () => {
    for (const rota of ["/installments", "/payments"]) {
      const pagina = esperado(
        await api.get(`${rota}?processoId=${processo._id}&limit=2&page=1`),
        200, `${rota} paginada`
      );

      assert.equal(pagina.total, 3, `${rota}: o total conta o conjunto inteiro`);
      assert.equal(pagina.limit, 2, `${rota}: o \`limit\` pedido precisa ser respeitado`);
      assert.equal(
        pagina.data.length, 2,
        `${rota}: o caminho de \`processoId\` pulava skip/limit e devolvia tudo`
      );
      assert.equal(pagina.page, 1);
      assert.equal(pagina.totalPages, 2, `${rota}: 3 itens em páginas de 2`);

      const segunda = esperado(
        await api.get(`${rota}?processoId=${processo._id}&limit=2&page=2`),
        200, `${rota} página 2`
      );
      assert.equal(segunda.data.length, 1, `${rota}: a segunda página traz o resto`);

      // A prova de que são páginas de verdade, e não a mesma lista cortada: os
      // ids não se repetem entre elas.
      const idsPrimeira = pagina.data.map((x) => String(x._id));
      const idsSegunda = segunda.data.map((x) => String(x._id));
      assert.equal(
        idsPrimeira.filter((id) => idsSegunda.includes(id)).length, 0,
        `${rota}: as duas páginas não podem repetir registro`
      );
    }
  });

  test("o teto de 100 vale também no caminho de `processoId`", async () => {
    // `limit=500` é clampado pelo controller. Sem o clamp, uma listagem por
    // processo poderia baixar a coleção inteira num pedido só.
    for (const rota of ["/installments", "/payments"]) {
      const r = esperado(
        await api.get(`${rota}?processoId=${processo._id}&limit=500`),
        200, `${rota} com limit acima do teto`
      );
      assert.ok(r.limit <= 100, `${rota}: limit devolvido (${r.limit}) precisa respeitar o teto de 100`);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4 — A guarda nova como função pura
  // ═════════════════════════════════════════════════════════════════════════
  test("filtroObjectIdExigido: ausente passa, inválido lança 400 com `campo`", () => {
    const valido = String(processo._id);
    assert.equal(filtroObjectIdExigido(valido, "processoId"), valido);
    assert.equal(filtroObjectIdExigido(`  ${valido}  `, "processoId"), valido, "apara as bordas");

    // Ausência não é erro — é "sem filtro".
    for (const ausente of [undefined, null, "", "   "]) {
      assert.equal(
        filtroObjectIdExigido(ausente, "processoId"), undefined,
        `${JSON.stringify(ausente)} significa "sem filtro", não erro`
      );
    }

    // Presente e imprestável é erro do chamador.
    for (const hostil of ["nao-e-objectid", 42, { $ne: "x" }, ["a"], Buffer.from("123456789012")]) {
      assert.throws(
        () => filtroObjectIdExigido(hostil, "processoId"),
        (err) => err.statusCode === 400 && err.campo === "processoId",
        `${JSON.stringify(String(hostil))} precisa virar 400 com campo`
      );
    }
  });
});
