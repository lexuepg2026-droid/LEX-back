// ═══════════════════════════════════════════════════════════════════════════
// A GUARDA DOS COMANDOS DESTRUTIVOS (F-2b)
//
// `npm run seed:fresh` derruba treze coleções e `migrarTotalParcelas.js`
// reescreve parcelas e troca um índice único. Os dois rodam contra o banco de
// DESENVOLVIMENTO, que neste projeto é Atlas **remoto e compartilhado**. Só o
// banco de teste tinha guarda, e já aconteceu de um `seed:fresh` apagar dados
// no meio de uma validação.
//
// **Aviso que não interrompe é aviso que ninguém lê** — os scripts já
// imprimiam o banco, e isso não impediu o acidente.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";

import {
  ehBancoLocal,
  nomeDoBanco,
  confirmacaoDispensada,
  exigirConfirmacaoDeBanco,
  VARIAVEL_PULAR
} from "../../scripts/lib/guardaDeBanco.js";

const ler = (caminho) =>
  readFileSync(fileURLToPath(new URL(`../../${caminho}`, import.meta.url)), "utf8");

// URIs de exemplo, com credencial INVENTADA. Nenhum valor real de `.env`
// aparece aqui — é a convenção do projeto, e vale para o código de teste também.
const REMOTA = "mongodb+srv://usuario:senha@cluster0.exemplo.mongodb.net/lex?retryWrites=true";
const LOCAL = "mongodb://localhost:27017/lex";

const entradaCom = (linha) => {
  const s = Readable.from([`${linha}\n`]);
  s.isTTY = true;
  return s;
};

const saidaMuda = () => {
  let buf = "";
  const w = new Writable({ write(c, e, cb) { buf += c.toString(); cb(); } });
  w.texto = () => buf;
  return w;
};

describe("guarda de banco — o que é local e o que não é", () => {
  test("Atlas é remoto; localhost e 127.0.0.1 são locais", () => {
    assert.equal(ehBancoLocal(REMOTA), false);
    assert.equal(ehBancoLocal(LOCAL), true);
    assert.equal(ehBancoLocal("mongodb://127.0.0.1:27017/lex_test"), true);
    assert.equal(ehBancoLocal("mongodb://[::1]:27017/lex"), true);
  });

  test("conjunto MISTO de hosts é remoto", () => {
    // Basta um nó fora da máquina para o dano sair dela.
    assert.equal(ehBancoLocal("mongodb://localhost:27017,remoto.net:27017/lex"), false);
  });

  test("vários hosts remotos (forma que `URL` recusa) são reconhecidos", () => {
    const uri = "mongodb://u:p@host1:27017,host2:27017/lex?replicaSet=rs0";
    assert.equal(ehBancoLocal(uri), false);
    assert.equal(nomeDoBanco(uri), "lex");
  });

  test("URI vazia ou torta não é considerada local", () => {
    // Errar para o lado seguro: o que não se consegue classificar PERGUNTA.
    for (const torta of ["", null, undefined, "nao-e-uri"]) {
      assert.equal(ehBancoLocal(torta), false, `"${torta}" não pode passar por local`);
    }
  });

  test("o nome do banco é extraído, e a credencial NUNCA é devolvida", () => {
    assert.equal(nomeDoBanco(REMOTA), "lex");
    assert.equal(nomeDoBanco(LOCAL), "lex");

    // O que a guarda devolve é o nome do banco — não a URI, não o host, não a
    // senha. A convenção é que credencial não aparece em saída de script nem
    // mascarada.
    for (const proibido of ["senha", "usuario", "cluster0", "mongodb+srv"]) {
      assert.ok(
        !String(nomeDoBanco(REMOTA)).includes(proibido),
        `"${proibido}" vazou pelo nome do banco`
      );
    }
  });
});

describe("guarda de banco — quando ela interrompe", () => {
  test("banco LOCAL passa direto, sem perguntar", () => {
    // Perguntar toda vez num banco descartável treinaria a pessoa a responder
    // no automático — que é o hábito que a guarda existe para evitar.
    return exigirConfirmacaoDeBanco({
      uri: LOCAL, acao: "reset", argv: [], entrada: entradaCom(""), saida: saidaMuda()
    }).then((r) => {
      assert.equal(r.perguntou, false);
      assert.equal(r.local, true);
    });
  });

  test("banco REMOTO com o nome digitado certo: prossegue", async () => {
    const saida = saidaMuda();
    const r = await exigirConfirmacaoDeBanco({
      uri: REMOTA, acao: "reset", argv: [], entrada: entradaCom("lex"), saida
    });
    assert.equal(r.perguntou, true);
    assert.equal(r.confirmado, true);

    // O texto mostrado diz O NOME DO BANCO — é o que a pessoa precisa para
    // decidir — e não mostra a URI.
    assert.match(saida.texto(), /Banco alvo: lex/);
    assert.ok(!saida.texto().includes("senha"), "a URI não pode aparecer no aviso");
    assert.ok(!saida.texto().includes("cluster0"), "o host não pode aparecer no aviso");
  });

  test("a flag e a variável dispensam a pergunta — mas o padrão é PERGUNTAR", () => {
    assert.equal(confirmacaoDispensada([]), false, "o padrão é perguntar");
    assert.equal(confirmacaoDispensada(["--sim"]), true);
    assert.equal(confirmacaoDispensada(["--yes"]), true);
    assert.equal(confirmacaoDispensada(["-y"]), true);

    const salvo = process.env[VARIAVEL_PULAR];
    process.env[VARIAVEL_PULAR] = "sim";
    try {
      assert.equal(confirmacaoDispensada([]), true);
    } finally {
      if (salvo === undefined) delete process.env[VARIAVEL_PULAR];
      else process.env[VARIAVEL_PULAR] = salvo;
    }
  });

  test("a variável só dispensa com o valor exato `sim`", () => {
    const salvo = process.env[VARIAVEL_PULAR];
    for (const valor of ["1", "true", "SIM", "yes", ""]) {
      process.env[VARIAVEL_PULAR] = valor;
      try {
        assert.equal(
          confirmacaoDispensada([]), false,
          `"${valor}" não pode dispensar a confirmação — só o literal "sim"`
        );
      } finally {
        if (salvo === undefined) delete process.env[VARIAVEL_PULAR];
        else process.env[VARIAVEL_PULAR] = salvo;
      }
    }
  });
});

describe("guarda de banco — está ligada nos comandos destrutivos", () => {
  const DESTRUTIVOS = [
    ["scripts/resetDev.js", "derruba 13 coleções"],
    ["scripts/migrarTotalParcelas.js", "reescreve parcelas e troca um índice"],
    ["scripts/seedDemo.js", "apaga os dados do usuário demo no --clean"]
  ];

  test("os três chamam `exigirConfirmacaoDeBanco`", () => {
    for (const [arquivo, porque] of DESTRUTIVOS) {
      assert.match(
        ler(arquivo), /exigirConfirmacaoDeBanco/,
        `${arquivo} (${porque}) precisa da guarda`
      );
    }
  });

  test("`resetDev` não imprime mais o HOST do cluster", () => {
    // Host de cluster é infraestrutura e não precisa aparecer em log de
    // bancada. É a mesma regra que `migrarTotalParcelas.js` já seguia.
    const codigo = ler("scripts/resetDev.js");
    assert.doesNotMatch(codigo, /connection\.host/);
    assert.match(codigo, /databaseName/);
  });

  test("nenhum script destrutivo imprime o VALOR da URI", () => {
    // A URI carrega usuário e senha do cluster.
    //
    // O que se procura é a INTERPOLAÇÃO do valor (`${uri}`,
    // `${process.env.MONGO_URI}`), não o nome da variável em texto: a linha
    // `console.error('ABORT: MONGO_URI não definida.')` cita o NOME para a
    // pessoa saber o que configurar, e isso é o oposto de vazar o valor.
    const INTERPOLA_VALOR = [
      /\$\{\s*uri\s*\}/,
      /\$\{\s*process\.env\.MONGO_URI\s*\}/,
      /console\.(log|error)\(\s*(uri|process\.env\.MONGO_URI)\s*[,)]/
    ];

    for (const [arquivo] of DESTRUTIVOS) {
      const codigo = ler(arquivo);
      for (const padrao of INTERPOLA_VALOR) {
        assert.doesNotMatch(
          codigo, padrao,
          `${arquivo}: o VALOR da URI não pode ir para a saída, nem mascarado`
        );
      }
    }
  });

  test("o `--dry-run` da migração NÃO pergunta", () => {
    // É justamente o modo que existe para olhar antes de agir; exigir
    // confirmação nele treinaria a resposta automática.
    const codigo = ler("scripts/migrarTotalParcelas.js");
    assert.match(codigo, /if \(!DRY_RUN\) \{\s*\n\s*await exigirConfirmacaoDeBanco/);
  });

  test("o seed comum NÃO pergunta — só o `--clean`", () => {
    // `seed:fresh` é `reset:dev && seed:demo`, e o reset já pergunta. Guardar o
    // seed comum faria a mesma execução perguntar duas vezes, e pergunta
    // repetida treina a resposta automática.
    const codigo = ler("scripts/seedDemo.js");
    assert.match(codigo, /if \(IS_CLEAN\) \{\s*\n\s*await exigirConfirmacaoDeBanco/);
  });
});
