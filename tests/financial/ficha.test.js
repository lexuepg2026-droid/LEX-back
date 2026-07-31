// ═══════════════════════════════════════════════════════════════════════════
// FICHA FINANCEIRA DO PROCESSO
//
// `GET /api/financeiro/processos/:processoId`. Leitura consolidada: honorários,
// parcelas, pagamentos e totais em três níveis.
//
// A resposta NÃO usa o envelope de listagem, e isso é o que este arquivo trava
// primeiro: a regra vigente é que `{ data, total, page, limit, totalPages }` é
// contrato de LISTAGEM. Uma "uniformização" futura que enfiasse o envelope aqui
// paginaria honorário e partiria o total ao meio.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, esperado
} from "../helpers/setup.js";

const AMANHA = "2099-12-31";
const ONTEM = "2020-01-10";

describe("ficha financeira do processo", () => {
  let api, cliente, processo;
  let percentual, fixo, cancelado;
  let parcelaPaga, parcelaParcial;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("ficha");
    cliente = await criarClientePF(api);
    processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);

    // Um honorário percentual, com parcelas em estados diferentes.
    percentual = await criarHonorario(api, processo._id, {
      tipo: "percentual", percentual: 10, valorBase: 50000,
      descricao: "Honorários de êxito — 10% sobre o proveito"
    });
    parcelaPaga = await criarParcela(api, percentual._id, 1, { valor: 2500, dataVencimento: ONTEM });
    parcelaParcial = await criarParcela(api, percentual._id, 2, { valor: 2500, dataVencimento: AMANHA });
    await criarPagamento(api, parcelaPaga._id, { valorPago: 2500 });
    await criarPagamento(api, parcelaParcial._id, { valorPago: 1000 });

    // Um honorário fixo, quitado.
    fixo = await criarHonorario(api, processo._id, { tipo: "fixo", valor: 1000 });
    const p = await criarParcela(api, fixo._id, 1, { valor: 1000, dataVencimento: ONTEM });
    await criarPagamento(api, p._id, { valorPago: 1000 });

    // Um honorário cancelado, sem parcela.
    cancelado = await criarHonorario(api, processo._id, {
      tipo: "custas", valor: 800, status: "cancelado", descricao: "Custas — cancelado"
    });
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const ficha = async () =>
    esperado(await api.get(`/financeiro/processos/${processo._id}`), 200, "ficha financeira");

  test("a forma da resposta é objeto de consolidação, não envelope de listagem", async () => {
    const r = await ficha();

    assert.deepEqual(
      Object.keys(r).sort(),
      ["geradoEm", "honorarios", "processo", "totais"],
      "as quatro chaves de primeiro nível da ficha"
    );

    // `page`, `limit` e `totalPages` não descrevem nada numa consolidação: a
    // ficha não é paginável, e paginar honorário partiria o total ao meio.
    for (const doEnvelope of ["data", "page", "limit", "totalPages"]) {
      assert.equal(
        r[doEnvelope], undefined,
        `a ficha não é listagem e não deveria trazer \`${doEnvelope}\``
      );
    }
    // `total` também não: aqui o que existe é `totais`, no plural, com três
    // números que significam coisas diferentes.
    assert.equal(r.total, undefined);
  });

  test("o processo vem identificado, sem campo interno", async () => {
    const r = await ficha();
    assert.equal(String(r.processo._id), String(processo._id));
    assert.equal(r.processo.titulo, processo.titulo);
    assert.ok(r.processo.numeroProcesso);
    // `observacoes` de processo é anotação interna; não tem por que estar numa
    // ficha de valores.
    assert.equal(r.processo.observacoes, undefined);
  });

  test("cada honorário traz tipo, valor, percentual, valor base e status derivado", async () => {
    const r = await ficha();
    const porId = new Map(r.honorarios.map((h) => [String(h._id), h]));

    const pct = porId.get(String(percentual._id));
    assert.equal(pct.tipo, "percentual");
    assert.equal(pct.percentual, 10);
    assert.equal(pct.valorBase, 50000);
    assert.equal(pct.valor, 5000, "10% de 50.000");
    assert.equal(pct.status, "parcialmente_pago");

    const fix = porId.get(String(fixo._id));
    assert.equal(fix.tipo, "fixo");
    // `null`, e não omitido: campo ausente e campo vazio são coisas diferentes
    // para quem monta a tela.
    assert.equal(fix.percentual, null);
    assert.equal(fix.valorBase, null);
    assert.equal(fix.status, "pago");

    const canc = porId.get(String(cancelado._id));
    assert.equal(canc.status, "cancelado");
    assert.deepEqual(canc.parcelas, []);
  });

  test("as parcelas trazem vencimento, valor, valorPago, em aberto e status", async () => {
    const r = await ficha();
    const pct = r.honorarios.find((h) => String(h._id) === String(percentual._id));

    assert.equal(pct.parcelas.length, 2);
    // Ordenadas pelo número da parcela: a ficha é lida de cima para baixo.
    assert.deepEqual(pct.parcelas.map((p) => p.numeroParcela), [1, 2]);

    const [primeira, segunda] = pct.parcelas;

    assert.equal(primeira.valor, 2500);
    assert.equal(primeira.valorPago, 2500);
    assert.equal(primeira.emAberto, 0);
    assert.equal(primeira.status, "pago");
    assert.ok(primeira.dataVencimento);

    assert.equal(segunda.valorPago, 1000);
    assert.equal(segunda.emAberto, 1500, "2500 de valor menos 1000 pagos");
    assert.equal(segunda.status, "parcial");
  });

  test("cada parcela traz os próprios pagamentos", async () => {
    const r = await ficha();
    const pct = r.honorarios.find((h) => String(h._id) === String(percentual._id));

    for (const parcela of pct.parcelas) {
      assert.equal(parcela.pagamentos.length, 1, `parcela ${parcela.numeroParcela}`);
      const [pg] = parcela.pagamentos;
      assert.equal(pg.valorPago, parcela.valorPago);
      assert.ok(pg.dataPagamento);
      assert.ok(pg.formaPagamento);
    }
  });

  test("os totais são calculados no backend, nos três níveis", async () => {
    const r = await ficha();

    // Nível parcela e nível honorário.
    const pct = r.honorarios.find((h) => String(h._id) === String(percentual._id));
    assert.deepEqual(pct.totais, { contratado: 5000, pago: 3500, emAberto: 1500 });

    const fix = r.honorarios.find((h) => String(h._id) === String(fixo._id));
    assert.deepEqual(fix.totais, { contratado: 1000, pago: 1000, emAberto: 0 });

    // Nível processo. O CANCELADO fica fora de `contratado`: a cobrança foi
    // desfeita, e somá-la faria a advogada ler como devido um valor que ela
    // mesma cancelou. 5000 + 1000, e não 5000 + 1000 + 800.
    assert.equal(r.totais.contratado, 6000);
    assert.equal(r.totais.pago, 3500 + 1000);
    assert.equal(r.totais.emAberto, 1500);
    assert.equal(r.totais.honorarios, 3, "o cancelado continua na lista");
    assert.equal(r.totais.honorariosCancelados, 1);

    // A tela não faz conta: os três números têm de fechar entre si.
    assert.equal(r.totais.contratado - r.totais.pago, r.totais.emAberto);
  });

  test("o honorário cancelado continua aparecendo na lista", async () => {
    // Sumir da ficha levaria junto o histórico: a advogada precisa ver que
    // aquela cobrança existiu e foi cancelada.
    const r = await ficha();
    assert.ok(
      r.honorarios.some((h) => String(h._id) === String(cancelado._id)),
      "o honorário cancelado sumiu da ficha"
    );
  });

  test("os documentos gerados a partir do honorário acompanham cada linha", async () => {
    // Primeiro consumidor real do índice `documents.honorarioId_1`, listado
    // pela auditoria da Fase 2E.1 como criado e nunca consultado.
    const r = await ficha();
    for (const h of r.honorarios) {
      assert.ok(Array.isArray(h.documentos), `honorário ${h._id} sem a lista de documentos`);
    }
  });

  test("processo sem financeiro nenhum devolve a ficha vazia, não 404", async () => {
    const vazio = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);

    const r = esperado(
      await api.get(`/financeiro/processos/${vazio._id}`),
      200, "ficha de processo sem honorário"
    );

    assert.deepEqual(r.honorarios, []);
    assert.deepEqual(r.totais, {
      contratado: 0, pago: 0, emAberto: 0, honorarios: 0, honorariosCancelados: 0
    });
  });

  test("id malformado → 400; id inexistente → 404", async () => {
    const malformado = await api.get("/financeiro/processos/nao-e-objectid");
    assert.equal(malformado.status, 400, JSON.stringify(malformado.body));

    const inexistente = await api.get("/financeiro/processos/000000000000000000000000");
    assert.equal(inexistente.status, 404, JSON.stringify(inexistente.body));
  });

  test("processo desativado → 404", async () => {
    const descartavel = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    esperado(await api.delete(`/processes/${descartavel._id}`), 200, "exclusão do processo");

    const r = await api.get(`/financeiro/processos/${descartavel._id}`);
    assert.equal(r.status, 404);
  });

  test("a ficha acompanha o recálculo: desativar pagamento muda os totais", async () => {
    // Contraprova de que a ficha LÊ o estado derivado em vez de guardar cópia.
    const antes = await ficha();
    const pgs = antes.honorarios
      .find((h) => String(h._id) === String(percentual._id))
      .parcelas.find((p) => p.numeroParcela === 2).pagamentos;

    esperado(await api.delete(`/payments/${pgs[0]._id}`), 200, "desativa o pagamento parcial");

    const depois = await ficha();
    const pct = depois.honorarios.find((h) => String(h._id) === String(percentual._id));

    assert.equal(pct.parcelas[1].valorPago, 0);
    assert.equal(pct.parcelas[1].pagamentos.length, 0, "pagamento desativado sai da lista");
    assert.equal(pct.totais.pago, 2500);
    assert.equal(depois.totais.pago, 3500, "2500 do percentual + 1000 do fixo");

    // Devolve ao estado de antes, para o arquivo ficar idempotente entre
    // execuções da mesma sessão.
    await criarPagamento(api, parcelaParcial._id, { valorPago: 1000 });
  });
});
