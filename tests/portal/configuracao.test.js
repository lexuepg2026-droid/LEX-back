// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DO PORTAL — a guarda do segredo e o balde de rate limit.
//
// Os dois só se testam em PROCESSO PRÓPRIO:
//   - a guarda do segredo chama `process.exit(1)`, e testá-la no processo da
//     suíte mataria a suíte;
//   - os limitadores são construídos na carga do módulo, lendo `process.env`
//     uma vez, então baixar o teto depois de `src/app.js` importado não teria
//     efeito nenhum — e o teste passaria sem testar nada.
//
// Mesma técnica das guardas de banco da Fase 2E.2: subprocesso, código de saída
// e saída de erro conferidos.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { conferirSegredoDoPortal, MOTIVO } from "../../src/config/portalSecret.js";

const execFileAsync = promisify(execFile);

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");

// Sobe `src/app.js` num processo próprio, com o ambiente informado, e devolve
// código de saída e stderr.
const carregarApp = async (env) => {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["-e", "import('./src/app.js').then(() => process.exit(0))"],
      {
        cwd: RAIZ,
        env: { ...process.env, ...env },
        timeout: 30000
      }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

describe("portal: configuração", () => {
  describe("guarda do JWT_PORTAL_SECRET", () => {
    test("a função pura classifica os três casos", () => {
      // Separada do efeito colateral justamente para poder ser testada sem
      // derrubar o processo de teste.
      assert.equal(conferirSegredoDoPortal(undefined, "abc"), MOTIVO.AUSENTE);
      assert.equal(conferirSegredoDoPortal("", "abc"), MOTIVO.AUSENTE);
      assert.equal(conferirSegredoDoPortal("   ", "abc"), MOTIVO.AUSENTE);
      assert.equal(conferirSegredoDoPortal("abc", "abc"), MOTIVO.IGUAL);
      assert.equal(conferirSegredoDoPortal(" abc ", "abc"), MOTIVO.IGUAL);
      assert.equal(conferirSegredoDoPortal("portal", "advogada"), MOTIVO.OK);
    });

    test("a aplicação NÃO sobe com JWT_PORTAL_SECRET ausente", async () => {
      const r = await carregarApp({ JWT_SECRET: "segredo-da-advogada", JWT_PORTAL_SECRET: "" });

      assert.notEqual(r.code, 0, "a aplicação subiu sem o segredo do portal");
      assert.equal(r.code, 1, `esperado código 1, veio ${r.code}`);
      assert.match(r.stderr, /APLICAÇÃO NÃO PODE SUBIR/);
      assert.match(r.stderr, /JWT_PORTAL_SECRET/);
      assert.match(r.stderr, /não está definido/);
      // A mensagem tem de dizer o que fazer, não só que deu errado.
      assert.match(r.stderr, /\.env\.example/);
    });

    test("a aplicação NÃO sobe com JWT_PORTAL_SECRET igual ao JWT_SECRET", async () => {
      const mesmo = "o-mesmo-segredo-nos-dois";
      const r = await carregarApp({ JWT_SECRET: mesmo, JWT_PORTAL_SECRET: mesmo });

      assert.notEqual(r.code, 0, "a aplicação subiu com os dois segredos iguais");
      assert.equal(r.code, 1);
      assert.match(r.stderr, /IGUAL ao `JWT_SECRET`/);
      // E explica o motivo, que é o que impede alguém de "resolver" trocando a
      // checagem em vez do segredo.
      assert.match(r.stderr, /assinatura/i);
    });

    test("a aplicação sobe com os dois segredos distintos", async () => {
      // Contraprova: sem ela, uma guarda que abortasse sempre passaria nos dois
      // testes acima e a API não subiria nunca.
      const r = await carregarApp({
        JWT_SECRET: "segredo-da-advogada",
        JWT_PORTAL_SECRET: "segredo-do-portal"
      });

      assert.equal(r.code, 0, `a aplicação não subiu: ${r.stderr}`);
      assert.ok(!r.stderr.includes("APLICAÇÃO NÃO PODE SUBIR"));
    });
  });

  describe("balde de rate limit do portal", () => {
    test("é independente dos três baldes da advogada", async () => {
      // O login do portal é a superfície mais atacável do sistema: o código de
      // acesso circula por WhatsApp e por papel, e a senha é o único fator. Se
      // o balde fosse compartilhado, um ataque ao portal derrubaria o login da
      // advogada junto — negação de serviço de graça.
      const { stdout } = await execFileAsync(
        process.execPath,
        [resolve(AQUI, "fixtures", "rateLimitProbe.mjs")],
        { cwd: RAIZ, timeout: 60000 }
      );

      const linha = stdout.trim().split("\n").pop();
      const r = JSON.parse(linha);

      assert.equal(r.portalEstourou, true, "o balde do portal não estourou — o limitador não existe");
      assert.equal(r.primeiroPortal, 401, "a primeira tentativa deveria passar pelo limitador");
      assert.equal(r.ultimoPortal, 429, "a última tentativa deveria ter sido barrada");

      // Com o portal estourado, os outros baldes continuam abertos.
      assert.notEqual(
        r.advogadaAposEstouro, 429,
        "VAZAMENTO DE BALDE — estourar o portal travou o login da advogada"
      );
      assert.notEqual(
        r.cadastroAposEstouro, 429,
        "VAZAMENTO DE BALDE — estourar o portal travou o cadastro"
      );
    });
  });
});
