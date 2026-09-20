// ═══════════════════════════════════════════════════════════════════════════
// DEC-063 — A REGRA DE E-MAIL, E A ASSIMETRIA ENTRE CADASTRO E LOGIN (A-1)
//
// ── O que a A-1 encontrou, e não era o que o enunciado supunha ────────────
// O enunciado da fase dizia que não havia validação nenhuma. Havia:
// `validateRegisterPayload` já testava uma expressão escrita à mão, e a MESMA
// expressão estava copiada em `RegisterPage.jsx`, no frontend.
//
// As duas cópias tinham o mesmo furo, e ele é de um caso só:
//
//     /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test("daniel@lex..dev")  →  true
//
// porque `[^\s@]+` engole o primeiro ponto e o `\.` casa com o segundo. Dos
// onze casos da tabela da fase, ela acertava dez.
//
// ── A parte que MAIS precisa de teste não é o formato ────────────────────
// É o **login continuar sem validar formato**. A regra é fácil de "consertar"
// por reflexo — parece inconsistência —, e consertá-la abriria um oráculo de
// enumeração de contas: um 400 que só e-mail malformado recebe separa
// "recusei antes de olhar o banco" de "olhei o banco".
//
// O bloco 3 é a rede contra isso, e a mutação (b) da fase é exatamente essa
// alteração.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import { registrarUsuario, esperado } from "../helpers/setup.js";
import { ClienteApi } from "../helpers/client.js";
import { dadosUsuario, SENHA_PADRAO } from "../helpers/factories.js";
import { emailValido, normalizarEmail, MENSAGEM_EMAIL_INVALIDO } from "../../src/utils/email.js";

// A tabela da fase, verbatim. É o contrato da regra, e está aqui como DADO e
// não como uma sequência de `test(...)` escritos à mão — assim acrescentar um
// caso é acrescentar uma linha, e nenhum caso pode ser esquecido no meio.
const CASOS = Object.freeze([
  ["daniel@lex.dev", true, "o caso comum"],
  ["daniel.rodrigues@lex.com.br", true, "ponto no nome e domínio composto"],
  ["daniel+tag@lex.dev", true, "sinal de mais é VÁLIDO e é usado de verdade"],
  ["daniel", false, "sem @ nenhum"],
  ["daniel@", false, "sem domínio"],
  ["@lex.dev", false, "sem nada antes do @"],
  ["daniel@lex", false, "domínio sem ponto"],
  ["daniel @lex.dev", false, "espaço no meio"],
  ["daniel@@lex.dev", false, "dois @"],
  ["daniel@lex..dev", false, "🚨 dois pontos seguidos — o furo da expressão antiga"],
  ["  daniel@lex.dev  ", true, "espaços nas bordas: aceito, e removidos"]
]);

describe("DEC-063 — validação de e-mail", () => {
  let api;

  before(async () => {
    api = await subirApp();
    await limparColecoes();
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  describe("1. a regra, em função pura", () => {
    for (const [entrada, aceito, porque] of CASOS) {
      test(`${aceito ? "aceita" : "recusa"} ${JSON.stringify(entrada)} — ${porque}`, () => {
        assert.equal(emailValido(entrada), aceito);
      });
    }

    test("a normalização é trim + caixa baixa, e devolve string sempre", () => {
      assert.equal(normalizarEmail("  Daniel@LEX.dev "), "daniel@lex.dev");
      assert.equal(normalizarEmail("JÁ@MINÚSCULO.com"), "já@minúsculo.com");
      // Entrada não-string não pode virar `undefined`: quem chama isto está
      // prestes a comparar contra o banco, e `undefined` num `findOne`
      // devolveria um documento arbitrário.
      assert.equal(normalizarEmail(undefined), "");
      assert.equal(normalizarEmail(null), "");
      assert.equal(normalizarEmail({ $ne: "x" }), "");
    });

    test("a expressão ANTIGA falharia no ponto duplo — a regressão que a fase fechou", () => {
      const antiga = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      assert.equal(antiga.test("daniel@lex..dev"), true, "a antiga aceitava");
      assert.equal(emailValido("daniel@lex..dev"), false, "a nova recusa");
    });
  });

  describe("2. no CADASTRO: recusa com 400 e `campo: \"email\"`", () => {
    test("e-mail malformado → 400, com o campo nomeado", async () => {
      const cliente = new ClienteApi("cadastro torto");
      const r = await cliente.post("/auth/register", dadosUsuario({ email: "daniel@lex..dev" }));

      assert.equal(r.status, 400, "recusa o formato");
      assert.equal(r.body.message, MENSAGEM_EMAIL_INVALIDO, "a frase é a única da regra");
      // Sem `campo`, quem erra o e-mail na etapa 1 do assistente lê a mensagem
      // na etapa 2 e não sabe para onde voltar. É o contrato da DEC-027, e o
      // passo 81 do roteiro já o trava para os outros formulários.
      assert.equal(r.body.campo, "email", "🚨 o formulário precisa saber qual input destacar");
    });

    test("os cinco recusados da tabela recusam pela ROTA, e não só na função", async () => {
      for (const [entrada, aceito] of CASOS) {
        if (aceito) continue;
        const cliente = new ClienteApi("cadastro torto");
        const r = await cliente.post("/auth/register", dadosUsuario({ email: entrada }));
        assert.equal(r.status, 400, `${JSON.stringify(entrada)} tinha de ser recusado pela rota`);
        assert.equal(r.body.campo, "email");
      }
    });

    test("e-mail com espaços nas bordas é ACEITO, e gravado sem eles", async () => {
      const payload = dadosUsuario();
      const limpo = normalizarEmail(payload.email);
      const cliente = new ClienteApi("cadastro com espaços");
      const r = await cliente.post("/auth/register", { ...payload, email: `  ${limpo.toUpperCase()}  ` });

      const corpo = esperado(r, 201, "cadastro com espaços e maiúsculas");
      assert.equal(corpo.usuario.email, limpo, "gravado normalizado");
    });
  });

  describe("3. 🚨 no LOGIN: o formato NÃO é validado, e a resposta é uniforme", () => {
    let existente;

    before(async () => {
      await limparColecoes();
      existente = await registrarUsuario("dona da conta");
    });

    // O coração da fase. Os três casos precisam ser INDISTINGUÍVEIS por fora:
    // quem consegue separá-los consegue descobrir quais endereços têm conta.
    test("e-mail malformado, e-mail inexistente e senha errada: mesma resposta", async () => {
      const tentar = async (rotulo, corpo) => {
        const cliente = new ClienteApi(rotulo);
        const r = await cliente.post("/auth/login", corpo);
        return { status: r.status, body: JSON.stringify(r.body) };
      };

      const malformado = await tentar("malformado", { email: "daniel@lex..dev", senha: SENHA_PADRAO });
      const inexistente = await tentar("inexistente", { email: "naoexiste@lex.dev", senha: SENHA_PADRAO });
      const senhaErrada = await tentar("senha errada", {
        email: existente.credenciais.email,
        senha: "SenhaErrada123"
      });

      assert.equal(malformado.status, 401, "malformado responde 401, e não 400");
      assert.equal(inexistente.status, 401);
      assert.equal(senhaErrada.status, 401);

      // Byte a byte, como a DEC-029 ponto 11 exige do portal. Se alguém
      // acrescentar `emailValido()` ao `validateLoginPayload`, o primeiro vira
      // 400 "E-mail inválido" e estas duas asserções caem.
      assert.equal(
        malformado.body,
        inexistente.body,
        "🚨 malformado e inexistente têm de ser indistinguíveis"
      );
      assert.equal(
        inexistente.body,
        senhaErrada.body,
        "🚨 inexistente e senha errada têm de ser indistinguíveis"
      );
    });

    test("nenhuma variação de e-mail torto escapa para 400 no login", async () => {
      for (const [entrada, aceito] of CASOS) {
        if (aceito) continue;
        const cliente = new ClienteApi("login torto");
        const r = await cliente.post("/auth/login", { email: entrada, senha: SENHA_PADRAO });
        assert.equal(
          r.status,
          401,
          `${JSON.stringify(entrada)} devolveu ${r.status} — um status próprio para ` +
          "e-mail malformado permite enumerar contas"
        );
      }
    });

    test("e-mail vazio continua 400 — campo obrigatório não é formato", async () => {
      const cliente = new ClienteApi("login vazio");
      const r = await cliente.post("/auth/login", { email: "", senha: SENHA_PADRAO });
      // Este 400 não vaza nada: ele não distingue conta nenhuma, porque string
      // vazia não é endereço de conta possível. É a fronteira exata da decisão.
      assert.equal(r.status, 400);
    });
  });

  describe("4. normalização: `Daniel@X.com ` e `daniel@x.com` são o MESMO e-mail", () => {
    let conta;

    before(async () => {
      await limparColecoes();
      conta = await registrarUsuario("dona do e-mail");
    });

    test("o login encontra a conta digitando com maiúsculas e espaços", async () => {
      const bagunçado = `  ${conta.credenciais.email.toUpperCase()}  `;
      const cliente = new ClienteApi("login bagunçado");
      const r = await cliente.post("/auth/login", { email: bagunçado, senha: conta.credenciais.senha });

      // Sem a normalização ANTES da consulta, o `lowercase` do schema não
      // ajudaria: ele atua na escrita, não no `findOne`. O login responderia
      // 401 para a dona da conta.
      esperado(r, 200, "login com o mesmo e-mail em outra caixa");
    });

    test("cadastrar o mesmo e-mail em outra caixa é recusado com 409", async () => {
      const cliente = new ClienteApi("cadastro duplicado");
      const r = await cliente.post(
        "/auth/register",
        dadosUsuario({ email: conta.credenciais.email.toUpperCase() })
      );

      assert.equal(r.status, 409, "🚨 duas contas que qualquer humano leria como uma");
      assert.equal(r.body.campo, "email");
    });
  });
});
