// ═══════════════════════════════════════════════════════════════════════════
// F-5b, PARTE 1.2 — A GRAVAÇÃO ATRASADA NÃO ATROPELA A DE OUTRO APARELHO
//
// Dois aparelhos, um offline. O que ficou sem sinal enfileira uma edição e a
// manda horas depois: a versão dele é mais VELHA que a que está no servidor.
//
// A decisão (DEC-060) é não decidir: o servidor **recusa com 409** e devolve o
// que está gravado. Não sobrescreve, não mescla. Duas versões de um mesmo
// compromisso é conflito de CONTEÚDO, e conteúdo é da advogada — a escolha
// acontece na tela de pendências, com as duas versões à vista.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";
import { compararVersao, CABECALHO_VERSAO } from "../../src/services/concurrencyGuard.js";

const COLECOES = ["users", "clients", "processes", "processo_clientes", "events", "idempotency_keys"];

let api;
let processo;

before(async () => {
  await subirApp();
  await limparColecoes(COLECOES);
  api = await registrarUsuario("advogada da DEC-060");
  const cliente = await criarClientePF(api);
  processo = await criarProcesso(api, [{ clienteId: cliente._id, papel: "autor", principal: true }]);
});

after(async () => {
  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

const comVersao = (versao) => ({ headers: { [CABECALHO_VERSAO]: versao } });

const criarEvento = async (extra = {}) =>
  esperado(
    await api.post("/events", { tipo: "audiencia", titulo: "Audiência", data: "2026-09-01", ...extra }),
    201,
    "arranjo"
  );

// ═════════════════════════════════════════════════════════════════════════
// A comparação, em função pura
// ═════════════════════════════════════════════════════════════════════════

describe("a comparação de versão", () => {
  const atual = new Date("2026-08-29T10:00:00.123Z");

  test("sem cabeçalho, não há verificação — é o comportamento de antes da fase", () => {
    for (const ausente of [null, undefined, "", "   "]) {
      assert.equal(compararVersao(atual, ausente), "semVerificacao");
    }
  });

  test("é IGUALDADE, e não 'mais novo que'", () => {
    assert.equal(compararVersao(atual, "2026-08-29T10:00:00.123Z"), "igual");
    // Um milissegundo depois já é outra versão: a pergunta é "o registro ainda
    // é o que eu vi?", e qualquer diferença responde não.
    assert.equal(compararVersao(atual, "2026-08-29T10:00:00.124Z"), "diferente");
    assert.equal(compararVersao(atual, "2026-08-29T10:00:00.000Z"), "diferente");
  });

  test("a precisão é de MILISSEGUNDOS — é por isso que o cabeçalho é próprio", () => {
    // O `If-Unmodified-Since` do HTTP carrega HTTP-date, com precisão de
    // segundos: duas edições dentro do mesmo segundo passariam pela
    // verificação, que é justamente a janela que esta guarda fecha.
    const comMilissegundos = new Date("2026-08-29T10:00:00.500Z");
    assert.equal(compararVersao(comMilissegundos, "2026-08-29T10:00:00.000Z"), "diferente");
  });

  test("texto que não é instante é 'invalida', e não passa como se fosse igual", () => {
    assert.equal(compararVersao(atual, "ontem"), "invalida");
    assert.equal(compararVersao(atual, "2026-13-45"), "invalida");
    assert.equal(compararVersao(undefined, "2026-08-29T10:00:00.123Z"), "invalida");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// O compromisso
// ═════════════════════════════════════════════════════════════════════════

describe("compromisso: a edição com a versão em dia grava", () => {
  test("mandando o `updatedAt` que se leu, a edição passa", async () => {
    const evento = await criarEvento({ titulo: "Versão em dia" });

    const r = await api.patch(
      `/events/${evento._id}`, { local: "Sala 1" }, comVersao(evento.updatedAt)
    );

    const atualizado = esperado(r, 200, "edição com versão em dia");
    assert.equal(atualizado.local, "Sala 1");
    assert.notEqual(atualizado.updatedAt, evento.updatedAt, "o carimbo precisa avançar");
  });

  test("sem o cabeçalho, grava como sempre gravou", async () => {
    const evento = await criarEvento({ titulo: "Sem cabeçalho" });
    esperado(await api.patch(`/events/${evento._id}`, { local: "Sala 2" }), 200, "edição sem cabeçalho");
  });
});

describe("compromisso: a edição atrasada é RECUSADA, com o estado atual no corpo", () => {
  test("409 `conflitoDeVersao`, e a versão do servidor vem junto", async () => {
    const evento = await criarEvento({ titulo: "Audiência disputada", data: "2026-09-10" });
    const versaoDoAparelhoOffline = evento.updatedAt;

    // O outro aparelho (online) edita primeiro.
    const doOutro = esperado(
      await api.patch(`/events/${evento._id}`, { local: "Fórum — sala 3" }),
      200, "edição do aparelho online"
    );

    // Horas depois, a fila do aparelho que estava offline manda a dela.
    const r = await api.patch(
      `/events/${evento._id}`,
      { local: "Escritório" },
      comVersao(versaoDoAparelhoOffline)
    );

    assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.regra, "conflitoDeVersao");
    assert.match(r.body.message, /outro aparelho/);

    // O corpo carrega o que ESTÁ gravado — sem isso, a tela de pendências
    // teria de sair buscando o registro logo depois de uma falha de rede.
    assert.ok(r.body.errors?.atual, "o 409 precisa trazer o estado atual do servidor");
    assert.equal(r.body.errors.atual._id, String(evento._id));
    assert.equal(r.body.errors.atual.local, "Fórum — sala 3");
    assert.equal(r.body.errors.atualizadoEm, doOutro.updatedAt);
  });

  test("o 409 NÃO grava nada — a recusa é recusa", async () => {
    const evento = await criarEvento({ titulo: "Nada gravado no conflito", data: "2026-09-11" });
    const versaoVelha = evento.updatedAt;

    await api.patch(`/events/${evento._id}`, { local: "Primeiro" });

    const r = await api.patch(`/events/${evento._id}`, { local: "Segundo" }, comVersao(versaoVelha));
    assert.equal(r.status, 409);

    const atual = esperado(await api.get(`/events/${evento._id}`), 200, "leitura depois do 409");
    assert.equal(atual.local, "Primeiro", "o 409 escreveu assim mesmo");
  });

  test("a conclusão também é guardada pela versão", async () => {
    const evento = await criarEvento({ titulo: "Conclusão disputada", data: "2026-09-12" });
    const versaoVelha = evento.updatedAt;

    await api.patch(`/events/${evento._id}`, { local: "mudou por outro caminho" });

    const r = await api.patch(`/events/${evento._id}/concluir`, { concluido: true }, comVersao(versaoVelha));
    assert.equal(r.status, 409);
    assert.equal(r.body.regra, "conflitoDeVersao");

    const atual = esperado(await api.get(`/events/${evento._id}`), 200, "leitura");
    assert.equal(atual.concluido, false, "a conclusão passou apesar do conflito");
  });

  test("cabeçalho inválido é 400, e não 409 — são coisas diferentes", async () => {
    const evento = await criarEvento({ titulo: "Cabeçalho inválido", data: "2026-09-13" });
    const r = await api.patch(`/events/${evento._id}`, { local: "x" }, comVersao("ontem"));

    assert.equal(r.status, 400);
    assert.match(r.body.message, /X-If-Unmodified-Since/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// A fase do processo
// ═════════════════════════════════════════════════════════════════════════

describe("mudança de fase: a mesma guarda, e o histórico é o motivo", () => {
  test("com a versão em dia, muda", async () => {
    const antes = esperado(await api.get(`/processes/${processo._id}`), 200, "leitura");
    const r = await api.patch(
      `/processes/${processo._id}/fase`, { fase: "sentenca" }, comVersao(antes.updatedAt)
    );
    const depois = esperado(r, 200, "mudança com versão em dia");
    assert.equal(depois.fase, "sentenca");
  });

  test("com a versão velha, 409 — e o histórico NÃO ganha a transição fantasma", async () => {
    const antes = esperado(await api.get(`/processes/${processo._id}`), 200, "leitura");
    const versaoVelha = antes.updatedAt;

    // Outro aparelho muda primeiro: agora a fase é `execucao`.
    esperado(
      await api.patch(`/processes/${processo._id}/fase`, { fase: "execucao" }),
      200, "mudança do outro aparelho"
    );

    // A fila manda a dela, que partia de `sentenca`.
    const r = await api.patch(
      `/processes/${processo._id}/fase`, { fase: "recursos" }, comVersao(versaoVelha)
    );

    assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.regra, "conflitoDeVersao");
    assert.ok(r.body.errors?.atual, "o 409 precisa trazer o processo como está");
    assert.equal(r.body.errors.atual.fase, "execucao");

    const depois = esperado(await api.get(`/processes/${processo._id}`), 200, "leitura final");
    assert.equal(depois.fase, "execucao", "a fase foi sobrescrita pela gravação atrasada");
    assert.ok(
      !(depois.historicoFase ?? []).some((h) => h.para === "recursos"),
      "o histórico registrou uma transição que foi RECUSADA — pior que o dado errado, " +
      "porque o histórico é o que a linha do tempo lê"
    );
  });
});
