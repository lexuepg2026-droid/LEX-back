// ═══════════════════════════════════════════════════════════════════════════
// TELEFONE E CEP FORMATADOS NO TIMBRADO (Fase 0, DEC-072)
//
// A tela grava telefone e CEP só com dígitos, e o timbrado — o papel de todo
// documento e de todo recibo — os imprimia assim: "42999991234", "CEP
// 84010000". `montarTimbrado` é função pura (recebe o usuário, devolve as
// linhas), então o teste a chama direto, sem banco e sem PDF.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { montarTimbrado } from "../../src/services/letterheadService.js";

const usuario = (extra = {}) => ({
  nomeCompleto: "Laís Teste",
  email: "lais@lex.dev",
  oab: { numero: "12345", estado: "PR" },
  advocacia: { nome: "Escritório Teste" },
  ...extra
});

const contato = (telefone) => montarTimbrado(usuario({ telefone })).contato;
const endereco = (cep) =>
  montarTimbrado(usuario({ endereco: { logradouro: "Rua XV", numero: "10", cep } })).endereco;

describe("timbrado — telefone formatado", () => {
  test("11 dígitos (celular) → (DD) NNNNN-NNNN", () => {
    assert.equal(contato("42999991234"), "(42) 99999-1234 · lais@lex.dev");
  });

  test("10 dígitos (fixo) → (DD) NNNN-NNNN", () => {
    assert.equal(contato("4232221234"), "(42) 3222-1234 · lais@lex.dev");
  });

  test("já formatado → continua igual", () => {
    assert.equal(contato("(42) 99999-1234"), "(42) 99999-1234 · lais@lex.dev");
  });

  test("vazio → a linha fica só com o e-mail, sem separador solto", () => {
    assert.equal(contato(""), "lais@lex.dev");
    assert.equal(contato(null), "lais@lex.dev");
  });

  test("tamanho inválido → sai como está, sem inventar formato", () => {
    assert.equal(contato("123456"), "123456 · lais@lex.dev");
    assert.equal(contato("+55 42 99999-1234"), "+55 42 99999-1234 · lais@lex.dev");
  });
});

describe("timbrado — CEP formatado", () => {
  test("8 dígitos → NNNNN-NNN", () => {
    assert.equal(endereco("84010000"), "Rua XV, 10 · CEP 84010-000");
  });

  test("já formatado → continua igual", () => {
    assert.equal(endereco("84010-000"), "Rua XV, 10 · CEP 84010-000");
  });

  test("vazio → sem o trecho de CEP", () => {
    assert.equal(endereco(""), "Rua XV, 10");
    assert.equal(endereco(undefined), "Rua XV, 10");
  });

  test("tamanho inválido → sai como está", () => {
    assert.equal(endereco("8401"), "Rua XV, 10 · CEP 8401");
  });
});
