// ═══════════════════════════════════════════════════════════════════════════
// VETORES COMPARTILHADOS DA FÓRMULA PERCENTUAL (achado #8 — Fase 4.5)
//
// A mesma conta existe nos DOIS repositórios: no hook `pre("validate")` de
// `models/Fee.js` (DEC-027, a última palavra) e em `utils/feeCalc.js` do
// frontend, que a espelha para exibir o valor derivado enquanto a advogada
// digita. Duas implementações da mesma regra divergem — é uma questão de
// quando, não de se.
//
// Divergir aqui é caro e silencioso: a tela mostraria um número e o banco
// gravaria outro, os dois "corretos" pelo seu próprio código, e o erro só
// apareceria quando alguém somasse o contrato na calculadora.
//
// ── Como a sincronia é garantida ──────────────────────────────────────────
// `tests/fixtures/percentualVetores.json` existe idêntico nos dois repos. Cada
// lado confere o SHA-256 do conteúdo canonicalizado contra a MESMA constante,
// escrita à mão nos dois arquivos de teste. Editar um lado sem editar o outro
// derruba a suíte dos dois — e a mensagem diz exatamente isso.
//
// O hash é do JSON REPARSEADO e re-serializado, não do texto do arquivo: assim
// ele não muda por indentação ou fim de linha, que é diferença sem significado
// e produziria falha por motivo errado.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, esperado
} from "../helpers/setup.js";

// Precisa ser IDÊNTICA à do `tests/financial/percentualVetores.test.js` do
// LEX-front. Ao mudar os vetores, os dois arquivos mudam juntos.
const HASH_ESPERADO = "4e40cbc9aad0478d7e09d4cff30de5adc0582d62af2ba148ced4284654aa22cb";

const vetores = JSON.parse(
  readFileSync(new URL("../fixtures/percentualVetores.json", import.meta.url), "utf8")
);

const hashDe = (obj) => createHash("sha256").update(JSON.stringify(obj)).digest("hex");

describe("fórmula do honorário percentual — vetores compartilhados", () => {
  let api, processo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("vetores");
    const pf = await criarClientePF(api);
    processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("os vetores estão sincronizados com os do frontend", () => {
    assert.equal(
      hashDe(vetores), HASH_ESPERADO,
      "os vetores mudaram. Atualize tests/fixtures/percentualVetores.json NOS DOIS repositórios " +
      "e a constante HASH_ESPERADO nos dois arquivos de teste — é isso que impede a fórmula " +
      "de divergir entre a tela e o banco."
    );
  });

  test("o arquivo traz vetores suficientes para valer alguma coisa", () => {
    assert.ok(vetores.validos.length >= 10, "poucos casos válidos");
    assert.ok(vetores.invalidos.length >= 5, "poucos casos inválidos");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // O hook, exercitado pela API — que é onde a conta vale
  // ═════════════════════════════════════════════════════════════════════════
  test("o hook de Fee.js grava exatamente o `valor` de cada vetor válido", async () => {
    for (const caso of vetores.validos) {
      const r = await api.post("/fees", {
        processoId: processo._id,
        descricao: `vetor: ${caso.nome}`,
        tipo: "percentual",
        percentual: caso.percentual,
        valorBase: caso.valorBase,
        // Mandado de propósito e ERRADO: no tipo percentual o backend descarta
        // o que vier em `valor`, porque ali o valor não é opinião, é conta.
        valor: 999999,
        status: "pendente",
        dataVencimento: "2099-12-31"
      });

      const fee = esperado(r, 201, `criação do vetor "${caso.nome}"`);
      assert.equal(
        fee.valor, caso.valor,
        `${caso.nome}: ${caso.percentual}% de ${caso.valorBase} deveria dar ${caso.valor}, veio ${fee.valor}`
      );
    }
  });

  test("o `valor` enviado é descartado no tipo percentual", async () => {
    const r = await api.post("/fees", {
      processoId: processo._id,
      descricao: "valor enviado é descartado",
      tipo: "percentual",
      percentual: 10,
      valorBase: 1000,
      valor: 777,
      status: "pendente",
      dataVencimento: "2099-12-31"
    });
    const fee = esperado(r, 201, "criação");
    assert.equal(fee.valor, 100, "o hook recalcula e ignora o valor do corpo");
  });

  test("cada vetor inválido é recusado com 400", async () => {
    for (const caso of vetores.invalidos) {
      const corpo = {
        processoId: processo._id,
        descricao: `inválido: ${caso.nome}`,
        tipo: "percentual",
        status: "pendente",
        dataVencimento: "2099-12-31"
      };
      if (caso.percentual !== null) corpo.percentual = caso.percentual;
      if (caso.valorBase !== null) corpo.valorBase = caso.valorBase;

      const r = await api.post("/fees", corpo);
      assert.equal(
        r.status, 400,
        `"${caso.nome}" deveria ser recusado com 400 — veio ${r.status} ${JSON.stringify(r.body)}`
      );
    }
  });

  test("o arredondamento é em centavos, e não depois da divisão", async () => {
    // A contraprova da ORDEM da conta.
    //
    // Escolher o caso importa: `1000 * 33.33` dá exatamente 33330 em ponto
    // flutuante, então ali as duas ordens coincidem e o teste não provaria
    // nada — foi o primeiro par que tentei, e a asserção de guarda abaixo o
    // reprovou. `987654.32 * 8.75` cai num valor inexato, e é nele que a ordem
    // aparece: 86419.75299999998 dividindo depois, 86419.75 arredondando antes.
    const PERC = 8.75;
    const BASE = 987654.32;
    const errado = (BASE * PERC) / 100;
    const certo = Math.round(BASE * PERC) / 100;

    assert.notEqual(errado, certo, "se estes fossem iguais, o teste não provaria a ordem");
    assert.equal(certo, 86419.75);

    const r = await api.post("/fees", {
      processoId: processo._id,
      descricao: "ordem da conta",
      tipo: "percentual",
      percentual: PERC,
      valorBase: BASE,
      status: "pendente",
      dataVencimento: "2099-12-31"
    });
    const fee = esperado(r, 201, "criação");
    assert.equal(fee.valor, certo, "o hook precisa arredondar ANTES de dividir");
    assert.notEqual(fee.valor, errado, "dividir primeiro traria o erro de ponto flutuante para o contrato");
  });
});
