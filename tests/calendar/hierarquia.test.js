// ═══════════════════════════════════════════════════════════════════════════
// F-3 — A DEC-053 ALCANÇA EVENTO, NAS DUAS BOCAS
//
// A regra é a mesma de sempre: nenhum registro fica ATIVO enquanto o pai dele
// estiver INATIVO — nem subindo (reativar), nem nascendo (criar).
//
// ── O que Evento traz de novo: o pai OPCIONAL ──────────────────────────
// É o primeiro filho da árvore cujo pai pode não existir. O evento solto não
// tem pai, e a regra **não se aplica** a ele — não porque o dispense, mas
// porque a pergunta não existe. É a distinção que este arquivo trava: o evento
// solto continua criável e reativável, sempre.
//
// ── E a terceira porta ─────────────────────────────────────────────────
// `PATCH /events/:id` com `processoId` MOVENDO o evento para um processo
// desativado. É a mesma porta que a F-2d fechou em `PATCH /fees/:id`, e sem
// ela o órfão nasceria pela edição em vez de pela criação.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";
import { ARVORE_DE_ATIVACAO } from "../../src/services/activationHierarchy.js";
import { reativarEvento } from "../../src/services/eventService.js";

const COLECOES = ["users", "clients", "processes", "processo_clientes", "fees", "installments", "events"];

let api;

before(async () => {
  await subirApp();
  await limparColecoes(COLECOES);
  api = await registrarUsuario("advogada da hierarquia");
});

after(async () => {
  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

// Um processo próprio por teste, desativado ou não — cenários que compartilham
// processo se contaminam quando um deles o desativa.
const processoNovo = async ({ desativado = false } = {}) => {
  const cliente = await criarClientePF(api);
  const processo = await criarProcesso(api, [
    { clienteId: cliente._id, papel: "autor", principal: true }
  ]);
  if (desativado) esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");
  return processo;
};

const evento = (extra = {}) => ({
  tipo: "reuniao",
  titulo: "Reunião de alinhamento",
  data: "2026-09-01",
  ...extra
});

describe("DEC-053 — Evento está na ÁRVORE, com o pai opcional anotado", () => {
  test("a árvore conhece Evento, e diz que o pai é opcional", () => {
    const no = ARVORE_DE_ATIVACAO.Event;
    assert.ok(no, "Evento precisa estar na árvore — é dela que a auditoria sai");
    assert.deepEqual([...no.pais], ["Process"]);
    assert.equal(no.paiOpcional, true, "o evento solto não tem pai, e a regra não se aplica");
    assert.equal(no.colecao, "events");
  });
});

describe("DEC-053, boca 2 — o evento não NASCE sob processo inativo", () => {
  test("criar sob processo desativado é 409, e a recusa NOMEIA o processo", async () => {
    const processo = await processoNovo({ desativado: true });

    const r = await api.post("/events", evento({ processoId: processo._id }));

    assert.equal(r.status, 409);
    assert.equal(r.body.regra, "paiInativo");
    // A frase nomeia o pai PELO NOME e diz o que fazer. Recusar em silêncio é
    // pior que permitir: uma mensagem genérica manda a advogada procurar qual
    // dos processos dela está fora.
    assert.match(r.body.message, new RegExp(processo.titulo));
    assert.match(r.body.message, /está desativado/);
    assert.match(r.body.message, /Reative o processo primeiro/);
    assert.equal(r.body.errors.paisInativos[0].tipo, "Process");
    assert.equal(r.body.errors.paisInativos[0].id, String(processo._id));
  });

  test("o verbo da recusa é o da AÇÃO recusada — 'criar o evento'", async () => {
    const processo = await processoNovo({ desativado: true });
    const r = await api.post("/events", evento({ processoId: processo._id }));
    assert.match(r.body.message, /Não é possível criar o evento/);
  });

  test("o evento SOLTO nasce sempre — a regra não se aplica a ele", async () => {
    // Nem toda reunião é de um processo. Um evento sem processo não tem pai que
    // possa estar inativo, e recusá-lo seria aplicar a regra onde ela não existe.
    esperado(await api.post("/events", evento()), 201, "evento solto");
    esperado(await api.post("/events", evento({ processoId: null })), 201, "processoId null explícito");
  });

  test("processo INEXISTENTE continua 404 — a mensagem não confirma o alheio", async () => {
    const r = await api.post("/events", evento({ processoId: "507f1f77bcf86cd799439011" }));
    assert.equal(r.status, 404);
    // 404, e não 409: a distinção é a mesma da F-2c. "Não existe" e "está
    // desativado" são respostas diferentes, e confundi-las é o defeito que a
    // DEC-053 nomeou.
    assert.match(r.body.message, /não encontrado/);
  });
});

describe("DEC-053, boca 1 — o evento não SOBE sem o pai", () => {
  test("reativar sob processo desativado é 409, nomeando o processo", async () => {
    const processo = await processoNovo();

    const criado = esperado(
      await api.post("/events", evento({ processoId: processo._id })),
      201,
      "evento sob processo ativo"
    );
    esperado(await api.delete(`/events/${criado._id}`), 200, "desativar o evento");
    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar o processo");

    const r = await api.patch(`/events/${criado._id}/reactivate`);

    assert.equal(r.status, 409);
    assert.equal(r.body.regra, "paiInativo");
    assert.match(r.body.message, new RegExp(processo.titulo));
    assert.match(r.body.message, /Não é possível reativar/);
  });

  test("A AUTORIDADE É DO SERVIÇO — a recusa vale para quem chama direto", async () => {
    const processo = await processoNovo();
    const criado = esperado(
      await api.post("/events", evento({ processoId: processo._id })),
      201,
      "evento"
    );
    esperado(await api.delete(`/events/${criado._id}`), 200, "desativar o evento");
    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar o processo");

    // Sem passar por rota nenhuma. É o mesmo teste que a F-2c escreveu para
    // `reactivateProcess`, e pela mesma razão: a tela é conveniência, a regra
    // mora no serviço.
    await assert.rejects(
      () => reativarEvento(api.usuario._id ?? api.usuario.id, criado._id),
      (erro) => {
        assert.equal(erro.statusCode, 409);
        assert.equal(erro.regra, "paiInativo");
        return true;
      }
    );
  });

  test("o evento SOLTO reativa sempre", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "evento solto");
    esperado(await api.delete(`/events/${criado._id}`), 200, "desativar");
    esperado(await api.patch(`/events/${criado._id}/reactivate`), 200, "reativar solto");
  });

  test("reativar com o processo DE PÉ funciona", async () => {
    const processo = await processoNovo();
    const criado = esperado(
      await api.post("/events", evento({ processoId: processo._id })),
      201,
      "evento"
    );
    esperado(await api.delete(`/events/${criado._id}`), 200, "desativar só o evento");
    esperado(await api.patch(`/events/${criado._id}/reactivate`), 200, "reativar");
  });
});

describe("DEC-053, a TERCEIRA porta — MOVER para processo inativo", () => {
  test("PATCH com processoId de processo desativado é 409", async () => {
    const vivo = await processoNovo();
    const morto = await processoNovo({ desativado: true });

    const criado = esperado(
      await api.post("/events", evento({ processoId: vivo._id })),
      201,
      "evento sob processo vivo"
    );

    const r = await api.patch(`/events/${criado._id}`, { processoId: morto._id });

    assert.equal(r.status, 409);
    assert.equal(r.body.regra, "paiInativo");
    assert.match(r.body.message, /Não é possível mover o evento/);
  });

  test("SOLTAR o evento de um processo é permitido — `processoId: null`", async () => {
    const vivo = await processoNovo();
    const criado = esperado(
      await api.post("/events", evento({ processoId: vivo._id })),
      201,
      "evento vinculado"
    );

    const solto = esperado(
      await api.patch(`/events/${criado._id}`, { processoId: null }),
      200,
      "soltar"
    );
    assert.equal(solto.processoId, null);
  });
});
