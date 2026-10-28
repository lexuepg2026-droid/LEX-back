// ═══════════════════════════════════════════════════════════════════════════
// DEC-138 — busca, período e só documentos em `GET /documents` (Fase 3.9a)
//
// `?busca=` (nome do documento, número do processo, nome do cliente — sem
// acento e sem caixa), `?de=&ate=` (por `dataGeracao`, bordas em UTC),
// `?ehModelo=false|true`, a chave nova `cliente` em cada linha, e `?busca=`
// em `GET /documents/modelos`.
//
// Só acréscimos: sem os parâmetros novos a listagem é a de sempre, e há teste
// para isso também.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar, conectar, COLECOES } from "../helpers/db.js";
import {
  registrarUsuario, criarProcesso, criarClientePF, criarSecao, criarModelo, vincularSecao, esperado
} from "../helpers/setup.js";

const nomes = (corpo) => corpo.data.map((d) => d.nome).sort();

describe("DEC-138 — a lista de documentos: busca, período e só documentos", () => {
  let adv;
  let outra;
  let modelo;
  let joao;
  let maria;
  let pJoao;
  let pMaria;
  const d = {};

  // Gera um documento e grava o nome e a data de geração pedidos — a data
  // real seria "agora", e o recorte precisa de datas conhecidas.
  const gerarDocumento = async (quem, modeloId, processo, cliente, nome, dataGeracao) => {
    const corpo = esperado(
      await quem.post(`/documents/modelos/${modeloId}/gerar`, { processoId: processo._id, clienteId: cliente._id }),
      201,
      `gerar ${nome}`
    );
    const documento = corpo.documento ?? corpo;
    await conectar();
    await mongoose.connection.db.collection(COLECOES.DOCUMENTS).updateOne(
      { _id: new mongoose.Types.ObjectId(String(documento._id)) },
      { $set: { nome, dataGeracao: new Date(dataGeracao) } }
    );
    return documento;
  };

  const montarModelo = async (quem, nome) => {
    const secao = await criarSecao(quem);
    const m = await criarModelo(quem, { nome });
    await vincularSecao(quem, m._id, secao._id);
    return m;
  };

  before(async () => {
    await subirApp();
    await limparColecoes();
    adv = await registrarUsuario("dona dos documentos");
    outra = await registrarUsuario("outra advogada");

    joao = await criarClientePF(adv, { nomeCompleto: "João Inventariante" });
    maria = await criarClientePF(adv, { nomeCompleto: "Maria Autora" });
    pJoao = await criarProcesso(adv, [{ clienteId: joao._id, papel: "autor", principal: true }], {
      titulo: "Inventário do João", numeroProcesso: "0001111-22.2026.8.16.0019"
    });
    pMaria = await criarProcesso(adv, [{ clienteId: maria._id, papel: "autor", principal: true }], {
      titulo: "Cobrança da Maria", numeroProcesso: "0009999-88.2026.8.16.0019"
    });

    modelo = await montarModelo(adv, "Procuração de teste");

    // A virada de setembro para outubro, em UTC: 30/09 às 23:59 e 01/10 às 00:00.
    d.procuracao = await gerarDocumento(adv, modelo._id, pJoao, joao, "Procuração ad judicia", "2026-09-30T23:59:00Z");
    d.contrato = await gerarDocumento(adv, modelo._id, pMaria, maria, "Contrato de honorários", "2026-10-01T00:00:00Z");
    d.declaracao = await gerarDocumento(adv, modelo._id, pMaria, maria, "Declaração de hipossuficiência", "2026-10-31T23:59:59Z");
    d.novembro = await gerarDocumento(adv, modelo._id, pJoao, joao, "Petição de novembro", "2026-11-01T00:00:00Z");

    // A outra advogada: o mesmo nome de documento e de cliente, na mesma data.
    const delaCliente = await criarClientePF(outra, { nomeCompleto: "João Inventariante" });
    const delaProcesso = await criarProcesso(outra, [{ clienteId: delaCliente._id, papel: "autor", principal: true }], {
      numeroProcesso: "0001111-22.2026.8.16.0020"
    });
    const delaModelo = await montarModelo(outra, "Procuração de teste");
    await gerarDocumento(outra, delaModelo._id, delaProcesso, delaCliente, "Procuração ad judicia", "2026-10-01T12:00:00Z");
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  const lista = async (query, quem = adv) =>
    esperado(await quem.get(`/documents?limit=100${query ? `&${query}` : ""}`), 200, `lista ${query}`);

  // ── Sem os parâmetros novos: a de sempre ────────────────────────────────
  test("sem os parâmetros novos, a listagem de sempre: documentos E modelos, mais novos primeiro", async () => {
    const corpo = await lista("");
    // 4 documentos + 1 modelo, todos da usuária.
    assert.equal(corpo.total, 5);
    assert.ok(corpo.data.some((x) => x.ehModelo === true), "o modelo continua na listagem sem `ehModelo`");
    for (const chave of ["data", "total", "page", "limit", "totalPages"]) assert.ok(chave in corpo, chave);
    // `processoId` continua populado, e `clienteId` continua id.
    const contrato = corpo.data.find((x) => x.nome === "Contrato de honorários");
    assert.equal(contrato.processoId.numeroProcesso, "0009999-88.2026.8.16.0019");
    assert.equal(typeof contrato.clienteId, "string");
  });

  test("a chave nova `cliente`: { _id, nome } do documento; o modelo não tem cliente", async () => {
    const corpo = await lista("");
    const contrato = corpo.data.find((x) => x.nome === "Contrato de honorários");
    assert.deepEqual(contrato.cliente, { _id: String(maria._id), nome: "Maria Autora" });
    const doModelo = corpo.data.find((x) => x.ehModelo === true);
    assert.equal(doModelo.cliente, null);
  });

  // ── ehModelo ────────────────────────────────────────────────────────────
  test("`?ehModelo=false` tira os modelos — e o total e as páginas fecham", async () => {
    const corpo = await lista("ehModelo=false");
    assert.equal(corpo.total, 4);
    assert.ok(corpo.data.every((x) => x.ehModelo !== true));
    const pagina2 = esperado(await adv.get("/documents?ehModelo=false&limit=3&page=2"), 200, "página 2");
    assert.equal(pagina2.total, 4);
    assert.equal(pagina2.totalPages, 2);
    assert.equal(pagina2.data.length, 1);
  });

  test("`?ehModelo=true` só os modelos; outro valor → 400 com `campo`", async () => {
    const corpo = await lista("ehModelo=true");
    assert.deepEqual(nomes(corpo), ["Procuração de teste"]);
    const r = await adv.get("/documents?ehModelo=nao");
    assert.equal(r.status, 400);
    assert.equal(r.body.campo, "ehModelo");
  });

  // ── Busca ───────────────────────────────────────────────────────────────
  test("busca pelo nome do documento, sem acento e sem caixa", async () => {
    assert.deepEqual(nomes(await lista("ehModelo=false&busca=DECLARACAO")), ["Declaração de hipossuficiência"]);
    assert.deepEqual(nomes(await lista("ehModelo=false&busca=peticao")), ["Petição de novembro"]);
  });

  test("busca pelo número do processo", async () => {
    assert.deepEqual(
      nomes(await lista("ehModelo=false&busca=0009999")),
      ["Contrato de honorários", "Declaração de hipossuficiência"]
    );
  });

  test("busca pelo nome do cliente, sem acento", async () => {
    assert.deepEqual(
      nomes(await lista("ehModelo=false&busca=joao")),
      ["Petição de novembro", "Procuração ad judicia"]
    );
  });

  test("busca: metacaractere é literal; vazia é a listagem sem busca", async () => {
    assert.equal((await lista("ehModelo=false&busca=.*")).total, 0);
    assert.equal((await lista("ehModelo=false&busca=%20%20")).total, 4);
  });

  // ── Período ─────────────────────────────────────────────────────────────
  test("período por `dataGeracao`, na virada do mês, bordas em UTC", async () => {
    assert.deepEqual(
      nomes(await lista("ehModelo=false&de=2026-10-01&ate=2026-10-31")),
      ["Contrato de honorários", "Declaração de hipossuficiência"]
    );
    assert.deepEqual(
      nomes(await lista("ehModelo=false&de=2026-09-30&ate=2026-10-01")),
      ["Contrato de honorários", "Procuração ad judicia"]
    );
    assert.deepEqual(nomes(await lista("ehModelo=false&de=2026-11-01")), ["Petição de novembro"]);
    assert.deepEqual(nomes(await lista("ehModelo=false&ate=2026-09-30")), ["Procuração ad judicia"]);
  });

  test("com período, o modelo (sem data de geração) fica fora", async () => {
    assert.equal((await lista("de=2000-01-01")).data.some((x) => x.ehModelo === true), false);
  });

  test("período torto ou invertido → 400 com `campo`", async () => {
    const torto = await adv.get("/documents?de=2026-02-31");
    assert.equal(torto.status, 400);
    assert.equal(torto.body.campo, "de");
    const invertido = await adv.get("/documents?de=2026-10-31&ate=2026-10-01");
    assert.equal(invertido.status, 400);
    assert.equal(invertido.body.campo, "de");
  });

  // ── Combinados ──────────────────────────────────────────────────────────
  test("combinados: busca + período + processo", async () => {
    assert.deepEqual(
      nomes(await lista("ehModelo=false&busca=maria&de=2026-10-01&ate=2026-10-15")),
      ["Contrato de honorários"]
    );
    assert.deepEqual(
      nomes(await lista(`ehModelo=false&processoId=${pJoao._id}&busca=procuracao`)),
      ["Procuração ad judicia"]
    );
    assert.equal((await lista(`ehModelo=false&processoId=${pJoao._id}&busca=maria`)).total, 0);
  });

  // ── Isolamento ──────────────────────────────────────────────────────────
  test("isolamento por `usuarioId`: o mesmo nome, cliente e data da outra não aparecem", async () => {
    const minha = await lista("ehModelo=false&busca=joao&de=2026-10-01&ate=2026-10-01");
    assert.equal(minha.total, 0);
    const dela = await lista("ehModelo=false&busca=joao", outra);
    assert.deepEqual(nomes(dela), ["Procuração ad judicia"]);
    assert.equal(dela.data[0].cliente.nome, "João Inventariante");
    assert.equal((await lista("busca=0001111-22.2026.8.16.0020")).total, 0);
  });

  // ── Modelos ─────────────────────────────────────────────────────────────
  test("`GET /documents/modelos?busca=` pelo nome, sem acento; sem busca, a de sempre", async () => {
    await montarModelo(adv, "Declaração de autônomo");
    const todos = esperado(await adv.get("/documents/modelos?limit=100"), 200, "modelos");
    assert.equal(todos.total, 2);
    const achados = esperado(await adv.get("/documents/modelos?busca=AUTONOMO"), 200, "busca");
    assert.deepEqual(achados.data.map((m) => m.nome), ["Declaração de autônomo"]);
    const dela = esperado(await outra.get("/documents/modelos?busca=autonomo"), 200, "dela");
    assert.equal(dela.total, 0);
  });
});
