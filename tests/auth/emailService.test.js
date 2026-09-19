// ═══════════════════════════════════════════════════════════════════════════
// A-2 (DEC-064) — O QUE O SISTEMA MANDA AO PROVEDOR, E O QUE FAZ QUANDO ELE FALHA
//
// Sem rede e sem conta de provedor: o `fetch` é trocado por uma função que
// guarda a requisição. O que se prova aqui é o FORMATO do que cada adaptador
// envia (URL, cabeçalho de autenticação, corpo) e o comportamento diante de
// erro — não que o Brevo ou o Resend aceitem a mensagem. Isso só um envio real
// prova, e ele é feito à mão (passos 267 a 270 do roteiro).
//
// ⚠️ O formato de cada adaptador foi escrito a partir da documentação pública
// de cada provedor, e NÃO foi exercitado contra a API real nesta fase (não há
// chave). Se o primeiro envio real falhar com 400/401, é aqui que se corrige.
// ═══════════════════════════════════════════════════════════════════════════

import "../helpers/env.js";

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  enviarEmail, definirTransporteDeEmail, montarRequisicao, urlBaseDoApp
} from "../../src/services/emailService.js";
import {
  montarEmailConfirmacao, montarEmailRecuperacao, escaparHtml
} from "../../src/services/emailTemplates.js";
import { gerarToken, lerToken, hashesIguais } from "../../src/utils/tokenUsuario.js";

const MENSAGEM = Object.freeze({
  para: "advogada@exemplo.com",
  assunto: "Assunto de teste",
  texto: "Texto com o link https://lex.exemplo.teste/redefinir-senha?token=SEGREDO-DO-TOKEN",
  html: "<p>Html com SEGREDO-DO-TOKEN</p>"
});

const VARIAVEIS = ["EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME", "APP_URL", "NODE_ENV"];

describe("A-2 — envio de e-mail por provedor HTTP", () => {
  const original = {};
  let fetchOriginal;
  let requisicoes;
  let respostaDoProvedor;
  let erroDeRede;
  let logsDeErro;
  let consoleErrorOriginal;

  beforeEach(() => {
    for (const v of VARIAVEIS) original[v] = process.env[v];
    fetchOriginal = globalThis.fetch;
    definirTransporteDeEmail(null);

    requisicoes = [];
    respostaDoProvedor = { ok: true, status: 201, texto: "{}" };
    erroDeRede = null;
    logsDeErro = [];

    globalThis.fetch = async (url, opcoes) => {
      requisicoes.push({ url, opcoes });
      if (erroDeRede) throw erroDeRede;
      return {
        ok: respostaDoProvedor.ok,
        status: respostaDoProvedor.status,
        text: async () => respostaDoProvedor.texto
      };
    };

    consoleErrorOriginal = console.error;
    console.error = (...args) => logsDeErro.push(args.join(" "));

    process.env.EMAIL_PROVIDER = "brevo";
    process.env.EMAIL_API_KEY = "chave-de-teste-123";
    process.env.EMAIL_FROM = "lex@exemplo.com";
    process.env.EMAIL_FROM_NAME = "LEX Teste";
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    console.error = consoleErrorOriginal;
    for (const v of VARIAVEIS) {
      if (original[v] === undefined) delete process.env[v];
      else process.env[v] = original[v];
    }
  });

  describe("o que cada adaptador envia", () => {
    const configuracao = { chave: "CHAVE", remetente: "lex@exemplo.com", remetenteNome: "LEX" };

    test("brevo: URL, cabeçalho `api-key` e corpo", () => {
      const { url, opcoes } = montarRequisicao("brevo", MENSAGEM, configuracao);

      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(opcoes.method, "POST");
      assert.equal(opcoes.headers["api-key"], "CHAVE");
      assert.equal(opcoes.headers["content-type"], "application/json");

      const corpo = JSON.parse(opcoes.body);
      assert.deepEqual(corpo.sender, { name: "LEX", email: "lex@exemplo.com" });
      assert.deepEqual(corpo.to, [{ email: MENSAGEM.para }]);
      assert.equal(corpo.subject, MENSAGEM.assunto);
      assert.equal(corpo.htmlContent, MENSAGEM.html);
      assert.equal(corpo.textContent, MENSAGEM.texto);
    });

    test("resend: URL, `Authorization: Bearer` e corpo", () => {
      const { url, opcoes } = montarRequisicao("resend", MENSAGEM, configuracao);

      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(opcoes.headers.authorization, "Bearer CHAVE");

      const corpo = JSON.parse(opcoes.body);
      assert.equal(corpo.from, "LEX <lex@exemplo.com>");
      assert.deepEqual(corpo.to, [MENSAGEM.para]);
      assert.equal(corpo.subject, MENSAGEM.assunto);
      assert.equal(corpo.html, MENSAGEM.html);
      assert.equal(corpo.text, MENSAGEM.texto);
    });

    test("provedor desconhecido não monta requisição", () => {
      assert.equal(montarRequisicao("correios", MENSAGEM, configuracao), null);
    });
  });

  describe("enviarEmail", () => {
    test("chama o provedor configurado, com a chave e o remetente do ambiente", async () => {
      await enviarEmail(MENSAGEM);

      assert.equal(requisicoes.length, 1);
      assert.equal(requisicoes[0].url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(requisicoes[0].opcoes.headers["api-key"], "chave-de-teste-123");
      assert.equal(JSON.parse(requisicoes[0].opcoes.body).sender.name, "LEX Teste");
      assert.ok(requisicoes[0].opcoes.signal, "sem tempo limite, um provedor pendurado seguraria a requisição");
    });

    test("trocar EMAIL_PROVIDER troca o adaptador, sem mudar código", async () => {
      process.env.EMAIL_PROVIDER = "resend";
      await enviarEmail(MENSAGEM);
      assert.equal(requisicoes[0].url, "https://api.resend.com/emails");
    });

    test("o provedor recusou (401): lança, com o status, e o SEGREDO do link não vai para o log nem para o erro", async () => {
      respostaDoProvedor = { ok: false, status: 401, texto: '{"message":"Key is invalid"}' };

      await assert.rejects(
        () => enviarEmail(MENSAGEM),
        (erro) => {
          assert.match(erro.message, /401/);
          assert.match(erro.message, /Key is invalid/);
          assert.equal(erro.statusCode, 502);
          assert.ok(!erro.message.includes("SEGREDO-DO-TOKEN"), "o token do link vazou para a mensagem de erro");
          assert.ok(!erro.message.includes("chave-de-teste-123"), "a chave de API vazou para a mensagem de erro");
          return true;
        }
      );
    });

    test("rede fora do ar ou tempo esgotado: lança sem carregar o corpo da mensagem", async () => {
      erroDeRede = Object.assign(new Error("fetch failed: SEGREDO-DO-TOKEN"), { name: "TimeoutError" });

      await assert.rejects(
        () => enviarEmail(MENSAGEM),
        (erro) => {
          assert.match(erro.message, /TimeoutError/);
          assert.ok(!erro.message.includes("SEGREDO-DO-TOKEN"));
          return true;
        }
      );
    });

    test("provedor sem chave ou sem remetente: lança, e nada é enviado", async () => {
      delete process.env.EMAIL_API_KEY;
      await assert.rejects(() => enviarEmail(MENSAGEM), /mal configurado/);

      process.env.EMAIL_API_KEY = "x";
      delete process.env.EMAIL_FROM;
      await assert.rejects(() => enviarEmail(MENSAGEM), /mal configurado/);

      assert.equal(requisicoes.length, 0);
    });

    test("provedor com nome errado: lança, e nada é enviado", async () => {
      process.env.EMAIL_PROVIDER = "pombo-correio";
      await assert.rejects(() => enviarEmail(MENSAGEM), /desconhecido/);
      assert.equal(requisicoes.length, 0);
    });

    test("EM PRODUÇÃO, sem provedor: lança — não finge que enviou", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.EMAIL_PROVIDER;

      await assert.rejects(() => enviarEmail(MENSAGEM), /não configurado/);
      assert.equal(requisicoes.length, 0);
    });

    test("fora de produção, sem provedor: não chama a rede (o link sai no console)", async () => {
      delete process.env.EMAIL_PROVIDER;
      const logOriginal = console.log;
      const linhas = [];
      console.log = (...args) => linhas.push(args.join(" "));
      try {
        await enviarEmail(MENSAGEM);
      } finally {
        console.log = logOriginal;
      }

      assert.equal(requisicoes.length, 0);
      assert.ok(linhas.some((l) => l.includes("[lex:email]")));
    });
  });

  describe("a base dos links", () => {
    test("vem de APP_URL, sem a barra do fim", () => {
      process.env.APP_URL = "https://lex.exemplo.teste///";
      assert.equal(urlBaseDoApp(), "https://lex.exemplo.teste");
    });

    test("fora de produção há um padrão; EM PRODUÇÃO a falta de APP_URL devolve vazio", () => {
      delete process.env.APP_URL;
      process.env.NODE_ENV = "test";
      assert.equal(urlBaseDoApp(), "http://localhost:5173");

      process.env.NODE_ENV = "production";
      assert.equal(urlBaseDoApp(), "", "um link para localhost em produção é um e-mail inútil");
    });
  });
});

describe("A-2 — o texto dos e-mails", () => {
  const link = "https://lex.exemplo.teste/confirmar-email?token=abc.def&x=1";

  test("confirmação: o link está no texto e no HTML, com o prazo", () => {
    const { assunto, texto, html } = montarEmailConfirmacao({ nomeCompleto: "Ana Souza", link });

    assert.match(assunto, /confirme/i);
    assert.ok(texto.includes(link));
    assert.ok(html.includes(escaparHtml(link)), "no HTML o `&` do link precisa estar escapado");
    assert.match(texto, /24 horas/);
    assert.match(texto, /Olá, Ana!/);
  });

  test("recuperação: prazo de 60 minutos, aviso de que desconecta os aparelhos, e o que fazer se não foi a pessoa", () => {
    const { texto } = montarEmailRecuperacao({ nomeCompleto: "Ana Souza", link });

    assert.match(texto, /60 minutos/);
    assert.match(texto, /desconectados/);
    assert.match(texto, /ignore esta mensagem/i);
  });

  test("o nome vindo do cadastro é ESCAPADO no HTML", () => {
    const nome = '<img src=x onerror="alert(1)"> Maria';
    const { html } = montarEmailRecuperacao({ nomeCompleto: nome, link });

    assert.ok(!html.includes("<img"), "marcação do nome entrou no HTML do e-mail");
    assert.ok(html.includes("&lt;img"));
  });

  test("sem nome, a saudação não quebra", () => {
    const { texto } = montarEmailConfirmacao({ nomeCompleto: "", link });
    assert.ok(texto.startsWith("Olá!"));
  });
});

describe("A-2 — o token do link", () => {
  test("ida e volta: o id e o hash do segredo saem do token, e o hash NÃO é o segredo", () => {
    const usuarioId = "64b7f0c2a1b2c3d4e5f60718";
    const { token, tokenHash } = gerarToken(usuarioId);
    const lido = lerToken(token);

    assert.equal(lido.usuarioId, usuarioId);
    assert.equal(lido.tokenHash, tokenHash);
    assert.notEqual(tokenHash, token.split(".")[1]);
    assert.match(token, /^[a-f0-9]{24}\.[a-f0-9]{64}$/);
  });

  test("dois tokens do mesmo usuário nunca coincidem", () => {
    const id = "64b7f0c2a1b2c3d4e5f60718";
    const gerados = new Set(Array.from({ length: 50 }, () => gerarToken(id).token));
    assert.equal(gerados.size, 50);
  });

  test("lerToken recusa o que não tem a forma exata", () => {
    for (const ruim of [undefined, null, 5, {}, "", "abc", "x.y", `${"a".repeat(24)}.${"b".repeat(63)}`, `${"g".repeat(24)}.${"b".repeat(64)}`]) {
      assert.equal(lerToken(ruim), null, `aceitou ${JSON.stringify(ruim)}`);
    }
  });

  test("hashesIguais compara em tempo constante e recusa o que não é hash", () => {
    const { tokenHash } = gerarToken("64b7f0c2a1b2c3d4e5f60718");
    assert.equal(hashesIguais(tokenHash, tokenHash), true);
    assert.equal(hashesIguais(tokenHash, gerarToken("64b7f0c2a1b2c3d4e5f60718").tokenHash), false);
    assert.equal(hashesIguais(tokenHash, "curto"), false);
    assert.equal(hashesIguais(undefined, tokenHash), false);
    assert.equal(hashesIguais("", ""), false);
  });
});
