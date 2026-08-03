// ═══════════════════════════════════════════════════════════════════════════
// REATIVAÇÃO EXPLÍCITA E O HONORÁRIO MENTIROSO (Fase 4.5)
//
// Achados 2.2c e 2.5b da Auditoria Geral nº 2.
//
// ── Por que rotas próprias, e não `PATCH { ativo: true }` ─────────────────
// Reativar tem guarda de integridade, e guarda não cabe num campo de update
// genérico: um pagamento só volta se a parcela dele estiver viva, e uma parcela
// só volta se o honorário estiver. Era justamente por não existir este caminho
// que o `ativo` no corpo parecia necessário — e foi por ele que o contorno dos
// achados #1/#2/#11 sobreviveu tanto tempo.
//
// ── O 2.5b, e por que ele é reproduzido por escrita direta ────────────────
// `recalcularStatusInstallment` exigia `ativo: true` ao buscar a parcela e
// devolvia `null` antes de alcançar `recalcularStatusFee`. Resultado: remover o
// pagamento de uma parcela desativada deixava o honorário parado em `pago`.
//
// Depois da Parte 1.1 desta fase, esse estado NÃO é mais alcançável pela API:
// `PATCH { ativo: false }` morreu, `deletarInstallment` já recusava com 409
// havendo pagamento ativo, e a reativação de pagamento exige parcela ativa. Por
// isso o arranjo é montado por escrita direta no banco de teste — ele
// representa uma base corrompida ANTES da 4.5, que é onde a correção ainda
// importa. Reproduzi-lo pela API seria impossível, e omiti-lo deixaria a
// regressão sem rede no dia em que alguém devolver o filtro à busca.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar, conectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, esperado
} from "../helpers/setup.js";

describe("reativação de pagamento e de parcela", () => {
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

  // Arranjo: honorário de 1000, uma parcela de 1000, pagamento integral.
  const arranjoQuitado = async () => {
    const honorario = await criarHonorario(api, processo._id, { valor: 1000, tipo: "fixo" });
    const parcela = await criarParcela(api, honorario._id, 1, { valor: 1000 });
    const pagamento = await criarPagamento(api, parcela._id, { valorPago: 1000 });
    return { honorario, parcela, pagamento };
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — O ciclo do pagamento, com o recálculo subindo até o honorário
  // ═════════════════════════════════════════════════════════════════════════
  test("desativar e reativar pagamento devolve o honorário a `pago`", async () => {
    const { honorario, parcela, pagamento } = await arranjoQuitado();

    assert.equal(await statusDoHonorario(honorario._id), "pago", "arranjo: quitado");

    esperado(await api.delete(`/payments/${pagamento._id}`), 200, "remoção do pagamento");
    assert.equal(
      await statusDoHonorario(honorario._id), "pendente",
      "removido o pagamento, o honorário volta a pendente"
    );

    const r = await api.patch(`/payments/${pagamento._id}/reativar`);
    esperado(r, 200, "reativação do pagamento");

    assert.equal(
      await statusDoHonorario(honorario._id), "pago",
      "reativar o pagamento tem de disparar a cadeia até o honorário"
    );

    const p = esperado(await api.get(`/installments/${parcela._id}`), 200, "leitura da parcela");
    assert.equal(p.status, "pago", "a parcela volta a `pago`");
    assert.equal(p.valorPago, 1000, "`valorPago` é refeito a partir dos pagamentos ativos");
  });

  test("reativar pagamento já ativo é idempotente e responde 200", async () => {
    const { pagamento } = await arranjoQuitado();
    const r = await api.patch(`/payments/${pagamento._id}/reativar`);
    esperado(r, 200, "reativação de pagamento que já estava ativo");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — As guardas de dependência
  // ═════════════════════════════════════════════════════════════════════════
  test("pagamento não volta se a parcela estiver desativada — 409 `dependencia: parcela`", async () => {
    const { parcela, pagamento } = await arranjoQuitado();

    esperado(await api.delete(`/payments/${pagamento._id}`), 200, "remoção do pagamento");
    esperado(await api.delete(`/installments/${parcela._id}`), 200, "remoção da parcela");

    const r = await api.patch(`/payments/${pagamento._id}/reativar`);
    assert.equal(r.status, 409, "reativar pagamento de parcela morta é conflito");
    assert.equal(r.body.dependencia, "parcela", "a chave estruturada nomeia a dependência");
    assert.match(
      r.body.message, /[Rr]eative a parcela/,
      "a mensagem diz o que fazer — recusar sem apontar a saída é beco sem saída"
    );
  });

  test("parcela não volta se o honorário estiver desativado — 409 `dependencia: honorario`", async () => {
    const honorario = await criarHonorario(api, processo._id, { valor: 500, tipo: "fixo" });
    const parcela = await criarParcela(api, honorario._id, 1, { valor: 500 });

    esperado(await api.delete(`/installments/${parcela._id}`), 200, "remoção da parcela");
    esperado(await api.delete(`/fees/${honorario._id}`), 200, "remoção do honorário");

    const r = await api.patch(`/installments/${parcela._id}/reativar`);
    assert.equal(r.status, 409, "reativar parcela de honorário morto é conflito");
    assert.equal(r.body.dependencia, "honorario");
    assert.match(r.body.message, /[Rr]eative o honorário/);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — A cadeia inteira, de baixo para cima
  // ═════════════════════════════════════════════════════════════════════════
  test("reativar parcela e depois pagamento reconstrói o honorário", async () => {
    const { honorario, parcela, pagamento } = await arranjoQuitado();

    esperado(await api.delete(`/payments/${pagamento._id}`), 200, "remoção do pagamento");
    esperado(await api.delete(`/installments/${parcela._id}`), 200, "remoção da parcela");

    esperado(await api.patch(`/installments/${parcela._id}/reativar`), 200, "reativação da parcela");
    assert.equal(
      await statusDoHonorario(honorario._id), "pendente",
      "a parcela volta sem pagamento ativo: o honorário fica pendente"
    );

    esperado(await api.patch(`/payments/${pagamento._id}/reativar`), 200, "reativação do pagamento");
    assert.equal(
      await statusDoHonorario(honorario._id), "pago",
      "com o pagamento de volta, o honorário fecha"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4 — A colisão de `numeroParcela` que NÃO é alcançável
  //
  // O roteiro da fase pedia tratá-la. O índice `{ feeId, numeroParcela }` é
  // único SEM `partialFilterExpression` (`models/Installment.js`), diferente
  // dos de `documento_secao`, que são parciais em `ativo: true`. Sem filtro
  // parcial a parcela desativada NUNCA solta o número: criar outra com o mesmo
  // número falha enquanto a desativada existir, e por isso não há duas para
  // colidir na volta.
  //
  // O teste trava a PREMISSA — se alguém tornar o índice parcial, ele cai e a
  // rede de `verificarNumeroParcelaDuplicado` passa a ser necessária de fato.
  // ═════════════════════════════════════════════════════════════════════════
  test("parcela desativada não solta o número — a colisão na reativação é inalcançável", async () => {
    const honorario = await criarHonorario(api, processo._id, { valor: 800, tipo: "fixo" });
    const parcela = await criarParcela(api, honorario._id, 1, { valor: 800 });

    esperado(await api.delete(`/installments/${parcela._id}`), 200, "remoção da parcela 1");

    // Tentar recriar a parcela 1 com a antiga desativada.
    const r = await api.post("/installments", {
      feeId: honorario._id,
      numeroParcela: 1,
      valor: 800,
      dataVencimento: "2099-12-31",
      status: "pendente"
    });

    assert.equal(
      r.status, 409,
      "o número continua reservado pela parcela desativada — é isto que torna a colisão da reativação impossível"
    );
    assert.equal(r.body.campo, "numeroParcela");

    // E a reativação da original passa, justamente porque ninguém ocupou a vaga.
    esperado(
      await api.patch(`/installments/${parcela._id}/reativar`),
      200,
      "reativação da parcela original"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5 — 2.5b: o honorário mentiroso, sobre base corrompida antes da 4.5
  // ═════════════════════════════════════════════════════════════════════════
  test("remover pagamento de parcela DESATIVADA recalcula o honorário", async () => {
    const { honorario, parcela, pagamento } = await arranjoQuitado();
    assert.equal(await statusDoHonorario(honorario._id), "pago", "arranjo: quitado");

    // Escrita direta: reproduz o que o `PATCH { ativo: false }` produzia antes
    // da 4.5 — parcela inativa com pagamento ATIVO pendurado. Ver o cabeçalho.
    await conectar();
    await mongoose.connection.db.collection("installments").updateOne(
      { _id: new mongoose.Types.ObjectId(String(parcela._id)) },
      { $set: { ativo: false } }
    );

    const pagamentosAtivos = await mongoose.connection.db.collection("payments")
      .countDocuments({ installmentId: new mongoose.Types.ObjectId(String(parcela._id)), ativo: true });
    assert.equal(pagamentosAtivos, 1, "o arranjo precisa ter pagamento ativo sob parcela inativa");

    // O honorário ainda diz `pago`, derivado de um mundo que não existe mais.
    assert.equal(await statusDoHonorario(honorario._id), "pago", "a mentira antes da remoção");

    esperado(await api.delete(`/payments/${pagamento._id}`), 200, "remoção do pagamento");

    assert.equal(
      await statusDoHonorario(honorario._id), "pendente",
      "ANTES da 4.5 ficava `pago`: a cadeia morria no `ativo: true` da busca da parcela"
    );
  });
});
