// ═══════════════════════════════════════════════════════════════════════════
// DEC-166 — `?clienteId=` em `GET /installments` e `GET /payments` (Fase 4a2)
//
// As parcelas e os pagamentos dos honorários dos processos em que o cliente
// tem vínculo ATIVO, principal ou não — o recorte de `GET /processes?clienteId=`
// (DEC-119). Só acréscimo: sem o parâmetro, as listagens são as de sempre.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarProcesso, criarClientePF, criarHonorario, criarParcela, criarPagamento, esperado
} from "../helpers/setup.js";

const ids = (corpo) => corpo.data.map((x) => String(x._id)).sort();
const de = (...registros) => registros.map((r) => String(r._id)).sort();

describe("DEC-166 — o financeiro de um cliente (?clienteId=)", () => {
  let adv;
  let outra;
  const c = {};
  const p = {};
  const h = {};
  const i = {};
  const pg = {};

  before(async () => {
    await subirApp();
    await limparColecoes();
    adv = await registrarUsuario("dona do financeiro");
    outra = await registrarUsuario("outra advogada");

    c.ana = await criarClientePF(adv, { nomeCompleto: "Ana Financeiro" });
    c.bia = await criarClientePF(adv, { nomeCompleto: "Bia Financeiro" });
    c.semNada = await criarClientePF(adv, { nomeCompleto: "Caio Sem Processo" });
    const parte = (cliente, papel = "autor", principal = true) => ({ clienteId: cliente._id, papel, principal });

    // Ana: principal em P1, litisconsorte em P2 (da Bia), removida de P3 e
    // principal em P4, que é desativado depois de ter financeiro.
    p.p1 = await criarProcesso(adv, [parte(c.ana)], { titulo: "P1 Ana", numeroProcesso: "0000011-00.2026.8.16.0001" });
    p.p2 = await criarProcesso(adv, [parte(c.bia), parte(c.ana, "litisconsorte", false)], { titulo: "P2 Bia e Ana", numeroProcesso: "0000012-00.2026.8.16.0001" });
    p.p3 = await criarProcesso(adv, [parte(c.bia), parte(c.ana, "litisconsorte", false)], { titulo: "P3 Ana removida", numeroProcesso: "0000013-00.2026.8.16.0001" });
    p.p4 = await criarProcesso(adv, [parte(c.ana)], { titulo: "P4 desativado", numeroProcesso: "0000014-00.2026.8.16.0001" });

    for (const [chave, proc] of Object.entries({ h1: p.p1, h2: p.p2, h3: p.p3, h4: p.p4 })) {
      h[chave] = await criarHonorario(adv, proc._id, { descricao: `Honorário ${chave}`, valor: 2000 });
      i[`${chave}a`] = await criarParcela(adv, h[chave]._id, 1, { valor: 1000, dataVencimento: "2026-11-10" });
      i[`${chave}b`] = await criarParcela(adv, h[chave]._id, 2, { valor: 1000, dataVencimento: "2026-12-10" });
      pg[chave] = (await criarPagamento(adv, h[chave]._id, { valor: 500, data: "2026-10-20", observacoes: `pagamento ${chave}` })).pagamento;
    }

    esperado(await adv.delete(`/processes/${p.p3._id}/clientes/${c.ana._id}`), 200, "remover Ana de P3");
    esperado(await adv.delete(`/processes/${p.p4._id}`), 200, "desativar P4");

    // A outra advogada, com um cliente, um processo e financeiro próprios.
    c.dela = await criarClientePF(outra, { nomeCompleto: "Cida Outra" });
    p.dela = await criarProcesso(outra, [parte(c.dela)], { titulo: "Processo da outra" });
    h.dela = await criarHonorario(outra, p.dela._id, { valor: 2000 });
    i.dela = await criarParcela(outra, h.dela._id, 1, { valor: 1000 });
    pg.dela = (await criarPagamento(outra, h.dela._id, { valor: 500 })).pagamento;
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  const parcelas = async (query, quem = adv) =>
    esperado(await quem.get(`/installments?limit=100${query ? `&${query}` : ""}`), 200, `parcelas ${query}`);
  const pagamentos = async (query, quem = adv) =>
    esperado(await quem.get(`/payments?limit=100${query ? `&${query}` : ""}`), 200, `pagamentos ${query}`);

  describe("GET /installments?clienteId=", () => {
    test("as parcelas dos processos com vínculo ativo, como principal ou não", async () => {
      assert.deepEqual(ids(await parcelas(`clienteId=${c.ana._id}`)), de(i.h1a, i.h1b, i.h2a, i.h2b));
      assert.deepEqual(ids(await parcelas(`clienteId=${c.bia._id}`)), de(i.h2a, i.h2b, i.h3a, i.h3b));
    });

    test("vínculo removido e processo desativado ficam fora", async () => {
      const daAna = ids(await parcelas(`clienteId=${c.ana._id}`));
      for (const fora of [i.h3a, i.h3b, i.h4a, i.h4b]) assert.ok(!daAna.includes(String(fora._id)));
    });

    test("cliente sem processo: lista vazia", async () => {
      const corpo = await parcelas(`clienteId=${c.semNada._id}`);
      assert.deepEqual(corpo.data, []);
      assert.equal(corpo.total, 0);
    });

    test("combina com honorarioId, status, período e busca", async () => {
      assert.deepEqual(ids(await parcelas(`clienteId=${c.ana._id}&honorarioId=${h.h2._id}`)), de(i.h2a, i.h2b));
      assert.deepEqual(ids(await parcelas(`clienteId=${c.ana._id}&honorarioId=${h.h3._id}`)), []);
      assert.deepEqual(ids(await parcelas(`clienteId=${c.ana._id}&de=2026-12-01&ate=2026-12-31`)), de(i.h1b, i.h2b));
      assert.deepEqual(ids(await parcelas(`clienteId=${c.ana._id}&busca=Honorário h1`)), de(i.h1a, i.h1b));
      assert.deepEqual(ids(await parcelas(`clienteId=${c.ana._id}&status=parcial`)), de(i.h1a, i.h2a));
    });

    test("isolamento: o cliente de outra advogada dá lista vazia, igual a um id inexistente", async () => {
      assert.deepEqual((await parcelas(`clienteId=${c.dela._id}`)).data, []);
      assert.deepEqual((await parcelas("clienteId=0123456789abcdef01234567")).data, []);
      // E a outra advogada não vê as parcelas da Ana pelo id dela.
      assert.deepEqual((await parcelas(`clienteId=${c.ana._id}`, outra)).data, []);
      assert.deepEqual(ids(await parcelas(`clienteId=${c.dela._id}`, outra)), de(i.dela));
    });

    test("clienteId torto é 400 com campo", async () => {
      for (const torto of ["abc", "123", "x".repeat(24)]) {
        const r = await adv.get(`/installments?clienteId=${torto}`);
        assert.equal(r.status, 400, torto);
        assert.equal(r.body.campo, "clienteId");
      }
      const repetido = await adv.get(`/installments?clienteId=${c.ana._id}&clienteId=${c.bia._id}`);
      assert.equal(repetido.status, 400);
      assert.equal(repetido.body.campo, "clienteId");
    });

    test("sem o parâmetro, a listagem é a de sempre", async () => {
      assert.equal((await parcelas("")).total, 8);
    });
  });

  describe("GET /payments?clienteId=", () => {
    test("os pagamentos dos processos com vínculo ativo, como principal ou não", async () => {
      assert.deepEqual(ids(await pagamentos(`clienteId=${c.ana._id}`)), de(pg.h1, pg.h2));
      assert.deepEqual(ids(await pagamentos(`clienteId=${c.bia._id}`)), de(pg.h2, pg.h3));
    });

    test("cliente sem processo: lista vazia", async () => {
      assert.deepEqual((await pagamentos(`clienteId=${c.semNada._id}`)).data, []);
    });

    test("combina com honorarioId e com a busca", async () => {
      assert.deepEqual(ids(await pagamentos(`clienteId=${c.ana._id}&honorarioId=${h.h1._id}`)), de(pg.h1));
      assert.deepEqual(ids(await pagamentos(`clienteId=${c.ana._id}&honorarioId=${h.h3._id}`)), []);
      assert.deepEqual(ids(await pagamentos(`clienteId=${c.ana._id}&busca=pagamento h2`)), de(pg.h2));
    });

    test("isolamento: o cliente de outra advogada dá lista vazia", async () => {
      assert.deepEqual((await pagamentos(`clienteId=${c.dela._id}`)).data, []);
      assert.deepEqual((await pagamentos(`clienteId=${c.ana._id}`, outra)).data, []);
      assert.deepEqual(ids(await pagamentos(`clienteId=${c.dela._id}`, outra)), de(pg.dela));
    });

    test("clienteId torto é 400 com campo", async () => {
      const r = await adv.get("/payments?clienteId=abc");
      assert.equal(r.status, 400);
      assert.equal(r.body.campo, "clienteId");
    });

    test("sem o parâmetro, a listagem é a de sempre", async () => {
      assert.equal((await pagamentos("")).total, 4);
    });
  });
});
