// ═══════════════════════════════════════════════════════════════════════════
// DEC-114 — o processo nasce ativo (Fase 3.4, apontamento 9 da banca)
//
// A tela deixou de enviar `status` na criação; o modelo tem `default: "ativo"`.
// O BACK NÃO MUDOU: ele continua aceitando `status` (outros clientes da API e
// a edição o mandam), e este arquivo trava as duas pontas.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, esperado } from "../helpers/setup.js";
import { dadosProcesso } from "../helpers/factories.js";

describe("DEC-114 — a criação sem status nasce ativa", () => {
  let adv;
  let cliente;

  before(async () => {
    await subirApp();
    await limparColecoes();
    adv = await registrarUsuario("criação sem status");
    cliente = await criarClientePF(adv);
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  const clientes = () => [{ clienteId: cliente._id, papel: "autor", principal: true }];

  test("sem `status` no corpo, o processo volta `ativo`, com a fase escolhida", async () => {
    const corpo = dadosProcesso(clientes(), { fase: "execucao" });
    delete corpo.status;
    const criado = esperado(await adv.post("/processes", corpo), 201, "criação sem status");
    assert.equal(criado.status, "ativo");
    assert.equal(criado.fase, "execucao");
    const lido = esperado(await adv.get(`/processes/${criado._id}`), 200, "leitura");
    assert.equal(lido.status, "ativo");
  });

  test("o back continua aceitando `status` na criação (nada mudou no contrato)", async () => {
    const criado = esperado(
      await adv.post("/processes", dadosProcesso(clientes(), { status: "suspenso" })),
      201, "criação com status"
    );
    assert.equal(criado.status, "suspenso");
  });
});
