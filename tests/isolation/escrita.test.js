// ═══════════════════════════════════════════════════════════════════════════
// RESPOSTAS DE ESCRITA NÃO VAZAM SEGREDO
//
// A varredura da Fase 2E.2 e a da 3.1 cobriram respostas de LEITURA — `GET` de
// listagem e de detalhe. Falta o outro lado, e ele é o que já falhou de
// verdade.
//
// ── Por que a resposta de escrita é o caso perigoso ────────────────────────
// `select: false` no schema protege a CONSULTA: o Mongoose não pede o campo ao
// banco, então o documento lido não o traz. Não protege o documento que acabou
// de ser ESCRITO. Quem faz `new User(...)`, atribui o hash e chama `save()`
// tem o campo em memória — nenhuma consulta aconteceu, e não há `select` que
// atue sobre um objeto que nunca voltou do banco.
//
// Foi assim que `senhaPortalHash` saiu no 201 de cadastro de cliente na
// primeira execução da Fase 3.1, com a listagem limpa. O `select: false`
// estava lá, correto, e inútil para aquele caminho.
//
// A correção foi centralizada em `config/mongooseDefaults.js`, no `toJSON`
// global, que atua sobre a serialização e por isso pega os DOIS caminhos. Este
// arquivo prova que ela alcança o 201 do cadastro da advogada — o caminho que
// a 2D.1 criou quando `POST /auth/register` passou a devolver corpo e cookie,
// e que nenhuma varredura tinha visitado.
//
// A prova é por STRING CRUA do corpo, não por `assert.equal(body.senhaHash,
// undefined)`: o hash pode vazar aninhado, dentro de `usuario`, de um array,
// ou sob outro nome. Procurar o prefixo do bcrypt encontra o segredo onde quer
// que ele esteja.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, esperado } from "../helpers/setup.js";
import { dadosUsuario, dadosClientePF } from "../helpers/factories.js";
import { ClienteApi } from "../helpers/client.js";

// O prefixo que todo hash bcrypt carrega. `$2b$` é o do `bcryptjs` atual,
// `$2a$` o da geração anterior — os dois entram, porque o que se procura é
// "saiu hash", não "saiu hash desta versão".
const MARCAS_DE_HASH = ["$2b$", "$2a$", "$2y$"];
const NOMES_DE_SEGREDO = ["senhaHash", "senhaPortalHash"];

const varrer = (rotulo, corpo, senhaEmClaro) => {
  const bruto = JSON.stringify(corpo ?? {});

  for (const marca of MARCAS_DE_HASH) {
    assert.ok(
      !bruto.includes(marca),
      `VAZAMENTO — ${rotulo} devolveu um hash bcrypt (prefixo "${marca}"):\n${bruto}`
    );
  }

  for (const nome of NOMES_DE_SEGREDO) {
    assert.ok(
      !bruto.includes(nome),
      `VAZAMENTO — ${rotulo} devolveu a chave "${nome}":\n${bruto}`
    );
  }

  // A senha em claro nunca é ecoada de volta. Não é a mesma falha do hash, mas
  // é a mesma família: o que entrou no corpo do pedido não volta na resposta.
  if (senhaEmClaro) {
    assert.ok(
      !bruto.includes(senhaEmClaro),
      `VAZAMENTO — ${rotulo} ecoou a senha em claro:\n${bruto}`
    );
  }
};

describe("respostas de escrita não vazam segredo", () => {
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
  // O caso da Parte 1.1: o 201 do cadastro da advogada
  // ═════════════════════════════════════════════════════════════════════════

  test("201 de POST /auth/register não traz senhaHash", async () => {
    const api = new ClienteApi("cadastro");
    const payload = dadosUsuario();

    const resposta = await api.post("/auth/register", payload);
    const corpo = esperado(resposta, 201, "cadastro da advogada");

    varrer("POST /auth/register (201)", corpo, payload.senha);

    // O documento é criado por `save()` e devolvido na mesma requisição: é
    // exatamente a situação em que `select: false` não teria efeito nenhum.
    //
    // MEDIDO, não suposto: neutralizar a lista de segredos do `toJSON` global
    // NÃO faz este teste falhar — só os de `/clients` abaixo. O 201 do
    // cadastro passa por `sanitizeUser` (`authService.js:57`), que monta a
    // resposta campo a campo, e por isso nunca dependeu do `select: false`
    // nem do `toJSON`. São duas camadas independentes, e esta asserção trava
    // a de cima: trocar `sanitizeUser` por um spread do documento faz o hash
    // voltar a caber na resposta, e é aqui que isso aparece.
    assert.ok(corpo.usuario, "o 201 do cadastro precisa devolver `{ usuario }`");
    assert.equal(
      corpo.usuario.senhaHash,
      undefined,
      "o objeto `usuario` do 201 não pode carregar `senhaHash`"
    );

    // E o cadastro já vem autenticado desde a Fase 2D.1 — o cookie sai na
    // mesma resposta. Confirmar aqui evita que uma "correção" do vazamento
    // passe a devolver corpo vazio e quebre o fluxo de entrada.
    assert.ok(api.autenticado, "o cadastro precisa emitir o cookie `lex-token`");
  });

  test("200 de POST /auth/login e GET /auth/me também não trazem", async () => {
    const api = new ClienteApi("login");
    const payload = dadosUsuario();
    esperado(await api.post("/auth/register", payload), 201, "cadastro");

    const sessao = new ClienteApi("sessão");
    const login = esperado(
      await sessao.post("/auth/login", { email: payload.email, senha: payload.senha }),
      200, "login"
    );
    varrer("POST /auth/login (200)", login, payload.senha);

    const me = esperado(await sessao.get("/auth/me"), 200, "/auth/me");
    varrer("GET /auth/me (200)", me, payload.senha);
  });

  test("200 de PATCH /auth/me não traz — o update também escreve", async () => {
    const adv = await registrarUsuario("advogada do patch");

    const corpo = esperado(
      await adv.patch("/auth/me", { telefone: "(42) 99999-1234" }),
      200, "atualização de perfil"
    );
    varrer("PATCH /auth/me (200)", corpo, adv.credenciais.senha);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // A mesma classe de defeito, no cliente — que é onde ela apareceu
  // ═════════════════════════════════════════════════════════════════════════

  test("201 de POST /clients com senha de portal não traz senhaPortalHash", async () => {
    const adv = await registrarUsuario("advogada do cliente");

    // A senha de portal entra pela criação do cliente. Este é literalmente o
    // caminho que vazou na Fase 3.1: `new Client(...)` + hash + `save()`.
    const dados = dadosClientePF({ senhaPortal: "PortalTeste2026" });
    const corpo = esperado(await adv.post("/clients", dados), 201, "cliente com senha de portal");

    varrer("POST /clients (201)", corpo, "PortalTeste2026");

    // O estado do acesso PODE sair — é o que a tela da advogada exibe. O que
    // não pode sair é o hash. A distinção é o ponto: esconder o estado junto
    // com o segredo deixaria a interface sem ter o que mostrar.
    assert.equal(
      corpo.senhaPortalProvisoria,
      true,
      "senha gravada pela advogada nasce provisória — é o que dá o fluxo de troca"
    );
  });

  test("200 de PATCH /clients/:id com senha nova não traz senhaPortalHash", async () => {
    const adv = await registrarUsuario("advogada da redefinição");
    const cliente = esperado(
      await adv.post("/clients", dadosClientePF()),
      201, "cliente sem portal"
    );

    const corpo = esperado(
      await adv.patch(`/clients/${cliente._id}`, { senhaPortal: "OutraSenha2026" }),
      200, "redefinição de senha de portal"
    );

    varrer("PATCH /clients/:id (200)", corpo, "OutraSenha2026");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // O ponto único de correção — travado nominalmente
  // ═════════════════════════════════════════════════════════════════════════

  test("o toJSON global cobre os dois segredos, num lugar só", async () => {
    // Se alguém trocar o `toJSON` global por `select: false` em cada schema,
    // os testes acima voltam a falhar — mas só depois de alguém escrever um
    // model novo e esquecer. Este teste falha na hora.
    const { default: mongoose } = await import("mongoose");
    const opcoes = mongoose.get("toJSON");

    assert.ok(
      typeof opcoes?.transform === "function",
      "o `toJSON` global sumiu — `config/mongooseDefaults.js` é o ponto único " +
      "que impede o hash de sair no documento recém-escrito"
    );

    const alvo = {
      _id: "x",
      __v: 3,
      senhaHash: "$2b$10$exemplo",
      senhaPortalHash: "$2b$10$exemplo",
      nomeCompleto: "fica"
    };
    const saida = opcoes.transform({}, { ...alvo });

    assert.equal(saida.senhaHash, undefined, "o transform precisa apagar senhaHash");
    assert.equal(saida.senhaPortalHash, undefined, "o transform precisa apagar senhaPortalHash");
    assert.equal(saida.__v, undefined, "o transform precisa apagar __v");
    assert.equal(saida.nomeCompleto, "fica", "o transform não pode apagar campo comum");
  });
});
