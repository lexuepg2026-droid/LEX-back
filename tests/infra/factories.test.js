// A suíte que testa a suíte.
//
// Existe por causa de um prejuízo concreto: a auditoria geral perdeu uma
// rodada inteira porque o gerador de CNPJ usava base de 11 dígitos em vez de
// 12. O sintoma aparecia como "cadastro de PJ quebrado" — diagnóstico no
// lugar errado, tempo gasto no código de produção, que estava certo.
//
// Aqui os geradores são conferidos contra o validador REAL do backend, e
// depois contra a API de verdade. Se este arquivo passar, uma falha de PF ou
// PJ em qualquer outro arquivo é do produto, não do arranjo.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, COLECOES, desconectar } from "../helpers/db.js";
import { cpfValido, cnpjValido, emailUnico } from "../helpers/factories.js";
import { registrarUsuario, criarClientePF, criarClientePJ } from "../helpers/setup.js";
import { nomeDoBanco, BANCO_PROIBIDO } from "../helpers/env.js";

// O validador de produção, importado sem intermediário.
import { validarCPF, validarCNPJ, somenteDigitos } from "../../src/utils/documentos.js";

const COLECOES_USADAS = [COLECOES.USERS, COLECOES.CLIENTS];

describe("infra: geradores de documento", () => {
  test("cpfValido() produz 200 CPFs que o validador real aceita", () => {
    for (let i = 0; i < 200; i += 1) {
      const cpf = cpfValido();
      assert.equal(somenteDigitos(cpf).length, 11, `CPF com comprimento errado: ${cpf}`);
      assert.ok(validarCPF(cpf), `validarCPF recusou ${cpf}`);
    }
  });

  test("cnpjValido() produz 200 CNPJs que o validador real aceita", () => {
    for (let i = 0; i < 200; i += 1) {
      const cnpj = cnpjValido();
      // A asserção que teria poupado a rodada perdida: 14 dígitos, o que
      // implica base de 12 antes dos dois verificadores.
      assert.equal(somenteDigitos(cnpj).length, 14, `CNPJ com comprimento errado: ${cnpj}`);
      assert.ok(validarCNPJ(cnpj), `validarCNPJ recusou ${cnpj}`);
    }
  });

  test("os geradores não repetem em 500 chamadas", () => {
    const cpfs = new Set();
    const cnpjs = new Set();
    for (let i = 0; i < 500; i += 1) {
      cpfs.add(cpfValido());
      cnpjs.add(cnpjValido());
    }
    assert.equal(cpfs.size, 500, "CPF repetido — colidiria no índice único");
    assert.equal(cnpjs.size, 500, "CNPJ repetido — colidiria no índice único");
  });

  test("emailUnico() não repete", () => {
    const emails = new Set();
    for (let i = 0; i < 500; i += 1) emails.add(emailUnico());
    assert.equal(emails.size, 500);
  });
});

describe("infra: guarda do banco de teste", () => {
  test("nomeDoBanco() extrai o banco de URIs nas duas formas", () => {
    assert.equal(nomeDoBanco("mongodb+srv://u:p@c.mongodb.net/lex_test?retryWrites=true"), "lex_test");
    assert.equal(nomeDoBanco("mongodb://localhost:27017/lex_test"), "lex_test");
    assert.equal(nomeDoBanco("mongodb://u:p@host:27017/outro_test"), "outro_test");
    assert.equal(nomeDoBanco("mongodb://localhost:27017"), null);
    assert.equal(nomeDoBanco(""), null);
    assert.equal(nomeDoBanco(undefined), null);
  });

  test("o banco proibido é o da demonstração", () => {
    // Trava o valor: se alguém renomear a constante para outro banco, este
    // teste cai antes de a suíte apagar a base da banca.
    assert.equal(BANCO_PROIBIDO, "lex");
  });

  test("a suíte não está conectada ao banco proibido", async () => {
    const atual = nomeDoBanco(process.env.MONGO_URI);
    assert.notEqual(atual, BANCO_PROIBIDO);
    assert.match(atual, /test/i);
  });
});

describe("infra: os documentos gerados passam pela API real", () => {
  before(async () => {
    await subirApp();
    await limparColecoes(COLECOES_USADAS);
  });

  after(async () => {
    await limparColecoes(COLECOES_USADAS);
    await derrubarApp();
    await desconectar();
  });

  test("cadastro de usuária com CPF gerado é aceito", async () => {
    const api = await registrarUsuario("infra");
    assert.ok(api.autenticado, "o cadastro deveria emitir o cookie lex-token");
    assert.ok(api.usuario?.id ?? api.usuario?._id);
  });

  test("cliente PF e PJ com documentos gerados são aceitos", async () => {
    const api = await registrarUsuario("infra-clientes");
    const pf = await criarClientePF(api);
    const pj = await criarClientePJ(api);
    assert.equal(pf.tipoPessoa, "fisica");
    assert.equal(pj.tipoPessoa, "juridica");
    assert.ok(validarCPF(pf.cpf));
    assert.ok(validarCNPJ(pj.cnpj));
  });

  test("o pote de cookies isola sessões diferentes", async () => {
    const a = await registrarUsuario("A");
    const b = await registrarUsuario("B");

    const meA = await a.get("/auth/me");
    const meB = await b.get("/auth/me");

    assert.equal(meA.status, 200);
    assert.equal(meB.status, 200);
    assert.notEqual(
      meA.body.usuario.email,
      meB.body.usuario.email,
      "as duas sessões enxergaram a mesma usuária — o pote de cookies vazou"
    );
  });

  test("sessão sem cookie recebe 401", async () => {
    const { ClienteApi } = await import("../helpers/client.js");
    const anonimo = new ClienteApi("anônimo");
    const r = await anonimo.get("/auth/me");
    assert.equal(r.status, 401);
  });
});
