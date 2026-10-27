// ═══════════════════════════════════════════════════════════════════════════
// FASE 3.7 — o cliente e o em aberto nas vencidas do sino (DEC-130)
//
// A Visão geral do Financeiro lista as parcelas vencidas a partir do MESMO
// `GET /calendar/avisos` que o sino e o Início contam (DEC-057: uma fonte só
// para esse número). Faltavam duas coisas para a linha dizer o que a decisão
// pede — "processo · cliente" e o valor em aberto —, e as duas entraram como
// ACRÉSCIMO: `processo.clientePrincipalNome` (o `nomeExibicaoDoCliente` da
// DEC-105) e `emAberto` (a conta de `proximosVencimentos` e de `valorVencido`).
//
// O que se trava aqui:
//   - os dois campos novos, com o nome da PJ pela razão social;
//   - a soma dos `emAberto` é o `valorVencido` do resumo — o cartão "Total
//     vencido hoje" e a lista embaixo dele não podem discordar;
//   - nada do que já existia na linha mudou.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarClientePJ, criarProcesso, criarHonorario, criarParcela, esperado
} from "../helpers/setup.js";
import {
  hojeComoDataDeCalendario,
  escreverDataDeCalendario,
  lerDataDeCalendario
} from "../../src/utils/dataDeCalendario.js";

const COLECOES = [
  "users", "clients", "processes", "processo_clientes", "fees",
  "installments", "payments", "events", "alocacoes"
];

const UM_DIA = 24 * 60 * 60 * 1000;
const HOJE = hojeComoDataDeCalendario();
const deslocar = (dias) =>
  escreverDataDeCalendario(new Date(lerDataDeCalendario(HOJE).getTime() + dias * UM_DIA));

let api;

const vencerParcelaDe = async (honorarioId, valor, dias) => {
  await criarParcela(api, honorarioId, 1, { valor, dataVencimento: deslocar(dias) });
  const parcela = (await api.get(`/installments?honorarioId=${honorarioId}`)).body.data[0];
  esperado(await api.patch(`/installments/${parcela._id}`, { status: "vencido" }), 200, "marcar vencida");
};

before(async () => {
  await subirApp();
  await limparColecoes(COLECOES);
  api = await registrarUsuario("advogada da visão geral");

  const pf = await criarClientePF(api, { nomeCompleto: "Helena Vencida Teste" });
  const pj = await criarClientePJ(api, { razaoSocial: "Construtora Vencida Ltda" });
  const procPf = await criarProcesso(api, [{ clienteId: pf._id, papel: "autor", principal: true }]);
  const procPj = await criarProcesso(api, [{ clienteId: pj._id, papel: "autor", principal: true }]);

  const feePf = await criarHonorario(api, procPf._id, { valor: 1500, descricao: "Honorário PF vencido" });
  const feePj = await criarHonorario(api, procPj._id, { valor: 2750.5, descricao: "Honorário PJ vencido" });
  await vencerParcelaDe(feePf._id, 1500, -12);
  await vencerParcelaDe(feePj._id, 2750.5, -3);
});

after(async () => {
  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

describe("GET /calendar/avisos — o cliente e o em aberto nas vencidas (DEC-130)", () => {
  test("cada vencida traz o cliente principal do processo (PF pelo nome, PJ pela razão social)", async () => {
    const corpo = esperado(await api.get("/calendar/avisos"), 200, "avisos");
    assert.equal(corpo.contagens.parcelasVencidas, 2);
    const porHonorario = Object.fromEntries(corpo.parcelasVencidas.map((p) => [p.subtitulo, p]));
    assert.equal(porHonorario["Honorário PF vencido"].processo.clientePrincipalNome, "Helena Vencida Teste");
    assert.equal(porHonorario["Honorário PJ vencido"].processo.clientePrincipalNome, "Construtora Vencida Ltda");
  });

  test("cada vencida traz o em aberto, sem resíduo de ponto flutuante", async () => {
    const corpo = esperado(await api.get("/calendar/avisos"), 200, "avisos");
    const emAberto = corpo.parcelasVencidas.map((p) => p.emAberto).sort((a, b) => a - b);
    assert.deepEqual(emAberto, [1500, 2750.5]);
  });

  test("a soma dos em aberto é o `valorVencido` do resumo (o cartão e a lista não discordam)", async () => {
    const avisos = esperado(await api.get("/calendar/avisos"), 200, "avisos");
    const resumo = esperado(await api.get("/financeiro/resumo"), 200, "resumo");
    const soma = Math.round(avisos.parcelasVencidas.reduce((t, p) => t + p.emAberto, 0) * 100) / 100;
    assert.equal(soma, resumo.valorVencido);
  });

  test("o que já existia na linha não mudou (só acréscimo)", async () => {
    const corpo = esperado(await api.get("/calendar/avisos"), 200, "avisos");
    const linha = corpo.parcelasVencidas[0];
    for (const campo of ["natureza", "origem", "motivo", "_id", "titulo", "subtitulo", "data", "valor", "valorPago", "status", "feeId", "processoId"]) {
      assert.ok(campo in linha, `o campo ${campo} continua`);
    }
    assert.deepEqual(Object.keys(linha.processo).sort(), ["_id", "clientePrincipalNome", "numeroProcesso", "titulo"]);
    assert.equal(linha.editavelNoCalendario, false);
  });
});
