// ═══════════════════════════════════════════════════════════════════════════
// FASE 3.2 — PROCESSO E CLIENTE NAS LISTAGENS DE PARCELAS E PAGAMENTOS (DEC-102)
//
// As três listas financeiras ganharam a coluna Cliente ao lado do processo.
// Honorários já traziam o cliente dentro de `processoId` desde a 2.5. Aqui, só
// acréscimos:
//
//   GET /installments  → `processo: { _id, numeroProcesso, titulo,
//                         clientePrincipalNome }` (chave NOVA; `feeId` e o
//                         `feeId.processoId` continuam como eram)
//   GET /payments      → `honorarioId.processoId.clientePrincipalId`
//                         (chave nova dentro de um objeto que já era objeto)
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario,
  criarClientePF,
  criarProcesso,
  criarHonorario,
  criarParcela,
  criarPagamento,
  esperado
} from "../helpers/setup.js";

describe("Fase 3.2 — processo e cliente nas listagens de parcelas e pagamentos", () => {
  let api, processo, honorario, parcela;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("listas32");
    const cliente = await criarClientePF(api, { nomeCompleto: "Helena Bastos" });
    processo = await criarProcesso(api, [{ clienteId: cliente._id, papel: "autor", principal: true }],
      { titulo: "Ação de Alimentos" });
    honorario = await criarHonorario(api, processo._id, { valor: 2000 });
    parcela = await criarParcela(api, honorario._id, 1, { valor: 2000 });
    await criarPagamento(api, honorario._id, { valor: 500 });
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("GET /installments: chave nova `processo`, com o cliente principal", async () => {
    const r = esperado(await api.get("/installments"), 200, "parcelas");
    const linha = r.data.find((p) => String(p._id) === String(parcela._id));
    assert.deepEqual(linha.processo, {
      _id: String(processo._id),
      numeroProcesso: processo.numeroProcesso,
      titulo: "Ação de Alimentos",
      clientePrincipalNome: "Helena Bastos"
    });
    // O que já existia não mudou de forma.
    assert.equal(typeof linha.feeId, "object");
    assert.equal(typeof linha.feeId.processoId, "string", "feeId.processoId continua sendo o id");
    assert.ok("totalNoPlano" in linha);
  });

  test("GET /payments: o cliente vem dentro do processo já populado", async () => {
    const r = esperado(await api.get("/payments"), 200, "pagamentos");
    const proc = r.data[0].honorarioId.processoId;
    assert.equal(proc.titulo, "Ação de Alimentos");
    assert.equal(proc.numeroProcesso, processo.numeroProcesso);
    assert.equal(proc.clientePrincipalId.nomeCompleto, "Helena Bastos");
  });
});
