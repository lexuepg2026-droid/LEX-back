// ═══════════════════════════════════════════════════════════════════════════
// DEC-045 — A REFERÊNCIA DO PAGAMENTO É O QUE O HUMANO RECONHECE
//
// ── O defeito, com o caso real (passo 166 do roteiro) ────────────────────
// Dois pagamentos do mesmo dia saíram referenciados no extrato como **#e66b7a**
// e **#e66b7c** — diferem no ÚLTIMO caractere. A suíte provava que não
// colidiam, e ninguém casava as linhas de relance.
//
// A causa é estrutural, não sorte: os seis últimos hex de um ObjectId são o
// CONTADOR, que incrementa de 1 em 1. Pagamentos criados em sequência sempre
// colidem no prefixo desses seis — que é justamente por onde o olho lê.
//
// ── A decisão ────────────────────────────────────────────────────────────
// O vínculo passa a nomear o pagamento por **valor** e **forma**, além da
// data. O sufixo do id continua existindo para o caso degenerado (mesmo valor,
// mesma forma, mesmo dia), mas deixa de ser a referência principal.
//
// ── O que ESTE arquivo garante ───────────────────────────────────────────
// O CONTRATO: a linha de alocação do extrato carrega `valorPagamento` e
// `formaPagamento`. Sem isso a tela não tem como escrever a frase, e a frase
// escrita a partir de campo ausente diria "R$ 0,00 em undefined". Quem mede a
// frase é `statementEntry.js`, na suíte do frontend — função pura, testada
// como função pura, pela razão de sempre (a suíte é `node --test` sem DOM).
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario,
  criarClientePF,
  criarProcesso,
  criarHonorario,
  criarParcela,
  criarPagamento,
  esperado
} from "../helpers/setup.js";

describe("DEC-045 — o extrato carrega valor e forma do pagamento", () => {
  let api, honorario;
  let pagamentoDinheiro, pagamentoPix;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("dec045");
    const pf = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
    honorario = await criarHonorario(api, processo._id, {
      descricao: "Honorários advocatícios — o caso do passo 166",
      valor: 2000,
      dataVencimento: "2026-12-01"
    });
    await criarParcela(api, honorario._id, 1, { valor: 1000, dataVencimento: "2026-05-10" });
    await criarParcela(api, honorario._id, 2, { valor: 1000, dataVencimento: "2026-06-10" });

    // O CASO DO PASSO 166, refeito: dois pagamentos no MESMO DIA, no MESMO
    // honorário — só que com valores e formas diferentes, que é o que a
    // advogada de fato reconhece.
    pagamentoDinheiro = await criarPagamento(api, honorario._id, {
      valor: 300,
      data: "2026-06-10",
      formaPagamento: "dinheiro"
    });
    pagamentoPix = await criarPagamento(api, honorario._id, {
      valor: 750,
      data: "2026-06-10",
      formaPagamento: "pix"
    });
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const extrato = async () =>
    esperado(await api.get(`/fees/${honorario._id}/statement?limit=100`), 200, "extrato");

  test("cada alocação diz de qual valor e de qual forma o dinheiro veio", async () => {
    const corpo = await extrato();
    const alocacoes = corpo.data.filter((e) => e.tipo === "alocacao");
    assert.ok(alocacoes.length >= 2, "arranjo: os dois pagamentos alocaram");

    for (const a of alocacoes) {
      assert.ok(
        Object.hasOwn(a, "valorPagamento"),
        "a alocação precisa carregar `valorPagamento` — sem ele a frase do " +
        "vínculo não tem como nomear o pagamento"
      );
      assert.ok(Object.hasOwn(a, "formaPagamento"), "a alocação precisa carregar `formaPagamento`");
    }
  });

  test("os dois pagamentos do mesmo dia se distinguem SEM o id", async () => {
    const corpo = await extrato();
    const alocacoes = corpo.data.filter((e) => e.tipo === "alocacao");

    // O par (valor, forma) de cada alocação. É esta dupla que a frase imprime,
    // e é ela que precisa ser distinta — não o sufixo do id.
    const assinaturas = alocacoes.map((a) => `${a.valorPagamento}|${a.formaPagamento}`);
    const distintas = new Set(assinaturas);

    assert.ok(
      distintas.has("300|dinheiro"),
      `o pagamento em dinheiro não apareceu nomeado: ${[...distintas].join(" / ")}`
    );
    assert.ok(
      distintas.has("750|pix"),
      `o pagamento em pix não apareceu nomeado: ${[...distintas].join(" / ")}`
    );

    // A prova negativa, que é a razão da DEC-045: os sufixos de id dos dois
    // pagamentos criados em sequência diferem só no fim.
    const sufixo = (id) => String(id).slice(-6);
    const a = sufixo(pagamentoDinheiro.pagamento._id);
    const b = sufixo(pagamentoPix.pagamento._id);
    assert.notEqual(a, b, "os sufixos não colidem — nunca colidiram");
    assert.equal(
      a.slice(0, 4),
      b.slice(0, 4),
      "e é exatamente por isso que eles não servem de referência: os quatro " +
      "primeiros caracteres do sufixo são iguais, porque os últimos bytes do " +
      "ObjectId são um contador"
    );
  });

  test("alocação vinda de SALDO ADIANTADO não inventa pagamento", async () => {
    // Sem pagamento por trás, `valorPagamento` e `formaPagamento` têm de vir
    // `null` — a tela escreve "de saldo adiantado" nesse caso, e um valor
    // inventado ali afirmaria um pagamento que não aconteceu.
    const corpo = await extrato();
    const deSaldo = corpo.data.filter(
      (e) => e.tipo === "alocacao" && e.origem === "saldoAdiantado"
    );
    for (const a of deSaldo) {
      if (a.pagamentoId === null) {
        assert.equal(a.valorPagamento, null);
        assert.equal(a.formaPagamento, null);
      }
    }
  });

  test("a linha do próprio PAGAMENTO já dizia valor e forma — as duas se casam", async () => {
    const corpo = await extrato();
    const pagamentos = corpo.data.filter((e) => e.tipo === "pagamento");
    const alocacoes = corpo.data.filter((e) => e.tipo === "alocacao" && e.pagamentoId);

    for (const a of alocacoes) {
      const linha = pagamentos.find((p) => String(p.pagamentoId) === String(a.pagamentoId));
      assert.ok(linha, "toda alocação com pagamento tem a linha dele no extrato");
      assert.equal(
        a.valorPagamento,
        linha.valor,
        "o valor citado no vínculo tem de ser o mesmo da linha do pagamento — " +
        "duas leituras do mesmo fato que não batem seriam pior que uma só"
      );
      assert.equal(a.formaPagamento, linha.formaPagamento);
    }
  });
});
