// ═══════════════════════════════════════════════════════════════════════════
// A MIGRAÇÃO DA DEC-054 — `scripts/migrarFaseProcesso.js` (F-2d)
//
// Três garantias:
//
//   1. ela PREENCHE os campos novos nos processos que não os tinham, e grava
//      a primeira entrada de `historicoFase` junto;
//   2. ela é IDEMPOTENTE — a segunda execução não altera documento nenhum,
//      provado comparando o banco documento por documento;
//   3. ela NÃO INVENTA mapeamento: nenhum valor de `status` vira fase, e o
//      relatório diz isso em voz alta, com a contagem de cada um.
//
// ── Por que o estado "antes da migração" é plantado por escrita direta ────
// É o único jeito. Depois desta fase a API não produz mais processo sem
// `fase` — o `default` do model a preenche na criação. O estado que a migração
// alcança é o HISTÓRICO, gravado antes de o campo existir, e ele se fabrica
// tirando o campo com `$unset`.
//
// ── A guarda de banco ────────────────────────────────────────────────────
// Este script ESCREVE, e por isso tem a guarda da F-2b. A suíte a dispensa por
// `LEX_CONFIRMA_BANCO=sim` — declarado de propósito, que é como a guarda foi
// desenhada para ser pulada em automação. Sem a variável, ela abortaria por
// não haver terminal interativo, e isso também é de propósito.
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
import Process from "../../src/models/Process.js";

const execFileAsync = promisify(execFile);
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const SCRIPT = resolve(RAIZ, "scripts", "migrarFaseProcesso.js");

const rodar = async () => {
  const { stdout } = await execFileAsync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      MONGO_URI: MONGO_URI_TESTE,
      // Como a guarda da F-2b foi desenhada para ser pulada em automação.
      LEX_CONFIRMA_BANCO: "sim"
    },
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

// Os campos da DEC-054, tirados dos processos — o estado "antes do campo
// existir". `$unset` e não `$set: null`: a migração filtra por
// `{ fase: { $exists: false } }`, que é a forma exata do dado antigo.
const desfazerADEC054 = () =>
  Process.updateMany(
    {},
    {
      $unset: {
        fase: "",
        historicoFase: "",
        transitoEmJulgadoEm: "",
        motivoEncerramento: "",
        liminar: "",
        liminarObservacao: "",
        liminarEm: ""
      }
    }
  );

describe("migrarFaseProcesso.js — preenche, não inventa, e é idempotente", () => {
  let api;
  let cliente;
  let primeira;
  let segunda;
  let retratoDepoisDaPrimeira;
  let retratoDepoisDaSegunda;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("migracaofase");
    cliente = await criarClientePF(api, { nomeCompleto: "Heloísa Campos" });

    const participantes = [{ clienteId: cliente._id, papel: "autor", principal: true }];

    // Os três valores reais de `status` que existem no banco, um de cada.
    await criarProcesso(api, participantes, { titulo: "Ação em curso", status: "ativo" });
    await criarProcesso(api, participantes, { titulo: "Ação encerrada", status: "encerrado" });
    await criarProcesso(api, participantes, { titulo: "Ação suspensa", status: "suspenso" });

    await desfazerADEC054();

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

  describe("o que ela preenche", () => {
    test("todo processo passa a ter `fase`", async () => {
      const semFase = await Process.countDocuments({ fase: { $exists: false } });
      assert.equal(semFase, 0);
    });

    test("todos vão para a fase padrão — porque nenhum `status` diz a fase", async () => {
      const processos = await Process.find({}).select("titulo fase status").lean();
      assert.equal(processos.length, 3);
      for (const p of processos) {
        assert.equal(
          p.fase,
          "conhecimento",
          `${p.titulo} (status ${p.status}) devia ficar na fase padrão`
        );
      }
    });

    test("a primeira entrada de histórico é gravada, com `de: null`", async () => {
      const processos = await Process.find({}).select("titulo historicoFase").lean();
      for (const p of processos) {
        assert.equal(p.historicoFase.length, 1, `${p.titulo}: uma entrada`);
        assert.equal(p.historicoFase[0].de, null, `${p.titulo}: de`);
        assert.equal(p.historicoFase[0].para, "conhecimento", `${p.titulo}: para`);
        assert.equal(p.historicoFase[0].motivo, null, `${p.titulo}: sem motivo`);
        assert.ok(p.historicoFase[0].autorId, `${p.titulo}: autor`);
        assert.ok(p.historicoFase[0].data, `${p.titulo}: data`);
      }
    });

    test("os campos de encerramento e liminar nascem vazios", async () => {
      const processos = await Process.find({}).lean();
      for (const p of processos) {
        assert.equal(p.transitoEmJulgadoEm, null, `${p.titulo}: sem trânsito`);
        assert.equal(p.motivoEncerramento, null, `${p.titulo}: sem motivo`);
        assert.equal(p.liminar, false, `${p.titulo}: sem liminar`);
        assert.equal(p.liminarObservacao, null);
        assert.equal(p.liminarEm, null);
      }
    });
  });

  describe("o que ela NÃO faz", () => {
    test("não apaga nem altera `status` — é o outro eixo", async () => {
      const status = (await Process.find({}).select("titulo status").lean())
        .map((p) => p.status)
        .sort();
      assert.deepEqual(status, ["ativo", "encerrado", "suspenso"]);
    });

    test("não carimba trânsito em julgado nos `encerrado`", async () => {
      // Uma data inventada é pior que nenhuma: parece informação e não é.
      const encerrado = await Process.findOne({ status: "encerrado" }).lean();
      assert.equal(encerrado.transitoEmJulgadoEm, null);
      assert.equal(encerrado.motivoEncerramento, null);
    });
  });

  describe("o relatório", () => {
    test("lista os valores REAIS de `status` do banco, com a contagem", () => {
      for (const status of ["ativo", "encerrado", "suspenso"]) {
        assert.ok(primeira.includes(status), `precisa citar "${status}":\n${primeira}`);
      }
    });

    test("diz, em voz alta, o que NÃO soube mapear e quantos ficaram assim", () => {
      // Chute silencioso em migração é o defeito que ninguém acha depois. O
      // relatório é o que impede o silêncio.
      assert.match(primeira, /NÃO MAPEADOS/);
      assert.match(primeira, /Nenhum valor de `status` carrega informação de FASE/);
    });

    test("nomeia os `encerrado` como candidatos à revisão da advogada", () => {
      assert.ok(
        primeira.includes("Ação encerrada"),
        `precisa nomear o processo encerrado:\n${primeira}`
      );
      assert.match(primeira, /NÃO carimbou nenhum deles/);
    });

    test("imprime o NOME do banco, e nunca a URI", () => {
      assert.match(primeira, /banco: /);
      assert.doesNotMatch(primeira, /mongodb(\+srv)?:\/\//, "a URI carrega credencial");
    });
  });

  describe("idempotência", () => {
    test("a segunda execução não altera NADA — documento por documento", () => {
      // `deepEqual` sobre os retratos: qualquer campo de qualquer documento que
      // tivesse mudado aparece aqui, inclusive um `updatedAt` tocado por uma
      // escrita que se dizia condicional.
      assert.deepEqual(retratoDepoisDaSegunda, retratoDepoisDaPrimeira);
    });

    test("e ela DIZ que não fez nada", () => {
      assert.match(segunda, /nada a fazer/);
      assert.match(segunda, /idempotente/);
      assert.match(segunda, /fase preenchida agora : 0/);
    });

    test("a primeira execução, essa sim, preencheu — senão o teste acima seria vazio", () => {
      assert.match(primeira, /fase preenchida agora : 3/);
      assert.match(primeira, /migração aplicada/);
    });
  });

  describe("a guarda de banco", () => {
    test("sem `LEX_CONFIRMA_BANCO` e sem terminal, ela ABORTA", async () => {
      // A guarda da F-2b recusa em vez de seguir: um script encadeado que
      // caísse aqui rodaria a operação sem que ninguém tivesse visto a
      // pergunta. Quem quer automação diz isso de propósito.
      const env = { ...process.env, MONGO_URI: MONGO_URI_TESTE };
      delete env.LEX_CONFIRMA_BANCO;

      await assert.rejects(
        execFileAsync(process.execPath, [SCRIPT], { env, cwd: RAIZ }),
        (erro) => {
          assert.match(erro.stderr, /ABORT/);
          assert.match(erro.stderr, /confirmação/);
          // E nem aqui a URI aparece.
          assert.doesNotMatch(erro.stderr, /mongodb(\+srv)?:\/\//);
          return true;
        }
      );
    });

    test("`--dry-run` não pergunta e não escreve", async () => {
      await desfazerADEC054();
      const antes = await retratoDoBanco();

      const env = { ...process.env, MONGO_URI: MONGO_URI_TESTE };
      delete env.LEX_CONFIRMA_BANCO;

      const { stdout } = await execFileAsync(
        process.execPath,
        [SCRIPT, "--dry-run"],
        { env, cwd: RAIZ }
      );

      assert.match(stdout, /DRY RUN/);
      assert.deepEqual(await retratoDoBanco(), antes, "dry run não escreve");
    });
  });
});
