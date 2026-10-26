// ═══════════════════════════════════════════════════════════════════════════
// FASE 3.2 — DUAS CHAVES NOVAS EM `GET /dashboard` (DEC-104)
//
//   confirmacoesNovasPorProcesso  [{ processoId, numeroProcesso, titulo, quantidade }]
//                                 até 10, pela confirmação mais recente
//   processosNaoLiberados         processos com vínculo ativo de cliente com
//                                 portal e `liberadoNoPortal: false` (contava
//                                 vínculos na 3.2; PROCESSOS desde a 3.3,
//                                 DEC-108 — os casos daqui têm um vínculo por
//                                 processo e valem nas duas leituras)
//
// As chaves antigas continuam (a contagem `confirmacoesNaoVistas` é travada
// em `confirmacao.test.js` e `isolamento.test.js`, que não mudaram).
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";
import { montarPortalPronto, liberarNoPortal } from "../helpers/portal.js";

describe("Fase 3.2 — GET /dashboard: confirmações por processo e processos não liberados", () => {
  let adv, cliente, p1, portal, p2, semPortal, outra;

  const painel = async (quem = adv) => esperado(await quem.get("/dashboard"), 200, "dashboard");
  const confirmar = async (processoId) =>
    esperado(await portal.post(`/portal/processos/${processoId}/confirmacoes`), 201, "confirmação");

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    ({ adv, cliente, processo: p1, portal } = await montarPortalPronto("dash32"));
    p2 = await criarProcesso(adv, [{ clienteId: cliente._id, papel: "autor", principal: true }],
      { titulo: "Segundo processo do cliente" });
    await liberarNoPortal(adv, p2._id, cliente._id);
    semPortal = await criarClientePF(adv, { nomeCompleto: "Cliente Sem Portal" });
    outra = await registrarUsuario("dash32-outra");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("as chaves existem, vazias, quando não há nada", async () => {
    const d = await painel();
    assert.deepEqual(d.confirmacoesNovasPorProcesso, []);
    assert.equal(d.processosNaoLiberados, 0);
    assert.equal(d.confirmacoesNaoVistas, 0, "a chave antiga continua");
  });

  test("agrupa por processo, com quantidade, e ordena pela confirmação mais recente", async () => {
    await confirmar(p1._id);
    await confirmar(p1._id);
    await new Promise((r) => setTimeout(r, 15));
    await confirmar(p2._id);

    const d = await painel();
    assert.equal(d.confirmacoesNaoVistas, 3);
    assert.deepEqual(
      d.confirmacoesNovasPorProcesso.map((c) => [String(c.processoId), c.quantidade]),
      [[String(p2._id), 1], [String(p1._id), 2]]
    );
    const item = d.confirmacoesNovasPorProcesso[0];
    assert.deepEqual(Object.keys(item).sort(), ["numeroProcesso", "processoId", "quantidade", "titulo"]);
    assert.equal(item.titulo, "Segundo processo do cliente");
    assert.equal(item.numeroProcesso, p2.numeroProcesso);
  });

  test("marcar como vistas tira o processo da lista", async () => {
    esperado(await adv.patch(`/processes/${p2._id}/confirmacoes/vistas`), 200, "marcar vistas");
    const d = await painel();
    assert.deepEqual(d.confirmacoesNovasPorProcesso.map((c) => String(c.processoId)), [String(p1._id)]);
  });

  test("isolamento: a outra usuária não vê as confirmações nem as liberações pendentes", async () => {
    const d = await painel(outra);
    assert.deepEqual(d.confirmacoesNovasPorProcesso, []);
    assert.equal(d.processosNaoLiberados, 0);
  });

  test("conta o vínculo não liberado de cliente COM portal; cliente sem portal fica de fora", async () => {
    const p3 = await criarProcesso(adv, [
      { clienteId: cliente._id, papel: "autor", principal: true },
      { clienteId: semPortal._id, papel: "litisconsorte", principal: false }
    ]);
    assert.equal((await painel()).processosNaoLiberados, 1);

    await liberarNoPortal(adv, p3._id, cliente._id);
    assert.equal((await painel()).processosNaoLiberados, 0, "liberado sai da conta");
  });

  test("vínculo inativo fica de fora da contagem", async () => {
    const p4 = await criarProcesso(adv, [
      { clienteId: semPortal._id, papel: "autor", principal: true },
      { clienteId: cliente._id, papel: "terceiro_interessado", principal: false }
    ]);
    assert.equal((await painel()).processosNaoLiberados, 1);

    esperado(await adv.delete(`/processes/${p4._id}/clientes/${cliente._id}`), 200, "remover participante");
    assert.equal((await painel()).processosNaoLiberados, 0);
  });

  test("processo desativado: as confirmações dele saem da lista curta", async () => {
    esperado(await adv.delete(`/processes/${p1._id}`), 200, "desativar processo");
    const d = await painel();
    assert.ok(!d.confirmacoesNovasPorProcesso.some((c) => String(c.processoId) === String(p1._id)));
  });
});
