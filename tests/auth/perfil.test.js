// ═══════════════════════════════════════════════════════════════════════════
// CONTRATO DE `POST /auth/alterar-senha` E `PATCH /auth/me` (achado #13)
//
// As duas rotas mais antigas do projeto e as menos cobertas: a troca de senha
// nunca teve teste, e `PATCH /auth/me` só era exercitado de raspão pelos testes
// de isolamento.
//
// São também as rotas em que uma falha é mais cara e menos visível: o perfil da
// advogada alimenta DEZ das 48 variáveis do catálogo (`nomeAdvogada`,
// `numOAB`, `enderecoEscritorio`, `chavePix`…) e o timbrado de todo documento e
// recibo. Um `PATCH` que aceite o que não deve, ou que apague o que não pediram,
// aparece primeiro numa procuração já assinada.
//
// O teste do EFEITO da troca de senha (a nova entra, a antiga não) é o que
// distingue "a rota respondeu 200" de "a senha mudou". As duas coisas já foram
// diferentes neste projeto.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, logar, esperado } from "../helpers/setup.js";
import { SENHA_PADRAO } from "../helpers/factories.js";
import { ClienteApi } from "../helpers/client.js";
import { LOGO_LIMITE_BYTES } from "../../src/validations/authValidation.js";

// Data URI de PNG válido, do tamanho pedido. O prefixo é real; o recheio é
// base64 legítimo (múltiplo de 4) para passar pelo regex antes de chegar ao
// teste de tamanho — sem isso a recusa viria por formato e o teste de limite
// provaria outra coisa.
const logoDeTamanho = (bytesAlvo) => {
  const prefixo = "data:image/png;base64,";
  const recheio = Math.max(4, Math.ceil((bytesAlvo - prefixo.length) / 4) * 4);
  return prefixo + "A".repeat(recheio);
};

describe("contrato de /auth — perfil e troca de senha", () => {
  let api;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("perfil");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // PATCH /auth/me — o que entra
  // ═════════════════════════════════════════════════════════════════════════
  test("atualiza nome, telefone, OAB, advocacia e endereço", async () => {
    const r = await api.patch("/auth/me", {
      nomeCompleto: "Laís Advogada Atualizada",
      telefone: "42999990000",
      oab: { numero: "654321", estado: "SC" },
      advocacia: { nome: "Nova Advocacia", chavePix: "pix@lex.dev" },
      endereco: { cep: "84010330", estado: "PR", cidade: "Ponta Grossa" }
    });

    const corpo = esperado(r, 200, "PATCH /auth/me");
    const usuario = corpo.usuario ?? corpo;

    assert.equal(usuario.nomeCompleto, "Laís Advogada Atualizada");
    assert.equal(usuario.oab.numero, "654321");
    assert.equal(usuario.oab.estado, "SC");
    assert.equal(usuario.advocacia.nome, "Nova Advocacia");
    assert.equal(usuario.advocacia.chavePix, "pix@lex.dev");
    assert.equal(usuario.endereco.cidade, "Ponta Grossa");
  });

  test("a alteração persiste — GET /auth/me devolve o que foi gravado", async () => {
    // Sem esta leitura, o teste acima provaria só que a rota ECOA o payload.
    const corpo = esperado(await api.get("/auth/me"), 200, "GET /auth/me");
    assert.equal(corpo.usuario.nomeCompleto, "Laís Advogada Atualizada");
    assert.equal(corpo.usuario.advocacia.chavePix, "pix@lex.dev");
  });

  test("o hash da senha nunca sai na resposta", async () => {
    const bruto = JSON.stringify(esperado(await api.get("/auth/me"), 200, "GET /auth/me"));
    assert.ok(!/\$2[aby]\$/.test(bruto), "prefixo de bcrypt no corpo de /auth/me");
    assert.ok(!/senhaHash/.test(bruto), "`senhaHash` no corpo de /auth/me");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // PATCH /auth/me — o que NÃO entra
  // ═════════════════════════════════════════════════════════════════════════
  test("os campos protegidos são recusados um a um", async () => {
    const protegidos = [
      ["email", "outro@lex.dev"],
      ["senhaHash", "$2b$10$qualquercoisa"],
      ["senha", "NovaSenha123"],
      ["ativo", false]
    ];

    for (const [campo, valor] of protegidos) {
      const r = await api.patch("/auth/me", { [campo]: valor });
      assert.equal(
        r.status, 400,
        `"${campo}" deveria ser recusado por esta rota — veio ${r.status}`
      );
      assert.match(r.body.message, new RegExp(campo), "a mensagem nomeia o campo recusado");
    }
  });

  test("CPF inválido e UF de OAB inválida são recusados", async () => {
    const r1 = await api.patch("/auth/me", { cpf: "11111111111" });
    assert.equal(r1.status, 400, "CPF de dígito inválido");

    const r2 = await api.patch("/auth/me", { oab: { estado: "XX" } });
    assert.equal(r2.status, 400, "UF fora da lista das 27");

    const r3 = await api.patch("/auth/me", { oab: { numero: "1234567" } });
    assert.equal(r3.status, 400, "OAB com mais de 6 dígitos");

    const r4 = await api.patch("/auth/me", { endereco: { cep: "123" } });
    assert.equal(r4.status, 400, "CEP com menos de 8 dígitos");
  });

  test("nome completo vazio é recusado", async () => {
    const r = await api.patch("/auth/me", { nomeCompleto: "   " });
    assert.equal(r.status, 400);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // O logo — o limite de 200 KB nas duas bordas
  //
  // O teto existe porque o `User` é carregado em TODA requisição autenticada
  // (`authMiddleware`): um logo grande entra no custo de cada chamada da API,
  // não só na do perfil.
  // ═════════════════════════════════════════════════════════════════════════
  test("logo logo abaixo do limite é aceito", async () => {
    const r = await api.patch("/auth/me", {
      advocacia: { logoBase64: logoDeTamanho(LOGO_LIMITE_BYTES - 400) }
    });
    esperado(r, 200, "logo dentro do limite");
  });

  test("logo acima do limite é recusado, e a mensagem diz o tamanho", async () => {
    const r = await api.patch("/auth/me", {
      advocacia: { logoBase64: logoDeTamanho(LOGO_LIMITE_BYTES + 4000) }
    });
    assert.equal(r.status, 400, "acima de 200 KB precisa ser recusado");
    assert.match(r.body.message, /KB/, "a mensagem precisa citar o tamanho e o limite");
  });

  test("formato de logo não aceito é recusado", async () => {
    const r = await api.patch("/auth/me", {
      advocacia: { logoBase64: "data:image/gif;base64,AAAA" }
    });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /PNG|JPEG/, "a mensagem diz quais formatos servem");
  });

  test("logo em string que não é data URI é recusado", async () => {
    const r = await api.patch("/auth/me", { advocacia: { logoBase64: "iVBORw0KGgo=" } });
    assert.equal(r.status, 400);
  });

  test("`null` e string vazia removem o logo — é o botão Remover do perfil", async () => {
    esperado(
      await api.patch("/auth/me", { advocacia: { logoBase64: null } }),
      200, "remoção do logo com null"
    );
    esperado(
      await api.patch("/auth/me", { advocacia: { logoBase64: "" } }),
      200, "remoção do logo com string vazia"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // POST /auth/alterar-senha — validação e EFEITO
  // ═════════════════════════════════════════════════════════════════════════
  // A asserção era `[400, 401]` — frouxa de propósito, quando o número ainda
  // não tinha regra. A DEC-050 deu regra: sessão válida com dado errado é 422,
  // e 401 aqui é o defeito V-2, que expulsava a advogada do sistema.
  // O inventário completo dos 401 está em `tests/auth/semantica401.test.js`.
  test("senha atual errada é recusada com 422, sem derrubar a sessão", async () => {
    const r = await api.post("/auth/alterar-senha", {
      senhaAtual: "SenhaQueNaoEhAMinha1",
      novaSenha: "OutraSenha123"
    });
    assert.equal(r.status, 422, "401 aqui deslogaria quem só errou a digitação");
    assert.equal(r.body.campo, "senhaAtual");

    esperado(await api.get("/auth/me"), 200, "a sessão sobrevive à senha errada");
  });

  test("nova senha fraca é recusada, com a regra na mensagem", async () => {
    const curta = await api.post("/auth/alterar-senha", {
      senhaAtual: SENHA_PADRAO,
      novaSenha: "Ab1"
    });
    assert.equal(curta.status, 400);
    assert.match(curta.body.message, /8/, "a mensagem cita o mínimo de caracteres");

    const semNumero = await api.post("/auth/alterar-senha", {
      senhaAtual: SENHA_PADRAO,
      novaSenha: "SomenteLetras"
    });
    assert.equal(semNumero.status, 400);
    assert.match(semNumero.body.message, /letra|número/, "a mensagem cita letra e número");
  });

  test("nova senha igual à atual é recusada", async () => {
    const r = await api.post("/auth/alterar-senha", {
      senhaAtual: SENHA_PADRAO,
      novaSenha: SENHA_PADRAO
    });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /diferente/);
  });

  test("a troca funciona: a nova senha loga e a antiga não", async () => {
    // Este é o teste que separa "respondeu 200" de "a senha mudou".
    const usuario = await registrarUsuario("troca-de-senha");
    const email = usuario.credenciais.email;
    const NOVA = "SenhaNovaDaLais2026";

    esperado(
      await usuario.post("/auth/alterar-senha", { senhaAtual: SENHA_PADRAO, novaSenha: NOVA }),
      200, "troca de senha"
    );

    const comNova = await logar(email, NOVA, "com a nova senha");
    assert.ok(comNova.autenticado, "a senha NOVA precisa logar");

    const sessaoAntiga = new ClienteApi("com a senha antiga");
    const r = await sessaoAntiga.post("/auth/login", { email, senha: SENHA_PADRAO });
    assert.equal(r.status, 401, "a senha ANTIGA não pode mais logar");
  });

  test("alterar-senha exige sessão", async () => {
    const anonimo = new ClienteApi("anônimo");
    const r = await anonimo.post("/auth/alterar-senha", {
      senhaAtual: SENHA_PADRAO,
      novaSenha: "QualquerCoisa123"
    });
    assert.equal(r.status, 401, "a rota é autenticada");
  });

  test("PATCH /auth/me exige sessão", async () => {
    const anonimo = new ClienteApi("anônimo");
    const r = await anonimo.patch("/auth/me", { nomeCompleto: "Invasor" });
    assert.equal(r.status, 401);
  });
});
