// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTES DO FINANCEIRO (Parte 1.4 da Fase 4.5)
//
// O script de invariantes da Auditoria Geral nº 2 vira teste permanente, agora
// exercitando também os caminhos que a 4.5 criou — reativar pagamento e
// reativar parcela.
//
// As três invariantes:
//
//   1. `contratado − pago = emAberto`, na ficha financeira do processo, nos
//      três níveis em que ela soma.
//   2. `Installment.valorPago = Σ pagamentos ATIVOS da parcela`. O campo é
//      desnormalizado (Fase 4.1) e tem um único ponto de escrita; a soma é
//      REFEITA a cada recálculo, nunca incrementada — é isso que faz pagamento
//      desativado sair da conta.
//   3. `Fee.status` derivado das parcelas (DEC-028), com `cancelado` imune.
//
// ── Por que os caminhos novos entram aqui ─────────────────────────────────
// Reativação é escrita que muda o CONJUNTO (a parcela volta ao honorário, o
// pagamento volta à parcela), não o valor de um registro. É exatamente a classe
// de operação em que uma soma desnormalizada se perde — e `valorPago` é
// desnormalizado. Sem estas asserções, a Fase 4.5 teria criado duas rotas
// capazes de deixar a ficha financeira mentindo.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, esperado
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

  const pagamentosAtivosDa = async (installmentId) => {
    const lista = esperado(
      await api.get(`/payments?installmentId=${installmentId}&limit=100`),
      200, "pagamentos da parcela"
    );
    return lista.data;
  };

  // ── As três invariantes, aplicadas ao estado corrente ────────────────────
  const conferirInvariantes = async (rotulo) => {
    const f = await ficha();

    // 1. contratado − pago = emAberto, no total e em cada honorário
    assert.equal(
      centavos(f.totais.contratado) - centavos(f.totais.pago),
      centavos(f.totais.emAberto),
      `${rotulo}: totais da ficha não fecham (contratado − pago ≠ emAberto)`
    );

    for (const h of f.honorarios) {
      assert.equal(
        centavos(h.totais.contratado) - centavos(h.totais.pago),
        centavos(h.totais.emAberto),
        `${rotulo}: honorário "${h.descricao}" não fecha`
      );

      // 2. valorPago = Σ pagamentos ativos, parcela a parcela
      for (const p of h.parcelas) {
        const ativos = await pagamentosAtivosDa(p._id);
        const soma = ativos.reduce((acc, x) => acc + centavos(x.valorPago), 0);
        assert.equal(
          centavos(p.valorPago), soma,
          `${rotulo}: parcela ${p.numeroParcela} tem valorPago ${p.valorPago} ` +
          `e soma de pagamentos ativos ${soma / 100}`
        );

        assert.equal(
          centavos(p.emAberto), centavos(p.valor) - centavos(p.valorPago),
          `${rotulo}: emAberto da parcela ${p.numeroParcela} não fecha`
        );
      }

      // 3. status derivado — `cancelado` é o único imune ao recálculo
      if (h.status !== "cancelado") {
        const parcelas = h.parcelas;
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

    const p1 = await criarParcela(api, honorario._id, 1, { valor: 600 });
    const p2 = await criarParcela(api, honorario._id, 2, { valor: 400 });
    await conferirInvariantes("duas parcelas, nenhuma paga");

    const pag1 = await criarPagamento(api, p1._id, { valorPago: 300 });
    await conferirInvariantes("pagamento parcial");
    assert.equal((await lerParcela(p1._id)).status, "parcial");

    await criarPagamento(api, p1._id, { valorPago: 300 });
    await conferirInvariantes("parcela 1 quitada em dois pagamentos");
    assert.equal((await lerParcela(p1._id)).status, "pago");

    await criarPagamento(api, p2._id, { valorPago: 400 });
    const cheia = await conferirInvariantes("tudo quitado");
    const h = cheia.honorarios.find((x) => String(x._id) === String(honorario._id));
    assert.equal(h.status, "pago");
    assert.equal(centavos(h.totais.emAberto), 0);

    // ── Os caminhos NOVOS da Fase 4.5 ─────────────────────────────────────
    esperado(await api.delete(`/payments/${pag1._id}`), 200, "remoção de um pagamento");
    await conferirInvariantes("depois de remover um pagamento");

    esperado(await api.patch(`/payments/${pag1._id}/reativar`), 200, "reativação do pagamento");
    await conferirInvariantes("depois de REATIVAR o pagamento");
  });

  test("invariantes sobrevivem a remover e reativar uma parcela inteira", async () => {
    const honorario = await criarHonorario(api, processo._id, { valor: 900, tipo: "fixo" });
    const p1 = await criarParcela(api, honorario._id, 1, { valor: 500 });
    await criarParcela(api, honorario._id, 2, { valor: 400 });
    const pag = await criarPagamento(api, p1._id, { valorPago: 500 });

    await conferirInvariantes("arranjo da parcela");

    // Remover a parcela exige remover o pagamento antes (409 de integridade).
    const bloqueado = await api.delete(`/installments/${p1._id}`);
    assert.equal(bloqueado.status, 409, "parcela com pagamento ativo não sai");
    assert.equal(bloqueado.body.dependencia, "pagamentos");

    esperado(await api.delete(`/payments/${pag._id}`), 200, "remoção do pagamento");
    esperado(await api.delete(`/installments/${p1._id}`), 200, "remoção da parcela");
    await conferirInvariantes("parcela fora do conjunto");

    esperado(await api.patch(`/installments/${p1._id}/reativar`), 200, "reativação da parcela");
    await conferirInvariantes("parcela de volta, sem pagamento");

    esperado(await api.patch(`/payments/${pag._id}/reativar`), 200, "reativação do pagamento");
    await conferirInvariantes("pagamento de volta sobre a parcela reativada");

    const f = await ficha();
    const h = f.honorarios.find((x) => String(x._id) === String(honorario._id));
    const parcela = h.parcelas.find((p) => p.numeroParcela === 1);
    assert.equal(centavos(parcela.valorPago), centavos(500), "o valorPago foi refeito, não perdido");
  });

  test("honorário cancelado fica fora de `contratado` e imune ao recálculo", async () => {
    const honorario = await criarHonorario(api, processo._id, { valor: 800, tipo: "fixo" });
    const parcela = await criarParcela(api, honorario._id, 1, { valor: 800 });
    await criarPagamento(api, parcela._id, { valorPago: 800 });

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
