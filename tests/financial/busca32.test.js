// ═══════════════════════════════════════════════════════════════════════════
// FASE 3.2 — A BUSCA DOS SELETORES (DEC-101)
//
// Os seletores de processo (formulário de honorário) e de honorário
// (formulários de parcela e de pagamento) passaram a buscar no servidor. O
// que precisa valer:
//
//   GET /processes?busca=  número, título e NOME DO CLIENTE PRINCIPAL;
//   GET /fees?busca=       descrição, número do processo e NOME DO CLIENTE
//                          PRINCIPAL.
//
// Insensível a acento e caixa, no padrão de `/secoes`.
//
// Como na F-1b.3, todo bloco afirma as duas metades — o que entrou e o que
// ficou de fora. Um filtro quebrado que devolve tudo passa em "achei".
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario,
  criarClientePF,
  criarClientePJ,
  criarProcesso,
  criarHonorario,
  esperado
} from "../helpers/setup.js";

const ids = (corpo) => corpo.data.map((x) => String(x._id)).sort();

describe("Fase 3.2 — busca no servidor para os seletores", () => {
  let api, outra;
  let joao, agro;
  let pInventario, pCobranca, pAgro;
  let fInventario, fCobranca, fAgro;
  let pDeOutra, fDeOutra;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("busca32");
    outra = await registrarUsuario("busca32-outra");

    joao = await criarClientePF(api, { nomeCompleto: "João Conceição Araújo" });
    agro = await criarClientePJ(api, { razaoSocial: "Agro Campos Gerais Ltda" });

    pInventario = await criarProcesso(api, [
      { clienteId: joao._id, papel: "autor", principal: true }
    ], { titulo: "Inventário e Partilha", numeroProcesso: "0001111-22.2026.8.16.0019" });

    pCobranca = await criarProcesso(api, [
      { clienteId: joao._id, papel: "autor", principal: true }
    ], { titulo: "Ação de Cobrança", numeroProcesso: "0002222-33.2026.8.16.0019" });

    // Agro é a principal; João entra só como litisconsorte, e por isso NÃO
    // pode fazer este processo aparecer na busca por "joão".
    pAgro = await criarProcesso(api, [
      { clienteId: agro._id, papel: "autor", principal: true },
      { clienteId: joao._id, papel: "litisconsorte", principal: false }
    ], { titulo: "Recurso Administrativo", numeroProcesso: "0003333-44.2026.8.16.0019" });

    fInventario = await criarHonorario(api, pInventario._id, { descricao: "Honorários de sucessão" });
    fCobranca = await criarHonorario(api, pCobranca._id, { descricao: "Honorários de êxito" });
    fAgro = await criarHonorario(api, pAgro._id, { descricao: "Custas administrativas" });

    // A outra usuária tem um cliente e um processo com os MESMOS nomes.
    const joaoDeOutra = await criarClientePF(outra, { nomeCompleto: "João Conceição Araújo" });
    pDeOutra = await criarProcesso(outra, [
      { clienteId: joaoDeOutra._id, papel: "autor", principal: true }
    ], { titulo: "Inventário e Partilha", numeroProcesso: "0009999-22.2026.8.16.0019" });
    fDeOutra = await criarHonorario(outra, pDeOutra._id, { descricao: "Honorários de sucessão" });
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const listar = async (quem, caminho) => esperado(await quem.get(caminho), 200, caminho);

  describe("GET /processes?busca=", () => {
    test("por número", async () => {
      const r = await listar(api, "/processes?busca=0002222");
      assert.deepEqual(ids(r), [String(pCobranca._id)]);
    });

    test("por título, com e sem acento, em qualquer caixa", async () => {
      for (const termo of ["Inventário", "inventario", "INVENTARIO", "invêntario"]) {
        const r = await listar(api, `/processes?busca=${encodeURIComponent(termo)}`);
        assert.deepEqual(ids(r), [String(pInventario._id)], `termo "${termo}"`);
      }
    });

    test("pelo nome do cliente PRINCIPAL, com e sem acento — o litisconsorte não conta", async () => {
      for (const termo of ["João Conceição", "joao conceicao", "ARAUJO"]) {
        const r = await listar(api, `/processes?busca=${encodeURIComponent(termo)}`);
        assert.deepEqual(
          ids(r),
          [String(pInventario._id), String(pCobranca._id)].sort(),
          `termo "${termo}"`
        );
      }
    });

    test("pela razão social do cliente PJ principal", async () => {
      const r = await listar(api, "/processes?busca=campos%20gerais");
      assert.deepEqual(ids(r), [String(pAgro._id)]);
    });

    test("a listagem popula o cliente principal", async () => {
      const r = await listar(api, "/processes?busca=0003333");
      assert.equal(r.data[0].clientePrincipalId.razaoSocial, "Agro Campos Gerais Ltda");
    });

    test("isolamento: o mesmo nome da outra usuária não aparece, nos dois sentidos", async () => {
      const minha = await listar(api, "/processes?busca=joao");
      assert.ok(!ids(minha).includes(String(pDeOutra._id)), "VAZAMENTO — processo da outra usuária");
      const dela = await listar(outra, "/processes?busca=joao");
      assert.deepEqual(ids(dela), [String(pDeOutra._id)]);
    });

    test("busca vazia é igual à listagem sem busca", async () => {
      const sem = await listar(api, "/processes");
      for (const termo of ["", "%20%20"]) {
        const vazia = await listar(api, `/processes?busca=${termo}`);
        assert.deepEqual(ids(vazia), ids(sem));
        assert.equal(vazia.total, sem.total);
      }
    });

    test("metacaractere é literal", async () => {
      const r = await listar(api, "/processes?busca=.*");
      assert.equal(r.total, 0);
    });
  });

  describe("GET /fees?busca=", () => {
    test("por descrição, com e sem acento", async () => {
      for (const termo of ["êxito", "exito", "ÊXITO"]) {
        const r = await listar(api, `/fees?busca=${encodeURIComponent(termo)}`);
        assert.deepEqual(ids(r), [String(fCobranca._id)], `termo "${termo}"`);
      }
    });

    test("pelo número do processo", async () => {
      const r = await listar(api, "/fees?busca=0001111-22");
      assert.deepEqual(ids(r), [String(fInventario._id)]);
    });

    test("pelo nome do cliente principal, com e sem acento", async () => {
      for (const termo of ["João", "joao", "conceicao araujo"]) {
        const r = await listar(api, `/fees?busca=${encodeURIComponent(termo)}`);
        assert.deepEqual(
          ids(r),
          [String(fInventario._id), String(fCobranca._id)].sort(),
          `termo "${termo}"`
        );
      }
      const pj = await listar(api, "/fees?busca=agro");
      assert.deepEqual(ids(pj), [String(fAgro._id)]);
    });

    test("o cliente vem dentro do processo populado", async () => {
      const r = await listar(api, "/fees?busca=agro");
      assert.equal(r.data[0].processoId.clientePrincipalId.razaoSocial, "Agro Campos Gerais Ltda");
    });

    test("isolamento por usuarioId", async () => {
      const minha = await listar(api, "/fees?busca=sucessao");
      assert.deepEqual(ids(minha), [String(fInventario._id)]);
      const dela = await listar(outra, "/fees?busca=joao");
      assert.deepEqual(ids(dela), [String(fDeOutra._id)]);
    });

    test("busca vazia é igual à listagem sem busca", async () => {
      const sem = await listar(api, "/fees");
      const vazia = await listar(api, "/fees?busca=");
      assert.deepEqual(ids(vazia), ids(sem));
      assert.equal(vazia.total, sem.total);
    });

    test("o 101º honorário é encontrado pela busca, além do teto de 100 da página", async () => {
      // 101 honorários a mais num processo próprio; o mais antigo é o que um
      // seletor com `limit=100` em ordem de criação jamais mostraria.
      const cli = await criarClientePF(api, { nomeCompleto: "Beatriz Volume" });
      const proc = await criarProcesso(api, [
        { clienteId: cli._id, papel: "autor", principal: true }
      ], { titulo: "Processo de Volume", numeroProcesso: "0005555-66.2026.8.16.0019" });
      const primeiro = await criarHonorario(api, proc._id, { descricao: "Volume nº 000 — o mais antigo" });
      for (let i = 1; i <= 100; i += 1) {
        await criarHonorario(api, proc._id, { descricao: `Volume nº ${String(i).padStart(3, "0")}` });
      }
      const pagina = await listar(api, "/fees?limit=100");
      assert.ok(!ids(pagina).includes(String(primeiro._id)), "o arranjo não empurrou o 1º para fora da página");

      const achado = await listar(api, "/fees?busca=mais%20antigo&limit=20");
      assert.deepEqual(ids(achado), [String(primeiro._id)]);
      const porCliente = await listar(api, "/fees?busca=beatriz&limit=20");
      assert.equal(porCliente.total, 101);
    });
  });

  describe("as listagens de parcelas e pagamentos herdam o alcance", () => {
    test("GET /installments?busca= casa o nome do cliente principal", async () => {
      const parcela = esperado(
        await api.post("/installments", { feeId: fAgro._id, numeroParcela: 1, valor: 100, dataVencimento: "2026-12-10" }),
        201, "parcela"
      );
      const r = await listar(api, "/installments?busca=agro");
      assert.deepEqual(ids(r), [String(parcela._id)]);
    });
  });
});
