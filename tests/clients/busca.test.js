// ═══════════════════════════════════════════════════════════════════════════
// DEC-110 — A BUSCA DE CLIENTES DO SELETOR DE PARTICIPANTE (Fase 3.3b)
//
// O formulário do processo escolhia o participante num `<select>` com os 100
// primeiros clientes: o 101º não aparecia em lugar nenhum. A tela passou a
// buscar no servidor, e o `GET /clients?busca=` alargou para o que a advogada
// lembra: o nome com ou sem acento, a razão social, o nome fantasia, e o
// CPF/CNPJ com ou sem máscara.
//
// A regra do alargamento é a da DEC-101: só ALARGA. Todo termo que casava
// antes (nome, razão social e e-mail, como digitados) continua casando — há
// teste para isso também.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarClientePJ, esperado } from "../helpers/setup.js";
import { alvosDoDocumento } from "../../src/services/clientService.js";

const nomes = (r) => r.data.map((c) => c.nomeExibicao).sort();

describe("DEC-110 — GET /clients?busca= no seletor de participante", () => {
  let usuario;
  let outra;
  let joao;
  let empresa;

  before(async () => {
    await subirApp();
    await limparColecoes();
    usuario = await registrarUsuario("dona dos clientes");
    outra = await registrarUsuario("outra advogada");

    joao = await criarClientePF(usuario, { nomeCompleto: "João Conceição", email: "joao.c@exemplo.dev" });
    empresa = await criarClientePJ(usuario, {
      razaoSocial: "Padaria Pão Quente Ltda",
      nomeFantasia: "Panificadora Estrela",
    });
    await criarClientePF(usuario, { nomeCompleto: "Maria Souza" });
    // Da outra advogada, com o mesmo nome: nunca aparece para a primeira.
    await criarClientePF(outra, { nomeCompleto: "João Conceição" });
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  describe("1. o nome, sem acento e sem caixa", () => {
    for (const termo of ["joao", "JOAO", "João", "conceicao", "Conceição"]) {
      test(`"${termo}" acha "João Conceição"`, async () => {
        const r = esperado(await usuario.get(`/clients?busca=${encodeURIComponent(termo)}`), 200, "busca");
        assert.deepEqual(nomes(r), ["João Conceição"]);
      });
    }

    test("a razão social, sem acento", async () => {
      const r = esperado(await usuario.get("/clients?busca=pao%20quente"), 200, "busca");
      assert.deepEqual(r.data.map((c) => String(c._id)), [String(empresa._id)]);
    });

    test("o nome fantasia — que antes não era alvo", async () => {
      const r = esperado(await usuario.get("/clients?busca=estrela"), 200, "busca");
      assert.deepEqual(r.data.map((c) => String(c._id)), [String(empresa._id)]);
    });
  });

  describe("2. o CPF/CNPJ, com ou sem máscara", () => {
    test("o CPF inteiro, só dígitos", async () => {
      const r = esperado(await usuario.get(`/clients?busca=${joao.cpf}`), 200, "busca");
      assert.deepEqual(r.data.map((c) => String(c._id)), [String(joao._id)]);
    });

    test("o CPF com máscara", async () => {
      const d = joao.cpf;
      const mascarado = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
      const r = esperado(await usuario.get(`/clients?busca=${encodeURIComponent(mascarado)}`), 200, "busca");
      assert.deepEqual(r.data.map((c) => String(c._id)), [String(joao._id)]);
    });

    test("o começo do CNPJ, com a pontuação", async () => {
      const d = empresa.cnpj;
      const inicio = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}`;
      const r = esperado(await usuario.get(`/clients?busca=${encodeURIComponent(inicio)}`), 200, "busca");
      assert.ok(r.data.some((c) => String(c._id) === String(empresa._id)));
    });

    test("termo com letras não procura no documento", () => {
      assert.deepEqual(alvosDoDocumento("Rua 123"), []);
    });

    test("menos de 3 dígitos não procura no documento", () => {
      assert.deepEqual(alvosDoDocumento("1"), []);
      assert.deepEqual(alvosDoDocumento("1.2"), []);
      assert.equal(alvosDoDocumento("123").length, 2);
    });

    test("termo que não é texto não vira filtro", () => {
      assert.deepEqual(alvosDoDocumento(["123", "456"]), []);
      assert.deepEqual(alvosDoDocumento(undefined), []);
    });
  });

  describe("3. só alarga: o que casava antes continua casando", () => {
    test("o e-mail continua sendo alvo", async () => {
      const r = esperado(await usuario.get("/clients?busca=joao.c%40exemplo"), 200, "busca");
      assert.deepEqual(nomes(r), ["João Conceição"]);
    });

    test("o nome como digitado continua casando", async () => {
      const r = esperado(await usuario.get("/clients?busca=Maria%20Souza"), 200, "busca");
      assert.deepEqual(nomes(r), ["Maria Souza"]);
    });

    test("metacaractere continua literal", async () => {
      const r = esperado(await usuario.get("/clients?busca=.*"), 200, "busca");
      assert.equal(r.total, 0);
    });

    test("a busca continua restrita à advogada", async () => {
      const r = esperado(await usuario.get("/clients?busca=joao"), 200, "busca");
      assert.equal(r.total, 1);
      const r2 = esperado(await outra.get("/clients?busca=joao"), 200, "busca da outra");
      assert.equal(r2.total, 1);
      assert.notEqual(String(r2.data[0]._id), String(joao._id));
    });
  });
});
