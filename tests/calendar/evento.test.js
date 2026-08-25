// ═══════════════════════════════════════════════════════════════════════════
// F-3, PARTE 1 — O EVENTO: CRUD, VALIDAÇÃO À MÃO, E O `null` QUE APAGA
//
// O fuso tem arquivo próprio (`fuso.test.js`), porque é o risco número um da
// fase e merece sair do relatório como bloco identificável.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, contarEm, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";

const COLECOES = [
  "users", "clients", "processes", "processo_clientes", "fees",
  "installments", "payments", "events"
];

let api;
let processo;

before(async () => {
  await subirApp();
  await limparColecoes(COLECOES);
  api = await registrarUsuario("advogada da F-3");
  const cliente = await criarClientePF(api);
  processo = await criarProcesso(api, [{ clienteId: cliente._id, papel: "autor", principal: true }]);
});

after(async () => {
  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

const evento = (extra = {}) => ({
  tipo: "audiencia",
  titulo: "Audiência de instrução",
  data: "2026-09-01",
  ...extra
});

describe("F-3 Parte 1 — o evento se grava", () => {
  test("criação com o mínimo: tipo, título e data", async () => {
    const corpo = esperado(await api.post("/events", evento()), 201, "criação mínima");

    assert.equal(corpo.tipo, "audiencia");
    assert.equal(corpo.titulo, "Audiência de instrução");
    assert.equal(corpo.data, "2026-09-01");
    // Os opcionais nascem `null`, e nunca `undefined`: é a convenção do
    // projeto, e é o que faz a tela distinguir "vazio" de "não veio".
    assert.equal(corpo.hora, null);
    assert.equal(corpo.descricao, null);
    assert.equal(corpo.local, null);
    assert.equal(corpo.processoId, null);
    assert.equal(corpo.concluido, false);
    assert.equal(corpo.concluidoEm, null);
  });

  test("o evento existe SOLTO — nem toda reunião é de um processo", async () => {
    const corpo = esperado(
      await api.post("/events", evento({ tipo: "reuniao", titulo: "Reunião de captação" })),
      201,
      "evento sem processo"
    );
    assert.equal(corpo.processoId, null);
    assert.equal(corpo.processo, null);
  });

  test("evento vinculado a processo devolve o processo projetado", async () => {
    const corpo = esperado(
      await api.post("/events", evento({ processoId: processo._id })),
      201,
      "evento com processo"
    );
    assert.equal(corpo.processoId, String(processo._id));
    assert.equal(corpo.processo.titulo, processo.titulo);
  });

  test("o rótulo do tipo vem PRONTO do backend — nenhuma tela o monta", async () => {
    const corpo = esperado(await api.post("/events", evento({ tipo: "prazo" })), 201, "prazo");
    assert.equal(corpo.tipoRotulo, "Prazo");
  });

  test("tipo fora do catálogo é 400, e a mensagem lista os aceitos", async () => {
    const r = await api.post("/events", evento({ tipo: "pericia" }));
    assert.equal(r.status, 400);
    assert.match(r.body.message, /audiencia, prazo, reuniao, outro/);
  });

  test("título vazio é 400", async () => {
    const r = await api.post("/events", evento({ titulo: "   " }));
    assert.equal(r.status, 400);
    assert.match(r.body.message, /título é obrigatório/);
  });

  test("data ausente é 400", async () => {
    const semData = evento();
    delete semData.data;
    const r = await api.post("/events", semData);
    assert.equal(r.status, 400);
    assert.match(r.body.message, /data é obrigatória/);
  });

  test("hora fora de HH:MM é 400; hora válida grava como veio", async () => {
    const ruim = await api.post("/events", evento({ hora: "25:00" }));
    assert.equal(ruim.status, 400);
    assert.match(ruim.body.message, /HH:MM/);

    const bom = esperado(await api.post("/events", evento({ hora: "14:30" })), 201, "hora válida");
    assert.equal(bom.hora, "14:30");
  });
});

describe("F-3 Parte 1 — o PATCH, e o `null` que apaga", () => {
  test("PATCH parcial não zera o que não foi enviado", async () => {
    const criado = esperado(
      await api.post("/events", evento({ descricao: "Levar as testemunhas", local: "Fórum" })),
      201,
      "criação"
    );

    const editado = esperado(
      await api.patch(`/events/${criado._id}`, { titulo: "Audiência remarcada" }),
      200,
      "patch parcial"
    );

    assert.equal(editado.titulo, "Audiência remarcada");
    assert.equal(editado.descricao, "Levar as testemunhas");
    assert.equal(editado.local, "Fórum");
  });

  test("`null` APAGA o campo opcional — a convenção do projeto", async () => {
    const criado = esperado(
      await api.post("/events", evento({ descricao: "some", local: "some", hora: "09:00" })),
      201,
      "criação"
    );

    const editado = esperado(
      await api.patch(`/events/${criado._id}`, { descricao: null, local: null, hora: null }),
      200,
      "patch com null"
    );

    assert.equal(editado.descricao, null);
    assert.equal(editado.local, null);
    assert.equal(editado.hora, null);
  });

  test("`data: null` é RECUSADO — evento sem data não tem onde existir", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "criação");
    const r = await api.patch(`/events/${criado._id}`, { data: null });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /não pode ser apagada/);
  });

  test("campo desconhecido é 400 e NOMEIA o campo", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "criação");
    const r = await api.patch(`/events/${criado._id}`, { prioridade: "alta" });
    assert.equal(r.status, 400);
    assert.equal(r.body.campo, "prioridade");
  });

  test("`ativo` no corpo é 400 e manda para o DELETE", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "criação");
    const r = await api.patch(`/events/${criado._id}`, { ativo: false });
    assert.equal(r.status, 400);
    assert.equal(r.body.campo, "ativo");
    assert.match(r.body.message, /DELETE \/api\/events\/:id/);
  });

  test("`concluido` no PATCH comum é 400 e manda para a rota própria", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "criação");
    const r = await api.patch(`/events/${criado._id}`, { concluido: true });
    assert.equal(r.status, 400);
    assert.equal(r.body.campo, "concluido");
    assert.match(r.body.message, /PATCH \/api\/events\/:id\/concluir/);
  });

  test("PUT NÃO existe: recurso novo não ganha o alias depreciado", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "criação");
    const r = await api.put(`/events/${criado._id}`, { titulo: "por PUT" });
    assert.equal(r.status, 404);
  });
});

describe("F-3 Parte 1 — conclusão e exclusão", () => {
  test("concluir grava o carimbo; desmarcar o LIMPA", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "criação");

    const concluido = esperado(
      await api.patch(`/events/${criado._id}/concluir`, { concluido: true }),
      200,
      "concluir"
    );
    assert.equal(concluido.concluido, true);
    assert.ok(concluido.concluidoEm, "concluidoEm precisa ser carimbado");

    const desmarcado = esperado(
      await api.patch(`/events/${criado._id}/concluir`, { concluido: false }),
      200,
      "desmarcar"
    );
    assert.equal(desmarcado.concluido, false);
    // O carimbo sai junto: um `concluidoEm` sobrevivente seria a data de uma
    // conclusão desfeita, e quem o lesse depois não teria como saber disso.
    assert.equal(desmarcado.concluidoEm, null);
  });

  test("conclusão sem booleano é 400", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "criação");
    const r = await api.patch(`/events/${criado._id}/concluir`, { concluido: "sim" });
    assert.equal(r.status, 400);
  });

  test("DELETE é soft delete: some da leitura, fica no banco", async () => {
    const criado = esperado(await api.post("/events", evento({ titulo: "para apagar" })), 201, "criação");

    esperado(await api.delete(`/events/${criado._id}`), 200, "delete");

    const depois = await api.get(`/events/${criado._id}`);
    assert.equal(depois.status, 404);

    const noBanco = await contarEm("events", { titulo: "para apagar" });
    assert.equal(noBanco, 1, "soft delete não apaga o documento");
  });

  test("reativar devolve o evento à leitura", async () => {
    const criado = esperado(await api.post("/events", evento({ titulo: "vai e volta" })), 201, "criação");
    esperado(await api.delete(`/events/${criado._id}`), 200, "delete");

    esperado(await api.patch(`/events/${criado._id}/reactivate`), 200, "reativar");
    esperado(await api.get(`/events/${criado._id}`), 200, "leitura depois de reativar");
  });

  test("reativar o que já está ativo é 404 — a tela ofereceu o que não existia", async () => {
    const criado = esperado(await api.post("/events", evento()), 201, "criação");
    const r = await api.patch(`/events/${criado._id}/reactivate`);
    assert.equal(r.status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ISOLAMENTO POR USUÁRIA — a regra 1 do projeto, aplicada à entidade nova
//
// Toda entidade tem `usuarioId`, e toda busca, listagem, atualização e exclusão
// inclui `{ usuarioId }` no filtro. Uma entidade nova é exatamente onde essa
// linha costuma faltar, porque ela funciona perfeitamente com um usuário só.
//
// O bloco grande de isolamento vive em `tests/isolation/tenant.test.js` e
// cobre as entidades antigas. Este fica aqui, junto do CRUD que ele guarda:
// quem mexer no `eventService` lê os dois no mesmo arquivo.
// ═══════════════════════════════════════════════════════════════════════════
describe("F-3 Parte 1 — isolamento por usuária", () => {
  test("B não lê, não edita, não conclui e não apaga o evento de A", async () => {
    const b = await registrarUsuario("advogada B");

    const deA = esperado(
      await api.post("/events", evento({ titulo: "Audiência de A" })),
      201,
      "evento de A"
    );

    // 404, e não 403: a resposta não confirma que o registro existe. É o mesmo
    // tratamento de todo o resto do projeto.
    assert.equal((await b.get(`/events/${deA._id}`)).status, 404, "leitura");
    assert.equal((await b.patch(`/events/${deA._id}`, { titulo: "sequestrado" })).status, 404, "edição");
    assert.equal((await b.patch(`/events/${deA._id}/concluir`, { concluido: true })).status, 404, "conclusão");
    assert.equal((await b.delete(`/events/${deA._id}`)).status, 404, "exclusão");

    // E o evento de A continua intacto depois das quatro tentativas.
    const aindaDeA = esperado(await api.get(`/events/${deA._id}`), 200, "releitura por A");
    assert.equal(aindaDeA.titulo, "Audiência de A");
    assert.equal(aindaDeA.concluido, false);
  });

  test("a listagem e o calendário de B não enxergam nada de A", async () => {
    const b = await registrarUsuario("advogada B2");

    const lista = esperado(await b.get("/events"), 200, "listagem de B");
    assert.equal(lista.total, 0, "B começa sem evento nenhum");

    const calendario = esperado(
      await b.get("/calendar?de=2026-01-01&ate=2026-12-31"),
      200,
      "calendário de B"
    );
    assert.equal(calendario.itens.length, 0, "o ano inteiro de B está vazio");

    const sino = esperado(await b.get("/calendar/avisos"), 200, "sino de B");
    assert.equal(sino.total, 0);
  });

  test("sem sessão, nenhuma das rotas responde", async () => {
    const { ClienteApi } = await import("../helpers/client.js");
    const anonimo = new ClienteApi("sem sessão");

    assert.equal((await anonimo.get("/events")).status, 401);
    assert.equal((await anonimo.get("/calendar?de=2026-09-01&ate=2026-09-30")).status, 401);
    assert.equal((await anonimo.get("/calendar/avisos")).status, 401);
    assert.equal((await anonimo.post("/events", evento())).status, 401);
  });
});
