// ═══════════════════════════════════════════════════════════════════════════
// FASE 3.2 — O CLIENTE NAS "DATAS PRÓXIMAS" DO INÍCIO (DEC-105)
//
// As duas fontes das Datas próximas ganham o nome do cliente principal, como
// campo NOVO (os existentes não mudam):
//
//   GET /financeiro/resumo  → proximosVencimentos[].clientePrincipalNome
//   GET /calendar           → itens[natureza=evento].processo.clientePrincipalNome
//
// O limite de 8 dos próximos vencimentos está em `resumo.test.js`.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario,
  criarClientePF,
  criarClientePJ,
  criarProcesso,
  criarHonorario,
  criarParcela,
  esperado
} from "../helpers/setup.js";

const AGORA = new Date();
const daquiA = (dias) =>
  new Date(Date.UTC(AGORA.getUTCFullYear(), AGORA.getUTCMonth(), AGORA.getUTCDate() + dias))
    .toISOString().slice(0, 10);

describe("Fase 3.2 — cliente principal nas fontes das Datas próximas", () => {
  let api, outra, pPF, pPJ;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("datas32");
    outra = await registrarUsuario("datas32-outra");
    const maria = await criarClientePF(api, { nomeCompleto: "Maria Ápice Teixeira" });
    const agro = await criarClientePJ(api, { razaoSocial: "Agro Campos Gerais Ltda" });

    pPF = await criarProcesso(api, [{ clienteId: maria._id, papel: "autor", principal: true }]);
    pPJ = await criarProcesso(api, [{ clienteId: agro._id, papel: "autor", principal: true }]);

    const fPF = await criarHonorario(api, pPF._id, { valor: 1000 });
    const fPJ = await criarHonorario(api, pPJ._id, { valor: 1000 });
    await criarParcela(api, fPF._id, 1, { valor: 1000, dataVencimento: daquiA(3) });
    await criarParcela(api, fPJ._id, 1, { valor: 1000, dataVencimento: daquiA(4) });

    esperado(await api.post("/events", {
      tipo: "audiencia", titulo: "Audiência com processo", data: daquiA(2), processoId: pPF._id
    }), 201, "evento com processo");
    esperado(await api.post("/events", {
      tipo: "reuniao", titulo: "Reunião solta", data: daquiA(2)
    }), 201, "evento sem processo");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("proximosVencimentos traz o nome do cliente principal (PF e PJ)", async () => {
    const r = esperado(await api.get("/financeiro/resumo"), 200, "resumo");
    const porProcesso = new Map(r.proximosVencimentos.map((p) => [String(p.processoId), p]));
    assert.equal(porProcesso.get(String(pPF._id)).clientePrincipalNome, "Maria Ápice Teixeira");
    assert.equal(porProcesso.get(String(pPJ._id)).clientePrincipalNome, "Agro Campos Gerais Ltda");
    // Os campos de antes continuam.
    assert.equal(porProcesso.get(String(pPF._id)).numeroProcesso, pPF.numeroProcesso);
  });

  test("GET /calendar: o processo do evento traz o cliente; o evento solto continua sem processo", async () => {
    const r = esperado(await api.get(`/calendar?de=${daquiA(0)}&ate=${daquiA(10)}`), 200, "calendário");
    const comProcesso = r.itens.find((i) => i.titulo === "Audiência com processo");
    assert.deepEqual(Object.keys(comProcesso.processo).sort(),
      ["_id", "clientePrincipalNome", "numeroProcesso", "titulo"]);
    assert.equal(comProcesso.processo.clientePrincipalNome, "Maria Ápice Teixeira");
    assert.equal(comProcesso.processo.numeroProcesso, pPF.numeroProcesso);

    const solto = r.itens.find((i) => i.titulo === "Reunião solta");
    assert.equal(solto.processo, null);
    assert.equal(solto.processoId, null);
  });

  test("isolamento: a outra usuária não recebe nada disso", async () => {
    const r = esperado(await outra.get("/financeiro/resumo"), 200, "resumo da outra");
    assert.deepEqual(r.proximosVencimentos, []);
    const c = esperado(await outra.get(`/calendar?de=${daquiA(0)}&ate=${daquiA(10)}`), 200, "calendário da outra");
    assert.equal(c.itens.length, 0);
  });
});
