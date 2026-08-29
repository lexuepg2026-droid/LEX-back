// ═══════════════════════════════════════════════════════════════════════════
// D-1 — O QUE O DEPLOY PRECISA QUE ESTEJA ESCRITO
//
// Esta fase não muda comportamento nenhum do sistema: ela faz o repositório
// conseguir rodar fora do `localhost`. O que dá para travar em teste é
// justamente o que se descobre tarde e no pior momento — a variável que o
// código passou a ler e ninguém pôs no painel, e a versão de Node que o
// hospedeiro escolheu por nós.
//
// ── Por que a lista de variáveis é um TESTE, e não um item de checklist ──
// `.env.production.example` é a única lista do que precisa ser configurado no
// Render. Uma variável nova lida pelo código e ausente dele produz um deploy
// que **sobe** e falha em uso — que é a categoria de defeito mais cara
// possível, porque não há erro de build para investigar.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ler = (relativo) => readFileSync(resolve(RAIZ, relativo), "utf8");

const arquivosJs = (dir, acc = []) => {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosJs(caminho, acc);
    else if (nome.endsWith(".js")) acc.push(caminho);
  }
  return acc;
};

// `process.env.NOME` e `process.env["NOME"]`. A leitura dinâmica
// (`process.env[variavel]`, em `config/rateLimit.js`) não aparece aqui por
// construção — ela é coberta pelo bloco dos tetos, logo abaixo, que lê os
// nomes literais dos arquivos de rota.
const variaveisLidas = (codigo) => {
  const nomes = new Set();
  const padrao = /process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*\])/g;
  for (const m of codigo.matchAll(padrao)) nomes.add(m[1] ?? m[2]);
  return nomes;
};

describe("D-1 — o modelo de variáveis de produção", () => {
  const CAMINHO = ".env.production.example";

  test("o arquivo existe", () => {
    assert.ok(
      existsSync(resolve(RAIZ, CAMINHO)),
      "sem ele, a única lista do que configurar no Render é a memória de quem fez o deploy"
    );
  });

  test("lista TODA variável que o código de produção lê", () => {
    const modelo = ler(CAMINHO);

    const lidas = new Set();
    for (const arquivo of arquivosJs(resolve(RAIZ, "src"))) {
      for (const nome of variaveisLidas(readFileSync(arquivo, "utf8"))) lidas.add(nome);
    }

    // O código também lê os tetos do rate limit por nome montado em tempo de
    // execução (`teto("RATE_LIMIT_LOGIN", 10)`): os literais estão nas rotas.
    for (const arquivo of ["src/routes/authRoutes.js", "src/routes/portalRoutes.js"]) {
      for (const m of ler(arquivo).matchAll(/"(RATE_LIMIT_[A-Z_]+)"/g)) lidas.add(m[1]);
    }

    const ausentes = [...lidas].filter((nome) => !modelo.includes(nome)).sort();

    assert.deepEqual(
      ausentes, [],
      "o código lê estas variáveis e o modelo de produção não as menciona:\n" +
      ausentes.map((n) => `  - ${n}`).join("\n") +
      "\n\nUma variável que ninguém configura no painel produz um deploy que SOBE e falha em uso."
    );
  });

  test("não carrega valor real nenhum — nem de exemplo com cara de real", () => {
    // A fase mexe justamente nos arquivos que carregam segredo. Um valor real
    // commitado aqui exige ROTAÇÃO, porque histórico publicado não se
    // reescreve — apagar o commit não desfaz nada.
    const linhas = ler(CAMINHO).split("\n").filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l));
    assert.ok(linhas.length > 0, "o modelo precisa ter as chaves, mesmo sem valor");

    for (const linha of linhas) {
      const [chave, ...resto] = linha.split("=");
      const valor = resto.join("=").trim();

      assert.ok(
        !/mongodb(\+srv)?:\/\/[^<\s]*:[^<@\s]*@/.test(valor),
        `${chave} traz uma URI com usuário e senha dentro`
      );
      assert.ok(
        !/^[0-9a-f]{32,}$/i.test(valor),
        `${chave} tem cara de segredo gerado (hex longo)`
      );
      // Sobra o que é declaradamente modelo: vazio, ou com `<placeholder>`.
      assert.ok(
        valor === "" || valor.includes("<") || valor === "production",
        `${chave}=${valor} — no modelo, valor só se for placeholder`
      );
    }
  });

  test("o `PORT` está documentado como NÃO configurável", () => {
    // Fixar `PORT` no painel é um dos jeitos clássicos de o health check do
    // Render nunca passar, com o deploy parado em "in progress" sem erro.
    const modelo = ler(CAMINHO);
    assert.match(modelo, /PORT/);
    assert.match(modelo, /NÃO configure PORT/i);
  });
});

describe("D-1 — a versão do Node é DECLARADA, e com teto", () => {
  const pkg = JSON.parse(ler("package.json"));

  test("`engines.node` existe", () => {
    // Sem isto, o Render usa o default DELE — hoje a série 24 — e o serviço
    // roda numa versão que a suíte nunca tocou. A suíte deste projeto roda em
    // Node 20.
    assert.ok(
      pkg.engines?.node,
      "sem `engines.node`, o hospedeiro escolhe a versão do Node por nós"
    );
  });

  test("a faixa tem limite superior", () => {
    // É a recomendação explícita da documentação do Render: faixa aberta
    // (`>=20`) resolve para o `latest`, que muda de major sozinho.
    const faixa = pkg.engines.node;
    assert.match(
      faixa, /</,
      `"${faixa}" não tem teto: uma faixa aberta sobe de major sozinha, e o ` +
      "deploy passa a rodar num Node que ninguém testou"
    );
  });

  test("a faixa aceita a versão em que a suíte roda", () => {
    const [major] = process.versions.node.split(".").map(Number);
    const faixa = pkg.engines.node;
    const min = Number(faixa.match(/>=\s*(\d+)/)?.[1]);
    const max = Number(faixa.match(/<\s*(\d+)/)?.[1]);

    assert.ok(
      major >= min && major < max,
      `a suíte roda em Node ${process.versions.node}, fora da faixa "${faixa}" — ` +
      "o que se testa aqui precisa ser o que roda lá"
    );
  });
});
