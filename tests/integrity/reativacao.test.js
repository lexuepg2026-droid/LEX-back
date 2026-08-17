// ═══════════════════════════════════════════════════════════════════════════
// AS ROTAS DE REATIVAÇÃO MORRERAM — DEC-034 (Fase F-1a)
//
// Este arquivo testava as duas rotas de reativação criadas pela Fase 4.5
// (achados 2.2c e 2.5b da Auditoria Geral nº 2). Elas foram REMOVIDAS na F-1a,
// e o arquivo foi reescrito no lugar em vez de apagado — pelo mesmo motivo que
// levou a Fase 4.1 a INVERTER o teste da DEC-028 em `chain.test.js`: o
// histórico do Git precisa mostrar uma transição deliberada, não um teste que
// sumiu numa fase e ninguém notou.
//
// ── Por que morreram ──────────────────────────────────────────────────────
// As duas existiam para desfazer um soft delete. Com o Financeiro 2.0:
//
//   • pagamento não se desativa — ele se ESTORNA (DEC-032/DEC-033), e o
//     estorno se desfaz por ANULAÇÃO. Os dois registram um fato novo em vez de
//     reescrever o antigo; uma rota que devolvesse o pagamento ao ar apagaria
//     o motivo pelo qual ele saiu;
//   • parcela que sai de circulação por decisão da advogada sai por
//     REPARCELAMENTO (DEC-037), cancelada COM `reparcelamentoId`. "Reativar"
//     uma dessas ressuscitaria uma cobrança que foi substituída, ao lado da
//     que a substituiu — as duas somariam, e a advogada cobraria duas vezes.
//
// ── O que este arquivo continua garantindo ────────────────────────────────
// Três coisas, e nenhuma delas é sobre as rotas mortas:
//
//   1. as duas rotas respondem 404, e o `ativo` continua fora de toda
//      allowlist de PATCH — sem isso o contorno que a Fase 4.5 fechou voltaria
//      pela porta dos fundos, agora sem nenhuma rota legítima no lugar dele;
//   2. os caminhos que TOMARAM o lugar delas reconstroem o estado do
//      honorário com a mesma fidelidade;
//   3. as duas premissas ESTRUTURAIS que os testes antigos travavam — o número
//      da parcela desativada continua reservado, e a cadeia de recálculo
//      alcança o honorário mesmo quando a parcela está inativa. As duas
//      seguem valendo e nenhuma delas dependia da reativação.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar, conectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarEstorno, anularEstorno, esperado
} from "../helpers/setup.js";

describe("DEC-034 — as rotas de reativação não existem mais", () => {
  let api, processo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("reativacao");
    const pf = await criarClientePF(api);
    processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const statusDoHonorario = async (id) =>
    esperado(await api.get(`/fees/${id}`), 200, "leitura de honorário").status;

  // Honorário de 800 com uma parcela, quitado por um pagamento.
  const arranjoQuitado = async () => {
    const honorario = await criarHonorario(api, processo._id, { valor: 800, tipo: "fixo" });
    const parcela = await criarParcela(api, honorario._id, 1, {
      valor: 800, dataVencimento: "2099-12-31"
    });
    const { pagamento } = await criarPagamento(api, honorario._id, { valor: 800 });
    return { honorario, parcela, pagamento };
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — As rotas responderam 200 até a F-0 e passam a responder 404
  // ═════════════════════════════════════════════════════════════════════════

  test("PATCH /payments/:id/reativar → 404", async () => {
    const { pagamento } = await arranjoQuitado();
    const r = await api.patch(`/payments/${pagamento._id}/reativar`, {});
    assert.equal(
      r.status, 404,
      `a rota de reativação de pagamento continua respondendo — ${JSON.stringify(r.body)}`
    );
  });

  test("PATCH /installments/:id/reativar → 404", async () => {
    const { parcela } = await arranjoQuitado();
    const r = await api.patch(`/installments/${parcela._id}/reativar`, {});
    assert.equal(
      r.status, 404,
      `a rota de reativação de parcela continua respondendo — ${JSON.stringify(r.body)}`
    );
  });

  test("DELETE /payments/:id → 404 (o par da reativação também morreu)", async () => {
    // As duas eram um par: uma desativava, a outra devolvia. Deixar só a de
    // desativar viva seria pior que ter as duas — dinheiro sairia da conta sem
    // registro e sem volta.
    const { pagamento } = await arranjoQuitado();
    const r = await api.delete(`/payments/${pagamento._id}`);
    assert.equal(r.status, 404, `DELETE de pagamento continua respondendo — ${JSON.stringify(r.body)}`);
  });

  test("`ativo` continua fora da allowlist de PATCH das duas rotas", async () => {
    // A Fase 4.5 tirou `ativo` de toda allowlist E criou as rotas de
    // reativação, como o caminho legítimo. Com as rotas mortas, esta guarda
    // fica ainda mais importante: é a única coisa entre a advogada e um
    // registro financeiro desativado em silêncio, por um campo de formulário.
    const { parcela, pagamento } = await arranjoQuitado();

    for (const [rota, id] of [
      ["payments", pagamento._id],
      ["installments", parcela._id]
    ]) {
      for (const valor of [false, true]) {
        const r = await api.patch(`/${rota}/${id}`, { ativo: valor });
        assert.equal(r.status, 400, `${rota} { ativo: ${valor} }`);
        assert.equal(r.body.campo, "ativo", `${rota}: o 400 precisa nomear o campo`);
      }
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — Os caminhos que tomaram o lugar delas
  // ═════════════════════════════════════════════════════════════════════════

  test("estornar e ANULAR devolve o honorário a `pago`", async () => {
    // Era "desativar e reativar pagamento devolve o honorário a `pago`". A
    // propriedade é a mesma — o estado do honorário é reconstruído por
    // derivação, não guardado —, e o caminho passou a registrar POR QUE o
    // dinheiro saiu e por que voltou.
    const { honorario, pagamento } = await arranjoQuitado();
    assert.equal(await statusDoHonorario(honorario._id), "pago", "arranjo: quitado");

    const { estorno } = await criarEstorno(api, pagamento._id, {
      valor: 800, motivo: "Estorno integral"
    });
    assert.equal(
      await statusDoHonorario(honorario._id), "pendente",
      "o estorno desalocou e o honorário voltou"
    );

    await anularEstorno(api, pagamento._id, estorno._id);
    assert.equal(
      await statusDoHonorario(honorario._id), "pago",
      "a anulação re-alocou e o honorário voltou a `pago`"
    );
  });

  test("a anulação re-aloca pela regra normal, não repõe no estado antigo", async () => {
    // Diferença deliberada em relação à reativação, que devolvia o pagamento
    // exatamente à parcela de onde saiu. Entre o estorno e a anulação o mundo
    // pode ter mudado, e repor no estado antigo criaria alocação em parcela
    // cancelada. Ver o cabeçalho de `reversalService`.
    const honorario = await criarHonorario(api, processo._id, { valor: 1000, tipo: "fixo" });
    await criarParcela(api, honorario._id, 1, { valor: 500, dataVencimento: "2026-03-10" });
    await criarParcela(api, honorario._id, 2, { valor: 500, dataVencimento: "2026-04-10" });

    const { pagamento } = await criarPagamento(api, honorario._id, { valor: 500 });
    const { estorno } = await criarEstorno(api, pagamento._id, {
      valor: 500, motivo: "Estorno para testar a re-alocação"
    });

    await anularEstorno(api, pagamento._id, estorno._id);

    // O valor voltou e encontrou a parcela mais antiga em aberto — que é a
    // mesma de antes, aqui, mas por REGRA e não por memória.
    const ficha = esperado(
      await api.get(`/financeiro/processos/${processo._id}`), 200, "ficha"
    );
    const linha = ficha.honorarios.find((h) => String(h._id) === String(honorario._id));
    assert.equal(linha.totais.pagoLiquidoAlocado, 500, "o valor voltou a estar alocado");
    assert.equal(linha.parcelas.find((p) => p.numeroParcela === 1).valorPago, 500);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — As duas premissas estruturais, que não dependiam da reativação
  // ═════════════════════════════════════════════════════════════════════════

  test("parcela desativada não solta o número", async () => {
    // O índice `{feeId, numeroParcela}` é único SEM `partialFilterExpression`
    // (`models/Installment.js`), diferente dos de `documento_secao`. Sem filtro
    // parcial, a parcela desativada nunca solta o número.
    //
    // A Fase 4.5 travava esta premissa porque era ela que tornava INALCANÇÁVEL
    // a colisão na reativação. A rota morreu, e a premissa continua importando
    // por outro motivo: é ela que faz o REPARCELAMENTO poder numerar as
    // parcelas novas continuando a sequência, em vez de recomeçar em 1 e
    // colidir na primeira.
    const honorario = await criarHonorario(api, processo._id, { valor: 800, tipo: "fixo" });
    const parcela = await criarParcela(api, honorario._id, 1, {
      valor: 800, dataVencimento: "2099-12-31"
    });

    esperado(await api.delete(`/installments/${parcela._id}`), 200, "remoção da parcela 1");

    const r = await api.post("/installments", {
      feeId: honorario._id,
      numeroParcela: 1,
      valor: 800,
      dataVencimento: "2099-12-31"
    });

    assert.equal(
      r.status, 409,
      "o número deixou de ficar reservado — o índice virou parcial, e o reparcelamento passa a poder colidir"
    );
    assert.equal(r.body.campo, "numeroParcela");
  });

  test("a cadeia de recálculo alcança o honorário mesmo com a parcela INATIVA", async () => {
    // Achado 2.5b da Auditoria Geral nº 2: `recalcularStatusInstallment`
    // exigia `ativo: true` ao buscar a parcela e devolvia `null` antes de
    // alcançar `recalcularStatusFee` — o honorário ficava parado em `pago`,
    // derivado de um mundo que não existe mais.
    //
    // O arranjo é montado por ESCRITA DIRETA, e continua sendo: o estado não é
    // alcançável pela API (`PATCH {ativo:false}` morreu na 4.5 e a exclusão de
    // parcela com alocação ativa recusa com 409). Ele representa uma base
    // corrompida, que é onde a correção ainda importa. Omiti-lo deixaria a
    // regressão sem rede no dia em que alguém devolver o filtro à busca.
    const { honorario, parcela, pagamento } = await arranjoQuitado();
    assert.equal(await statusDoHonorario(honorario._id), "pago", "arranjo: quitado");

    await conectar();
    await mongoose.connection.db.collection("installments").updateOne(
      { _id: new mongoose.Types.ObjectId(String(parcela._id)) },
      { $set: { ativo: false } }
    );

    // A alocação continua ativa sob uma parcela inativa — o estado corrompido.
    const alocacoesAtivas = await mongoose.connection.db.collection("alocacoes")
      .countDocuments({
        parcelaId: new mongoose.Types.ObjectId(String(parcela._id)),
        estornoId: null
      });
    assert.equal(alocacoesAtivas, 1, "o arranjo precisa ter alocação ativa sob parcela inativa");

    // O honorário ainda diz `pago`, derivado de um mundo que não existe mais.
    assert.equal(await statusDoHonorario(honorario._id), "pago", "a mentira antes do estorno");

    // O estorno dispara a cadeia. Ela precisa atravessar a parcela inativa e
    // chegar ao honorário.
    await criarEstorno(api, pagamento._id, { valor: 800, motivo: "Estorno sobre base corrompida" });

    assert.equal(
      await statusDoHonorario(honorario._id), "pendente",
      "ANTES da 4.5 ficava `pago`: a cadeia morria no `ativo: true` da busca da parcela"
    );
  });
});
