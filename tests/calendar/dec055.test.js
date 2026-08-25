// ═══════════════════════════════════════════════════════════════════════════
// DEC-055 — O QUE É FATO SE GRAVA; O QUE É DERIVADO SE DERIVA
//
// As duas provas que sustentam a decisão inteira:
//
//   1. o intervalo devolve as DUAS naturezas juntas, com discriminador;
//   2. **nenhuma derivada é GRAVADA** — contagem de documentos em `events`
//      antes e depois de consultar o calendário.
//
// A segunda é a que importa. A primeira só mostra que a leitura funciona; a
// segunda é a que prova que a leitura não deixou rastro — e o rastro é
// exatamente o que a decisão proíbe, porque duas fontes para a mesma data
// divergem no primeiro reparcelamento.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, contarEm, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarReparcelamento, esperado
} from "../helpers/setup.js";

const COLECOES = [
  "users", "clients", "processes", "processo_clientes", "fees",
  "installments", "payments", "renegotiations", "allocations", "events"
];

let api;
let processo;
let honorario;

before(async () => {
  await subirApp();
  await limparColecoes(COLECOES);
  api = await registrarUsuario("advogada da DEC-055");
  const cliente = await criarClientePF(api);
  processo = await criarProcesso(api, [{ clienteId: cliente._id, papel: "autor", principal: true }]);

  // Um honorário com plano de parcelas em setembro/2026. As datas são fixas —
  // um teste de calendário ancorado em "hoje" mudaria de resultado por dia da
  // semana e por virada de mês.
  honorario = await criarHonorario(api, processo._id, { valor: 3000, descricao: "Honorário do plano" });
  await criarParcela(api, honorario._id, 1, { valor: 1000, dataVencimento: "2026-09-10" });
  await criarParcela(api, honorario._id, 2, { valor: 1000, dataVencimento: "2026-09-20" });
  await criarParcela(api, honorario._id, 3, { valor: 1000, dataVencimento: "2026-10-05" });

  // Um evento próprio no mesmo mês, para as duas naturezas caírem na mesma
  // janela.
  esperado(
    await api.post("/events", {
      tipo: "audiencia",
      titulo: "Audiência de instrução",
      data: "2026-09-15",
      hora: "14:30",
      processoId: processo._id
    }),
    201,
    "evento próprio"
  );
});

after(async () => {
  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

const setembro = () => api.get("/calendar?de=2026-09-01&ate=2026-09-30");

describe("DEC-055 — o intervalo devolve as duas naturezas, com discriminador", () => {
  test("evento e derivada saem juntos, e cada um diz o que é", async () => {
    const corpo = esperado(await setembro(), 200, "calendário de setembro");

    const eventos = corpo.itens.filter((i) => i.natureza === "evento");
    const derivadas = corpo.itens.filter((i) => i.natureza === "derivada");

    assert.equal(eventos.length, 1, "um evento próprio em setembro");
    assert.equal(derivadas.length, 2, "duas parcelas vencem em setembro");

    // TODO item tem a chave, e ela é de primeiro nível. Uma tela que tivesse de
    // INFERIR a natureza (pela presença de `feeId`, digamos) inferiria errado no
    // dia em que um evento ganhasse vínculo com honorário.
    for (const item of corpo.itens) {
      assert.ok(["evento", "derivada"].includes(item.natureza), `natureza de "${item.titulo}"`);
    }
  });

  test("a derivada carrega a ORIGEM e o id de lá — para o clique saber para onde ir", async () => {
    const corpo = esperado(await setembro(), 200, "calendário");
    const derivada = corpo.itens.find((i) => i.natureza === "derivada");

    assert.equal(derivada.origem, "parcela");
    assert.ok(derivada._id, "o id da PARCELA, não de um evento inventado");
    assert.equal(derivada.feeId, String(honorario._id));
  });

  test("a derivada NÃO é editável no calendário, e diz isso explicitamente", async () => {
    const corpo = esperado(await setembro(), 200, "calendário");

    for (const item of corpo.itens.filter((i) => i.natureza === "derivada")) {
      assert.equal(item.editavelNoCalendario, false, `"${item.titulo}" não pode ser editável aqui`);
    }
    for (const item of corpo.itens.filter((i) => i.natureza === "evento")) {
      assert.equal(item.editavelNoCalendario, true, `"${item.titulo}" é fato próprio e se edita`);
    }
  });

  test("o rótulo da parcela vem PRONTO, na redação da DEC-048", async () => {
    const corpo = esperado(await setembro(), 200, "calendário");
    const derivada = corpo.itens.find((i) => i.origem === "parcela");
    // Plano ABERTO: `totalParcelas` é `null` e o rótulo não inventa um "de N".
    assert.match(derivada.titulo, /^Parcela \d+$/);
  });

  test("a ordenação é por dia, e o item sem hora vem antes do que tem hora", async () => {
    const corpo = esperado(await setembro(), 200, "calendário");
    const datas = corpo.itens.map((i) => i.data);
    assert.deepEqual([...datas].sort(), datas, "os itens saem em ordem de data");
  });

  test("`hoje` viaja na resposta — a tela não tem como saber o hoje do servidor", async () => {
    const corpo = esperado(await setembro(), 200, "calendário");
    assert.match(corpo.hoje, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("DEC-055 — NENHUMA derivada é gravada", () => {
  test("consultar o calendário não cria documento nenhum em `events`", async () => {
    const antes = await contarEm("events");

    // Consultas repetidas, e em janelas diferentes: se houvesse escrita
    // preguiçosa ("grava na primeira leitura"), ela apareceria aqui.
    esperado(await setembro(), 200, "1ª leitura");
    esperado(await api.get("/calendar?de=2026-10-01&ate=2026-10-31"), 200, "outubro");
    esperado(await setembro(), 200, "2ª leitura de setembro");
    esperado(await api.get("/calendar?de=2026-01-01&ate=2026-12-31"), 200, "o ano inteiro");

    const depois = await contarEm("events");

    assert.equal(
      depois,
      antes,
      `o calendário gravou ${depois - antes} documento(s) em \`events\`. ` +
      "Data derivada se DERIVA — gravá-la cria a segunda fonte que a DEC-055 proíbe."
    );
  });

  test("o sino também não grava", async () => {
    const antes = await contarEm("events");
    esperado(await api.get("/calendar/avisos"), 200, "avisos");
    esperado(await api.get("/calendar/avisos"), 200, "avisos de novo");
    assert.equal(await contarEm("events"), antes);
  });

  test("não existe rota de ESCRITA em /calendar — a ausência é a decisão", async () => {
    // Se alguma destas responder 2xx, existe um lugar onde alguém gravaria a
    // derivada — e é exatamente isso que a decisão proíbe.
    const post = await api.post("/calendar", { titulo: "gravado à força", data: "2026-09-01" });
    assert.equal(post.status, 404, "POST /calendar não pode existir");

    const patch = await api.patch("/calendar/qualquer", { data: "2026-09-02" });
    assert.equal(patch.status, 404, "PATCH /calendar/:id não pode existir");

    const del = await api.delete("/calendar/qualquer");
    assert.equal(del.status, 404, "DELETE /calendar/:id não pode existir");
  });
});

describe("DEC-055 — a parcela cancelada por reparcelamento NÃO aparece", () => {
  test("depois do reparcelamento, o calendário mostra o plano NOVO e só ele", async () => {
    const proprio = await criarHonorario(api, processo._id, {
      valor: 2000,
      descricao: "Honorário que vai ser reparcelado"
    });
    await criarParcela(api, proprio._id, 1, { valor: 1000, dataVencimento: "2026-11-10" });
    await criarParcela(api, proprio._id, 2, { valor: 1000, dataVencimento: "2026-11-20" });

    const antes = esperado(
      await api.get("/calendar?de=2026-11-01&ate=2026-11-30"),
      200,
      "novembro antes"
    );
    const doHonorario = (corpo) =>
      corpo.itens.filter((i) => i.natureza === "derivada" && i.feeId === String(proprio._id));
    assert.equal(doHonorario(antes).length, 2, "as duas parcelas originais");

    // O reparcelamento cancela as duas e cria UMA em dezembro.
    await criarReparcelamento(api, proprio._id, [
      { valor: 2000, dataVencimento: "2026-12-15" }
    ]);

    const depois = esperado(
      await api.get("/calendar?de=2026-11-01&ate=2026-11-30"),
      200,
      "novembro depois"
    );

    assert.equal(
      doHonorario(depois).length,
      0,
      "as parcelas canceladas por reparcelamento somem do calendário — é a mesma " +
      "regra do dashboard, e é ela que impede a agenda de mostrar cobrança que " +
      "não existe mais"
    );

    const dezembro = esperado(
      await api.get("/calendar?de=2026-12-01&ate=2026-12-31"),
      200,
      "dezembro"
    );
    assert.equal(doHonorario(dezembro).length, 1, "a parcela do plano novo aparece");
  });

  test("parcela de honorário CANCELADO não aparece", async () => {
    const cancelado = await criarHonorario(api, processo._id, {
      valor: 500,
      descricao: "Honorário cancelado"
    });
    await criarParcela(api, cancelado._id, 1, { valor: 500, dataVencimento: "2027-01-15" });

    const antes = esperado(await api.get("/calendar?de=2027-01-01&ate=2027-01-31"), 200, "antes");
    assert.equal(antes.itens.filter((i) => i.feeId === String(cancelado._id)).length, 1);

    esperado(await api.patch(`/fees/${cancelado._id}`, { status: "cancelado" }), 200, "cancelar");

    const depois = esperado(await api.get("/calendar?de=2027-01-01&ate=2027-01-31"), 200, "depois");
    assert.equal(depois.itens.filter((i) => i.feeId === String(cancelado._id)).length, 0);
  });
});

describe("DEC-055 — o intervalo, e a recusa que já tinha redação", () => {
  test("intervalo INVERTIDO recusa com a MENSAGEM EXISTENTE (passo 174)", async () => {
    const r = await api.get("/calendar?de=2026-09-30&ate=2026-09-01");

    assert.equal(r.status, 400);
    assert.equal(r.body.campo, "de");
    // A frase é a de `filtroPeriodo`, e não uma redação nova. Duas frases
    // diferentes para o mesmo engano, em duas telas do mesmo sistema, é o que
    // faz a advogada achar que são dois problemas.
    assert.match(r.body.message, /é posterior ao fim/);
    assert.match(r.body.message, /Inverta as duas datas/);
  });

  test("a mesma frase sai da listagem financeira — é a MESMA regra", async () => {
    const doCalendario = await api.get("/calendar?de=2026-09-30&ate=2026-09-01");
    const daListagem = await api.get("/installments?de=2026-09-30&ate=2026-09-01");

    assert.equal(daListagem.status, 400);
    assert.equal(
      doCalendario.body.message,
      daListagem.body.message,
      "as duas telas dizem exatamente a mesma coisa"
    );
  });

  test("as duas bordas são OBRIGATÓRIAS — não existe calendário aberto de um lado", async () => {
    const semDe = await api.get("/calendar?ate=2026-09-30");
    assert.equal(semDe.status, 400);
    assert.equal(semDe.body.campo, "de");

    const semAte = await api.get("/calendar?de=2026-09-01");
    assert.equal(semAte.status, 400);
    assert.equal(semAte.body.campo, "ate");
  });

  test("janela maior que um ano é recusada, e a frase DIZ o tamanho pedido", async () => {
    const r = await api.get("/calendar?de=2020-01-01&ate=2030-01-01");
    assert.equal(r.status, 400);
    assert.equal(r.body.campo, "ate");
    assert.match(r.body.message, /\d+ dias/);
  });

  test("data em formato torto é 400, e nomeia o campo", async () => {
    const r = await api.get("/calendar?de=01/09/2026&ate=2026-09-30");
    assert.equal(r.status, 400);
    assert.equal(r.body.campo, "de");
  });

  test("366 dias PASSA — o ano bissexto é o maior ano", async () => {
    esperado(await api.get("/calendar?de=2024-01-01&ate=2024-12-31"), 200, "2024 inteiro");
  });
});
