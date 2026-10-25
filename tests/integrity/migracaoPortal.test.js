// ═══════════════════════════════════════════════════════════════════════════
// migrarPortalPessoal.js — a migração da Fase 2.5 (DEC-094)
//
// O banco é montado como estava ANTES da 2.5: clientes com senha e sem código
// pessoal, vínculos sem `liberadoNoPortal`. O script roda DUAS vezes, e a
// segunda não pode mudar um byte — prova por retrato do banco inteiro, como
// `migracaoFase.test.js`, e não por contagem.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar, acharEm } from "../helpers/db.js";
import { registrarUsuario, criarProcesso, esperado } from "../helpers/setup.js";
import { dadosClientePF } from "../helpers/factories.js";
import { MONGO_URI_TESTE } from "../helpers/env.js";
import mongoose from "mongoose";
import Client from "../../src/models/Client.js";
import ProcessoCliente from "../../src/models/ProcessoCliente.js";

const execFileAsync = promisify(execFile);
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const SCRIPT = resolve(RAIZ, "scripts", "migrarPortalPessoal.js");

const rodar = async (args = []) => {
  const { stdout } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, MONGO_URI: MONGO_URI_TESTE, LEX_CONFIRMA_BANCO: "sim" },
    cwd: RAIZ
  });
  return stdout;
};

const retratoDoBanco = async () => {
  const retrato = {};
  for (const colecao of TODAS_AS_COLECOES) {
    const docs = await acharEm(colecao);
    docs.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    retrato[colecao] = JSON.stringify(docs);
  }
  return retrato;
};

// O estado de ANTES da 2.5: sem os dois campos novos.
const voltarParaAntesDaFase = async () => {
  await Client.collection.updateMany({}, { $unset: { codigoAcessoPessoal: "" } });
  await ProcessoCliente.collection.updateMany({}, { $unset: { liberadoNoPortal: "" } });
};

describe("migrarPortalPessoal.js — gera, libera o que existia, e é idempotente", () => {
  let api;
  let comSenha;
  let semSenha;
  let primeira;
  let segunda;
  let retratoDepoisDaPrimeira;
  let retratoDepoisDaSegunda;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("migracaoportal");
    comSenha = esperado(
      await api.post("/clients", { ...dadosClientePF(), senhaPortal: "Provisoria123" }),
      201, "cliente com senha"
    );
    semSenha = esperado(await api.post("/clients", dadosClientePF()), 201, "cliente sem senha");
    const terceiro = esperado(await api.post("/clients", dadosClientePF()), 201, "terceiro");

    // Um vínculo ativo de cada cliente, e um vínculo INATIVO.
    await criarProcesso(api, [{ clienteId: comSenha._id, papel: "autor", principal: true }]);
    const p2 = await criarProcesso(api, [
      { clienteId: semSenha._id, papel: "autor", principal: true },
      { clienteId: terceiro._id, papel: "litisconsorte", principal: false }
    ]);
    esperado(await api.delete(`/processes/${p2._id}/clientes/${terceiro._id}`), 200, "vínculo inativo");

    await voltarParaAntesDaFase();

    primeira = await rodar();
    retratoDepoisDaPrimeira = await retratoDoBanco();
    segunda = await rodar();
    retratoDepoisDaSegunda = await retratoDoBanco();
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("gera código pessoal só para quem tem senha de portal", async () => {
    const [a] = await acharEm("clients", { _id: new mongoose.Types.ObjectId(String(comSenha._id)) });
    const [b] = await acharEm("clients", { _id: new mongoose.Types.ObjectId(String(semSenha._id)) });
    assert.match(a.codigoAcessoPessoal, /^LEX-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(b.codigoAcessoPessoal, undefined, "sem senha, sem código");
  });

  test("o código gerado não colide com nenhum código de vínculo", async () => {
    const pessoais = (await acharEm("clients")).map((c) => c.codigoAcessoPessoal).filter(Boolean);
    const deVinculo = new Set((await acharEm("processo_clientes")).map((v) => v.codigoAcesso));
    for (const c of pessoais) assert.ok(!deVinculo.has(c));
  });

  test("vínculo ATIVO vira liberado; INATIVO vira não liberado", async () => {
    const vinculos = await acharEm("processo_clientes");
    for (const v of vinculos) {
      assert.equal(v.liberadoNoPortal, v.ativo === true, `vínculo ${v.ativo ? "ativo" : "inativo"}`);
    }
    assert.ok(vinculos.some((v) => v.ativo === false), "o cenário tem vínculo inativo");
  });

  test("a primeira execução diz o que fez, só com contagens", () => {
    assert.match(primeira, /código pessoal gerado agora\s+: 1/);
    assert.match(primeira, /vínculos ativos marcados liberados\s+: 2/);
    assert.match(primeira, /vínculos inativos marcados NÃO liber\. : 1/);
    assert.match(primeira, /migração aplicada/);
    // Nenhum código e nenhuma URI na saída.
    assert.doesNotMatch(primeira, /LEX-[0-9A-Z]{4}-[0-9A-Z]{4}/);
    assert.doesNotMatch(primeira, /mongodb(\+srv)?:\/\//);
  });

  test("a SEGUNDA execução não muda nada — o banco inteiro, byte a byte", () => {
    assert.deepEqual(retratoDepoisDaSegunda, retratoDepoisDaPrimeira);
    assert.match(segunda, /código pessoal gerado agora\s+: 0/);
    assert.match(segunda, /vínculos ativos marcados liberados\s+: 0/);
    assert.match(segunda, /nada a fazer/);
    assert.match(segunda, /idempotente/);
  });

  test("`--dry-run` não escreve", async () => {
    await voltarParaAntesDaFase();
    const antes = await retratoDoBanco();
    const saida = await rodar(["--dry-run"]);
    assert.deepEqual(await retratoDoBanco(), antes);
    assert.match(saida, /DRY RUN/);
    assert.match(saida, /código pessoal gerado agora\s+: 1/);
  });
});
