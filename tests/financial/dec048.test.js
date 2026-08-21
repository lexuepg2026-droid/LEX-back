// ═══════════════════════════════════════════════════════════════════════════
// DEC-048 — "PARCELA 1 DE 3": O NÚMERO DEPOIS DO REPARCELAMENTO
//
// ── O defeito ────────────────────────────────────────────────────────────
// O reparcelamento CONTINUAVA a numeração. Um honorário de 2 parcelas que
// virava 3 ficava com 1, 2 (canceladas) e **3, 4, 5** (vivas). Para quem lê,
// "parcela 3" de um plano de três é a PRIMEIRA — e a advogada, ao telefone
// com o cliente, precisa dizer "são três parcelas, esta é a primeira".
//
// ── O que impedia recomeçar em 1 ─────────────────────────────────────────
// O índice único `{feeId, numeroParcela}`. O próprio `renegotiationService`
// dizia: "Recomeçar em 1 colidiria na primeira." Ele passou a ser
// `{feeId, planoId, numeroParcela}` — a unicidade vale DENTRO do plano.
//
// ── Os dois campos ───────────────────────────────────────────────────────
//   `planoId`       — a operação que me CRIOU (`null` = plano original).
//                     NÃO confundir com `reparcelamentoId`, que é a operação
//                     que me CANCELOU. Uma parcela cancelada de 2ª geração tem
//                     os dois preenchidos, com valores DIFERENTES.
//   `totalParcelas` — o "de N" CONGELADO. `null` enquanto o plano está aberto
//                     (a advogada cria parcela por parcela); passa a ter valor
//                     quando o plano deixa de ser editável, e aí nunca mais
//                     muda.
//
// ── O problema que a decisão cria, e que ela mesma resolve ───────────────
// Renumerar faz existirem DUAS parcelas nº 1 no mesmo honorário. Referenciar
// por ordinal passa a ser ambíguo — o mesmo defeito que a DEC-045 resolveu
// para pagamentos, e a mesma solução: referência por ATRIBUTO.
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
  criarReparcelamento,
  esperado
} from "../helpers/setup.js";
import { extrairTextoDoPdf } from "../helpers/pdfText.js";

import {
  rotuloDaParcela,
  referenciaDaParcela
} from "../../src/services/installmentReference.js";

// ═══════════════════════════════════════════════════════════════════════════
// 1 — A FUNÇÃO DE REFERÊNCIA (pura, testada como função pura)
// ═══════════════════════════════════════════════════════════════════════════
describe("DEC-048 — a referência da parcela", () => {
  test("a parcela viva diz número, total e vencimento", () => {
    assert.equal(
      referenciaDaParcela({
        numeroParcela: 1, totalParcelas: 3, dataVencimento: "2026-09-15"
      }),
      "parcela 1 de 3, vencendo 15/09/2026"
    );
  });

  test("a cancelada avisa que a história dela acabou", () => {
    assert.equal(
      referenciaDaParcela({
        numeroParcela: 1, totalParcelas: 2,
        dataVencimento: "2026-05-10", status: "cancelado"
      }),
      "parcela 1 de 2, vencendo 10/05/2026 (reparcelada)"
    );
  });

  test("🚨 DUAS parcelas nº 1 do mesmo honorário são distinguíveis SEM id", () => {
    // É o teste central da fase. Se estas duas frases fossem iguais, a DEC-048
    // teria trocado um defeito por outro.
    const cancelada = referenciaDaParcela({
      numeroParcela: 1, totalParcelas: 2,
      dataVencimento: "2026-05-10", status: "cancelado"
    });
    const viva = referenciaDaParcela({
      numeroParcela: 1, totalParcelas: 3,
      dataVencimento: "2026-09-15", status: "pendente"
    });

    assert.notEqual(cancelada, viva, "as duas frases precisam diferir");
    // E não por um caractere no fim: o "de N", o vencimento e o "(reparcelada)"
    // são três diferenças, cada uma legível de relance.
    assert.match(cancelada, /de 2/);
    assert.match(viva, /de 3/);
    assert.match(cancelada, /10\/05\/2026/);
    assert.match(viva, /15\/09\/2026/);
    assert.match(cancelada, /\(reparcelada\)/);
    assert.ok(!/\(reparcelada\)/.test(viva));
  });

  test("o congelado tem precedência sobre o plano vigente", () => {
    // O ponto inteiro da DEC-048: a cancelada de um plano de 2 continua
    // dizendo "de 2" mesmo que o plano de hoje tenha 5.
    assert.equal(
      rotuloDaParcela({ numeroParcela: 1, totalParcelas: 2, totalNoPlanoVigente: 5 }),
      "Parcela 1 de 2"
    );
  });

  test("plano de uma parcela só não ganha `de 1`", () => {
    assert.equal(rotuloDaParcela({ numeroParcela: 1, totalParcelas: 1 }), "Parcela 1");
    assert.equal(rotuloDaParcela({ numeroParcela: 1, totalNoPlanoVigente: 1 }), "Parcela 1");
  });

  test("parcela que não existe mais não vira `parcela 0`", () => {
    // `Number(null)` é 0 e é finito. Sem guarda, a alocação órfã sairia
    // "parcela 0" — que parece um número de parcela e é lido como um.
    assert.equal(referenciaDaParcela({ numeroParcela: null }), "parcela ?");
    assert.equal(referenciaDaParcela({}), "parcela ?");
    assert.equal(rotuloDaParcela({ numeroParcela: null }), "Parcela");
  });

  test("a data sai em pt-BR e em UTC", () => {
    // As datas são gravadas como meia-noite UTC. Sem o fuso fixo, um servidor
    // em fuso negativo escreveria o dia anterior — a parcela venceria um dia
    // antes na frase e no dia certo na tabela.
    assert.match(
      referenciaDaParcela({ numeroParcela: 1, dataVencimento: "2026-01-01" }),
      /01\/01\/2026/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — O REPARCELAMENTO, PELA API
// ═══════════════════════════════════════════════════════════════════════════
describe("DEC-048 — o reparcelamento renumera a partir de 1", () => {
  let api, honorario, parcelasDepois;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("dec048");
    const pf = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
    honorario = await criarHonorario(api, processo._id, {
      descricao: "Honorário que vira três parcelas",
      valor: 6000,
      dataVencimento: "2026-12-01"
    });

    // O plano original: 2 parcelas.
    await criarParcela(api, honorario._id, 1, { valor: 3000, dataVencimento: "2026-05-10" });
    await criarParcela(api, honorario._id, 2, { valor: 3000, dataVencimento: "2026-07-15" });

    // Vira 3.
    await criarReparcelamento(api, honorario._id, [
      { valor: 2000, dataVencimento: "2026-09-15" },
      { valor: 2000, dataVencimento: "2026-10-15" },
      { valor: 2000, dataVencimento: "2026-11-15" }
    ]);

    const lista = esperado(
      await api.get(`/installments?honorarioId=${honorario._id}&limit=100`),
      200, "listagem das parcelas"
    );
    parcelasDepois = lista.data;
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  const vivas = () => parcelasDepois.filter((p) => p.status !== "cancelado");
  const canceladas = () => parcelasDepois.filter((p) => p.status === "cancelado");

  test("as novas numeram 1, 2, 3 — e não 3, 4, 5", () => {
    const numeros = vivas().map((p) => p.numeroParcela).sort((a, b) => a - b);
    assert.deepEqual(numeros, [1, 2, 3], "o plano vigente recomeça em 1");
  });

  test("as novas nascem com o `de N` congelado", () => {
    for (const p of vivas()) {
      assert.equal(p.totalParcelas, 3, `parcela ${p.numeroParcela} sem o total congelado`);
    }
  });

  test("as novas carregam `planoId` — a operação que as criou", () => {
    const planos = new Set(vivas().map((p) => String(p.planoId)));
    assert.equal(planos.size, 1, "as três nasceram no MESMO reparcelamento");
    assert.ok(![...planos][0].includes("null"), "`planoId` não pode ser nulo nas novas");
  });

  test("as canceladas mantêm o número que tinham", () => {
    const numeros = canceladas().map((p) => p.numeroParcela).sort((a, b) => a - b);
    assert.deepEqual(numeros, [1, 2], "a história não é reescrita");
  });

  test("as canceladas congelam o `de N` do plano DELAS", () => {
    for (const p of canceladas()) {
      assert.equal(
        p.totalParcelas, 2,
        `a cancelada ${p.numeroParcela} tem de dizer "de 2", e não "de 3"`
      );
    }
  });

  test("`planoId` e `reparcelamentoId` são campos DIFERENTES", () => {
    // A cancelada de 1ª geração: nasceu no plano original (`planoId` nulo) e
    // morreu no reparcelamento (`reparcelamentoId` preenchido). Confundir os
    // dois foi o que quase fez a migração contar o conjunto errado.
    for (const p of canceladas()) {
      assert.equal(p.planoId ?? null, null, "a cancelada de 1ª geração nasceu no plano original");
      assert.ok(p.reparcelamentoId, "e foi cancelada por um reparcelamento");
    }
  });

  test("🚨 existem DUAS parcelas nº 1, e as frases as distinguem", () => {
    const numero1 = parcelasDepois.filter((p) => p.numeroParcela === 1);
    assert.equal(numero1.length, 2, "é o caso que a DEC-048 cria de propósito");

    const frases = numero1.map((p) =>
      referenciaDaParcela({
        numeroParcela: p.numeroParcela,
        totalParcelas: p.totalParcelas,
        dataVencimento: p.dataVencimento,
        status: p.status
      })
    );
    assert.equal(new Set(frases).size, 2, `frases idênticas: ${JSON.stringify(frases)}`);
  });

  test("o extrato nomeia a parcela na forma nova", async () => {
    // A prova de que a frase chega à tela, e não só existe na função.
    const extrato = esperado(
      await api.get(`/fees/${honorario._id}/statement?limit=100`),
      200, "extrato"
    );
    const linhaRepar = extrato.data.find((e) => e.tipo === "reparcelamento");
    assert.ok(linhaRepar, "o extrato precisa ter a linha do reparcelamento");
    for (const c of linhaRepar.parcelasCanceladas) {
      assert.match(
        c.referencia, /parcela \d+ de \d+, vencendo \d{2}\/\d{2}\/\d{4} \(reparcelada\)/,
        `a parcela cancelada saiu como "${c.referencia}"`
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — 🚨 O RECIBO NÃO MUDA DE SIGNIFICADO DEPOIS DE ENTREGUE
// ═══════════════════════════════════════════════════════════════════════════
//
// É a razão de `totalParcelas` ser um campo GRAVADO e não uma contagem na
// leitura, e é a garantia mais importante da DEC-048.
//
// O defeito real que estava no código: `receiptService` calculava
// `totalDeParcelas` como `countDocuments({feeId, ativo: true})` — a contagem de
// TODAS as gerações. Um recibo emitido em maio, dizendo "parcela 1 de 2",
// passaria a dizer "parcela 1 de 5" depois de um reparcelamento em setembro.
//
// **Recibo que muda de significado depois de entregue ao cliente é o defeito
// mais grave que este projeto já corrigiu.**
describe("DEC-048 — o recibo emitido ANTES do reparcelamento não muda", () => {
  let api, honorario, pagamento;
  let textoAntes;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("dec048recibo");
    const pf = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
    honorario = await criarHonorario(api, processo._id, {
      descricao: "Honorário com recibo emitido antes do reparcelamento",
      valor: 6000,
      dataVencimento: "2026-12-01"
    });

    // Plano original de DUAS parcelas.
    await criarParcela(api, honorario._id, 1, { valor: 3000, dataVencimento: "2026-05-10" });
    await criarParcela(api, honorario._id, 2, { valor: 3000, dataVencimento: "2026-07-15" });

    // A parcela 1 é quitada e o recibo sai — dizendo "de 2".
    // O helper devolve `{ pagamento, alocacoes, ... }` — não o pagamento nu.
    ({ pagamento } = await criarPagamento(api, honorario._id, {
      valor: 3000,
      data: "2026-05-10",
      formaPagamento: "pix"
    }));

    const antes = await api.get(`/payments/${pagamento._id}/recibo`);
    assert.equal(antes.status, 200, `recibo antes: ${JSON.stringify(antes.body)}`);
    textoAntes = extrairTextoDoPdf(antes.bytes);
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  test("antes do reparcelamento, o recibo diz `de 2`", () => {
    assert.match(
      textoAntes, /de 2\b/,
      `o recibo emitido devia falar de um plano de 2 — saiu: ${textoAntes.slice(0, 400)}`
    );
  });

  test("🚨 depois do reparcelamento, o MESMO recibo continua dizendo `de 2`", async () => {
    // A parcela 1 está PAGA, então o reparcelamento não a cancela: ela fica no
    // plano original, e é justamente ela que o recibo nomeia.
    await criarReparcelamento(api, honorario._id, [
      { valor: 1000, dataVencimento: "2026-09-15" },
      { valor: 1000, dataVencimento: "2026-10-15" },
      { valor: 1000, dataVencimento: "2026-11-15" }
    ]);

    // Agora o honorário tem 5 parcelas ativas (2 do plano original + 3 novas).
    // Contar na leitura diria "de 5"; o congelado diz "de 2".
    const depois = await api.get(`/payments/${pagamento._id}/recibo`);
    assert.equal(depois.status, 200, `recibo depois: ${JSON.stringify(depois.body)}`);
    const textoDepois = extrairTextoDoPdf(depois.bytes);

    assert.match(
      textoDepois, /de 2\b/,
      "o recibo passou a nomear outro plano — o `de N` está sendo CONTADO na " +
      "leitura em vez de lido do campo congelado"
    );
    assert.ok(
      !/de 5\b/.test(textoDepois),
      "o recibo somou as gerações: é exatamente o defeito que a DEC-048 corrigiu"
    );
  });
});
