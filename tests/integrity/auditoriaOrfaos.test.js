// ═══════════════════════════════════════════════════════════════════════════
// O SCRIPT DE AUDITORIA DE ÓRFÃOS — `scripts/auditarOrfaos.js` (DEC-053)
//
// Duas garantias, e a segunda é a que importa mais:
//
//   1. ele ACHA um órfão plantado, nomeando pai e filho;
//   2. ele NÃO ALTERA NADA — provado comparando o estado do banco antes e
//      depois, documento por documento, e não só a contagem.
//
// ── Por que a comparação é de CONTEÚDO, e não de contagem ─────────────────
// Uma auditoria que "consertasse" órfãos silenciosamente manteria a contagem
// idêntica — ela viraria `ativo: false`, não sumiria. Contar documentos
// provaria que nada foi APAGADO e deixaria passar exatamente o defeito que
// esta fase decidiu não ter: a correção automática que escolhe, sem saber,
// entre desativar o filho e reativar o pai.
//
// ── Por que o órfão é plantado por ESCRITA DIRETA ─────────────────────────
// É o único jeito. Depois da DEC-053 a API não produz mais este estado — é o
// ponto inteiro da fase. O órfão que a advogada tem hoje no banco nasceu antes
// da guarda existir, e é esse estado histórico que o script precisa alcançar.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar, acharEm } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";
import { MONGO_URI_TESTE } from "../helpers/env.js";
import Client from "../../src/models/Client.js";

const execFileAsync = promisify(execFile);
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const SCRIPT = resolve(RAIZ, "scripts", "auditarOrfaos.js");

// Retrato do banco: todas as coleções, todos os documentos, ordenados por
// `_id` para a comparação não depender da ordem que o driver devolveu.
const retratoDoBanco = async () => {
  const retrato = {};
  for (const colecao of TODAS_AS_COLECOES) {
    const docs = await acharEm(colecao);
    docs.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    retrato[colecao] = JSON.stringify(docs);
  }
  return retrato;
};

describe("auditarOrfaos.js — acha e não conserta", () => {
  let api;
  let saida;
  let retratoAntes;
  let retratoDepois;
  const NOME_CLIENTE = "Órfã Plantada Da Auditoria";
  const TITULO_PROCESSO = "Processo Órfão Da Auditoria";

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("auditoria");

    const cliente = await criarClientePF(api, { nomeCompleto: NOME_CLIENTE });
    await criarProcesso(
      api,
      [{ clienteId: cliente._id, papel: "autor", principal: true }],
      { titulo: TITULO_PROCESSO }
    );

    // ── O órfão ────────────────────────────────────────────────────────────
    // Cliente desativado POR BAIXO da API, com o processo dele de pé. É o
    // estado que a DEC-053 passou a impedir e que a base pode já conter.
    await Client.updateOne({ _id: cliente._id }, { $set: { ativo: false } });

    retratoAntes = await retratoDoBanco();

    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT],
      { env: { ...process.env, MONGO_URI: MONGO_URI_TESTE }, cwd: RAIZ }
    );
    saida = stdout;

    retratoDepois = await retratoDoBanco();
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("declara, na saída, que só lê", () => {
    assert.match(saida, /SOMENTE LÊ/);
  });

  test("acha o órfão e NOMEIA pai e filho", () => {
    // ── DOIS órfãos, e não um ──────────────────────────────────────────────
    // Desativar o cliente por baixo da API deixa órfão o PROCESSO (pelo
    // `clientePrincipalId`) e também o VÍNCULO processo-cliente, que é um
    // registro ativo apontando para o mesmo cliente inativo.
    //
    // Contar "1" aqui seria escrever o teste contra a intuição do caso em vez
    // de contra a árvore levantada na Parte 1 — e é exatamente a segunda
    // relação, a que não vem à cabeça, que a auditoria existe para achar.
    assert.match(saida, /Processo → Cliente \(principal\)/);
    assert.match(saida, /Vínculo processo-cliente → Cliente/);
    assert.ok(saida.includes(TITULO_PROCESSO), `precisa nomear o filho:\n${saida}`);
    assert.ok(saida.includes(NOME_CLIENTE), `precisa nomear o pai:\n${saida}`);
    assert.match(saida, /RESULTADO: 2 órfão\(s\) encontrado\(s\)/);
  });

  test("diz que NÃO corrigiu, e oferece as duas saídas humanas", () => {
    assert.match(saida, /NÃO corrigiu nada/);
    assert.match(saida, /DESATIVAR o filho/);
    assert.match(saida, /REATIVAR o pai/);
  });

  test("NÃO ALTERA NADA — o banco é idêntico, documento por documento", () => {
    // `deepEqual` sobre os retratos: qualquer campo de qualquer documento que
    // tivesse mudado aparece aqui, inclusive um `ativo` invertido "para
    // ajudar" e um `updatedAt` tocado por uma escrita que se dizia leitura.
    assert.deepEqual(retratoDepois, retratoAntes);
  });

  test("o script não contém escrita nenhuma — a garantia é estática também", async () => {
    // A comparação de estado prova o comportamento de HOJE, com o dado de
    // hoje. Esta varredura impede que alguém acrescente uma escrita amanhã num
    // ramo que o cenário do teste não exercita.
    const { readFile } = await import("node:fs/promises");
    const fonte = await readFile(SCRIPT, "utf8");
    const semComentarios = fonte
      .split("\n")
      .filter((linha) => !linha.trim().startsWith("//"))
      .join("\n");

    for (const proibido of [
      "updateOne", "updateMany", "deleteOne", "deleteMany", "insertOne",
      "insertMany", "findOneAndUpdate", "findOneAndDelete", "bulkWrite",
      "createIndex", "dropIndex", ".save(", ".create("
    ]) {
      assert.ok(
        !semComentarios.includes(proibido),
        `\`${proibido}\` apareceu em auditarOrfaos.js — o script deixou de ser somente-leitura. ` +
        `Se a escrita é intencional, ele precisa GANHAR a guarda de banco da F-2b.`
      );
    }
  });
});
