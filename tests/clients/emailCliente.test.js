// ═══════════════════════════════════════════════════════════════════════════
// A-2 (DEC-064) — O E-MAIL DO CLIENTE TEM FORMATO, E SEGUE OPCIONAL
//
// Decisão do Daniel: continua opcional; quando preenchido, é validado — na
// criação e, na edição, SÓ se o valor mudou em relação ao gravado.
//
// ── Por que "só se mudou" ─────────────────────────────────────────────────
// A tela de edição reenvia o e-mail em todo salvamento. Validar sempre travaria
// a edição do telefone de um cliente antigo cujo e-mail já estava torto no
// banco — por causa de um campo que ninguém tocou. (A-1, §2.6.)
//
// ── A regra é a da advogada ───────────────────────────────────────────────
// `utils/email.js` (DEC-063). Não existe segunda expressão: o último teste
// deste arquivo trava isso.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar, TODAS_AS_COLECOES } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, esperado } from "../helpers/setup.js";
import { dadosClientePF, dadosClientePJ, emailUnico } from "../helpers/factories.js";
import { emailValido } from "../../src/utils/email.js";

// E-mail torto ÚNICO por chamada: o índice `{usuarioId, email}` é único, e dois
// clientes do mesmo usuário gravados com o mesmo texto colidiriam.
let sequenciaDeTortos = 0;
const emailTortoUnico = () => `gravado-antes-da-validacao-${Date.now()}-${(sequenciaDeTortos += 1)}`;

const MALFORMADOS = ["daniel", "daniel@", "@lex.dev", "daniel@lex", "daniel @lex.dev", "daniel@@lex.dev", "daniel@lex..dev"];

describe("A-2 — validação de formato do e-mail do cliente", () => {
  let adv;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    adv = await registrarUsuario("email-cliente");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  describe("cadastro", () => {
    test("e-mail mal formado é recusado com 400 e `campo: email`, em cada caso", async () => {
      for (const email of MALFORMADOS) {
        const r = await adv.post("/clients", dadosClientePF({ email }));
        assert.equal(r.status, 400, `"${email}" foi aceito: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.campo, "email", `"${email}": a tela precisa saber qual input destacar`);
        assert.equal(r.body.message, "E-mail inválido");
      }
    });

    test("vale para PJ também", async () => {
      const r = await adv.post("/clients", dadosClientePJ({ email: "empresa-sem-arroba" }));
      assert.equal(r.status, 400);
      assert.equal(r.body.campo, "email");
    });

    test("e-mail válido é aceito, inclusive com `+` e maiúsculas (normalizado)", async () => {
      const email = emailUnico("cliente").replace("@", "+tag@").toUpperCase();
      const r = esperado(await adv.post("/clients", dadosClientePF({ email })), 201, "e-mail válido");
      assert.equal(r.email, email.toLowerCase());
    });

    test("CONTINUA OPCIONAL: sem e-mail, vazio ou só espaços, o cliente é criado", async () => {
      const semChave = dadosClientePF();
      delete semChave.email;
      esperado(await adv.post("/clients", semChave), 201, "sem a chave");

      for (const email of ["", "   ", null]) {
        esperado(await adv.post("/clients", dadosClientePF({ email })), 201, `email=${JSON.stringify(email)}`);
      }
    });
  });

  describe("edição", () => {
    test("trocar por um e-mail mal formado é recusado (400, `campo: email`) e NADA muda", async () => {
      const cliente = await criarClientePF(adv);

      for (const email of MALFORMADOS) {
        const r = await adv.patch(`/clients/${cliente._id}`, { email });
        assert.equal(r.status, 400, `"${email}" foi aceito na edição`);
        assert.equal(r.body.campo, "email");
      }

      const depois = esperado(await adv.get(`/clients/${cliente._id}`), 200, "leitura");
      assert.equal(depois.email, cliente.email, "o e-mail gravado mudou apesar do 400");
    });

    test("trocar por um e-mail válido funciona", async () => {
      const cliente = await criarClientePF(adv);
      const novo = emailUnico("corrigido");

      const r = esperado(await adv.patch(`/clients/${cliente._id}`, { email: novo }), 200, "trocar e-mail");
      assert.equal(r.email, novo);
    });

    test("apagar o e-mail (null) continua permitido", async () => {
      const cliente = await criarClientePF(adv);
      const r = esperado(await adv.patch(`/clients/${cliente._id}`, { email: null }), 200, "apagar e-mail");
      assert.ok(!r.email);
    });

    test("CLIENTE ANTIGO com e-mail torto NÃO trava a edição de outro campo, mesmo reenviando o e-mail", async () => {
      const cliente = await criarClientePF(adv);
      const torto = emailTortoUnico();

      // Grava o defeito direto na coleção, como estava antes da A-2.
      await mongoose.connection.db.collection("clients").updateOne(
        { _id: new mongoose.Types.ObjectId(cliente._id) },
        { $set: { email: torto } }
      );

      // É exatamente o que a tela faz: reenvia o e-mail que carregou.
      const r = await adv.patch(`/clients/${cliente._id}`, {
        email: torto,
        telefone: "(42) 98888-0000"
      });
      esperado(r, 200, "editar o telefone de um cliente com e-mail antigo torto");
      assert.equal(r.body.telefone, "(42) 98888-0000");
    });

    test("...mas quem for CORRIGIR o e-mail antigo é obrigado a digitar um válido", async () => {
      const cliente = await criarClientePF(adv);
      await mongoose.connection.db.collection("clients").updateOne(
        { _id: new mongoose.Types.ObjectId(cliente._id) },
        { $set: { email: emailTortoUnico() } }
      );

      const ruim = await adv.patch(`/clients/${cliente._id}`, { email: "continua torto" });
      assert.equal(ruim.status, 400);

      const boa = await adv.patch(`/clients/${cliente._id}`, { email: emailUnico("agora-certo") });
      assert.equal(boa.status, 200);
    });

    test("a troca de tipo (F-6.2), que reenvia o e-mail, não é afetada", async () => {
      const cliente = await criarClientePF(adv);
      const r = await adv.patch(`/clients/${cliente._id}`, {
        tipoPessoa: "juridica", razaoSocial: "Empresa E-mail Ltda", nomeFantasia: "Empresa E-mail",
        cnpj: dadosClientePJ().cnpj, email: cliente.email
      });
      esperado(r, 200, "troca de tipo com o mesmo e-mail");
    });
  });

  describe("uma regra só", () => {
    test("clientValidation usa `utils/email.js`, sem expressão própria", () => {
      const fonte = readFileSync(
        fileURLToPath(new URL("../../src/validations/clientValidation.js", import.meta.url)), "utf8"
      );

      assert.match(fonte, /from "\.\.\/utils\/email\.js"/);
      assert.ok(!/@\[\^\\s@\]|\[\^\\s@\]\+@/.test(fonte), "apareceu uma segunda expressão de e-mail em clientValidation");
    });

    test("o que a função única recusa é o que o cadastro do cliente recusa", () => {
      for (const email of MALFORMADOS) assert.equal(emailValido(email), false, email);
    });
  });
});
