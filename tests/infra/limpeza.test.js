// ═══════════════════════════════════════════════════════════════════════════
// A LIMPEZA DA SUÍTE ALCANÇA TODA COLEÇÃO (Fase 4a, DEC-158)
//
// `TODAS_AS_COLECOES` (`tests/helpers/db.js`) é escrita à mão, e as coleções
// do Financeiro 2.0 nasceram na F-1a sem entrar nela. Desde então
// `alocacoes`, `estornos` e `reparcelamentos` acumulavam no banco de teste, e
// um arquivo ainda limpava `allocations` e `renegotiations` — nomes que não
// existem, e por isso não limpavam nada, sem erro nenhum.
//
// As duas travas abaixo leem os MODELS, e não uma segunda lista: a próxima
// coleção nova cai aqui no primeiro `npm test`.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import mongoose from "mongoose";

import { TODAS_AS_COLECOES } from "../helpers/db.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const MODELS = resolve(AQUI, "..", "..", "src", "models");
const TESTES = resolve(AQUI, "..");

// Importar um model só o registra no Mongoose: nada conecta.
let registradas;
before(async () => {
  for (const arquivo of readdirSync(MODELS).filter((a) => a.endsWith(".js"))) {
    await import(pathToFileURL(join(MODELS, arquivo)).href);
  }
  registradas = mongoose.modelNames().map((nome) => mongoose.model(nome).collection.collectionName);
});

const arquivosDeTeste = (pasta) =>
  readdirSync(pasta, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? arquivosDeTeste(join(pasta, e.name))
      : e.name.endsWith(".test.js") ? [join(pasta, e.name)] : []
  );

describe("a limpeza da suíte alcança toda coleção", () => {
  test("os models foram de fato carregados (senão a trava abaixo seria vazia)", () => {
    assert.ok(registradas.length >= 16, `só ${registradas.length} models registrados`);
    for (const nome of ["alocacoes", "estornos", "reparcelamentos"]) {
      assert.ok(registradas.includes(nome), `${nome} não veio dos models`);
    }
  });

  test("toda coleção registrada pelos models está em TODAS_AS_COLECOES", () => {
    const faltando = registradas.filter((c) => !TODAS_AS_COLECOES.includes(c));
    assert.deepEqual(faltando, [], `fora da limpeza: ${faltando.join(", ")}`);
  });

  test("TODAS_AS_COLECOES não cita coleção que nenhum model registra", () => {
    const inexistentes = TODAS_AS_COLECOES.filter((c) => !registradas.includes(c));
    assert.deepEqual(inexistentes, [], `nome sem model: ${inexistentes.join(", ")}`);
  });

  test("nenhuma lista local de limpeza cita coleção que não existe", () => {
    // Foi como `allocations` e `renegotiations` passaram despercebidas: o
    // `limparColecoes` pula em silêncio o nome que não acha no banco.
    const achados = [];
    for (const arquivo of arquivosDeTeste(TESTES)) {
      const fonte = readFileSync(arquivo, "utf8");
      for (const lista of fonte.matchAll(/const COLECOES\w*\s*=\s*\[([^\]]*)\]/g)) {
        for (const [, nome] of lista[1].matchAll(/"([a-z_]+)"/g)) {
          if (!registradas.includes(nome)) achados.push(`${arquivo.slice(TESTES.length + 1)}: "${nome}"`);
        }
      }
    }
    assert.deepEqual(achados, []);
  });
});
