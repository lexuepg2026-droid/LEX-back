// ═══════════════════════════════════════════════════════════════════════════
// DEC-115 — os filtros novos da lista de processos (Fase 3.4)
//
// `?tipoAcao=` (igualdade, sem acento e sem caixa), `?de=&ate=` (por
// `dataDistribuicao`, bordas em UTC) e `?portal=nao_liberado|liberado` (a regra
// do cartão do Início, DEC-108), mais a rota `GET /processes/tipos-acao`.
//
// Só acréscimos: sem os parâmetros novos a listagem é a de sempre, e há teste
// para isso também.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarProcesso, criarClientePF, esperado } from "../helpers/setup.js";
import { dadosClientePF } from "../helpers/factories.js";
import { liberarNoPortal, SENHA_PROVISORIA } from "../helpers/portal.js";

const ids = (corpo) => corpo.data.map((p) => String(p._id)).sort();
const comPortal = async (quem, nome) =>
  esperado(await quem.post("/clients", { ...dadosClientePF({ nomeCompleto: nome }), senhaPortal: SENHA_PROVISORIA }), 201, nome);

describe("DEC-115 — filtros da lista de processos", () => {
  let adv;
  let outra;
  let semPortal;
  let ana;
  let bia;
  const p = {};

  before(async () => {
    await subirApp();
    await limparColecoes();
    adv = await registrarUsuario("dona dos processos");
    outra = await registrarUsuario("outra advogada");

    semPortal = await criarClientePF(adv, { nomeCompleto: "Sem Portal" });
    ana = await comPortal(adv, "Ana Portal");
    bia = await comPortal(adv, "Bia Portal");

    const um = (cliente) => [{ clienteId: cliente._id, papel: "autor", principal: true }];

    // Tipos e datas escolhidos para os recortes: a virada de setembro para
    // outubro, e um processo sem data de distribuição.
    p.inventario = await criarProcesso(adv, um(semPortal), { titulo: "Inventário A", tipoAcao: "Inventário", dataDistribuicao: "2026-09-30" });
    p.inventario2 = await criarProcesso(adv, um(semPortal), { titulo: "Inventário B", tipoAcao: "inventario", dataDistribuicao: "2026-10-01" });
    p.extrajudicial = await criarProcesso(adv, um(semPortal), { titulo: "Extrajudicial", tipoAcao: "Inventário extrajudicial", dataDistribuicao: "2026-10-31" });
    p.semData = await criarProcesso(adv, um(semPortal), { titulo: "Sem data", tipoAcao: "Usucapião", dataDistribuicao: undefined });
    p.novembro = await criarProcesso(adv, um(semPortal), { titulo: "Novembro", tipoAcao: "Usucapião", dataDistribuicao: "2026-11-01" });

    // Portal: um com dois clientes de portal (um liberado, outro não), um só
    // liberado, um só não liberado.
    p.misto = await criarProcesso(adv, [
      { clienteId: ana._id, papel: "autor", principal: true },
      { clienteId: bia._id, papel: "litisconsorte", principal: false }
    ], { titulo: "Misto", tipoAcao: "Cobrança", dataDistribuicao: "2026-05-10" });
    await liberarNoPortal(adv, p.misto._id, ana._id);
    p.liberado = await criarProcesso(adv, um(ana), { titulo: "Liberado", tipoAcao: "Cobrança", dataDistribuicao: "2026-05-11" });
    await liberarNoPortal(adv, p.liberado._id, ana._id);
    p.naoLiberado = await criarProcesso(adv, um(bia), { titulo: "Não liberado", tipoAcao: "Cobrança", dataDistribuicao: "2026-05-12" });

    // Desativado, com tipo próprio: aparece nas opções de tipo.
    p.desativado = await criarProcesso(adv, um(semPortal), { titulo: "Desativado", tipoAcao: "Despejo" });
    esperado(await adv.delete(`/processes/${p.desativado._id}`), 200, "desativar");

    // A outra advogada: mesmos tipos e um processo não liberado.
    const dela = await comPortal(outra, "Cida Portal");
    await criarProcesso(outra, [{ clienteId: dela._id, papel: "autor", principal: true }], { tipoAcao: "Inventário", dataDistribuicao: "2026-10-01" });
    await criarProcesso(outra, [{ clienteId: dela._id, papel: "autor", principal: true }], { tipoAcao: "Alimentos" });
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  const lista = async (query, quem = adv) =>
    esperado(await quem.get(`/processes?limit=100${query ? `&${query}` : ""}`), 200, `lista ${query}`);

  describe("1. tipo de ação", () => {
    test("igualdade sem acento e sem caixa — e não 'começa com'", async () => {
      const r = await lista("tipoAcao=INVENTARIO");
      assert.deepEqual(ids(r), [p.inventario._id, p.inventario2._id].map(String).sort());
    });

    test("vazio e só espaços são ignorados", async () => {
      const todos = await lista("");
      assert.deepEqual(ids(await lista("tipoAcao=")), ids(todos));
      assert.deepEqual(ids(await lista("tipoAcao=%20%20")), ids(todos));
    });

    test("valor repetido (array) é 400 com campo", async () => {
      const r = await adv.get("/processes?tipoAcao=a&tipoAcao=b");
      esperado(r, 400, "tipo repetido");
      assert.equal(r.body.campo, "tipoAcao");
    });

    test("valor longo demais é 400 com campo", async () => {
      const r = await adv.get(`/processes?tipoAcao=${"x".repeat(201)}`);
      esperado(r, 400, "tipo longo");
      assert.equal(r.body.campo, "tipoAcao");
    });

    test("metacaractere é literal", async () => {
      assert.equal((await lista("tipoAcao=.*")).total, 0);
    });
  });

  describe("2. GET /processes/tipos-acao", () => {
    test("os tipos dela, ativos e desativados, uma grafia por tipo, em ordem alfabética", async () => {
      const r = esperado(await adv.get("/processes/tipos-acao"), 200, "tipos");
      assert.deepEqual(r.data, ["Cobrança", "Despejo", "Inventário", "Inventário extrajudicial", "Usucapião"]);
    });

    test("isolamento: os da outra não aparecem", async () => {
      const r = esperado(await outra.get("/processes/tipos-acao"), 200, "tipos da outra");
      assert.deepEqual(r.data, ["Alimentos", "Inventário"]);
    });

    test("a rota não é capturada como id", async () => {
      const r = await adv.get("/processes/tipos-acao");
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.body.data));
    });
  });

  describe("3. período por distribuição", () => {
    test("cruzando a virada do mês, com as bordas inteiras", async () => {
      const r = await lista("de=2026-09-30&ate=2026-10-31");
      assert.deepEqual(ids(r), [p.inventario._id, p.inventario2._id, p.extrajudicial._id].map(String).sort());
    });

    test("processo sem data fica fora quando há período, e dentro sem ele", async () => {
      const comPeriodo = await lista("de=2000-01-01&ate=2100-12-31");
      assert.ok(!ids(comPeriodo).includes(String(p.semData._id)));
      assert.ok(ids(await lista("")).includes(String(p.semData._id)));
    });

    test("só uma borda vale", async () => {
      assert.deepEqual(ids(await lista("de=2026-11-01")), [String(p.novembro._id)]);
    });

    test("data torta e início depois do fim são 400 com campo", async () => {
      const torta = await adv.get("/processes?de=2026-02-31");
      esperado(torta, 400, "data torta");
      assert.equal(torta.body.campo, "de");
      const invertida = await adv.get("/processes?de=2026-10-02&ate=2026-10-01");
      esperado(invertida, 400, "invertida");
      assert.equal(invertida.body.campo, "de");
    });
  });

  describe("4. portal", () => {
    test("nao_liberado: quem tem pelo menos um cliente de portal não liberado", async () => {
      const r = await lista("portal=nao_liberado");
      assert.deepEqual(ids(r), [p.misto._id, p.naoLiberado._id].map(String).sort());
    });

    test("liberado: algum liberado e nenhum não liberado", async () => {
      assert.deepEqual(ids(await lista("portal=liberado")), [String(p.liberado._id)]);
    });

    test("a contagem de nao_liberado é a do cartão do Início, no mesmo banco", async () => {
      const r = await lista("portal=nao_liberado");
      const painel = esperado(await adv.get("/dashboard"), 200, "dashboard");
      assert.equal(r.total, painel.processosNaoLiberados);
    });

    test("outro valor é 400 com campo; vazio não filtra", async () => {
      const r = await adv.get("/processes?portal=todos");
      esperado(r, 400, "portal inválido");
      assert.equal(r.body.campo, "portal");
      assert.equal((await lista("portal=")).total, (await lista("")).total);
    });

    test("isolamento: o não liberado da outra não entra aqui, e vice-versa", async () => {
      const minha = await lista("portal=nao_liberado");
      const dela = await lista("portal=nao_liberado", outra);
      assert.equal(dela.total, 2, "os dois processos dela com a Cida não liberada");
      for (const id of ids(dela)) assert.ok(!ids(minha).includes(id));
    });
  });

  describe("5. combinados, e a listagem de sempre", () => {
    test("tipo + período + portal juntos", async () => {
      const r = await lista("tipoAcao=cobranca&de=2026-05-11&ate=2026-05-31&portal=nao_liberado");
      assert.deepEqual(ids(r), [String(p.naoLiberado._id)]);
    });

    test("tipo + status + busca", async () => {
      const r = await lista("tipoAcao=Usucapião&status=ativo&busca=novembro");
      assert.deepEqual(ids(r), [String(p.novembro._id)]);
    });

    test("situação desativados + tipo", async () => {
      const r = await lista("situacao=inativos&tipoAcao=despejo");
      assert.deepEqual(ids(r), [String(p.desativado._id)]);
    });

    test("sem os parâmetros novos, a listagem continua a de sempre (só ativos, os 8)", async () => {
      const r = await lista("");
      assert.equal(r.total, 8);
      assert.ok(!ids(r).includes(String(p.desativado._id)));
    });
  });
});
