// ═══════════════════════════════════════════════════════════════════════════
// FASE 3.3 — `processosNaoLiberados` conta PROCESSOS (DEC-108)
//
// Na 3.2 a contagem era por vínculo. Mudança de semântica autorizada: o campo
// nasceu na 3.2 e só o Início o lê. Campo novo: `processoNaoLiberadoId`, só
// quando há exatamente um processo.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarProcesso, esperado } from "../helpers/setup.js";
import { dadosClientePF } from "../helpers/factories.js";
import { liberarNoPortal, SENHA_PROVISORIA } from "../helpers/portal.js";

describe("Fase 3.3 — GET /dashboard: processos não liberados, por processo", () => {
  let adv, outra, ana, bia, p1, p2;

  const painel = async (quem = adv) => esperado(await quem.get("/dashboard"), 200, "dashboard");
  const clienteComPortal = async (quem, nome) =>
    esperado(await quem.post("/clients", { ...dadosClientePF({ nomeCompleto: nome }), senhaPortal: SENHA_PROVISORIA }), 201, nome);

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    adv = await registrarUsuario("dash33");
    outra = await registrarUsuario("dash33-outra");
    ana = await clienteComPortal(adv, "Ana Portal");
    bia = await clienteComPortal(adv, "Bia Portal");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("sem pendência: 0 e id nulo", async () => {
    const d = await painel();
    assert.equal(d.processosNaoLiberados, 0);
    assert.equal(d.processoNaoLiberadoId, null);
  });

  test("um processo com DOIS clientes de portal não liberados conta 1, e o id vem preenchido", async () => {
    p1 = await criarProcesso(adv, [
      { clienteId: ana._id, papel: "autor", principal: true },
      { clienteId: bia._id, papel: "litisconsorte", principal: false }
    ]);
    const d = await painel();
    assert.equal(d.processosNaoLiberados, 1, "era 2 quando contava vínculos");
    assert.equal(d.processoNaoLiberadoId, String(p1._id));
  });

  test("liberar só um dos dois clientes mantém o processo na conta", async () => {
    await liberarNoPortal(adv, p1._id, ana._id);
    const d = await painel();
    assert.equal(d.processosNaoLiberados, 1);
    assert.equal(d.processoNaoLiberadoId, String(p1._id));
  });

  test("dois processos contam 2, e o id volta a nulo", async () => {
    p2 = await criarProcesso(adv, [{ clienteId: ana._id, papel: "autor", principal: true }]);
    const d = await painel();
    assert.equal(d.processosNaoLiberados, 2);
    assert.equal(d.processoNaoLiberadoId, null);
  });

  test("liberando tudo de um deles, volta a 1 com o id do outro", async () => {
    await liberarNoPortal(adv, p1._id, bia._id);
    const d = await painel();
    assert.equal(d.processosNaoLiberados, 1);
    assert.equal(d.processoNaoLiberadoId, String(p2._id));
  });

  test("isolamento por usuarioId: a outra usuária não vê nada, e o dela não entra aqui", async () => {
    const dela = await clienteComPortal(outra, "Cida Portal");
    const pDela = await criarProcesso(outra, [{ clienteId: dela._id, papel: "autor", principal: true }]);
    const minha = await painel();
    assert.equal(minha.processosNaoLiberados, 1);
    assert.equal(minha.processoNaoLiberadoId, String(p2._id));
    const deLa = await painel(outra);
    assert.equal(deLa.processosNaoLiberados, 1);
    assert.equal(deLa.processoNaoLiberadoId, String(pDela._id));
  });
});
