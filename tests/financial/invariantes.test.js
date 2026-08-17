// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTES DO FINANCEIRO (Parte 1.4 da Fase 4.5, atualizada na F-1a)
//
// O script de invariantes da Auditoria Geral nº 2 vira teste permanente. Ele
// aplica as MESMAS asserções a cada passo de uma cadeia inteira, em vez de
// medir um estado final — é assim que um recálculo incremental errado aparece.
//
// As três invariantes, na forma da F-1a:
//
//   1. `emAberto = max(0, contratado − pagoLiquidoAlocado)` (DEC-040), na
//      ficha do processo, nos dois níveis em que ela soma — e o total do
//      processo é a SOMA das linhas, não uma subtração global. O
//      `saldoAdiantado` NÃO participa: é crédito, sai nomeado.
//
//      A forma anterior (`contratado − pago − saldo`, aceitando negativo) era
//      da F-1a e foi revogada na F-1a.1: o negativo propagava, e o crédito de
//      um honorário abatia a dívida de outro na soma do processo.
//   2. `Installment.valorPago = Σ ALOCAÇÕES ativas da parcela`. O campo é
//      desnormalizado (Fase 4.1) e tem um único ponto de escrita; a soma é
//      REFEITA a cada recálculo, nunca incrementada — é isso que faz o estorno
//      funcionar sem tocar no registro do pagamento.
//   3. `Fee.status` derivado das parcelas (DEC-028), com `cancelado` imune e
//      as parcelas `cancelado` fora do conjunto derivado (DEC-037).
//
// ── Os caminhos que exercitam as invariantes mudaram ──────────────────────
// A Fase 4.5 usava aqui reativar-pagamento e reativar-parcela: as duas rotas
// que mudavam o CONJUNTO sem mudar o valor de um registro, que é a classe de
// operação em que uma soma desnormalizada se perde.
//
// As duas morreram na F-1a (DEC-034). O lugar delas foi tomado pelas operações
// que hoje mexem no conjunto — ESTORNO, ANULAÇÃO de estorno e REPARCELAMENTO —
// que são exatamente da mesma classe e mais difíceis: o estorno desaloca em
// ordem espelhada, e o reparcelamento tira parcelas do conjunto derivado sem
// desativá-las.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarEstorno, anularEstorno,
  criarReparcelamento, esperado
} from "../helpers/setup.js";

const centavos = (n) => Math.round(Number(n) * 100);

describe("invariantes do financeiro", () => {
  let api, processo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("invariantes");
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

  const ficha = async () =>
    esperado(
      await api.get(`/financeiro/processos/${processo._id}`),
      200, "ficha financeira"
    );

  const lerParcela = async (id) =>
    esperado(await api.get(`/installments/${id}`), 200, "leitura de parcela");



  // ── As três invariantes, aplicadas ao estado corrente ────────────────────
  const conferirInvariantes = async (rotulo) => {
    const f = await ficha();

    // 1. emAberto = max(0, contratado − pago), com piso, e o total do
    //    processo é a SOMA das linhas vigentes (DEC-040).
    const vigentes = f.honorarios.filter((h) => h.status !== "cancelado");
    assert.equal(
      vigentes.reduce((acc, h) => acc + centavos(h.totais.emAberto), 0),
      centavos(f.totais.emAberto),
      `${rotulo}: o total do processo não é a soma dos honorários vigentes`
    );
    assert.ok(
      f.totais.emAberto >= 0,
      `${rotulo}: em aberto do processo ficou negativo (${f.totais.emAberto})`
    );

    for (const h of f.honorarios) {
      assert.equal(
        Math.max(0, centavos(h.totais.contratado) - centavos(h.totais.pagoLiquidoAlocado)),
        centavos(h.totais.emAberto),
        `${rotulo}: honorário "${h.descricao}" não fecha`
      );
      assert.ok(
        h.totais.emAberto >= 0,
        `${rotulo}: honorário "${h.descricao}" com em aberto negativo`
      );

      // 2. valorPago = Σ ALOCAÇÕES ativas, parcela a parcela.
      //
      // A ficha já traz as alocações ativas de cada parcela, e é sobre elas que
      // a soma é conferida — não sobre `GET /payments`, que devolve o
      // pagamento inteiro e não o pedaço que encostou nesta parcela.
      for (const p of h.parcelas) {
        const soma = (p.alocacoes ?? []).reduce((acc, a) => acc + centavos(a.valor), 0);
        assert.equal(
          centavos(p.valorPago), soma,
          `${rotulo}: parcela ${p.numeroParcela} tem valorPago ${p.valorPago} ` +
          `e soma de alocações ativas ${soma / 100}`
        );

        assert.equal(
          centavos(p.emAberto), centavos(p.valor) - centavos(p.valorPago),
          `${rotulo}: emAberto da parcela ${p.numeroParcela} não fecha`
        );
      }

      // 3. status derivado — `cancelado` é o único imune ao recálculo, e as
      //    parcelas canceladas por reparcelamento saem do conjunto derivado.
      if (h.status !== "cancelado") {
        const parcelas = h.parcelas.filter((p) => p.status !== "cancelado");
        const quitadas = parcelas.filter((p) => p.status === "pago");
        const comPagamento = parcelas.filter((p) => ["pago", "parcial"].includes(p.status));

        let esperadoStatus = "pendente";
        if (parcelas.length > 0 && quitadas.length === parcelas.length) esperadoStatus = "pago";
        else if (comPagamento.length > 0) esperadoStatus = "parcialmente_pago";

        assert.equal(
          h.status, esperadoStatus,
          `${rotulo}: status de "${h.descricao}" é ${h.status} e as parcelas dizem ${esperadoStatus}`
        );
      }
    }

    return f;
  };

  test("invariantes valem num processo sem honorário nenhum", async () => {
    await conferirInvariantes("processo vazio");
  });

  test("invariantes sobrevivem à cadeia inteira, passo a passo", async () => {
    const honorario = await criarHonorario(api, processo._id, { valor: 1000, tipo: "fixo" });
    await conferirInvariantes("honorário sem parcela");

    const p1 = await criarParcela(api, honorario._id, 1, { valor: 600, dataVencimento: "2026-03-10" });
    const p2 = await criarParcela(api, honorario._id, 2, { valor: 400, dataVencimento: "2026-04-10" });
    await conferirInvariantes("duas parcelas, nenhuma paga");

    // O pagamento nasce contra o HONORÁRIO e o motor aloca no vencimento mais
    // antigo — a p1.
    const { pagamento: pag1 } = await criarPagamento(api, honorario._id, { valor: 300 });
    await conferirInvariantes("pagamento parcial");
    assert.equal((await lerParcela(p1._id)).status, "parcial");

    await criarPagamento(api, honorario._id, { valor: 300 });
    await conferirInvariantes("parcela 1 quitada em dois pagamentos");
    assert.equal((await lerParcela(p1._id)).status, "pago");

    await criarPagamento(api, honorario._id, { valor: 400 });
    const cheia = await conferirInvariantes("tudo quitado");
    const h = cheia.honorarios.find((x) => String(x._id) === String(honorario._id));
    assert.equal(h.status, "pago");
    assert.equal(centavos(h.totais.emAberto), 0);

    // ── Os caminhos que mexem no CONJUNTO (F-1a) ───────────────────────────
    //
    // Estorno e anulação tomaram o lugar de remover-e-reativar pagamento. São
    // da mesma classe — mudam o conjunto que alimenta a soma desnormalizada —
    // e mais exigentes, porque a desalocação percorre as parcelas na ordem
    // ESPELHADA e a anulação re-aloca pela ordem normal.
    const { estorno } = await criarEstorno(api, pag1._id, {
      valor: 300, motivo: "Estorno do primeiro pagamento"
    });
    await conferirInvariantes("depois de estornar um pagamento");

    await anularEstorno(api, pag1._id, estorno._id);
    await conferirInvariantes("depois de ANULAR o estorno");

    // O dinheiro voltou: o honorário está quitado de novo.
    const refeita = await ficha();
    const hRefeito = refeita.honorarios.find((x) => String(x._id) === String(honorario._id));
    assert.equal(
      centavos(hRefeito.totais.pagoLiquidoAlocado) + centavos(hRefeito.totais.saldoAdiantado),
      centavos(1000),
      "a anulação devolveu o valor ao honorário, alocado ou em saldo"
    );
    assert.equal(centavos(hRefeito.totais.emAberto), 0);
    assert.ok(p2, "arranjo: a parcela 2 existe");
  });

  test("invariantes sobrevivem a um REPARCELAMENTO", async () => {
    // Reparcelar é a operação que mais mexe no conjunto: tira parcelas da
    // derivação sem desativá-las (elas viram `cancelado` com vínculo) e cria
    // outras no lugar. Uma soma incremental se perderia aqui.
    const honorario = await criarHonorario(api, processo._id, { valor: 900, tipo: "fixo" });
    await criarParcela(api, honorario._id, 1, { valor: 500, dataVencimento: "2026-03-10" });
    await criarParcela(api, honorario._id, 2, { valor: 400, dataVencimento: "2026-04-10" });
    await conferirInvariantes("arranjo do reparcelamento");

    await criarPagamento(api, honorario._id, { valor: 200 });
    await conferirInvariantes("com um pagamento parcial antes de reparcelar");

    // Saldo em aberto = 900 − 200 = 700, redistribuído em duas de 350.
    await criarReparcelamento(api, honorario._id, [
      { valor: 350, dataVencimento: "2026-06-10" },
      { valor: 350, dataVencimento: "2026-07-10" }
    ]);
    const depois = await conferirInvariantes("depois do reparcelamento");

    const h = depois.honorarios.find((x) => String(x._id) === String(honorario._id));
    assert.equal(
      centavos(h.totais.emAberto), centavos(700),
      "reparcelar redistribui o saldo, não muda quanto se deve"
    );

    // O que foi alocado na parcela cancelada FICA — é histórico, e o saldo
    // renegociado já o descontou.
    const cancelada = h.parcelas.find((p) => p.status === "cancelado" && p.valorPago > 0);
    assert.ok(cancelada, "a parcela parcial foi cancelada com o alocado preservado");
    assert.equal(centavos(cancelada.valorPago), centavos(200));
  });

  test("invariantes sobrevivem a saldo adiantado que ainda não achou parcela", async () => {
    // O crédito existe, tem nome, e NÃO abate a cobrança até encontrar
    // parcela. É o caso que a fórmula da F-1a acertava por acidente.
    const honorario = await criarHonorario(api, processo._id, { valor: 500, tipo: "fixo" });
    await criarPagamento(api, honorario._id, { valor: 500, tipo: "adiantamento" });

    const f = await conferirInvariantes("com saldo adiantado vivo");
    const h = f.honorarios.find((x) => String(x._id) === String(honorario._id));

    assert.equal(centavos(h.totais.saldoAdiantado), centavos(500));
    assert.equal(centavos(h.totais.pagoLiquidoAlocado), 0, "não há parcela para alocar");
    // ── DEC-040 ────────────────────────────────────────────────────────────
    // Era `emAberto: 0`, com o argumento "quem adiantou tudo não deve nada".
    // O número saía certo pelo caminho errado — o crédito era SUBTRAÍDO —, e o
    // mesmo caminho produzia negativo no honorário seguinte. Sem parcela
    // emitida, a cobrança está inteira em aberto; o crédito é o que vai
    // quitá-la quando a parcela nascer, e por isso sai nomeado ao lado.
    assert.equal(centavos(h.totais.emAberto), centavos(500), "a cobrança segue em aberto");

    // E quando a parcela nasce, o saldo migra para ela sem alterar o em aberto.
    await criarParcela(api, honorario._id, 1, { valor: 500, dataVencimento: "2026-05-10" });
    const depois = await conferirInvariantes("depois de a parcela nascer");
    const hDepois = depois.honorarios.find((x) => String(x._id) === String(honorario._id));

    assert.equal(centavos(hDepois.totais.saldoAdiantado), 0, "o saldo achou destino");
    assert.equal(centavos(hDepois.totais.pagoLiquidoAlocado), centavos(500), "e virou alocação");
    assert.equal(centavos(hDepois.totais.emAberto), 0, "o em aberto não se moveu");
  });

  test("honorário cancelado fica fora de `contratado` e imune ao recálculo", async () => {
    const honorario = await criarHonorario(api, processo._id, { valor: 800, tipo: "fixo" });
    await criarParcela(api, honorario._id, 1, { valor: 800, dataVencimento: "2026-05-10" });
    // O pagamento entra ANTES do cancelamento: desde a F-1a, honorário
    // cancelado recusa pagamento com 409.
    await criarPagamento(api, honorario._id, { valor: 800 });

    const antes = await ficha();
    const contratadoAntes = centavos(antes.totais.contratado);

    esperado(
      await api.patch(`/fees/${honorario._id}`, { status: "cancelado" }),
      200, "cancelamento do honorário"
    );

    const depois = await conferirInvariantes("com honorário cancelado");
    const h = depois.honorarios.find((x) => String(x._id) === String(honorario._id));

    assert.equal(h.status, "cancelado", "todas as parcelas quitadas NÃO podem devolvê-lo a `pago`");
    assert.equal(
      centavos(depois.totais.contratado), contratadoAntes - centavos(800),
      "o cancelado sai de `contratado` — somá-lo faria ler como devido o que foi desfeito"
    );
    assert.ok(depois.totais.honorariosCancelados >= 1, "e continua contado à parte");
  });
});
