// ═══════════════════════════════════════════════════════════════════════════
// AUTENTICAÇÃO DO PORTAL — 401 unificado, troca obrigatória, os dois segredos.
//
// Este arquivo protege três propriedades que, se quebrarem, quebram em
// silêncio — nenhuma delas aparece como erro de tela:
//
//   1. O 401 do login é IGUAL nos seis casos. Se um dia um deles divergir por
//      uma vírgula, o login vira oráculo de códigos de acesso válidos.
//   2. A troca de senha é obrigatória. Sem ela, a advogada continua conhecendo
//      a senha e toda confirmação de visualização vira repudiável.
//   3. Token de um domínio não vale no outro. É a fronteira inteira do
//      multi-tenant depois que existe gente de fora entrando.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarProcesso, esperado } from "../helpers/setup.js";
import { dadosClientePF } from "../helpers/factories.js";
import { ClienteApi } from "../helpers/client.js";
import {
  montarCenarioPortal, entrarNoPortal, entrarNoPortalComSenhaPropria,
  codigoAcessoDe, novoClientePortal, SENHA_PROVISORIA, SENHA_DO_CLIENTE
} from "../helpers/portal.js";
import { ERRO_PORTAL } from "../../src/config/portalErrors.js";
import { NOME_COOKIE_PORTAL, EXPIRACAO_SESSAO_PORTAL } from "../../src/services/portalAuthService.js";

describe("portal: autenticação", () => {
  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Login
  // ═════════════════════════════════════════════════════════════════════════

  describe("login", () => {
    test("código e senha válidos → 200, cookie emitido, provisória sinalizada", async () => {
      const { codigoAcesso, cliente, processo } = await montarCenarioPortal("login-ok");

      const api = novoClientePortal("login");
      const r = await api.post("/portal/login", { codigoAcesso, senha: SENHA_PROVISORIA });

      assert.equal(r.status, 200, `esperado 200 — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.senhaPortalProvisoria, true, "a senha da advogada nasce provisória");
      assert.equal(String(r.body.processoId), String(processo._id));
      assert.equal(String(r.body.clienteId), String(cliente._id));

      assert.ok(api.cookies.has(NOME_COOKIE_PORTAL), "o cookie lex-portal-token não foi emitido");
      assert.ok(!api.cookies.has("lex-token"), "o portal não pode emitir o cookie da advogada");

      // O token vive só no cookie httpOnly. Devolvê-lo no corpo o tornaria
      // legível por JavaScript de página e anularia o httpOnly.
      assert.equal(r.body.token, undefined, "o token não pode ir no corpo da resposta");
    });

    test("o código é aceito em minúsculas e com espaços em volta", async () => {
      // A advogada dita o código por telefone e o cliente digita. Exigir caixa
      // exata transformaria erro de digitação em "senha inválida", e o cliente
      // não teria como saber a diferença.
      const { codigoAcesso } = await montarCenarioPortal("login-caixa");
      const api = novoClientePortal("caixa");
      const r = await api.post("/portal/login", {
        codigoAcesso: `  ${codigoAcesso.toLowerCase()}  `,
        senha: SENHA_PROVISORIA
      });
      assert.equal(r.status, 200, `esperado 200 — ${JSON.stringify(r.body)}`);
    });

    test("o cookie do portal é httpOnly e tem expiração mais curta que a da advogada", async () => {
      const { codigoAcesso } = await montarCenarioPortal("login-cookie");
      const api = novoClientePortal("cookie");
      const r = await api.post("/portal/login", { codigoAcesso, senha: SENHA_PROVISORIA });

      const setCookie = (r.headers.getSetCookie?.() ?? []).find((c) =>
        c.startsWith(NOME_COOKIE_PORTAL)
      );
      assert.ok(setCookie, "não veio Set-Cookie do portal");
      assert.match(setCookie, /HttpOnly/i, "o cookie do portal precisa ser httpOnly");

      // 2h contra 1d da advogada. Sessão de consulta, e o código de acesso
      // circula por WhatsApp — "aparelho emprestado com sessão viva" é cenário
      // realista, não hipótese.
      assert.equal(EXPIRACAO_SESSAO_PORTAL, "2h");
      const maxAge = Number(/Max-Age=(\d+)/i.exec(setCookie)?.[1]);
      assert.equal(maxAge, 2 * 60 * 60, "maxAge do cookie deveria ser 2 horas");
      assert.ok(maxAge < 24 * 60 * 60, "a sessão do portal tem de ser mais curta que a da advogada");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 401 unificado — DEC-029 ponto 11
  // ═════════════════════════════════════════════════════════════════════════

  describe("401 unificado: os seis casos são indistinguíveis", () => {
    test("corpo e status byte-idênticos nos 6 casos", async () => {
      const respostas = {};
      const registrar = async (rotulo, corpo) => {
        const api = novoClientePortal(rotulo);
        const r = await api.post("/portal/login", corpo);
        respostas[rotulo] = { status: r.status, body: r.body };
      };

      // 1. código inexistente, mas bem formado
      await registrar("codigo inexistente", {
        codigoAcesso: "LEX-ZZZZ-9999",
        senha: SENHA_PROVISORIA
      });

      // 2. vínculo inativo
      {
        const adv = await registrarUsuario("adv-vinculo-inativo");
        const c1 = esperado(
          await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
          201, "cliente 1"
        );
        const c2 = esperado(await adv.post("/clients", dadosClientePF()), 201, "cliente 2");
        const processo = await criarProcesso(adv, [
          { clienteId: c2._id, papel: "autor", principal: true },
          { clienteId: c1._id, papel: "litisconsorte", principal: false }
        ]);
        const codigo = await codigoAcessoDe(adv, processo._id, c1._id);
        esperado(
          await adv.delete(`/processes/${processo._id}/clientes/${c1._id}`),
          200, "desativa o vínculo"
        );
        await registrar("vinculo inativo", { codigoAcesso: codigo, senha: SENHA_PROVISORIA });
      }

      // 3. cliente sem senha de portal
      {
        const adv = await registrarUsuario("adv-sem-senha");
        const cliente = esperado(await adv.post("/clients", dadosClientePF()), 201, "cliente");
        const processo = await criarProcesso(adv, [
          { clienteId: cliente._id, papel: "autor", principal: true }
        ]);
        const codigo = await codigoAcessoDe(adv, processo._id, cliente._id);
        await registrar("sem senha", { codigoAcesso: codigo, senha: SENHA_PROVISORIA });
      }

      // 4. senha errada
      {
        const { codigoAcesso } = await montarCenarioPortal("adv-senha-errada");
        await registrar("senha errada", { codigoAcesso, senha: "SenhaErrada999" });
      }

      // 5. cliente inativo
      {
        const adv = await registrarUsuario("adv-cliente-inativo");
        const cliente = esperado(
          await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
          201, "cliente"
        );
        const outro = esperado(await adv.post("/clients", dadosClientePF()), 201, "outro");
        const processo = await criarProcesso(adv, [
          { clienteId: outro._id, papel: "autor", principal: true },
          { clienteId: cliente._id, papel: "litisconsorte", principal: false }
        ]);
        const codigo = await codigoAcessoDe(adv, processo._id, cliente._id);
        esperado(
          await adv.delete(`/processes/${processo._id}/clientes/${cliente._id}`),
          200, "desvincula para poder excluir"
        );
        esperado(await adv.delete(`/clients/${cliente._id}`), 200, "desativa o cliente");
        await registrar("cliente inativo", { codigoAcesso: codigo, senha: SENHA_PROVISORIA });
      }

      // 6. processo inativo
      {
        const { adv, processo, codigoAcesso } = await montarCenarioPortal("adv-processo-inativo");
        esperado(await adv.delete(`/processes/${processo._id}`), 200, "desativa o processo");
        await registrar("processo inativo", { codigoAcesso, senha: SENHA_PROVISORIA });
      }

      const rotulos = Object.keys(respostas);
      assert.equal(rotulos.length, 6, "os 6 casos precisam ter sido exercitados");

      // A asserção que importa: os SEIS corpos serializam para a mesma string.
      // Comparar só o status deixaria passar uma mensagem diferente, que é
      // exatamente como um oráculo nasce.
      const referencia = JSON.stringify(respostas[rotulos[0]]);
      for (const rotulo of rotulos) {
        assert.equal(respostas[rotulo].status, 401, `"${rotulo}" não devolveu 401`);
        assert.equal(
          JSON.stringify(respostas[rotulo]),
          referencia,
          `"${rotulo}" respondeu diferente de "${rotulos[0]}":\n` +
          `  ${JSON.stringify(respostas[rotulo])}\n  ${referencia}`
        );
      }

      assert.equal(respostas[rotulos[0]].body.codigo, ERRO_PORTAL.CREDENCIAIS_INVALIDAS);
      // E não vaza qual foi o caso por nenhuma chave extra.
      assert.deepEqual(
        Object.keys(respostas[rotulos[0]].body).sort(),
        ["codigo", "message"]
      );
    });

    test("código com formato inválido cai no mesmo 401, não em 400", async () => {
      // 400 para código malformado e 401 para bem formado já separaria o
      // espaço de busca: bastaria variar o formato para descobrir a regra.
      const api = novoClientePortal("formato");
      const r = await api.post("/portal/login", {
        codigoAcesso: "NAO-E-UM-CODIGO",
        senha: SENHA_PROVISORIA
      });
      assert.equal(r.status, 401, `esperado 401, veio ${r.status}`);
      assert.equal(r.body.codigo, ERRO_PORTAL.CREDENCIAIS_INVALIDAS);
    });

    test("o código de um vínculo desativado continua RESERVADO globalmente", async () => {
      // Regra da Fase 2B. Se o código voltasse ao sorteio, quem guardou o
      // antigo entraria no processo de outra pessoa.
      const adv = await registrarUsuario("adv-reserva");
      const c1 = esperado(await adv.post("/clients", dadosClientePF()), 201, "c1");
      const c2 = esperado(await adv.post("/clients", dadosClientePF()), 201, "c2");
      const processo = await criarProcesso(adv, [
        { clienteId: c1._id, papel: "autor", principal: true },
        { clienteId: c2._id, papel: "litisconsorte", principal: false }
      ]);
      const codigo = await codigoAcessoDe(adv, processo._id, c2._id);

      esperado(
        await adv.delete(`/processes/${processo._id}/clientes/${c2._id}`),
        200, "desativa o vínculo"
      );

      const { acharEm, COLECOES } = await import("../helpers/db.js");
      const vinculos = await acharEm(COLECOES.PROCESSO_CLIENTES, { codigoAcesso: codigo });
      assert.equal(vinculos.length, 1, "o vínculo inativo sumiu do banco");
      assert.equal(vinculos[0].ativo, false);
      assert.equal(vinculos[0].codigoAcesso, codigo, "o código foi apagado do vínculo inativo");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Troca obrigatória — DEC-029 ponto 4
  // ═════════════════════════════════════════════════════════════════════════

  describe("troca obrigatória de senha", () => {
    test("com senha provisória, /sessao responde e sinaliza o estado", async () => {
      const { codigoAcesso } = await montarCenarioPortal("troca-sessao");
      const portal = await entrarNoPortal(codigoAcesso);

      const r = esperado(await portal.get("/portal/sessao"), 200, "sessão");
      assert.equal(r.senhaPortalProvisoria, true);
      assert.equal(r.papel, "autor");
    });

    test("a troca marca definitiva, preenche a data e reemite a sessão", async () => {
      const { codigoAcesso } = await montarCenarioPortal("troca-ok");
      const portal = await entrarNoPortal(codigoAcesso);
      const cookieAntigo = portal.cookies.get(NOME_COOKIE_PORTAL);

      const r = esperado(
        await portal.patch("/portal/senha", {
          senhaAtual: SENHA_PROVISORIA,
          novaSenha: SENHA_DO_CLIENTE
        }),
        200,
        "troca de senha"
      );

      assert.equal(r.senhaPortalProvisoria, false);
      assert.ok(r.senhaPortalDefinidaEm, "senhaPortalDefinidaEm deveria ter sido preenchido");

      const cookieNovo = portal.cookies.get(NOME_COOKIE_PORTAL);
      assert.notEqual(cookieNovo, cookieAntigo, "a sessão não foi reemitida");

      assert.equal(
        esperado(await portal.get("/portal/sessao"), 200, "sessão após troca").senhaPortalProvisoria,
        false
      );
    });

    test("o token ANTERIOR à troca deixa de valer", async () => {
      // JWT não tem revogação: sem o carimbo da senha nas claims, o token
      // emitido enquanto a advogada conhecia a senha continuaria válido pelas
      // 2 horas seguintes, e a janela que a troca fecha ficaria aberta.
      const { codigoAcesso } = await montarCenarioPortal("troca-token-velho");

      const sessaoA = await entrarNoPortal(codigoAcesso, SENHA_PROVISORIA, "A");
      const tokenAntigo = sessaoA.cookies.get(NOME_COOKIE_PORTAL);

      const sessaoB = await entrarNoPortal(codigoAcesso, SENHA_PROVISORIA, "B");
      esperado(
        await sessaoB.patch("/portal/senha", {
          senhaAtual: SENHA_PROVISORIA,
          novaSenha: SENHA_DO_CLIENTE
        }),
        200,
        "troca pela sessão B"
      );

      // A sessão A ainda carrega o token de antes da troca.
      const velha = novoClientePortal("A-velha");
      velha.cookies.set(NOME_COOKIE_PORTAL, tokenAntigo);
      const r = await velha.get("/portal/sessao");

      assert.equal(r.status, 401, `o token anterior à troca deveria morrer, veio ${r.status}`);
      assert.equal(r.body.codigo, ERRO_PORTAL.SESSAO_INVALIDA);
    });

    test("a nova senha não pode ser a provisória", async () => {
      // Sem esta regra, "trocar" repetindo a senha que a advogada entregou
      // marcaria a senha como definitiva com ela ainda conhecendo — o recibo
      // continuaria repudiável, agora com carimbo dizendo que não é.
      const { codigoAcesso } = await montarCenarioPortal("troca-repetida");
      const portal = await entrarNoPortal(codigoAcesso);

      const r = await portal.patch("/portal/senha", {
        senhaAtual: SENHA_PROVISORIA,
        novaSenha: SENHA_PROVISORIA
      });

      assert.equal(r.status, 400, `esperado 400 — ${JSON.stringify(r.body)}`);
      assert.match(r.body.message, /não pode ser igual/i);
      assert.equal(r.body.campo, "novaSenha");

      assert.equal(
        esperado(await portal.get("/portal/sessao"), 200, "sessão").senhaPortalProvisoria,
        true,
        "a senha não podia ter sido marcada como definitiva"
      );
    });

    test("a nova senha não pode ser o CPF do cliente", async () => {
      const pf = dadosClientePF();
      const adv = await registrarUsuario("troca-cpf");
      const cliente = esperado(
        await adv.post("/clients", { ...pf, senhaPortal: SENHA_PROVISORIA }),
        201, "cliente"
      );
      const processo = await criarProcesso(adv, [
        { clienteId: cliente._id, papel: "autor", principal: true }
      ]);
      const codigo = await codigoAcessoDe(adv, processo._id, cliente._id);
      const portal = await entrarNoPortal(codigo);

      for (const tentativa of [pf.cpf, String(pf.cpf).replace(/\D/g, "")]) {
        const r = await portal.patch("/portal/senha", {
          senhaAtual: SENHA_PROVISORIA,
          novaSenha: tentativa
        });
        assert.equal(r.status, 400, `CPF como senha deveria ser recusado — ${JSON.stringify(r.body)}`);
        assert.match(r.body.message, /CPF/);
      }
    });

    test("senha atual errada não troca nada", async () => {
      const { codigoAcesso } = await montarCenarioPortal("troca-atual-errada");
      const portal = await entrarNoPortal(codigoAcesso);

      const r = await portal.patch("/portal/senha", {
        senhaAtual: "NaoEhAAtual1",
        novaSenha: SENHA_DO_CLIENTE
      });
      assert.equal(r.status, 400);
      assert.equal(r.body.campo, "senhaAtual");

      assert.equal(
        esperado(await portal.get("/portal/sessao"), 200, "sessão").senhaPortalProvisoria,
        true
      );
    });

    test("depois da troca, o login usa a senha NOVA e a antiga não vale mais", async () => {
      const { codigoAcesso } = await montarCenarioPortal("troca-login");
      await entrarNoPortalComSenhaPropria(codigoAcesso);

      const comAntiga = novoClientePortal("antiga");
      assert.equal(
        (await comAntiga.post("/portal/login", { codigoAcesso, senha: SENHA_PROVISORIA })).status,
        401,
        "a senha provisória deveria ter deixado de valer"
      );

      const comNova = novoClientePortal("nova");
      const r = await comNova.post("/portal/login", { codigoAcesso, senha: SENHA_DO_CLIENTE });
      assert.equal(r.status, 200);
      assert.equal(r.body.senhaPortalProvisoria, false);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Logout e revogação
  // ═════════════════════════════════════════════════════════════════════════

  describe("logout e revogação", () => {
    test("logout limpa o cookie e a sessão morre", async () => {
      const { codigoAcesso } = await montarCenarioPortal("logout");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      esperado(await portal.post("/portal/logout"), 200, "logout");
      assert.ok(!portal.cookies.has(NOME_COOKIE_PORTAL), "o cookie não foi limpo");

      assert.equal((await portal.get("/portal/sessao")).status, 401);
    });

    test("a advogada revogando o acesso derruba a sessão na requisição seguinte", async () => {
      // Revogar precisa ter efeito imediato, e não esperar as 2 horas do token.
      const { adv, cliente, codigoAcesso } = await montarCenarioPortal("revoga");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      esperado(await portal.get("/portal/sessao"), 200, "sessão viva antes da revogação");

      esperado(await adv.delete(`/clients/${cliente._id}/senha-portal`), 200, "revoga");

      const r = await portal.get("/portal/sessao");
      assert.equal(r.status, 401, "a sessão deveria morrer após a revogação");

      // E o código deixa de autenticar.
      const novo = novoClientePortal("apos-revogacao");
      assert.equal(
        (await novo.post("/portal/login", { codigoAcesso, senha: SENHA_DO_CLIENTE })).status,
        401
      );
    });

    test("desativar o vínculo derruba a sessão na requisição seguinte", async () => {
      const adv = await registrarUsuario("adv-desativa-vinculo");
      const c1 = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "c1"
      );
      const c2 = esperado(await adv.post("/clients", dadosClientePF()), 201, "c2");
      const processo = await criarProcesso(adv, [
        { clienteId: c2._id, papel: "autor", principal: true },
        { clienteId: c1._id, papel: "litisconsorte", principal: false }
      ]);
      const codigo = await codigoAcessoDe(adv, processo._id, c1._id);
      const portal = await entrarNoPortalComSenhaPropria(codigo);

      esperado(await portal.get("/portal/sessao"), 200, "sessão viva");
      esperado(await adv.delete(`/processes/${processo._id}/clientes/${c1._id}`), 200, "desvincula");

      assert.equal((await portal.get("/portal/sessao")).status, 401);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Os dois segredos
  // ═════════════════════════════════════════════════════════════════════════

  describe("segredos distintos", () => {
    test("token assinado com JWT_SECRET não vale no portal", async () => {
      const { cliente, processo } = await montarCenarioPortal("segredo-a");

      // Token com as claims certas, mas assinado com o segredo ERRADO.
      const forjado = jwt.sign(
        {
          tipo: "portal",
          processoClienteId: String(processo._id),
          clienteId: String(cliente._id),
          processoId: String(processo._id),
          usuarioId: String(cliente.usuarioId ?? processo.usuarioId)
        },
        process.env.JWT_SECRET,
        { expiresIn: "2h" }
      );

      const api = novoClientePortal("forjado");
      api.cookies.set(NOME_COOKIE_PORTAL, forjado);
      const r = await api.get("/portal/sessao");

      assert.equal(r.status, 401, "token assinado com o segredo da advogada não pode valer");
      assert.equal(r.body.codigo, ERRO_PORTAL.SESSAO_INVALIDA);
    });

    test("token de portal renomeado para lex-token não vale na API da advogada", async () => {
      // O cenário que o segredo separado existe para impedir: nome de cookie
      // não é fronteira de segurança, e quem controla o navegador escolhe o
      // nome. Aqui a assinatura simplesmente não confere.
      const { codigoAcesso } = await montarCenarioPortal("segredo-b");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const tokenDoPortal = portal.cookies.get(NOME_COOKIE_PORTAL);

      const disfarcado = new ClienteApi("disfarcado");
      disfarcado.cookies.set("lex-token", tokenDoPortal);

      for (const rota of ["/auth/me", "/clients", "/processes", "/documents"]) {
        const r = await disfarcado.get(rota);
        assert.equal(r.status, 401, `${rota} aceitou um token de portal disfarçado`);
      }
    });

    test("mesmo com os segredos iguais, o `tipo` barra o token de portal", async () => {
      // A segunda tranca, testada isoladamente: um token COM `tipo: "portal"`
      // assinado com o segredo da ADVOGADA é rejeitado por `authMiddleware`.
      // É o que protege o dia em que alguém apontar as duas variáveis para o
      // mesmo valor sem perceber.
      const adv = await registrarUsuario("segredo-c");
      const me = esperado(await adv.get("/auth/me"), 200, "me");

      const comTipoPortal = jwt.sign(
        { id: me.usuario.id ?? me.usuario._id, tipo: "portal" },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
      );

      const api = new ClienteApi("tipo-portal");
      api.cookies.set("lex-token", comTipoPortal);
      const r = await api.get("/auth/me");

      assert.equal(r.status, 401, "authMiddleware precisa rejeitar tipo=portal");
    });

    test("token da advogada não vale nas rotas do portal", async () => {
      const adv = await registrarUsuario("segredo-d");
      const tokenDaAdvogada = adv.cookies.get("lex-token");

      const api = novoClientePortal("adv-no-portal");
      api.cookies.set(NOME_COOKIE_PORTAL, tokenDaAdvogada);

      const r = await api.get("/portal/sessao");
      assert.equal(r.status, 401);
    });
  });
});
