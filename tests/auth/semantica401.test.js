// ═══════════════════════════════════════════════════════════════════════════
// DEC-050 — A SEMÂNTICA DO 401, EM FORMA EXECUTÁVEL
//
// ── O defeito que originou a regra (V-2) ─────────────────────────────────
// Errar a senha ATUAL na tela de troca de senha devolvia 401. O interceptor do
// axios trata todo 401 como sessão perdida, e a advogada era EXPULSA do sistema
// por um erro de digitação — no meio de uma tarefa, sem ter feito nada errado
// além de trocar uma tecla.
//
// A causa não estava no interceptor. O 401 estava respondendo a duas perguntas
// diferentes: "não sei quem você é" e "sei quem você é, e este dado está
// errado". Só a primeira justifica descartar a sessão.
//
// ── A regra ──────────────────────────────────────────────────────────────
// **O 401 é reservado exclusivamente para sessão ausente ou inválida. Qualquer
// outra falha de credencial dentro de uma sessão válida é 422.**
//
// ── Por que este arquivo existe, separado dos testes de cada rota ────────
// Ele é o INVENTÁRIO dos 401 do backend, executável. Cada 401 que a fase
// levantou aparece aqui uma vez: os que continuam 401 provando que continuam, e
// os que viraram 422 provando o número novo E que a sessão sobrevive.
//
// Espalhados pelos arquivos de cada rota, esses casos seriam onze asserções sem
// parentesco visível, e a próxima pessoa a acrescentar um 401 não teria onde
// perceber que existe uma regra. Aqui, acrescentar um 401 sem classificá-lo
// deixa este arquivo desatualizado de um jeito que se vê.
//
// A alternativa que NÃO se usou: lista de exceção de rotas no frontend. Ela
// resolveria o V-2 e apodreceria no próximo caso — a rota seguinte que
// devolvesse 401 por engano não estaria na lista, e o defeito voltaria calado.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, esperado } from "../helpers/setup.js";
import { SENHA_PADRAO } from "../helpers/factories.js";
import { ClienteApi } from "../helpers/client.js";
import {
  montarCenarioPortal,
  entrarNoPortal,
  SENHA_PROVISORIA,
  SENHA_DO_CLIENTE
} from "../helpers/portal.js";

// Sessão forjada: um cookie que o middleware vai receber e recusar. Serve para
// exercitar os ramos de token malformado e de token de outro domínio sem
// depender de o servidor emitir um token ruim — coisa que ele não faz.
const comCookie = (nome, valor, rotulo) => {
  const api = new ClienteApi(rotulo);
  api.cookies.set(nome, valor);
  return api;
};

describe("DEC-050 — o 401 é só para sessão ausente ou inválida", () => {
  let api;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("dec050");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // CATEGORIA 1 — SESSÃO AUSENTE OU INVÁLIDA: continua 401
  //
  // Os quatro do `authMiddleware`, os dois do login e os do portal. Em todos, a
  // resposta certa é "não sei quem você é", e deslogar é a reação certa.
  // ═════════════════════════════════════════════════════════════════════════

  test("401 mantido — token não informado (authMiddleware)", async () => {
    const anonimo = new ClienteApi("sem token");
    const r = await anonimo.get("/auth/me");
    assert.equal(r.status, 401, "sem cookie nenhum, a sessão está AUSENTE");
  });

  test("401 mantido — token malformado (authMiddleware)", async () => {
    const r = await comCookie("lex-token", "isto-nao-e-um-jwt", "token podre").get("/clients");
    assert.equal(r.status, 401, "assinatura que não confere é sessão INVÁLIDA");
  });

  test("401 mantido — token expirado (authMiddleware)", async () => {
    const vencido = jwt.sign({ id: "000000000000000000000000" }, process.env.JWT_SECRET, {
      expiresIn: "-1h"
    });
    const r = await comCookie("lex-token", vencido, "token vencido").get("/clients");
    assert.equal(r.status, 401, "token expirado é sessão INVÁLIDA");
  });

  test("401 mantido — token do PORTAL apresentado na área da advogada", async () => {
    // Segunda tranca do isolamento entre domínios: mesmo que alguém aponte os
    // dois segredos para o mesmo valor, o `tipo` separa um cliente do cadastro
    // inteiro. A sessão da ADVOGADA não existe, e 401 é o que se responde.
    const doPortal = jwt.sign(
      { id: "000000000000000000000000", tipo: "portal" },
      process.env.JWT_SECRET
    );
    const r = await comCookie("lex-token", doPortal, "token de portal").get("/clients");
    assert.equal(r.status, 401);
  });

  test("401 mantido — usuário do token não existe mais (authMiddleware)", async () => {
    // Token perfeitamente assinado, apontando para um usuário que sumiu. A
    // sessão perdeu o sujeito: não há mais quem ela identifique.
    const orfao = jwt.sign({ id: "0123456789abcdef01234567" }, process.env.JWT_SECRET);
    const r = await comCookie("lex-token", orfao, "token órfão").get("/clients");
    assert.equal(r.status, 401);
  });

  test("401 mantido — login com senha errada", async () => {
    // Aqui NÃO HÁ sessão: esta é a requisição que pede uma. "Não sei quem você
    // é" é literalmente a resposta certa, e é o único 401 que a advogada vê
    // numa tela onde ninguém está logado.
    const anonimo = new ClienteApi("login errado");
    const r = await anonimo.post("/auth/login", {
      email: api.credenciais.email,
      senha: "SenhaQueNaoEhAMinha1"
    });
    assert.equal(r.status, 401);
    assert.ok(!anonimo.autenticado, "nenhuma sessão foi criada");
  });

  test("401 mantido — login com e-mail inexistente responde IGUAL ao de senha errada", async () => {
    // A igualdade é o ponto: distinguir os dois transformaria o login num
    // oráculo de enumeração de contas.
    const anonimo = new ClienteApi("login inexistente");
    const r = await anonimo.post("/auth/login", {
      email: "ninguem@lex.dev",
      senha: "SenhaQueNaoEhAMinha1"
    });
    assert.equal(r.status, 401);
  });

  test("401 mantido — login do portal com credencial errada", async () => {
    const { codigoAcesso } = await montarCenarioPortal("dec050-portal-login");
    const anonimo = new ClienteApi("portal login errado");
    const r = await anonimo.post("/portal/login", {
      codigoAcesso,
      senha: "SenhaErradaDoPortal1"
    });
    assert.equal(r.status, 401, "o login do portal não tem sessão a perder");
    assert.equal(r.body.codigo, "credenciaisInvalidas");
  });

  test("401 mantido — sessão do portal ausente (portalAuthMiddleware)", async () => {
    const anonimo = new ClienteApi("portal sem sessão");
    const r = await anonimo.get("/portal/sessao");
    assert.equal(r.status, 401);
    assert.equal(r.body.codigo, "sessaoPortalInvalida");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // CATEGORIA 2 — CREDENCIAL CONFERIDA DENTRO DE SESSÃO VÁLIDA: passou a 422
  //
  // O teste que importa não é o número: é a linha seguinte, que prova que a
  // sessão SOBREVIVEU. Era exatamente isso que o V-2 destruía.
  // ═════════════════════════════════════════════════════════════════════════

  test("422 — senha atual errada na troca de senha da advogada", async () => {
    const usuario = await registrarUsuario("dec050-troca");

    const r = await usuario.post("/auth/alterar-senha", {
      senhaAtual: "SenhaQueNaoEhAMinha1",
      novaSenha: "OutraSenhaValida123"
    });

    assert.equal(r.status, 422, "sessão válida + dado errado = 422, nunca 401");
    assert.equal(r.body.campo, "senhaAtual", "a tela precisa saber qual campo destacar");
  });

  test("422 — e a sessão SOBREVIVE ao erro de digitação (o defeito V-2)", async () => {
    const usuario = await registrarUsuario("dec050-sobrevive");

    esperado(
      await usuario.post("/auth/alterar-senha", {
        senhaAtual: "ErreiADigitacao1",
        novaSenha: "OutraSenhaValida123"
      }),
      422,
      "senha atual errada"
    );

    // A prova de que a sessão continua de pé: uma requisição autenticada logo
    // depois. Sem esta linha, o teste acima provaria só que o número mudou —
    // e o número não é o defeito. O defeito era a advogada ser expulsa.
    const depois = esperado(await usuario.get("/auth/me"), 200, "requisição autenticada depois do 422");
    assert.equal(depois.usuario.email, usuario.credenciais.email);

    // E a senha continua sendo a antiga: a recusa não pode ter trocado nada.
    esperado(
      await usuario.post("/auth/alterar-senha", {
        senhaAtual: SENHA_PADRAO,
        novaSenha: "AgoraSimTroquei123"
      }),
      200,
      "a senha antiga ainda é a válida"
    );
  });

  test("422 — senha atual errada na troca de senha do PORTAL, e a sessão sobrevive", async () => {
    const { codigoAcesso } = await montarCenarioPortal("dec050-portal-troca");
    const portal = await entrarNoPortal(codigoAcesso);

    const r = await portal.patch("/portal/senha", {
      senhaAtual: "NaoEhAAtual1",
      novaSenha: SENHA_DO_CLIENTE
    });

    // Era 400. Virou 422 junto com a da advogada: é a MESMA pergunta, e duas
    // respostas diferentes para a mesma pergunta é o que faz a próxima pessoa
    // copiar a que vir primeiro.
    assert.equal(r.status, 422);
    assert.equal(r.body.campo, "senhaAtual");

    const sessao = esperado(await portal.get("/portal/sessao"), 200, "sessão do portal depois do 422");
    assert.equal(sessao.senhaPortalProvisoria, true, "nada foi trocado");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // A REGRA, TRAVADA
  //
  // O teste que pega o 401 que ninguém classificou: uma rota autenticada
  // qualquer, com sessão VÁLIDA e dado errado, não pode responder 401.
  // ═════════════════════════════════════════════════════════════════════════

  test("nenhuma rota autenticada devolve 401 com sessão válida", async () => {
    const usuario = await registrarUsuario("dec050-varredura");

    // Amostra das falhas de dado mais comuns dentro de sessão válida: corpo
    // recusado, id inexistente, id malformado. Nenhuma delas é "não sei quem
    // você é", e nenhuma pode deslogar ninguém.
    const casos = [
      ["POST /auth/alterar-senha (senha atual errada)", () =>
        usuario.post("/auth/alterar-senha", { senhaAtual: "Errada123", novaSenha: "Nova12345" })],
      ["PATCH /auth/me (payload inválido)", () =>
        usuario.patch("/auth/me", { cpf: "123" })],
      ["GET /clients/:id (id inexistente)", () =>
        usuario.get("/clients/0123456789abcdef01234567")],
      ["GET /processes/:id (id malformado)", () =>
        usuario.get("/processes/nao-e-um-objectid")],
      ["GET /fees/:id (id inexistente)", () =>
        usuario.get("/fees/0123456789abcdef01234567")]
    ];

    for (const [nome, executar] of casos) {
      const r = await executar();
      assert.notEqual(
        r.status,
        401,
        `${nome} respondeu 401 com sessão VÁLIDA — isso desloga a advogada (DEC-050)`
      );
    }
  });
});
