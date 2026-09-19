// ═══════════════════════════════════════════════════════════════════════════
// A-2 (DEC-064) — CONFIRMAÇÃO DE E-MAIL E RECUPERAÇÃO DE SENHA DA ADVOGADA
//
// Decisões do Daniel que estes testes travam:
//   • o login NÃO fica bloqueado até confirmar o e-mail (a banca não pode ficar
//     de fora se o e-mail atrasar);
//   • a recuperação responde a MESMA coisa para e-mail com conta e sem conta.
//
// ── O envio é simulado ────────────────────────────────────────────────────
// `definirTransporteDeEmail` troca o provedor HTTP por uma função que guarda a
// mensagem. Nada sai da máquina. O envio real é conferido à mão (passos 267 a
// 270 do roteiro), e o formato do que se manda a cada provedor, em
// `emailService.test.js`.
//
// ── As duas mutações obrigatórias ─────────────────────────────────────────
//   1. tirar `expiraEm` do filtro de `consumirToken` → o teste "expirado" cai;
//   2. fazer a recuperação responder diferente quando a conta não existe → o
//      teste da resposta uniforme cai.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar, acharEm } from "../helpers/db.js";
import { registrarUsuario, logar, esperado } from "../helpers/setup.js";
import { ClienteApi } from "../helpers/client.js";
import { definirTransporteDeEmail } from "../../src/services/emailService.js";
import { MENSAGEM_RECUPERACAO } from "../../src/services/authService.js";

const BASE_DOS_LINKS = "https://lex.exemplo.teste";
const NOVA_SENHA = "NovaSenha789";

// ── A caixa de entrada simulada ────────────────────────────────────────────
let caixa = [];
let provedorFalha = false;

const instalarTransporte = () =>
  definirTransporteDeEmail(async (mensagem) => {
    if (provedorFalha) throw new Error("provedor fora do ar (simulado)");
    caixa.push(mensagem);
  });

const emailsPara = (endereco) => caixa.filter((m) => m.para === String(endereco).toLowerCase());
const ultimoEmailPara = (endereco) => emailsPara(endereco).at(-1);

const linkDe = (mensagem) => mensagem.texto.match(/https?:\/\/\S+/)[0];
const tokenDe = (mensagem) => new URL(linkDe(mensagem)).searchParams.get("token");

// ── Acesso cru à coleção, para o que a API não expõe ───────────────────────
const colecao = () => mongoose.connection.db.collection("users");
const usuarioCru = async (endereco) => (await acharEm("users", { email: String(endereco).toLowerCase() }))[0];
const atualizarCru = (endereco, atualizacao) =>
  colecao().updateOne({ email: String(endereco).toLowerCase() }, atualizacao);

const envelhecer = (endereco, campo, { expiraEm, enviadoEm } = {}) => {
  const $set = {};
  if (expiraEm) $set[`${campo}.expiraEm`] = expiraEm;
  if (enviadoEm) $set[`${campo}.enviadoEm`] = enviadoEm;
  return atualizarCru(endereco, { $set });
};

const noPassado = (ms) => new Date(Date.now() - ms);
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const anonimo = (rotulo = "anônimo") => new ClienteApi(rotulo);

describe("A-2 — e-mail da advogada", () => {
  before(async () => {
    process.env.APP_URL = BASE_DOS_LINKS;
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    instalarTransporte();
  });

  beforeEach(() => {
    caixa = [];
    provedorFalha = false;
  });

  after(async () => {
    definirTransporteDeEmail(null);
    delete process.env.APP_URL;
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("1. cadastro e confirmação", () => {
    test("o cadastro envia UM e-mail com o link, e a conta nasce não confirmada", async () => {
      const adv = await registrarUsuario("confirma-envio");
      const { email } = adv.credenciais;

      const mensagens = emailsPara(email);
      assert.equal(mensagens.length, 1, "um e-mail de confirmação, e só um");

      const link = linkDe(mensagens[0]);
      assert.ok(link.startsWith(`${BASE_DOS_LINKS}/confirmar-email?token=`), `link inesperado: ${link}`);
      assert.match(mensagens[0].assunto, /confirme/i);
      assert.ok(mensagens[0].html.includes(link.replace(/&/g, "&amp;")), "o HTML traz o mesmo link");

      assert.equal(adv.usuario.emailConfirmadoEm, null, "a resposta do cadastro diz que não está confirmado");

      const doc = await usuarioCru(email);
      assert.equal(doc.emailConfirmadoEm, null);
    });

    test("o segredo do link NÃO está no banco — só o hash dele", async () => {
      const adv = await registrarUsuario("confirma-hash");
      const token = tokenDe(ultimoEmailPara(adv.credenciais.email));
      const segredo = token.split(".")[1];

      const doc = await usuarioCru(adv.credenciais.email);
      assert.ok(doc.confirmacaoEmail?.tokenHash, "há um hash gravado");
      assert.notEqual(doc.confirmacaoEmail.tokenHash, segredo);
      assert.ok(!JSON.stringify(doc).includes(segredo), "o segredo em claro apareceu no documento");
    });

    test("falha do provedor NÃO derruba o cadastro — a conta existe e o login funciona", async () => {
      provedorFalha = true;
      const adv = await registrarUsuario("confirma-provedor-fora");

      assert.equal(emailsPara(adv.credenciais.email).length, 0, "nada foi entregue");
      const login = await logar(adv.credenciais.email, adv.credenciais.senha, "depois-da-falha");
      assert.ok(login.autenticado);
    });

    test("DECISÃO DO DANIEL: o login NÃO exige e-mail confirmado", async () => {
      const adv = await registrarUsuario("confirma-login-livre");

      const r = await anonimo().post("/auth/login", {
        email: adv.credenciais.email, senha: adv.credenciais.senha
      });
      esperado(r, 200, "login sem confirmar");
      assert.equal(r.body.usuario.emailConfirmadoEm, null);

      const eu = esperado(await adv.get("/auth/me"), 200, "/auth/me sem confirmar");
      assert.equal(eu.usuario.emailConfirmadoEm, null);
    });

    test("o token confirma a conta, e a resposta NÃO abre sessão", async () => {
      const adv = await registrarUsuario("confirma-ok");
      const token = tokenDe(ultimoEmailPara(adv.credenciais.email));

      const visitante = anonimo("clicou-no-link");
      const r = await visitante.post("/auth/confirm-email", { token });
      esperado(r, 200, "confirmar");
      assert.equal(visitante.cookies.size, 0, "confirmar o e-mail não pode abrir sessão");

      const eu = esperado(await adv.get("/auth/me"), 200, "/auth/me depois de confirmar");
      assert.ok(eu.usuario.emailConfirmadoEm, "a conta passou a constar como confirmada");

      const doc = await usuarioCru(adv.credenciais.email);
      assert.ok(!("confirmacaoEmail" in doc), "o token foi apagado junto");
    });

    test("o mesmo link não vale duas vezes", async () => {
      const adv = await registrarUsuario("confirma-uso-unico");
      const token = tokenDe(ultimoEmailPara(adv.credenciais.email));

      esperado(await anonimo().post("/auth/confirm-email", { token }), 200, "primeiro uso");

      const segundo = await anonimo().post("/auth/confirm-email", { token });
      assert.equal(segundo.status, 400);
      assert.equal(segundo.body.codigo, "tokenInvalido");
    });

    test("MUTAÇÃO 1: token EXPIRADO é recusado com o código próprio, e a conta segue não confirmada", async () => {
      const adv = await registrarUsuario("confirma-expirado");
      const token = tokenDe(ultimoEmailPara(adv.credenciais.email));
      await envelhecer(adv.credenciais.email, "confirmacaoEmail", { expiraEm: noPassado(1000) });

      const r = await anonimo().post("/auth/confirm-email", { token });
      assert.equal(r.status, 400, `um link expirado foi aceito: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.codigo, "tokenExpirado");

      const doc = await usuarioCru(adv.credenciais.email);
      assert.equal(doc.emailConfirmadoEm, null, "a conta foi confirmada por um link vencido");
    });

    test("token fora da forma, ausente ou de outro usuário é INVÁLIDO", async () => {
      const a = await registrarUsuario("confirma-a");
      const b = await registrarUsuario("confirma-b");
      const tokenA = tokenDe(ultimoEmailPara(a.credenciais.email));
      const tokenB = tokenDe(ultimoEmailPara(b.credenciais.email));

      const [idA] = tokenA.split(".");
      const [, segredoB] = tokenB.split(".");

      const casos = [
        ["ausente", undefined],
        ["número", 12345],
        ["vazio", ""],
        ["sem ponto", "abc"],
        ["forma certa, segredo inventado", `${idA}.${"0".repeat(64)}`],
        ["id de A com o segredo de B", `${idA}.${segredoB}`],
        ["id inexistente", `${"f".repeat(24)}.${segredoB}`]
      ];

      for (const [rotulo, token] of casos) {
        const r = await anonimo().post("/auth/confirm-email", token === undefined ? {} : { token });
        assert.equal(r.status, 400, `${rotulo}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.codigo, "tokenInvalido", rotulo);
      }

      assert.equal((await usuarioCru(a.credenciais.email)).emailConfirmadoEm, null, "A foi confirmada por engano");
      assert.equal((await usuarioCru(b.credenciais.email)).emailConfirmadoEm, null, "B foi confirmada por engano");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("2. reenvio da confirmação", () => {
    test("exige sessão", async () => {
      const r = await anonimo().post("/auth/resend-confirmation", {});
      assert.equal(r.status, 401);
    });

    test("envia um e-mail NOVO, e o link antigo deixa de valer", async () => {
      const adv = await registrarUsuario("reenvio-troca");
      const { email } = adv.credenciais;
      const antigo = tokenDe(ultimoEmailPara(email));

      await envelhecer(email, "confirmacaoEmail", { enviadoEm: noPassado(5 * 60 * 1000) });

      const r = esperado(await adv.post("/auth/resend-confirmation", {}), 200, "reenvio");
      assert.equal(r.jaConfirmado, false);

      const mensagens = emailsPara(email);
      assert.equal(mensagens.length, 2);
      const novo = tokenDe(mensagens[1]);
      assert.notEqual(novo, antigo);

      const comAntigo = await anonimo().post("/auth/confirm-email", { token: antigo });
      assert.equal(comAntigo.status, 400, "o link do primeiro e-mail continuou valendo");

      esperado(await anonimo().post("/auth/confirm-email", { token: novo }), 200, "link novo");
    });

    test("um pedido por minuto: o segundo em seguida é 429 com o código `aguarde`", async () => {
      const adv = await registrarUsuario("reenvio-intervalo");

      // O cadastro acabou de emitir um token: o reenvio imediato cai no intervalo.
      const r = await adv.post("/auth/resend-confirmation", {});
      assert.equal(r.status, 429, JSON.stringify(r.body));
      assert.equal(r.body.codigo, "aguarde");
      assert.equal(emailsPara(adv.credenciais.email).length, 1, "não pode ter saído um segundo e-mail");
    });

    test("conta já confirmada: diz isso e NÃO envia nada", async () => {
      const adv = await registrarUsuario("reenvio-ja-confirmada");
      esperado(
        await anonimo().post("/auth/confirm-email", { token: tokenDe(ultimoEmailPara(adv.credenciais.email)) }),
        200, "confirmar"
      );
      caixa = [];

      const r = esperado(await adv.post("/auth/resend-confirmation", {}), 200, "reenvio");
      assert.equal(r.jaConfirmado, true);
      assert.equal(caixa.length, 0);
    });

    test("falha do provedor no reenvio é dita à advogada (502) — ela está logada, não há o que esconder", async () => {
      const adv = await registrarUsuario("reenvio-provedor-fora");
      await envelhecer(adv.credenciais.email, "confirmacaoEmail", { enviadoEm: noPassado(5 * 60 * 1000) });

      provedorFalha = true;
      const r = await adv.post("/auth/resend-confirmation", {});
      assert.equal(r.status, 502, JSON.stringify(r.body));
      assert.match(r.body.message, /não foi possível enviar/i);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("3. recuperação de senha — o pedido", () => {
    test("MUTAÇÃO 2: a MESMA resposta para e-mail com conta e sem conta, byte a byte", async () => {
      const adv = await registrarUsuario("recupera-uniforme");
      const { email } = adv.credenciais;
      caixa = [];

      const comConta = await anonimo().post("/auth/forgot-password", { email });
      const semConta = await anonimo().post("/auth/forgot-password", { email: "ninguem.nunca.cadastrou@lex.teste" });
      const comCaixaDiferente = await anonimo().post("/auth/forgot-password", { email: `  ${email.toUpperCase()}  ` });
      const malFormado = await anonimo().post("/auth/forgot-password", { email: "isto-nao-e-um-email" });

      for (const [rotulo, r] of [
        ["com conta", comConta], ["sem conta", semConta],
        ["caixa diferente", comCaixaDiferente], ["mal formado", malFormado]
      ]) {
        assert.equal(r.status, 200, `${rotulo}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.message, MENSAGEM_RECUPERACAO, rotulo);
      }

      // Corpos idênticos: nada que só uma das respostas tenha.
      const corpos = new Set([comConta, semConta, comCaixaDiferente, malFormado].map((r) => JSON.stringify(r.body)));
      assert.equal(corpos.size, 1, `as respostas divergem: ${[...corpos].join(" | ")}`);

      // E o e-mail só saiu para quem tem conta — UM, porque o pedido com a caixa
      // diferente caiu no intervalo de espera da mesma conta.
      assert.equal(emailsPara(email).length, 1);
      assert.equal(caixa.length, 1, "saiu e-mail para um endereço sem conta");
    });

    test("o e-mail da recuperação leva o link de redefinir e o prazo", async () => {
      const adv = await registrarUsuario("recupera-conteudo");
      caixa = [];
      await anonimo().post("/auth/forgot-password", { email: adv.credenciais.email });

      const mensagem = ultimoEmailPara(adv.credenciais.email);
      assert.ok(linkDe(mensagem).startsWith(`${BASE_DOS_LINKS}/redefinir-senha?token=`));
      assert.match(mensagem.assunto, /senha/i);
      assert.match(mensagem.texto, /60 minutos/);
    });

    test("pedidos em sequência: a resposta é a mesma, sai UM e-mail, e o primeiro link segue valendo", async () => {
      const adv = await registrarUsuario("recupera-intervalo");
      caixa = [];

      const primeiro = await anonimo().post("/auth/forgot-password", { email: adv.credenciais.email });
      const segundo = await anonimo().post("/auth/forgot-password", { email: adv.credenciais.email });

      assert.deepEqual(primeiro.body, segundo.body);
      assert.equal(emailsPara(adv.credenciais.email).length, 1);

      const token = tokenDe(ultimoEmailPara(adv.credenciais.email));
      esperado(
        await anonimo().post("/auth/reset-password", { token, novaSenha: NOVA_SENHA }),
        200, "o primeiro link continua valendo"
      );
    });

    test("um pedido novo, depois do intervalo, SUBSTITUI o link anterior", async () => {
      const adv = await registrarUsuario("recupera-substitui");
      const { email } = adv.credenciais;
      caixa = [];

      await anonimo().post("/auth/forgot-password", { email });
      const antigo = tokenDe(ultimoEmailPara(email));
      await envelhecer(email, "recuperacaoSenha", { enviadoEm: noPassado(5 * 60 * 1000) });

      await anonimo().post("/auth/forgot-password", { email });
      const novo = tokenDe(ultimoEmailPara(email));
      assert.notEqual(novo, antigo);

      const comAntigo = await anonimo().post("/auth/reset-password", { token: antigo, novaSenha: NOVA_SENHA });
      assert.equal(comAntigo.status, 400);
      assert.equal(comAntigo.body.codigo, "tokenInvalido");

      esperado(await anonimo().post("/auth/reset-password", { token: novo, novaSenha: NOVA_SENHA }), 200, "link novo");
    });

    test("falha do provedor: a resposta CONTINUA sendo a mesma", async () => {
      const adv = await registrarUsuario("recupera-provedor-fora");
      provedorFalha = true;

      const r = await anonimo().post("/auth/forgot-password", { email: adv.credenciais.email });
      assert.equal(r.status, 200);
      assert.equal(r.body.message, MENSAGEM_RECUPERACAO);
    });

    test("corpo sem e-mail (ausente, vazio, não-texto) é 400 — é erro de FORMA, não pergunta sobre conta", async () => {
      for (const corpo of [{}, { email: "" }, { email: "   " }, { email: 42 }, { email: null }]) {
        const r = await anonimo().post("/auth/forgot-password", corpo);
        assert.equal(r.status, 400, JSON.stringify(corpo));
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("4. recuperação de senha — a redefinição", () => {
    const pedirLink = async (adv) => {
      caixa = [];
      await anonimo().post("/auth/forgot-password", { email: adv.credenciais.email });
      return tokenDe(ultimoEmailPara(adv.credenciais.email));
    };

    test("troca a senha, a antiga deixa de valer, e a resposta NÃO abre sessão", async () => {
      const adv = await registrarUsuario("redefine-ok");
      const token = await pedirLink(adv);

      const visitante = anonimo("redefinindo");
      esperado(await visitante.post("/auth/reset-password", { token, novaSenha: NOVA_SENHA }), 200, "redefinir");
      assert.equal(visitante.cookies.size, 0, "redefinir a senha não pode abrir sessão");

      const antiga = await anonimo().post("/auth/login", { email: adv.credenciais.email, senha: adv.credenciais.senha });
      assert.equal(antiga.status, 401, "a senha antiga continuou valendo");

      const nova = await anonimo().post("/auth/login", { email: adv.credenciais.email, senha: NOVA_SENHA });
      esperado(nova, 200, "login com a senha nova");
    });

    test("o hash gravado é bcrypt íntegro (o `$` do hash não virou caminho de campo)", async () => {
      const adv = await registrarUsuario("redefine-hash");
      const token = await pedirLink(adv);
      esperado(await anonimo().post("/auth/reset-password", { token, novaSenha: NOVA_SENHA }), 200, "redefinir");

      const doc = await usuarioCru(adv.credenciais.email);
      assert.match(doc.senhaHash, /^\$2[aby]\$10\$.{53}$/, `hash corrompido: ${doc.senhaHash}`);
    });

    test("o link vale UMA vez", async () => {
      const adv = await registrarUsuario("redefine-uso-unico");
      const token = await pedirLink(adv);

      esperado(await anonimo().post("/auth/reset-password", { token, novaSenha: NOVA_SENHA }), 200, "primeiro uso");

      const segundo = await anonimo().post("/auth/reset-password", { token, novaSenha: "OutraSenha123" });
      assert.equal(segundo.status, 400);
      assert.equal(segundo.body.codigo, "tokenInvalido");

      // E a senha continua sendo a do primeiro uso.
      esperado(
        await anonimo().post("/auth/login", { email: adv.credenciais.email, senha: NOVA_SENHA }),
        200, "a senha do primeiro uso"
      );
    });

    test("MUTAÇÃO 1: link EXPIRADO é recusado, e a senha antiga continua valendo", async () => {
      const adv = await registrarUsuario("redefine-expirado");
      const token = await pedirLink(adv);
      await envelhecer(adv.credenciais.email, "recuperacaoSenha", { expiraEm: noPassado(1000) });

      const r = await anonimo().post("/auth/reset-password", { token, novaSenha: NOVA_SENHA });
      assert.equal(r.status, 400, `um link expirado trocou a senha: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.codigo, "tokenExpirado");

      esperado(
        await anonimo().post("/auth/login", { email: adv.credenciais.email, senha: adv.credenciais.senha }),
        200, "a senha antiga segue valendo"
      );
    });

    test("senha fraca é recusada SEM gastar o link", async () => {
      const adv = await registrarUsuario("redefine-fraca");
      const token = await pedirLink(adv);

      for (const novaSenha of ["curta1", "somenteletras", "12345678", undefined]) {
        const r = await anonimo().post("/auth/reset-password", novaSenha === undefined ? { token } : { token, novaSenha });
        assert.equal(r.status, 400, `${novaSenha}: ${JSON.stringify(r.body)}`);
      }

      esperado(
        await anonimo().post("/auth/reset-password", { token, novaSenha: NOVA_SENHA }),
        200, "o link seguia inteiro depois das recusas"
      );
    });

    test("redefinir prova o controle do e-mail: a conta passa a constar como confirmada", async () => {
      const adv = await registrarUsuario("redefine-confirma");
      assert.equal((await usuarioCru(adv.credenciais.email)).emailConfirmadoEm, null);

      const token = await pedirLink(adv);
      esperado(await anonimo().post("/auth/reset-password", { token, novaSenha: NOVA_SENHA }), 200, "redefinir");

      const doc = await usuarioCru(adv.credenciais.email);
      assert.ok(doc.emailConfirmadoEm, "e-mail continuou não confirmado");
      assert.ok(!("confirmacaoEmail" in doc), "o link de confirmação pendente também foi apagado");
      assert.ok(!("recuperacaoSenha" in doc));
    });

    test("ENCERRA as sessões ativas — mas o login logo depois da redefinição passa", async () => {
      const adv = await registrarUsuario("redefine-sessoes");
      const sessaoAntiga = await logar(adv.credenciais.email, adv.credenciais.senha, "sessão-antiga");
      esperado(await sessaoAntiga.get("/auth/me"), 200, "a sessão antiga funcionava");

      // O `iat` do JWT tem resolução de segundos: a redefinição tem de acontecer
      // em um segundo POSTERIOR ao da sessão antiga.
      await dormir(1100);

      const token = await pedirLink(adv);
      esperado(await anonimo().post("/auth/reset-password", { token, novaSenha: NOVA_SENHA }), 200, "redefinir");

      const derrubada = await sessaoAntiga.get("/auth/me");
      assert.equal(derrubada.status, 401, "a sessão anterior à redefinição continuou valendo");
      assert.match(derrubada.body.message, /senha foi redefinida/i);

      // Cookie do cadastro (`adv`) também é anterior.
      assert.equal((await adv.get("/auth/me")).status, 401, "o cookie do cadastro continuou valendo");

      // O login imediatamente depois — possivelmente no MESMO segundo da
      // redefinição — não pode ser recusado.
      const nova = await logar(adv.credenciais.email, NOVA_SENHA, "sessão-nova");
      esperado(await nova.get("/auth/me"), 200, "o login feito logo depois da redefinição");
    });

    test("a troca de senha DENTRO da sessão não derruba a própria sessão (DEC-050)", async () => {
      const adv = await registrarUsuario("troca-logada-mantem");
      esperado(
        await adv.post("/auth/alterar-senha", { senhaAtual: adv.credenciais.senha, novaSenha: NOVA_SENHA }),
        200, "alterar-senha"
      );
      esperado(await adv.get("/auth/me"), 200, "a advogada continua logada");
    });

    test("a troca de senha logada INVALIDA um pedido de recuperação pendente", async () => {
      const adv = await registrarUsuario("troca-logada-invalida-link");
      const token = await pedirLink(adv);

      esperado(
        await adv.post("/auth/alterar-senha", { senhaAtual: adv.credenciais.senha, novaSenha: "SenhaEscolhida42" }),
        200, "alterar-senha"
      );

      const r = await anonimo().post("/auth/reset-password", { token, novaSenha: NOVA_SENHA });
      assert.equal(r.status, 400, "um link anterior à troca de senha ainda redefiniu por cima dela");
      assert.equal(r.body.codigo, "tokenInvalido");

      esperado(
        await anonimo().post("/auth/login", { email: adv.credenciais.email, senha: "SenhaEscolhida42" }),
        200, "a senha escolhida na troca continua valendo"
      );
    });

    test("link de recuperação não serve para confirmar e vice-versa", async () => {
      const adv = await registrarUsuario("finalidades-separadas");
      const tokenConfirmacao = tokenDe(ultimoEmailPara(adv.credenciais.email));
      const tokenRecuperacao = await pedirLink(adv);

      const confirmaComRecuperacao = await anonimo().post("/auth/confirm-email", { token: tokenRecuperacao });
      assert.equal(confirmaComRecuperacao.status, 400);

      const redefineComConfirmacao = await anonimo().post("/auth/reset-password", {
        token: tokenConfirmacao, novaSenha: NOVA_SENHA
      });
      assert.equal(redefineComConfirmacao.status, 400);

      // Nenhum dos dois foi consumido: cada link ainda serve à sua finalidade.
      esperado(await anonimo().post("/auth/confirm-email", { token: tokenConfirmacao }), 200, "confirmação");
      esperado(await anonimo().post("/auth/reset-password", { token: tokenRecuperacao, novaSenha: NOVA_SENHA }), 200, "recuperação");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("5. nada de credencial sai por onde não deve", () => {
    test("nenhuma resposta da API traz hash de token nem o segredo", async () => {
      const adv = await registrarUsuario("sem-vazamento");
      const token = tokenDe(ultimoEmailPara(adv.credenciais.email));
      const segredo = token.split(".")[1];

      const respostas = [
        await adv.get("/auth/me"),
        await adv.patch("/auth/me", { telefone: "(42) 90000-0000" }),
        await anonimo().post("/auth/forgot-password", { email: adv.credenciais.email }),
        await anonimo().post("/auth/login", { email: adv.credenciais.email, senha: adv.credenciais.senha })
      ];

      for (const r of respostas) {
        const bruto = JSON.stringify(r.body);
        assert.ok(!bruto.includes(segredo), "o segredo do link saiu numa resposta");
        assert.ok(!/tokenHash|confirmacaoEmail|recuperacaoSenha|senhaAlteradaEm/.test(bruto), `campo interno saiu: ${bruto}`);
      }
    });
  });
});
