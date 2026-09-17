// ═══════════════════════════════════════════════════════════════════════════
// DEC-062 — A ORDEM ALFABÉTICA EM PORTUGUÊS (A-1)
//
// ── O defeito que a fase corrigiu ─────────────────────────────────────────
// A listagem de clientes saía por `createdAt: -1` — ordem de cadastro, que não
// responde nenhuma pergunta de quem procura um nome.
//
// E trocá-la por uma ordenação ingênua produziria um defeito PIOR, que é o que
// a metade destes testes existe para travar: a ordenação binária do MongoDB
// compara BYTES, e em UTF-8 todo caractere acentuado tem byte maior que
// qualquer letra sem acento. Medido contra o Atlas antes de escolher:
//
//   sem collation : Alvaro < Ambar < Ana < Zeca < Álvaro < ámbar
//   pt strength 1 : Álvaro < Alvaro < ámbar < Ambar < Ana < Zeca
//
// **"Álvaro" depois de "Zeca"** — e num cadastro brasileiro isso não é caso de
// borda: é metade dos nomes. A advogada procuraria "Álvaro" na letra A, não
// acharia, e concluiria que o cliente não está cadastrado.
//
// ── Por que os dois campos de nome, e não um ─────────────────────────────
// Cliente PF guarda o nome em `nomeCompleto`; cliente PJ, em `razaoSocial`.
// Ordenar por um só deixaria o outro tipo inteiro com chave vazia — na
// prática, todos os PJ no fim, em bloco, na ordem de cadastro. É por isso que
// existe `nomeExibicao`, e é por isso que há teste misturando os dois tipos.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarClientePJ, esperado } from "../helpers/setup.js";
import { nomeExibicaoDoCliente } from "../../src/utils/nomeExibicao.js";
import { ordenacaoDeClientes, ORDENACOES_CLIENTE } from "../../src/utils/filtrosDeConsulta.js";

// Os nomes do enunciado da fase, mais um par em minúscula. O par existe porque
// `strength: 1` ignora caixa ALÉM de acento, e sem ele o teste não distinguiria
// "escolhi strength 1" de "escolhi strength 2".
const nomesDe = (lista) => lista.map((c) => c.nomeExibicao);

describe("DEC-062 — ordenação alfabética de clientes", () => {
  let api;
  let usuario;

  before(async () => {
    api = await subirApp();
    await limparColecoes();
    usuario = await registrarUsuario("dona da lista");
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  describe("1. a ordem, com nome acentuado no meio e não no fim", () => {
    before(async () => {
      await limparColecoes();
      usuario = await registrarUsuario("dona da lista");
      // Cadastrados FORA de ordem alfabética de propósito: se a consulta não
      // ordenasse nada, a lista sairia nesta sequência e o teste passaria por
      // acidente. "Zeca" primeiro é o que impede isso.
      for (const nome of ["Zeca", "Álvaro", "Ana", "Alvaro"]) {
        await criarClientePF(usuario, { nomeCompleto: nome });
      }
    });

    test("A–Z: o acentuado fica JUNTO do par sem acento, e os dois antes de Ana", async () => {
      const r = await usuario.get("/clients");
      esperado(r, 200, "listagem A–Z");

      const nomes = nomesDe(r.body.data);

      // A asserção que dá nome à fase. Escrita como posição relativa, e não
      // como igualdade com um array literal, porque o que importa é a REGRA:
      // "Álvaro" e "Alvaro" são o mesmo nome para efeito de ordenação, e
      // qualquer um dos dois na frente é aceitável — o que não é aceitável é
      // qualquer um deles depois de "Ana" ou de "Zeca".
      const iAlvaros = [nomes.indexOf("Álvaro"), nomes.indexOf("Alvaro")];
      const iAna = nomes.indexOf("Ana");
      const iZeca = nomes.indexOf("Zeca");

      assert.ok(iAlvaros.every((i) => i !== -1), "os dois Álvaro/Alvaro na lista");
      for (const i of iAlvaros) {
        assert.ok(i < iAna, `"${nomes[i]}" (posição ${i}) tem de vir antes de "Ana" (${iAna})`);
        assert.ok(i < iZeca, `"${nomes[i]}" (posição ${i}) tem de vir antes de "Zeca" (${iZeca})`);
      }
      assert.ok(iAna < iZeca, "Ana antes de Zeca");

      // 🚨 A contraprova do defeito, dita em voz alta: sem collation, o
      // acentuado cairia no ÚLTIMO lugar. Esta é a asserção que morre se
      // alguém remover `.collation()` da consulta.
      assert.notEqual(
        nomes[nomes.length - 1],
        "Álvaro",
        "Álvaro no fim significa ordenação binária — a collation sumiu da consulta"
      );
      assert.equal(nomes[nomes.length - 1], "Zeca", "o último é o Z de verdade");
    });

    test("Z–A: a ordem se inverte por inteiro", async () => {
      const r = await usuario.get("/clients?ordem=nome_desc");
      esperado(r, 200, "listagem Z–A");

      const nomes = nomesDe(r.body.data);
      assert.equal(nomes[0], "Zeca", "Z–A começa no Zeca");

      const iAna = nomes.indexOf("Ana");
      for (const alvaro of ["Álvaro", "Alvaro"]) {
        assert.ok(nomes.indexOf(alvaro) > iAna, `${alvaro} depois de Ana no Z–A`);
      }
    });

    test("a caixa também é ignorada — 'alvaro' não vai para depois do Z", async () => {
      await criarClientePF(usuario, { nomeCompleto: "alvaro" });
      const r = await usuario.get("/clients");
      esperado(r, 200, "listagem com minúscula");

      const nomes = nomesDe(r.body.data);
      assert.ok(
        nomes.indexOf("alvaro") < nomes.indexOf("Ana"),
        "minúscula ordena junto das maiúsculas (strength 1), não depois do Z"
      );
    });
  });

  describe("2. PF e PJ ordenados JUNTOS, não em blocos", () => {
    before(async () => {
      await limparColecoes();
      usuario = await registrarUsuario("dona da lista mista");
      // Intercalados de propósito: se a ordenação lesse só `nomeCompleto`, os
      // três PJ sairiam juntos no começo (chave vazia) ou no fim.
      await criarClientePF(usuario, { nomeCompleto: "Bruno Pessoa Física" });
      await criarClientePJ(usuario, { razaoSocial: "Alfa Comércio Ltda", nomeFantasia: "Alfa" });
      await criarClientePF(usuario, { nomeCompleto: "Diana Pessoa Física" });
      await criarClientePJ(usuario, { razaoSocial: "Castor Serviços Ltda", nomeFantasia: "Castor" });
    });

    test("a lista alterna os dois tipos conforme o alfabeto", async () => {
      const r = await usuario.get("/clients");
      esperado(r, 200, "listagem PF+PJ");

      const nomes = nomesDe(r.body.data);
      assert.deepEqual(nomes, [
        "Alfa Comércio Ltda",
        "Bruno Pessoa Física",
        "Castor Serviços Ltda",
        "Diana Pessoa Física"
      ]);

      // A prova de que não saiu em bloco: os tipos ALTERNAM. Se a chave de
      // ordenação fosse só `nomeCompleto`, esta sequência seria
      // juridica,juridica,fisica,fisica (ou o contrário).
      const tipos = r.body.data.map((c) => c.tipoPessoa);
      assert.deepEqual(tipos, ["juridica", "fisica", "juridica", "fisica"]);
    });

    test("PJ sem razão social cai no nome fantasia, e não fica sem chave", async () => {
      // O model exige `razaoSocial` em PJ, então este caso só existe por
      // escrita fora do model — e é justamente por isso que a derivação tem a
      // terceira opção. Provado na função pura, que é onde a regra mora.
      assert.equal(nomeExibicaoDoCliente({ nomeFantasia: "Só Fantasia" }), "Só Fantasia");
      assert.equal(
        nomeExibicaoDoCliente({ razaoSocial: "Razão Ltda", nomeFantasia: "Fantasia" }),
        "Razão Ltda",
        "com as duas, a razão social manda"
      );
      assert.equal(nomeExibicaoDoCliente({}), "", "sem nome nenhum é string vazia, nunca '(sem nome)'");
    });
  });

  describe("3. a ordenação combina com busca e com o filtro de situação", () => {
    before(async () => {
      await limparColecoes();
      usuario = await registrarUsuario("dona da lista filtrada");
      for (const nome of ["Zeca Silva", "Álvaro Silva", "Ana Silva", "Bruno Souza"]) {
        await criarClientePF(usuario, { nomeCompleto: nome });
      }
    });

    test("com `busca`, o recorte é aplicado E a ordem é alfabética", async () => {
      const r = await usuario.get("/clients?busca=Silva");
      esperado(r, 200, "busca + ordem");

      const nomes = nomesDe(r.body.data);
      assert.equal(nomes.length, 3, "só os três Silva");
      assert.ok(nomes.indexOf("Álvaro Silva") < nomes.indexOf("Ana Silva"), "acentuado no lugar certo");
      assert.equal(nomes[nomes.length - 1], "Zeca Silva");
    });

    test("com `situacao=inativos`, idem — e o desativado aparece ordenado", async () => {
      const lista = await usuario.get("/clients");
      const zeca = lista.body.data.find((c) => c.nomeExibicao === "Zeca Silva");
      const alvaro = lista.body.data.find((c) => c.nomeExibicao === "Álvaro Silva");
      esperado(await usuario.delete(`/clients/${zeca._id}`), 200, "desativar Zeca");
      esperado(await usuario.delete(`/clients/${alvaro._id}`), 200, "desativar Álvaro");

      const r = await usuario.get("/clients?situacao=inativos");
      esperado(r, 200, "inativos + ordem");
      assert.deepEqual(nomesDe(r.body.data), ["Álvaro Silva", "Zeca Silva"]);
    });

    test("busca e situação e ordenação, os três juntos", async () => {
      const r = await usuario.get("/clients?busca=Silva&situacao=todos&ordem=nome_desc");
      esperado(r, 200, "os três filtros");
      assert.deepEqual(nomesDe(r.body.data), ["Zeca Silva", "Ana Silva", "Álvaro Silva"]);
    });
  });

  describe("4. a ordenação sobrevive à PAGINAÇÃO", () => {
    // O ponto deste bloco não é a ordem dentro de uma página: é que a ordem
    // seja TOTAL. Com `strength: 1`, "Álvaro" e "Alvaro" empatam, e paginação
    // sobre ordem com empate repete e pula linhas — o mesmo defeito que o
    // extrato levou na F-1a e que o `_id` de desempate resolve.
    before(async () => {
      await limparColecoes();
      usuario = await registrarUsuario("dona da lista longa");
      // Sete nomes, quatro deles empatados entre si sob strength 1.
      for (const nome of ["Alvaro", "Álvaro", "ALVARO", "álvaro", "Ana", "Bruno", "Zeca"]) {
        await criarClientePF(usuario, { nomeCompleto: nome });
      }
    });

    test("duas páginas de 3 não repetem nem pulam ninguém", async () => {
      const p1 = await usuario.get("/clients?page=1&limit=3");
      const p2 = await usuario.get("/clients?page=2&limit=3");
      const p3 = await usuario.get("/clients?page=3&limit=3");
      esperado(p1, 200, "página 1");
      esperado(p2, 200, "página 2");
      esperado(p3, 200, "página 3");

      const ids = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((c) => String(c._id));
      assert.equal(ids.length, 7, "as três páginas somam o total");
      assert.equal(new Set(ids).size, 7, "🚨 nenhum id repetido entre páginas — é o empate sem desempate");
      assert.equal(p1.body.total, 7);
    });

    test("a mesma consulta, repetida, devolve a mesma página — a ordem é determinística", async () => {
      const a = await usuario.get("/clients?page=2&limit=3");
      const b = await usuario.get("/clients?page=2&limit=3");
      assert.deepEqual(
        a.body.data.map((c) => String(c._id)),
        b.body.data.map((c) => String(c._id)),
        "ordem instável faria a página 2 mudar de conteúdo entre duas chamadas iguais"
      );
    });

    test("Zeca continua na última página, e não some pelo caminho", async () => {
      const p3 = await usuario.get("/clients?page=3&limit=3");
      assert.equal(nomesDe(p3.body.data)[0], "Zeca");
    });
  });

  describe("5. o campo é DERIVADO — nem entra por rota, nem diverge", () => {
    before(async () => {
      await limparColecoes();
      usuario = await registrarUsuario("dona do campo derivado");
    });

    test("`nomeExibicao` no corpo do PATCH é recusado com 400", async () => {
      const cliente = await criarClientePF(usuario, { nomeCompleto: "Carla Original" });
      const r = await usuario.patch(`/clients/${cliente._id}`, {
        nomeExibicao: "AAA Primeiro da Lista"
      });

      assert.equal(r.status, 400, "campo derivado não entra por rota");

      const depois = await usuario.get(`/clients/${cliente._id}`);
      assert.equal(
        depois.body.nomeExibicao,
        "Carla Original",
        "e o valor gravado continua o derivado"
      );
    });

    test("editar o nome REESCREVE a chave — ela acompanha, não congela", async () => {
      const cliente = await criarClientePF(usuario, { nomeCompleto: "Zilda Antes" });
      esperado(
        await usuario.patch(`/clients/${cliente._id}`, { nomeCompleto: "Amanda Depois" }),
        200,
        "renomear"
      );

      const r = await usuario.get(`/clients/${cliente._id}`);
      assert.equal(r.body.nomeExibicao, "Amanda Depois");

      // E a lista obedece à chave nova, que é o que prova que o hook rodou no
      // update e não só na criação.
      const lista = await usuario.get("/clients");
      assert.equal(nomesDe(lista.body.data)[0], "Amanda Depois", "o renomeado subiu para o topo");
    });

    test("trocar PF→PJ troca a chave junto — não fica o nome que o model apagou", async () => {
      const cliente = await criarClientePJ(usuario, {
        razaoSocial: "Beta Servicos Ltda",
        nomeFantasia: "Beta"
      });
      const r = await usuario.get(`/clients/${cliente._id}`);
      assert.equal(r.body.nomeExibicao, "Beta Servicos Ltda");
      assert.equal(r.body.nomeCompleto, undefined, "PJ não tem nomeCompleto");
    });
  });

  describe("6. `ordem` inválida recusa, e não ordena em silêncio", () => {
    test("valor fora do vocabulário → 400 com `campo`", async () => {
      const r = await usuario.get("/clients?ordem=alfabetica");
      assert.equal(r.status, 400, "ordem desconhecida recusa");
      assert.equal(r.body.campo, "ordem", "e diz qual parâmetro veio errado");
    });

    test("ausente cai em `nome_asc`, que é o padrão declarado", () => {
      assert.equal(ordenacaoDeClientes(undefined), "nome_asc");
      assert.equal(ordenacaoDeClientes(""), "nome_asc");
      assert.equal(ordenacaoDeClientes(null), "nome_asc");
    });

    test("o vocabulário é fechado, e tem exatamente dois valores", () => {
      assert.deepEqual([...ORDENACOES_CLIENTE], ["nome_asc", "nome_desc"]);
      // Valor não-string é o que a injeção de operador entregaria.
      assert.throws(() => ordenacaoDeClientes({ $ne: "x" }), /Ordenação inválida/);
    });
  });
});
