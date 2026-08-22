// ═══════════════════════════════════════════════════════════════════════════
// OS TETOS DO RATE LIMIT, POR AMBIENTE (F-2b)
//
// ── O que este arquivo trava, e o que ele NÃO trava ─────────────────────
// Trava a CONTA: qual teto cada ambiente produz. Não trava o comportamento do
// `express-rate-limit` em si — isso é a biblioteca, e reexercitá-la aqui seria
// testar dependência de terceiro.
//
// ── Por que importa ──────────────────────────────────────────────────────
// O `express-rate-limit` conta **por IP**. Numa banca, três professores
// tentando o portal do mesmo wifi saem do mesmo IP: com o teto de produção (5),
// o terceiro bate em 429 **sem ninguém atacar nada**, e a demonstração morre
// com uma mensagem de bloqueio na tela. É o passo 85 do roteiro, e é pré-voo de
// toda demonstração pública.
//
// Do outro lado, um teto baixo demais em `test` faz a SUÍTE esbarrar num limite
// que ela não está testando — e a falha não diz "rate limit", aparece como um
// cadastro recusado num teste que não tem nada a ver com autenticação.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ambiente,
  ehProducao,
  MULTIPLICADOR,
  multiplicadorDoAmbiente,
  janelaMs,
  teto
} from "../../src/config/rateLimit.js";

const ler = (caminho) =>
  readFileSync(fileURLToPath(new URL(`../../${caminho}`, import.meta.url)), "utf8");

const original = process.env.NODE_ENV;
const comAmbiente = (valor, fn) => {
  process.env.NODE_ENV = valor;
  try {
    return fn();
  } finally {
    process.env.NODE_ENV = original;
  }
};

describe("rate limit — o teto muda com o NODE_ENV", () => {
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  // ── Os dois ramos que o prompt pede, mais o terceiro que a F-2b criou ───

  test("PRODUÇÃO usa o limite de verdade, sem multiplicador", () => {
    comAmbiente("production", () => {
      assert.equal(ehProducao(), true);
      assert.equal(multiplicadorDoAmbiente(), 1);

      // Os defaults de produção. NÃO baixar: são a proteção real contra força
      // bruta, e o portal é mais apertado de propósito.
      assert.equal(teto("RATE_LIMIT_CADASTRO", 5), 5);
      assert.equal(teto("RATE_LIMIT_LOGIN", 10), 10);
      assert.equal(teto("RATE_LIMIT_SENHA", 5), 5);
      assert.equal(teto("RATE_LIMIT_PORTAL_LOGIN", 5), 5);
    });
  });

  test("DESENVOLVIMENTO afrouxa 20× — validar à mão não pode travar por 15 minutos", () => {
    comAmbiente("development", () => {
      assert.equal(ehProducao(), false);
      assert.equal(multiplicadorDoAmbiente(), 20);
      assert.equal(teto("RATE_LIMIT_CADASTRO", 5), 100);
      assert.equal(teto("RATE_LIMIT_PORTAL_LOGIN", 5), 100);
    });
  });

  test("TESTE afrouxa muito mais — a suíte não pode esbarrar no limite", () => {
    comAmbiente("test", () => {
      assert.equal(multiplicadorDoAmbiente(), 500);

      // A conta que motivou separar `test` de `development`: a suíte faz mais
      // de 60 cadastros numa execução de ~6 minutos, ou seja, DENTRO de uma
      // única janela de 15. Com o multiplicador de dev (teto 100) a margem era
      // de cerca de um terço — e ela encolhe a cada fase.
      assert.ok(
        teto("RATE_LIMIT_CADASTRO", 5) >= 1000,
        "o teto de cadastro em teste precisa ter folga de ordem de grandeza"
      );
    });
  });

  test("produção e teste NÃO podem ter o mesmo teto", () => {
    const emProducao = comAmbiente("production", () => teto("RATE_LIMIT_CADASTRO", 5));
    const emTeste = comAmbiente("test", () => teto("RATE_LIMIT_CADASTRO", 5));
    assert.notEqual(emProducao, emTeste);
    assert.ok(emTeste > emProducao);
  });

  test("`test` é mais folgado que `development`, e os dois mais que produção", () => {
    assert.ok(MULTIPLICADOR.test > MULTIPLICADOR.development);
    assert.ok(MULTIPLICADOR.development > MULTIPLICADOR.production);
    assert.equal(MULTIPLICADOR.production, 1);
  });

  test("ambiente desconhecido cai no de desenvolvimento, nunca no de produção", () => {
    // Errar para o lado seguro: um `NODE_ENV=staging` que caísse no teto de
    // produção derrubaria uma demonstração; caindo no de dev, o pior que
    // acontece é um ambiente interno ficar folgado.
    comAmbiente("staging", () => {
      assert.equal(multiplicadorDoAmbiente(), MULTIPLICADOR.development);
      assert.equal(ehProducao(), false);
    });
  });

  test("sem NODE_ENV definido, o ambiente é `development`", () => {
    const salvo = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      assert.equal(ambiente(), "development");
      assert.equal(ehProducao(), false);
    } finally {
      process.env.NODE_ENV = salvo;
    }
  });

  test("`RATE_LIMIT_MULTIPLICADOR` sobrepõe o fator do ambiente", () => {
    // Existe para quem precisa de um teto EXERCITÁVEL sem fingir estar em
    // produção — é o caso da sonda que estoura o balde do portal para provar
    // que ele é independente dos baldes da advogada.
    const salvo = process.env.RATE_LIMIT_MULTIPLICADOR;
    process.env.RATE_LIMIT_MULTIPLICADOR = "1";
    try {
      comAmbiente("test", () => {
        assert.equal(multiplicadorDoAmbiente(), 1, "o explícito vence o do ambiente");
        assert.equal(teto("RATE_LIMIT_PORTAL_LOGIN", 5), 5);
      });
    } finally {
      if (salvo === undefined) delete process.env.RATE_LIMIT_MULTIPLICADOR;
      else process.env.RATE_LIMIT_MULTIPLICADOR = salvo;
    }
  });

  test("multiplicador explícito inválido é ignorado, não vira zero", () => {
    // `RATE_LIMIT_MULTIPLICADOR=0` zeraria todos os tetos e bloquearia o
    // sistema inteiro na primeira requisição.
    const salvo = process.env.RATE_LIMIT_MULTIPLICADOR;
    for (const torto of ["0", "-1", "abc", ""]) {
      process.env.RATE_LIMIT_MULTIPLICADOR = torto;
      try {
        comAmbiente("production", () => {
          assert.equal(
            multiplicadorDoAmbiente(), 1,
            `"${torto}" precisa cair no fator do ambiente`
          );
        });
        comAmbiente("development", () => {
          assert.equal(multiplicadorDoAmbiente(), 20, `"${torto}" precisa cair no fator do ambiente`);
        });
      } finally {
        if (salvo === undefined) delete process.env.RATE_LIMIT_MULTIPLICADOR;
        else process.env.RATE_LIMIT_MULTIPLICADOR = salvo;
      }
    }
  });

  // ── A janela ────────────────────────────────────────────────────────────

  test("a janela é de 15 minutos por padrão e sai de variável de ambiente", () => {
    assert.equal(janelaMs(), 15 * 60 * 1000);

    const salvo = process.env.RATE_LIMIT_JANELA_MINUTOS;
    process.env.RATE_LIMIT_JANELA_MINUTOS = "30";
    try {
      assert.equal(janelaMs(), 30 * 60 * 1000);
    } finally {
      if (salvo === undefined) delete process.env.RATE_LIMIT_JANELA_MINUTOS;
      else process.env.RATE_LIMIT_JANELA_MINUTOS = salvo;
    }
  });

  test("valor inválido na variável cai no padrão, não em zero", () => {
    // `RATE_LIMIT_CADASTRO=0` ou `=abc` não pode virar teto 0 — isso bloquearia
    // o cadastro inteiro, e o erro apareceria como "muitas tentativas" na
    // primeira requisição.
    const salvo = process.env.RATE_LIMIT_CADASTRO;
    for (const valorTorto of ["0", "-3", "abc", ""]) {
      process.env.RATE_LIMIT_CADASTRO = valorTorto;
      try {
        comAmbiente("production", () => {
          assert.equal(
            teto("RATE_LIMIT_CADASTRO", 5), 5,
            `"${valorTorto}" precisa cair no padrão 5`
          );
        });
      } finally {
        if (salvo === undefined) delete process.env.RATE_LIMIT_CADASTRO;
        else process.env.RATE_LIMIT_CADASTRO = salvo;
      }
    }
  });

  // ── Uma cópia só ────────────────────────────────────────────────────────

  test("as rotas leem o teto de `config/rateLimit.js`, sem cópia local", () => {
    // O bloco inteiro era duplicado em `authRoutes.js` e `portalRoutes.js`.
    // Duas cópias da mesma decisão divergem: bastaria ajustar uma para o portal
    // e a área da advogada se comportarem diferente sem ninguém notar.
    for (const arquivo of ["src/routes/authRoutes.js", "src/routes/portalRoutes.js"]) {
      const codigo = ler(arquivo);
      assert.match(
        codigo, /from "\.\.\/config\/rateLimit\.js"/,
        `${arquivo}: precisa ler o teto do módulo compartilhado`
      );
      assert.doesNotMatch(
        codigo, /MULTIPLICADOR_DEV\s*=/,
        `${arquivo}: voltou a ter uma cópia local do multiplicador`
      );
    }
  });
});
