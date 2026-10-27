// ═══════════════════════════════════════════════════════════════════════════
// DEC-119 — clientes: os processos de um cliente e o portal por cliente
// (Fase 3.5)
//
// `GET /processes?clienteId=` (vínculo ATIVO, principal ou não),
// `GET /clients?portal=com_acesso|sem_acesso|nao_liberado` (o último pela regra
// da DEC-108/115, `liberacaoNoPortal.js`), `GET /clients?tipoPessoa=PF|PJ` e os
// campos novos de cada processo em `GET /clients/:id/acesso-portal`.
//
// Só acréscimos: sem os parâmetros novos as listagens são as de sempre, e o
// código pessoal continua fora de `GET /clients` e do detalhe comum.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarProcesso, criarClientePF, criarClientePJ, esperado } from "../helpers/setup.js";
import { dadosClientePF, dadosClientePJ } from "../helpers/factories.js";
import { liberarNoPortal, SENHA_PROVISORIA } from "../helpers/portal.js";

const ids = (corpo) => corpo.data.map((x) => String(x._id)).sort();
const de = (...registros) => registros.map((r) => String(r._id)).sort();

describe("DEC-119 — processos por cliente e portal por cliente", () => {
  let adv;
  let outra;
  const c = {};
  const p = {};

  before(async () => {
    await subirApp();
    await limparColecoes();
    adv = await registrarUsuario("dona dos clientes");
    outra = await registrarUsuario("outra advogada");

    const comPortal = async (dados, rotulo) =>
      esperado(await adv.post("/clients", { ...dados, senhaPortal: SENHA_PROVISORIA }), 201, rotulo);

    // Clientes: PF e PJ, com e sem portal, um desativado.
    c.ana = await comPortal(dadosClientePF({ nomeCompleto: "Ana Portal" }), "Ana");
    c.bia = await comPortal(dadosClientePF({ nomeCompleto: "Bia Portal" }), "Bia");
    c.empresa = await comPortal(dadosClientePJ({ razaoSocial: "Empresa Portal Ltda" }), "Empresa");
    c.semPortal = await criarClientePF(adv, { nomeCompleto: "Caio Sem Portal" });
    c.pjSemPortal = await criarClientePJ(adv, { razaoSocial: "Sem Portal Ltda" });
    c.desativado = await criarClientePF(adv, { nomeCompleto: "Davi Desativado" });
    esperado(await adv.delete(`/clients/${c.desativado._id}`), 200, "desativar Davi");

    const parte = (cliente, papel = "autor", principal = true) => ({ clienteId: cliente._id, papel, principal });

    // Ana: principal em P1 (liberado) e em P3 (não liberado), litisconsorte em
    // P2 (liberada), e removida à mão de P4 (vínculo inativo).
    p.p1 = await criarProcesso(adv, [parte(c.ana)], { titulo: "P1 Ana principal", numeroProcesso: "0000003-00.2026.8.16.0001", status: "ativo" });
    await liberarNoPortal(adv, p.p1._id, c.ana._id);
    p.p2 = await criarProcesso(adv, [parte(c.bia), parte(c.ana, "litisconsorte", false)], {
      titulo: "P2 Bia principal, Ana litisconsorte", numeroProcesso: "0000001-00.2026.8.16.0001", status: "suspenso"
    });
    await liberarNoPortal(adv, p.p2._id, c.ana._id);
    p.p3 = await criarProcesso(adv, [parte(c.ana)], { titulo: "P3 Ana não liberada", numeroProcesso: "0000002-00.2026.8.16.0001", tipoAcao: "Cobrança" });
    p.p4 = await criarProcesso(adv, [parte(c.bia), parte(c.ana, "litisconsorte", false)], { titulo: "P4 Ana removida", numeroProcesso: null });
    esperado(await adv.delete(`/processes/${p.p4._id}/clientes/${c.ana._id}`), 200, "remover Ana de P4");

    // Empresa: principal num processo não liberado e num desativado.
    p.p5 = await criarProcesso(adv, [parte(c.empresa)], { titulo: "P5 Empresa não liberada" });
    p.p6 = await criarProcesso(adv, [parte(c.empresa), parte(c.semPortal, "reu", false)], { titulo: "P6 desativado" });
    esperado(await adv.delete(`/processes/${p.p6._id}`), 200, "desativar P6");

    // Caio, sem portal, num processo próprio: não conta para "não liberado".
    p.p7 = await criarProcesso(adv, [parte(c.semPortal)], { titulo: "P7 Caio" });

    // A outra advogada: um cliente com portal e um processo não liberado.
    c.dela = esperado(await outra.post("/clients", { ...dadosClientePF({ nomeCompleto: "Cida Outra" }), senhaPortal: SENHA_PROVISORIA }), 201, "Cida");
    p.dela = await criarProcesso(outra, [parte(c.dela)], { titulo: "Processo da outra" });
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  const processos = async (query, quem = adv) =>
    esperado(await quem.get(`/processes?limit=100${query ? `&${query}` : ""}`), 200, `processos ${query}`);
  const clientes = async (query, quem = adv) =>
    esperado(await quem.get(`/clients?limit=100${query ? `&${query}` : ""}`), 200, `clientes ${query}`);

  describe("1. GET /processes?clienteId=", () => {
    test("os processos em que o cliente tem vínculo ativo, como principal ou não", async () => {
      assert.deepEqual(ids(await processos(`clienteId=${c.ana._id}`)), de(p.p1, p.p2, p.p3));
    });

    test("vínculo removido à mão fica fora", async () => {
      assert.ok(!ids(await processos(`clienteId=${c.ana._id}`)).includes(String(p.p4._id)));
      // E a Bia, que continua em P4, o vê.
      assert.ok(ids(await processos(`clienteId=${c.bia._id}`)).includes(String(p.p4._id)));
    });

    test("processo desativado fica fora mesmo com situacao=todos: a cascata derrubou o vínculo", async () => {
      // DEC-052: desativar o processo desativa os vínculos. "Vínculo ativo" é a
      // regra pedida, e ela não muda com a situação do registro.
      assert.deepEqual(ids(await processos(`clienteId=${c.empresa._id}&situacao=todos`)), de(p.p5));
      assert.deepEqual(ids(await processos(`clienteId=${c.empresa._id}&situacao=inativos`)), []);
    });

    test("combina com status, tipo de ação e portal (DEC-115)", async () => {
      assert.deepEqual(ids(await processos(`clienteId=${c.ana._id}&status=suspenso`)), de(p.p2));
      assert.deepEqual(ids(await processos(`clienteId=${c.ana._id}&tipoAcao=cobranca`)), de(p.p3));
      // O portal é recorte do PROCESSO, por qualquer participante: P3 tem a
      // Ana não liberada e P2 tem a Bia não liberada (a Ana está liberada lá).
      // P5 também é "não liberado", mas é da Empresa e fica fora pelo cliente.
      assert.deepEqual(ids(await processos(`clienteId=${c.ana._id}&portal=nao_liberado`)), de(p.p2, p.p3));
      assert.deepEqual(ids(await processos(`clienteId=${c.ana._id}&portal=liberado`)), de(p.p1));
    });

    test("combina com a busca", async () => {
      assert.deepEqual(ids(await processos(`clienteId=${c.ana._id}&busca=litisconsorte`)), de(p.p2));
    });

    test("clienteId inválido é 400 com campo", async () => {
      for (const torto of ["abc", "123", "x".repeat(24)]) {
        const r = await adv.get(`/processes?clienteId=${torto}`);
        esperado(r, 400, `clienteId ${torto}`);
        assert.equal(r.body.campo, "clienteId");
      }
      const repetido = await adv.get(`/processes?clienteId=${c.ana._id}&clienteId=${c.bia._id}`);
      esperado(repetido, 400, "clienteId repetido");
      assert.equal(repetido.body.campo, "clienteId");
    });

    test("cliente de outra advogada devolve lista vazia, igual a um id que não existe", async () => {
      const dela = await processos(`clienteId=${c.dela._id}`);
      const inexistente = await processos("clienteId=000000000000000000000000");
      assert.equal(dela.total, 0);
      assert.deepEqual(dela, inexistente);
      // E na direção contrária.
      assert.equal((await processos(`clienteId=${c.ana._id}`, outra)).total, 0);
    });

    test("vazio é ignorado, e sem o parâmetro a lista é a de sempre", async () => {
      assert.deepEqual(ids(await processos("clienteId=")), ids(await processos("")));
    });
  });

  describe("2. GET /clients?portal=", () => {
    test("com_acesso: quem tem senha de portal", async () => {
      assert.deepEqual(ids(await clientes("portal=com_acesso")), de(c.ana, c.bia, c.empresa));
    });

    test("sem_acesso: quem não tem", async () => {
      assert.deepEqual(ids(await clientes("portal=sem_acesso")), de(c.semPortal, c.pjSemPortal));
    });

    test("nao_liberado: vínculo ativo não liberado, com cliente e processo ativos", async () => {
      // Ana (P3) e Empresa (P5). A Bia está liberada? Não: ninguém a liberou
      // em P2 nem em P4 — ela entra também.
      assert.deepEqual(ids(await clientes("portal=nao_liberado")), de(c.ana, c.bia, c.empresa));
    });

    test("liberar tira o cliente do recorte, e desligar o devolve", async () => {
      await liberarNoPortal(adv, p.p2._id, c.bia._id);
      await liberarNoPortal(adv, p.p4._id, c.bia._id);
      assert.deepEqual(ids(await clientes("portal=nao_liberado")), de(c.ana, c.empresa));
      await liberarNoPortal(adv, p.p4._id, c.bia._id, false);
      assert.deepEqual(ids(await clientes("portal=nao_liberado")), de(c.ana, c.bia, c.empresa));
    });

    test("a contagem é coerente com a regra compartilhada (acesso-portal e o cartão do Início)", async () => {
      const lista = await clientes("portal=nao_liberado");
      // Pela leitura independente: cada cliente com portal cujo acesso-portal
      // tem um processo não liberado com vínculo e processo ativos.
      const todos = await clientes("situacao=todos");
      const esperados = [];
      const processosPendentes = new Set();
      for (const cli of todos.data) {
        const a = esperado(await adv.get(`/clients/${cli._id}/acesso-portal`), 200, "acesso");
        const pendentes = a.processos.filter((x) => !x.liberadoNoPortal && x.vinculoAtivo && x.processoAtivo);
        if (cli.ativo && a.temSenhaPortal && pendentes.length > 0) esperados.push(String(cli._id));
        if (cli.ativo && a.temSenhaPortal) for (const x of pendentes) processosPendentes.add(String(x.processoId));
      }
      assert.deepEqual(ids(lista), esperados.sort());
      const painel = esperado(await adv.get("/dashboard"), 200, "dashboard");
      assert.equal(processosPendentes.size, painel.processosNaoLiberados);
    });

    test("outro valor é 400 com campo; vazio é ignorado", async () => {
      for (const torto of ["liberado", "COM_ACESSO", "sim"]) {
        const r = await adv.get(`/clients?portal=${torto}`);
        esperado(r, 400, `portal ${torto}`);
        assert.equal(r.body.campo, "portal");
      }
      assert.deepEqual(ids(await clientes("portal=")), ids(await clientes("")));
    });

    test("isolamento: a outra advogada vê só o dela", async () => {
      assert.deepEqual(ids(await clientes("portal=nao_liberado", outra)), de(c.dela));
      assert.deepEqual(ids(await clientes("portal=com_acesso", outra)), de(c.dela));
      assert.equal((await clientes("portal=sem_acesso", outra)).total, 0);
    });
  });

  describe("3. GET /clients?tipoPessoa=", () => {
    test("PF e PJ", async () => {
      assert.deepEqual(ids(await clientes("tipoPessoa=PF")), de(c.ana, c.bia, c.semPortal));
      assert.deepEqual(ids(await clientes("tipoPessoa=PJ")), de(c.empresa, c.pjSemPortal));
    });

    test("outro valor é 400 com campo — inclusive o valor do banco", async () => {
      for (const torto of ["fisica", "pf", "PX"]) {
        const r = await adv.get(`/clients?tipoPessoa=${torto}`);
        esperado(r, 400, `tipoPessoa ${torto}`);
        assert.equal(r.body.campo, "tipoPessoa");
      }
    });

    test("combinados: tipo + portal + situação + busca", async () => {
      assert.deepEqual(ids(await clientes("tipoPessoa=PJ&portal=com_acesso")), de(c.empresa));
      assert.deepEqual(ids(await clientes("tipoPessoa=PF&portal=sem_acesso")), de(c.semPortal));
      assert.deepEqual(ids(await clientes("tipoPessoa=PF&situacao=inativos")), de(c.desativado));
      assert.deepEqual(ids(await clientes("tipoPessoa=PF&situacao=todos&portal=sem_acesso")), de(c.semPortal, c.desativado));
      assert.deepEqual(ids(await clientes("tipoPessoa=PF&portal=nao_liberado&busca=ana")), de(c.ana));
    });

    test("sem os parâmetros novos, a listagem é a de sempre: só ativos, em ordem alfabética", async () => {
      const r = await clientes("");
      assert.deepEqual(ids(r), de(c.ana, c.bia, c.empresa, c.semPortal, c.pjSemPortal));
      const nomes = r.data.map((x) => x.nomeExibicao);
      assert.deepEqual(nomes, [...nomes].sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" })));
    });
  });

  describe("4. GET /clients/:id/acesso-portal — os processos do cliente", () => {
    test("cada processo traz os campos novos, ordenado por número; sem número por último", async () => {
      const a = esperado(await adv.get(`/clients/${c.ana._id}/acesso-portal`), 200, "acesso da Ana");
      assert.deepEqual(a.processos.map((x) => x.titulo), [
        "P2 Bia principal, Ana litisconsorte", "P3 Ana não liberada", "P1 Ana principal", "P4 Ana removida"
      ]);
      for (const x of a.processos) {
        for (const campo of ["processoId", "numeroProcesso", "titulo", "papel", "principal", "liberadoNoPortal",
          "vinculoAtivo", "processoAtivo", "ultimoAcessoPortal"]) {
          assert.ok(campo in x, `falta ${campo}`);
        }
      }
      const porTitulo = Object.fromEntries(a.processos.map((x) => [x.titulo, x]));
      assert.equal(porTitulo["P2 Bia principal, Ana litisconsorte"].papel, "litisconsorte");
      assert.equal(porTitulo["P2 Bia principal, Ana litisconsorte"].principal, false);
      assert.equal(porTitulo["P4 Ana removida"].vinculoAtivo, false);
      assert.equal(porTitulo["P4 Ana removida"].processoAtivo, true);
      assert.equal(porTitulo["P3 Ana não liberada"].liberadoNoPortal, false);
    });

    test("o processo desativado aparece com processoAtivo: false (o vínculo caiu junto)", async () => {
      const a = esperado(await adv.get(`/clients/${c.empresa._id}/acesso-portal`), 200, "acesso da Empresa");
      const p6 = a.processos.find((x) => String(x.processoId) === String(p.p6._id));
      assert.equal(p6.processoAtivo, false);
      assert.equal(p6.vinculoAtivo, false);
    });

    test("os campos de antes não mudaram: código, senha e 'N de M'", async () => {
      const a = esperado(await adv.get(`/clients/${c.ana._id}/acesso-portal`), 200, "acesso da Ana");
      assert.match(a.codigoAcessoPessoal, /^LEX-/);
      assert.equal(a.temSenhaPortal, true);
      assert.equal(a.senhaPortalProvisoria, true);
      assert.equal(a.processosAtivos, 3);
      assert.equal(a.processosLiberados, 2);
      for (const x of a.processos) assert.ok(["ativo", "vinculoDesativado", "processoDesativado"].includes(x.situacao));
    });
  });

  describe("5. o código pessoal continua só nas rotas dedicadas", () => {
    test("ausente de GET /clients (com e sem os filtros novos) e do detalhe comum", async () => {
      const a = esperado(await adv.get(`/clients/${c.ana._id}/acesso-portal`), 200, "acesso");
      const respostas = [
        await adv.get("/clients?limit=100"),
        await adv.get("/clients?limit=100&portal=com_acesso"),
        await adv.get("/clients?limit=100&portal=nao_liberado&tipoPessoa=PF"),
        await adv.get(`/clients/${c.ana._id}`),
        await adv.get(`/processes?limit=100&clienteId=${c.ana._id}`)
      ];
      for (const r of respostas) {
        assert.equal(r.status, 200);
        const bruto = JSON.stringify(r.body);
        assert.ok(!bruto.includes("codigoAcessoPessoal"), "trouxe a chave do código pessoal");
        assert.ok(!bruto.includes(a.codigoAcessoPessoal), "trouxe o valor do código pessoal");
        assert.ok(!bruto.includes("senhaPortalHash"), "trouxe o hash");
      }
    });
  });
});
