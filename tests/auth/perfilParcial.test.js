// ═══════════════════════════════════════════════════════════════════════════
// FASE 3.6 — `PATCH /auth/me` com payload PARCIAL
//
// O perfil passou a enviar SÓ os campos alterados (`utils/perfilPayload.js` do
// front, DEC-128). Isso só é seguro se a rota tratar o que NÃO veio como "não
// mexer" — inclusive dentro dos subdocumentos `oab`, `advocacia` e `endereco`,
// onde um `$set` do objeto inteiro apagaria os irmãos do campo enviado.
//
// Conferido antes de mudar a tela, e travado aqui: o front depende disto.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, esperado } from "../helpers/setup.js";

const perfil = async (api) => esperado(await api.get("/auth/me"), 200, "GET /auth/me").usuario;

describe("PATCH /auth/me — o que não veio fica como estava", () => {
  let api;
  let original;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("parcial");
    original = await perfil(api);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("corpo vazio responde 200 e não muda nada", async () => {
    esperado(await api.patch("/auth/me", {}), 200, "PATCH vazio");
    const agora = await perfil(api);
    assert.deepEqual(
      { ...agora, updatedAt: null },
      { ...original, updatedAt: null }
    );
  });

  test("só o telefone: o resto da conta e do escritório continua", async () => {
    esperado(await api.patch("/auth/me", { telefone: "42988887777" }), 200, "PATCH telefone");
    const agora = await perfil(api);
    assert.equal(agora.telefone, "42988887777");
    assert.equal(agora.nomeCompleto, original.nomeCompleto);
    assert.equal(agora.cpf, original.cpf);
    assert.deepEqual(agora.oab, original.oab);
    assert.deepEqual(agora.advocacia, original.advocacia);
    assert.deepEqual(agora.endereco, original.endereco);
  });

  test("um campo de `advocacia` não apaga os irmãos", async () => {
    esperado(
      await api.patch("/auth/me", { advocacia: { site: "https://novo.test" } }),
      200,
      "PATCH advocacia.site"
    );
    const agora = await perfil(api);
    assert.equal(agora.advocacia.site, "https://novo.test");
    assert.equal(agora.advocacia.nome, original.advocacia.nome);
    assert.equal(agora.advocacia.chavePix, original.advocacia.chavePix);
    assert.equal(agora.advocacia.instagram, original.advocacia.instagram);
  });

  test("`null` apaga só o campo enviado", async () => {
    esperado(
      await api.patch("/auth/me", { advocacia: { instagram: null } }),
      200,
      "PATCH advocacia.instagram null"
    );
    const agora = await perfil(api);
    assert.equal(agora.advocacia.instagram, null);
    assert.equal(agora.advocacia.site, "https://novo.test");
    assert.equal(agora.advocacia.nome, original.advocacia.nome);
  });

  test("um campo de `endereco` não apaga os irmãos", async () => {
    esperado(
      await api.patch("/auth/me", { endereco: { complemento: "Sala 3" } }),
      200,
      "PATCH endereco.complemento"
    );
    const agora = await perfil(api);
    assert.equal(agora.endereco.complemento, "Sala 3");
    for (const campo of ["logradouro", "numero", "bairro", "cidade", "estado", "cep"]) {
      assert.equal(agora.endereco[campo], original.endereco[campo], `endereco.${campo}`);
    }
  });

  test("`null` no telefone e em campos do endereço apaga só eles", async () => {
    esperado(
      await api.patch("/auth/me", {
        telefone: null,
        endereco: { complemento: null, estado: null }
      }),
      200,
      "PATCH telefone e endereco com null"
    );
    const agora = await perfil(api);
    assert.equal(agora.telefone ?? null, null);
    assert.equal(agora.endereco.complemento ?? null, null);
    assert.equal(agora.endereco.estado ?? null, null);
    assert.equal(agora.endereco.cidade, original.endereco.cidade);
    assert.equal(agora.endereco.cep, original.endereco.cep);
  });

  test("só a UF da OAB: o número continua", async () => {
    esperado(await api.patch("/auth/me", { oab: { estado: "SC" } }), 200, "PATCH oab.estado");
    const agora = await perfil(api);
    assert.equal(agora.oab.estado, "SC");
    assert.equal(agora.oab.numero, original.oab.numero);
  });
});
