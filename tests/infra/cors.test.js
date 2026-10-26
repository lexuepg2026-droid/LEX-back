// ═══════════════════════════════════════════════════════════════════════════
// DEC-113 — o preflight aceita o cabeçalho de versão da fila (Fase 3.4)
//
// A mudança de fase e o compromisso mandam `X-If-Unmodified-Since` (DEC-060).
// Com front e API em origens diferentes — o desenvolvimento local —, o
// navegador faz preflight, e o cabeçalho fora de `allowedHeaders` fazia a
// escrita morrer antes de sair. Em produção a API é mesma origem.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { desconectar } from "../helpers/db.js";

const ORIGEM = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",")[0].trim();

describe("DEC-113 — CORS do cabeçalho de versão", () => {
  let base;

  before(async () => { base = await subirApp(); });
  after(async () => { await derrubarApp(); await desconectar(); });

  const preflight = (cabecalhos, origem = ORIGEM) =>
    fetch(`${base}/processes/000000000000000000000000/fase`, {
      method: "OPTIONS",
      headers: {
        Origin: origem,
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": cabecalhos,
      },
    });

  test("origem permitida: o preflight aceita X-If-Unmodified-Since", async () => {
    const r = await preflight("content-type,x-if-unmodified-since");
    assert.ok(r.status === 204 || r.status === 200, `status ${r.status}`);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGEM);
    const permitidos = (r.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    assert.match(permitidos, /x-if-unmodified-since/);
    assert.match(permitidos, /content-type/);
    assert.match(permitidos, /authorization/);
    assert.equal(r.headers.get("access-control-allow-credentials"), "true");
  });

  test("origem de fora continua sem permissão", async () => {
    const r = await preflight("x-if-unmodified-since", "https://intruso.exemplo");
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  });
});
