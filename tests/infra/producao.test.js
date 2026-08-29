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

import { logError } from "../../src/utils/logError.js";

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

  // ═════════════════════════════════════════════════════════════════════════
  // 4 — O IP LIDO É O QUE O PROXY DIZ, E NÃO O QUE O CLIENTE ESCREVEU (D-1)
  // ═════════════════════════════════════════════════════════════════════════
  //
  // O teste acima prova que dois IPs encaminhados diferentes têm baldes
  // diferentes — e ele passaria também com `trust proxy: true`. Este aqui é o
  // outro lado, e é o que separa os dois valores:
  //
  //   X-Forwarded-For: <forjado pelo cliente>, <o que o proxy acrescentou>
  //
  // Com `trust proxy: 1`, o Express confia em UM salto e lê o **último** valor
  // da cadeia — o que o proxy do hospedeiro escreveu, que é o IP real de quem
  // chamou. Com `true`, ele acredita na cadeia inteira e lê o **primeiro** —
  // que é justamente o trecho que o cliente controla.
  //
  // A consequência prática do `true` é o rate limit virar enfeite: quem quiser
  // furá-lo troca o prefixo forjado a cada requisição e ganha um balde novo
  // toda vez. Este teste faz exatamente isso, e exige que NÃO funcione.
  test("prefixo forjado no X-Forwarded-For não cria balde novo", async () => {
    const PROXY = "203.0.113.200"; // o que o proxy do hospedeiro acrescentaria

    const loginForjando = (prefixoFalso) =>
      fetch(`${urlBase()}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Um cliente mal-intencionado escreve o primeiro valor; o proxy
          // acrescenta o dele no fim.
          "X-Forwarded-For": `${prefixoFalso}, ${PROXY}`
        },
        body: JSON.stringify({ email: "ninguem@lex.dev", senha: "SenhaErrada1" })
      });

    // Cada tentativa vem com um prefixo forjado DIFERENTE.
    let ultimo = null;
    for (let i = 0; i <= LIMITE_LOGIN; i += 1) {
      ultimo = await loginForjando(`198.51.100.${i + 1}`);
    }

    assert.equal(
      ultimo.status, 429,
      "trocar o prefixo forjado do X-Forwarded-For rendeu um balde novo a cada requisição — " +
      "é o que `trust proxy: true` faz, e é o que transforma o rate limit em enfeite"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOG DE 5xx EM PRODUÇÃO (Fase F-0)
//
// `errorMiddleware` imprimia o erro completo, com stack, mas guardado atrás de
// `if (NODE_ENV !== "production")`. Em produção, portanto, um 500 não deixava
// rastro NENHUM: a advogada relataria "deu erro ao salvar" e não haveria onde
// olhar.
//
// O teste exercita a função direto, capturando `console.error`, e não por HTTP:
// pôr a suíte em produção para provocar um 500 real mudaria cookie (`Secure`),
// HSTS e rate limit no meio do arquivo. O que precisa ser provado aqui é o que
// a linha CONTÉM e o que ela NÃO contém.
// ═══════════════════════════════════════════════════════════════════════════
describe("log de erro de produção", () => {
  const capturar = (fn) => {
    const original = console.error;
    const linhas = [];
    console.error = (...args) => linhas.push(args.join(" "));
    try { fn(); } finally { console.error = original; }
    return linhas;
  };

  const reqFalso = {
    method: "PATCH",
    baseUrl: "/api/clients",
    route: { path: "/:id" },
    // Tudo abaixo é o que NÃO pode vazar para o log.
    body: { cpf: "52998224725", nomeCompleto: "Fulana de Tal", telefone: "42999990000" },
    query: { busca: "fulana" },
    headers: { cookie: "lex-token=abc.def.ghi" },
    user: { _id: "6a824d59a9e97ba4c9d0bc83", email: "demo@lex.dev" }
  };

  test("4xx não é logado — conversa normal da API não é incidente", () => {
    const linhas = capturar(() => logError(new Error("Cliente não encontrado"), reqFalso, 404));
    assert.deepEqual(linhas, [], "logar todo 4xx afogaria o 500 de verdade no meio do esperado");
  });

  test("5xx é logado com quando, onde e o quê", () => {
    const linhas = capturar(() => logError(new Error("falha no driver"), reqFalso, 500));

    assert.ok(linhas.length >= 1, "um 500 precisa deixar rastro");
    const resumo = linhas[0];

    assert.match(resumo, /status=500/);
    assert.match(resumo, /metodo=PATCH/);
    assert.match(resumo, /falha no driver/);
    // Carimbo de tempo ISO no começo da linha.
    assert.match(resumo, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("a rota é o PADRÃO, não a URL com id real dentro", () => {
    const linhas = capturar(() => logError(new Error("x"), reqFalso, 500));
    assert.match(
      linhas[0], /rota=\/api\/clients\/:id/,
      "o id identifica um cliente real; a pergunta que o log responde é qual endpoint quebrou"
    );
  });

  test("NADA de corpo, query, cookie ou usuário entra na linha", () => {
    const linhas = capturar(() => logError(new Error("x"), reqFalso, 500)).join("\n");

    const proibidos = [
      ["52998224725", "CPF do corpo"],
      ["Fulana de Tal", "nome do corpo"],
      ["42999990000", "telefone do corpo"],
      ["fulana", "termo da query"],
      ["lex-token", "cookie de sessão"],
      ["demo@lex.dev", "e-mail do usuário"],
      ["6a824d59a9e97ba4c9d0bc83", "id do usuário"]
    ];

    for (const [valor, oQueE] of proibidos) {
      assert.ok(
        !linhas.includes(valor),
        `${oQueE} vazou para o log. Log sobrevive ao incidente, é copiado para triagem e ` +
        "raramente é apagado — dado pessoal ali vaza por um caminho que ninguém audita."
      );
    }
  });

  test("erro sem stack e requisição ausente não derrubam o logger", () => {
    // O logger roda DENTRO do handler de erro. Se ele lançar, o 500 vira uma
    // exceção não tratada e o cliente não recebe resposta nenhuma.
    assert.doesNotThrow(() => capturar(() => logError({ message: "sem stack" }, undefined, 500)));
    assert.doesNotThrow(() => capturar(() => logError(undefined, undefined, 500)));
  });
});
