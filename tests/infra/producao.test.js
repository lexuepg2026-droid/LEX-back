// ═══════════════════════════════════════════════════════════════════════════
// PREPARO DE PRODUÇÃO — cabeçalhos e proxy (achado 1.4 — Fase 4.5)
//
// Quatro cabeçalhos escritos à mão (a fase proíbe dependência nova, e helmet
// traria quinze defaults que ninguém leu), `x-powered-by` desligado e
// `trust proxy: 1`.
//
// ── Por que `trust proxy: 1` e não `true` ─────────────────────────────────
// Com `true`, o Express acredita no `X-Forwarded-For` INTEIRO, inclusive no
// trecho que o próprio cliente escreveu. Quem quisesse furar o rate limit
// mandaria um IP falso na frente da cadeia e ganharia um balde novo a cada
// requisição — o limitador viraria enfeite. Com `1`, só o proxy imediatamente à
// frente conta, que é a topologia real de um deploy em PaaS.
//
// O teste do balde precisa de um limite pequeno, e o `env.js` da suíte põe
// 100000 em todos. Por isso este arquivo sobrescreve `RATE_LIMIT_LOGIN` ANTES
// de `subirApp()` — `authRoutes.js` lê `process.env` na CARGA do módulo, e
// `subirApp` é quem faz o import dinâmico de `app.js`. Cada arquivo de teste
// roda em processo próprio, então a sobrescrita não vaza para os outros.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

// Precisa vir antes de qualquer import que carregue `src/app.js`.
import "../helpers/env.js";

const LIMITE_LOGIN = 3;
process.env.RATE_LIMIT_LOGIN = String(LIMITE_LOGIN);
process.env.RATE_LIMIT_JANELA_MINUTOS = "15";

// `authRoutes.js` multiplica todo limite por 20 fora de produção — cadastrar
// seis vezes seguidas em desenvolvimento é rotina, e travar por 15 minutos no
// meio de uma sessão custa mais do que protege. O multiplicador é resolvido na
// CARGA do módulo, então `NODE_ENV` precisa estar em `production` no momento do
// import dinâmico abaixo, e não na hora da requisição. Sem isto o limite
// efetivo seria 60 e o balde não estouraria no teste.
//
// Restaurado logo depois de `subirApp()`, no `before`: o resto do arquivo
// (inclusive o teste de HSTS) depende de estar fora de produção.
process.env.NODE_ENV = "production";

const { subirApp, derrubarApp, urlBase } = await import("../helpers/server.js");
const { limparColecoes, TODAS_AS_COLECOES, desconectar } = await import("../helpers/db.js");

const raiz = () => urlBase().replace(/\/api$/, "");

describe("preparo de produção — cabeçalhos, x-powered-by e proxy", () => {
  before(async () => {
    await subirApp();
    // Os limitadores já foram construídos com o teto de produção; daqui para a
    // frente o ambiente volta a ser de teste.
    process.env.NODE_ENV = "test";
    await limparColecoes(TODAS_AS_COLECOES);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — Os três cabeçalhos que valem em qualquer ambiente
  // ═════════════════════════════════════════════════════════════════════════
  test("nosniff, DENY e Referrer-Policy saem em toda resposta", async () => {
    const r = await fetch(raiz());

    assert.equal(r.headers.get("x-content-type-options"), "nosniff",
      "sem nosniff, um PDF do download pode ser reinterpretado como HTML pelo navegador");
    assert.equal(r.headers.get("x-frame-options"), "DENY",
      "a API não é para ser embutida em frame nenhum");
    assert.equal(r.headers.get("referrer-policy"), "strict-origin-when-cross-origin",
      "não vaza caminho nem query string para terceiros");
  });

  test("os cabeçalhos valem também nas rotas de /api", async () => {
    // O middleware é montado antes das rotas; sem esta asserção, movê-lo para
    // depois de uma delas passaria despercebido.
    const r = await fetch(`${urlBase()}/auth/me`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
  });

  test("x-powered-by não é anunciado", async () => {
    const r = await fetch(raiz());
    assert.equal(
      r.headers.get("x-powered-by"), null,
      "o header entrega a stack de graça — não é vulnerabilidade, é reconhecimento"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — HSTS só em produção
  //
  // O middleware lê `NODE_ENV` por requisição, então dá para alternar aqui sem
  // reconstruir o app. Em desenvolvimento o app roda em http://localhost, e
  // mandar o navegador exigir HTTPS daquele host por um ano deixaria a máquina
  // sem abrir o próprio localhost — efeito que sobrevive a desinstalar o
  // servidor, porque quem guarda é o navegador.
  // ═════════════════════════════════════════════════════════════════════════
  test("HSTS ausente fora de produção e presente em produção", async () => {
    const original = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = "test";
      const emTeste = await fetch(raiz());
      assert.equal(
        emTeste.headers.get("strict-transport-security"), null,
        "HSTS em desenvolvimento trancaria o localhost do Daniel em HTTPS"
      );

      process.env.NODE_ENV = "production";
      const emProducao = await fetch(raiz());
      assert.match(
        emProducao.headers.get("strict-transport-security") ?? "",
        /max-age=31536000/,
        "em produção o HSTS precisa sair, com um ano"
      );
      assert.match(
        emProducao.headers.get("strict-transport-security") ?? "",
        /includeSubDomains/
      );
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — Rate limit atrás de proxy: baldes separados por IP encaminhado
  // ═════════════════════════════════════════════════════════════════════════
  test("`trust proxy` está em 1 — nem desligado, nem confiando na cadeia inteira", async () => {
    const { default: app } = await import("../../src/app.js");
    assert.equal(
      app.get("trust proxy"), 1,
      "`true` faria o Express acreditar no X-Forwarded-For inteiro, e o rate limit viraria enfeite"
    );
  });

  test("IPs encaminhados distintos recebem baldes distintos", async () => {
    const login = (ip) =>
      fetch(`${urlBase()}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ email: "ninguem@lex.dev", senha: "SenhaErrada1" })
      });

    // Estoura o balde do primeiro IP. As credenciais são inválidas de
    // propósito: o que se mede é o limitador, não a autenticação.
    let ultimo = null;
    for (let i = 0; i < LIMITE_LOGIN + 1; i += 1) {
      ultimo = await login("203.0.113.10");
    }

    assert.equal(
      ultimo.status, 429,
      `o balde de 203.0.113.10 deveria estourar depois de ${LIMITE_LOGIN} tentativas`
    );

    // O segundo IP não pode ter sido afetado.
    const outro = await login("203.0.113.99");
    assert.notEqual(
      outro.status, 429,
      "IP encaminhado diferente precisa ter balde próprio — senão um cliente derruba o login de todos"
    );
  });
});
