// ═══════════════════════════════════════════════════════════════════════════
// "HONORÁRIOS EM ABERTO" — o cartão do Início (Fase 0, DEC-069)
//
// `GET /api/dashboard` → `honorariosAReceber`. Contava só `status: "pendente"`,
// isto é, só os honorários que nunca receberam um centavo. O honorário
// `parcialmente_pago` — justamente o que ainda tem o que receber, e o caso
// mais comum de um contrato em andamento — ficava fora.
//
// O nome do CAMPO não muda (contrato da rota); o rótulo da tela passou a ser
// "Honorários em aberto". Os quatro status nascem pelo caminho real: eles são
// derivados das parcelas (DEC-028), e gravá-los à mão provaria só a consulta.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, esperado
} from "../helpers/setup.js";

const dataUTC = (deslocamento, dia) => {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + deslocamento, dia))
    .toISOString().slice(0, 10);
};

describe("Início — honorários em aberto contam pendente E parcialmente pago (DEC-069)", () => {
  let api;
  const status = {};

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("honorarios-em-aberto");
    const cliente = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);

    // pendente: com parcela e sem pagamento nenhum.
    const pendente = await criarHonorario(api, processo._id, { tipo: "fixo", valor: 1000, descricao: "Pendente" });
    await criarParcela(api, pendente._id, 1, { valor: 1000, dataVencimento: dataUTC(1, 10) });

    // parcialmente_pago: recebeu parte.
    const parcial = await criarHonorario(api, processo._id, { tipo: "fixo", valor: 2000, descricao: "Parcial" });
    await criarParcela(api, parcial._id, 1, { valor: 2000, dataVencimento: dataUTC(1, 10) });
    await criarPagamento(api, parcial._id, { valor: 500, data: dataUTC(0, 1) });

    // pago: quitado.
    const pago = await criarHonorario(api, processo._id, { tipo: "fixo", valor: 3000, descricao: "Pago" });
    await criarParcela(api, pago._id, 1, { valor: 3000, dataVencimento: dataUTC(1, 10) });
    await criarPagamento(api, pago._id, { valor: 3000, data: dataUTC(0, 1) });

    // cancelado: escrita explícita, o único status escrevível.
    const cancelado = await criarHonorario(api, processo._id, { tipo: "fixo", valor: 4000, descricao: "Cancelado" });
    esperado(await api.patch(`/fees/${cancelado._id}`, { status: "cancelado" }), 200, "cancela o honorário");

    // Guarda do próprio teste: se a derivação mudar, o cenário deixa de ter os
    // quatro estados e as asserções abaixo passariam a medir outra coisa.
    for (const [nome, fee] of Object.entries({ pendente, parcial, pago, cancelado })) {
      status[nome] = esperado(await api.get(`/fees/${fee._id}`), 200, `honorário ${nome}`).status;
    }
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("o cenário tem os quatro estados que o teste afirma ter", () => {
    assert.deepEqual(status, {
      pendente: "pendente",
      parcial: "parcialmente_pago",
      pago: "pago",
      cancelado: "cancelado"
    });
  });

  test("conta o pendente e o parcialmente pago, e só eles", async () => {
    const r = esperado(await api.get("/dashboard"), 200, "resumo do Início");
    assert.equal(r.honorariosAReceber, 2);
  });
});
