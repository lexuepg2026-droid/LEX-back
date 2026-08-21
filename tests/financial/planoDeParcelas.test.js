// ═══════════════════════════════════════════════════════════════════════════
// O PLANO CRIADO DE UMA VEZ — e o fim da migração como pré-condição do seed
//
// ── O remendo que isto tira ──────────────────────────────────────────────
// `npm run seed:fresh` criava as parcelas uma a uma, por `criarInstallment`,
// que deixa `totalParcelas` em `null` de propósito — a advogada cria parcela
// por parcela pela interface, e quando a primeira nasce ninguém sabe que serão
// três.
//
// Só que o SEED sabe: ele tem o array literal do plano na mão. O resultado de
// gravar incompleto foi que `node scripts/migrarTotalParcelas.js` virou
// pré-condição de todo reset do banco de demonstração, e o roteiro de validação
// passou a repetir as duas linhas em seis passos.
//
// `criarPlanoDeParcelas` é o terceiro instante em que o tamanho do plano é
// conhecido de verdade — os outros dois são a criação e o cancelamento de um
// plano pelo reparcelamento (DEC-048).
//
// ── O que a migração continua sendo ──────────────────────────────────────
// Ela NÃO foi apagada, e não podia ser: existe para dados gravados ANTES da
// DEC-048 e continua necessária em qualquer banco que não tenha sido semeado do
// zero. O que ela deixou de ser é remendo de um seed que gravava incompleto.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario,
  criarClientePF,
  criarProcesso,
  criarHonorario,
  esperado
} from "../helpers/setup.js";
import { criarPlanoDeParcelas } from "../../src/services/installmentService.js";

const ler = (caminho) =>
  readFileSync(fileURLToPath(new URL(`../../${caminho}`, import.meta.url)), "utf8");

const semComentarios = (codigo) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("criarPlanoDeParcelas — o plano nasce com o `de N` congelado", () => {
  let api;
  let usuarioId;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("plano");
    usuarioId = esperado(await api.get("/auth/me"), 200, "id do usuário").usuario.id;
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const montarHonorario = async (rotulo) => {
    const cliente = await criarClientePF(api, { nomeCompleto: `Cliente ${rotulo}` });
    const processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    return criarHonorario(api, processo._id);
  };

  test("as parcelas nascem com `totalParcelas` preenchido e `planoId` nulo", async () => {
    const fee = await montarHonorario("basico");

    const criadas = await criarPlanoDeParcelas(usuarioId, fee._id.toString(), [
      { numeroParcela: 1, valor: 1000, dataVencimento: "2026-09-30" },
      { numeroParcela: 2, valor: 1000, dataVencimento: "2026-10-31" },
      { numeroParcela: 3, valor: 1000, dataVencimento: "2026-11-30" }
    ]);

    assert.equal(criadas.length, 3);

    for (const parcela of criadas) {
      assert.equal(
        parcela.totalParcelas, 3,
        "o `de N` precisa nascer congelado — é o que torna o estado determinístico"
      );
      // `planoId` nulo é o plano ORIGINAL, e é o valor CERTO aqui: só o
      // reparcelamento cria parcela dentro de outro plano.
      assert.equal(parcela.planoId ?? null, null, "plano original");
    }
  });

  test("o rótulo sai completo pela API, sem migração nenhuma", async () => {
    const fee = await montarHonorario("rotulo");
    await criarPlanoDeParcelas(usuarioId, fee._id.toString(), [
      { numeroParcela: 1, valor: 500, dataVencimento: "2026-09-30" },
      { numeroParcela: 2, valor: 500, dataVencimento: "2026-10-31" }
    ]);

    const corpo = esperado(await api.get(`/fees/${fee._id}`), 200, "página do honorário");
    for (const p of corpo.parcelas) {
      assert.equal(p.totalParcelas, 2, "a API devolve o congelado, não um cálculo de leitura");
    }
  });

  test("plano de uma parcela só congela em 1", async () => {
    // N = 1 não ganha "de 1" na tela — mas o campo é gravado do mesmo jeito.
    // Deixá-lo nulo faria a parcela mudar de rótulo se uma segunda nascesse.
    const fee = await montarHonorario("unica");
    const criadas = await criarPlanoDeParcelas(usuarioId, fee._id.toString(), [
      { numeroParcela: 1, valor: 8000, dataVencimento: "2026-09-30" }
    ]);
    assert.equal(criadas[0].totalParcelas, 1);
  });

  test("plano vazio não grava nada e não quebra", async () => {
    const fee = await montarHonorario("vazio");
    assert.deepEqual(await criarPlanoDeParcelas(usuarioId, fee._id.toString(), []), []);
  });

  test("a auto-alocação do saldo adiantado continua disparando (DEC-036)", async () => {
    // O motivo de o seed usar o SERVIÇO e não escrever no model: a alocação
    // automática nasce com a parcela. Escrever direto perderia justamente o que
    // o cenário de demonstração existe para mostrar.
    const fee = await montarHonorario("adiantado");

    esperado(
      await api.post("/payments", {
        honorarioId: fee._id.toString(),
        valor: 1500,
        data: "2026-08-01",
        formaPagamento: "pix"
      }),
      201,
      "pagamento antes de existir parcela"
    );

    await criarPlanoDeParcelas(usuarioId, fee._id.toString(), [
      { numeroParcela: 1, valor: 1000, dataVencimento: "2026-09-30" },
      { numeroParcela: 2, valor: 1000, dataVencimento: "2026-10-31" }
    ]);

    const corpo = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário");
    const porNumero = new Map(corpo.parcelas.map((p) => [p.numeroParcela, p]));

    assert.equal(porNumero.get(1).valorPago, 1000, "a 1ª foi quitada pelo saldo");
    assert.equal(porNumero.get(2).valorPago, 500, "a 2ª recebeu o que sobrou");
    // E o congelamento não atrapalhou a alocação.
    assert.equal(porNumero.get(1).totalParcelas, 2);
  });

  test("congelar de novo não altera nada (idempotente)", async () => {
    const fee = await montarHonorario("idempotente");
    await criarPlanoDeParcelas(usuarioId, fee._id.toString(), [
      { numeroParcela: 1, valor: 100, dataVencimento: "2026-09-30" }
    ]);
    // Uma segunda chamada acrescenta uma parcela nova; o `updateMany` só toca no
    // que ainda está `null`, então o carimbo da primeira não se mexe.
    const segunda = await criarPlanoDeParcelas(usuarioId, fee._id.toString(), [
      { numeroParcela: 2, valor: 100, dataVencimento: "2026-10-31" }
    ]);

    const corpo = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário");
    const porNumero = new Map(corpo.parcelas.map((p) => [p.numeroParcela, p]));
    assert.equal(porNumero.get(1).totalParcelas, 1, "o congelado da primeira NÃO se mexe");
    assert.equal(segunda[0].totalParcelas, 1, "a nova recebe o carimbo do lote dela");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O SEED — que o `seed:fresh` sozinho basta
//
// A execução do seed em si não entra na suíte: `scripts/seedDemo.js` aborta
// fora de `NODE_ENV=development` e escreve no banco de DESENVOLVIMENTO, que é
// remoto e compartilhado. O que se trava aqui é que ele passa pelo serviço —
// e é o serviço que os testes acima exercitam de verdade.
// ═══════════════════════════════════════════════════════════════════════════
describe("seedDemo — grava o plano pelo serviço", () => {
  const seed = semComentarios(ler("scripts/seedDemo.js"));

  test("usa `criarPlanoDeParcelas`, e não mais `criarInstallment` uma a uma", () => {
    assert.match(seed, /criarPlanoDeParcelas/);
    assert.doesNotMatch(
      seed, /\bcriarInstallment\s*\(/,
      "voltou a criar parcela por parcela, e o `de N` volta a nascer vazio"
    );
  });

  test("não escreve parcela direto no model", () => {
    // Dois lugares que sabem criar parcela divergem, e o que se perde na
    // divergência é a auto-alocação do saldo adiantado.
    assert.doesNotMatch(
      seed, /Installment\.create|Installment\.insertMany/,
      "o seed voltou a escrever no model, por fora do serviço"
    );
  });

  test("a migração continua no repositório", () => {
    // Ela deixou de ser pré-condição do seed; não deixou de ser necessária.
    // Qualquer banco gravado antes da DEC-048 ainda precisa dela — e ela
    // também troca o índice único, que só o `dropCollection` do reset dispensa.
    const migracao = ler("scripts/migrarTotalParcelas.js");
    assert.match(migracao, /totalParcelas/);
    assert.match(migracao, /planoId/);
  });
});
