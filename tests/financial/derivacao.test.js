// ═══════════════════════════════════════════════════════════════════════════
// DEC-028 — STATUS DERIVADO E `valorPago` DESNORMALIZADO
//
// Até a Fase 3.2, `Fee.status` só mudava por escrita explícita, e havia teste
// travando esse comportamento em `chain.test.js`. A Fase 4.1 o INVERTEU lá, e
// os quatro estados novos vivem aqui.
//
// O teste mais importante do arquivo é o de `cancelado`: pela regra derivada,
// "todas as parcelas quitadas" seria `pago`, e a guarda tem de impedir. Se ela
// cair, um honorário que a advogada cancelou volta a aparecer como recebido.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, esperado
} from "../helpers/setup.js";
import { dadosParcela, dadosPagamento } from "../helpers/factories.js";

const AMANHA = "2099-12-31";
const ONTEM = "2020-01-10";

describe("DEC-028 — status derivado e valorPago", () => {
  let api, cliente, processo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("derivacao");
    cliente = await criarClientePF(api);
    processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const lerHonorario = async (id) =>
    esperado(await api.get(`/fees/${id}`), 200, "leitura de honorário");
  const lerParcela = async (id) =>
    esperado(await api.get(`/installments/${id}`), 200, "leitura de parcela");
  const statusDo = async (id) => (await lerHonorario(id)).status;

  // ═════════════════════════════════════════════════════════════════════════
  // 4 — Os quatro estados, com as transições de ida e volta
  // ═════════════════════════════════════════════════════════════════════════

  describe("4. os quatro estados derivados", () => {
    test("`pendente`: nenhuma parcela ativa com pagamento", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });

      // Sem parcela nenhuma: o comportamento decidido nesta fase. A Fase 2C
      // trata honorário sem parcela como pagamento único; essa parcela única
      // existe e NÃO foi paga, então `pendente`. Nunca `pago`.
      assert.equal(fee.status, "pendente", "honorário sem parcela deveria nascer pendente");

      await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: ONTEM });

      // Uma a vencer e uma vencida, nenhuma paga: continua pendente. Vencimento
      // não é pagamento.
      assert.equal(await statusDo(fee._id), "pendente");
    });

    test("`parcialmente_pago`: ao menos uma parcela paga, nem todas", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const p1 = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });

      // Pagamento PARCIAL de uma parcela já tira o honorário de `pendente`: a
      // tabela diz "nenhuma parcela ativa com pagamento", e esta tem.
      await criarPagamento(api, p1._id, { valorPago: 200 });
      assert.equal(await statusDo(fee._id), "parcialmente_pago", "200 de 500 na parcela 1");

      // Quitar a parcela 1 inteira, com a 2 ainda em aberto: continua parcial.
      await criarPagamento(api, p1._id, { valorPago: 300 });
      assert.equal((await lerParcela(p1._id)).status, "pago");
      assert.equal(await statusDo(fee._id), "parcialmente_pago", "1 de 2 parcelas quitada");
    });

    test("`pago`: todas as parcelas ativas quitadas", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const p1 = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });
      const p2 = await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: ONTEM });

      await criarPagamento(api, p1._id, { valorPago: 500 });
      await criarPagamento(api, p2._id, { valorPago: 500 });

      assert.equal(await statusDo(fee._id), "pago");
    });

    test("as transições de VOLTA, ao desativar pagamento", async () => {
      // O caminho que um recálculo incremental erraria: desfazer um pagamento
      // tem de puxar o honorário de volta, estado a estado.
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const p1 = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });
      const p2 = await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });

      const pg1 = await criarPagamento(api, p1._id, { valorPago: 500 });
      const pg2 = await criarPagamento(api, p2._id, { valorPago: 500 });
      assert.equal(await statusDo(fee._id), "pago");

      // pago → parcialmente_pago
      esperado(await api.delete(`/payments/${pg2._id}`), 200, "desativa o 2º pagamento");
      assert.equal(await statusDo(fee._id), "parcialmente_pago");

      // parcialmente_pago → pendente
      esperado(await api.delete(`/payments/${pg1._id}`), 200, "desativa o 1º pagamento");
      assert.equal(await statusDo(fee._id), "pendente");

      // E de volta para cima, pelo mesmo caminho.
      await criarPagamento(api, p1._id, { valorPago: 500 });
      assert.equal(await statusDo(fee._id), "parcialmente_pago");
      await criarPagamento(api, p2._id, { valorPago: 500 });
      assert.equal(await statusDo(fee._id), "pago");
    });

    test("desativar a única parcela em aberto fecha o honorário", async () => {
      // `deletarInstallment` não passa por `recalcularStatusInstallment` (a
      // parcela deixou de ser ativa e a função devolveria null), então o
      // recálculo do honorário é chamado explicitamente lá. Sem isso o
      // honorário ficaria `parcialmente_pago` para sempre.
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const paga = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });
      const emAberto = await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });

      await criarPagamento(api, paga._id, { valorPago: 500 });
      assert.equal(await statusDo(fee._id), "parcialmente_pago");

      esperado(await api.delete(`/installments/${emAberto._id}`), 200, "desativa a parcela em aberto");
      assert.equal(
        await statusDo(fee._id),
        "pago",
        "com a única parcela em aberto desativada, o que resta está quitado"
      );
    });

    test("o status enviado no corpo é reconciliado com as parcelas", async () => {
      // `status` deixou de ser escrita e virou derivação. O que vem no payload
      // vale como intenção e as parcelas decidem — exceto `cancelado`.
      const fee = await criarHonorario(api, processo._id, { valor: 1000, status: "pago" });
      assert.equal(fee.status, "pendente", "criar como `pago` sem parcela paga não faz o honorário pago");

      const r = esperado(await api.patch(`/fees/${fee._id}`, { status: "pago" }), 200, "PATCH status pago");
      assert.equal(r.status, "pendente", "o update também reconcilia");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5 — `cancelado` NÃO é sobrescrito
  // ═════════════════════════════════════════════════════════════════════════

  describe("5. `cancelado` nunca é sobrescrito pelo recálculo", () => {
    test("honorário cancelado com TODAS as parcelas pagas permanece cancelado", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000, status: "cancelado" });
      assert.equal(fee.status, "cancelado", "`cancelado` é o único status que a escrita explícita mantém");

      const p1 = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });
      const p2 = await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });
      assert.equal(await statusDo(fee._id), "cancelado", "criar parcela não descancelou");

      await criarPagamento(api, p1._id, { valorPago: 500 });
      assert.equal(await statusDo(fee._id), "cancelado", "pagamento parcial não descancelou");

      await criarPagamento(api, p2._id, { valorPago: 500 });
      assert.equal(
        await statusDo(fee._id),
        "cancelado",
        "TODAS as parcelas quitadas: pela regra derivada seria `pago`, e a guarda impede"
      );

      // As parcelas, essas sim, são recalculadas normalmente: a guarda é do
      // honorário, e não uma parada geral da cadeia.
      assert.equal((await lerParcela(p1._id)).status, "pago");
      assert.equal((await lerParcela(p2._id)).status, "pago");
    });

    test("descancelar é escrita explícita, e aí a derivação volta a valer", async () => {
      // Contraprova: sem ela, uma guarda que travasse o status para sempre
      // passaria no teste de cima e deixaria o honorário preso.
      const fee = await criarHonorario(api, processo._id, { valor: 400, status: "cancelado" });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 400, dataVencimento: AMANHA });
      await criarPagamento(api, parcela._id, { valorPago: 400 });
      assert.equal(await statusDo(fee._id), "cancelado");

      const r = esperado(
        await api.patch(`/fees/${fee._id}`, { status: "pendente" }),
        200, "descancelamento explícito"
      );
      assert.equal(r.status, "pago", "descancelado, o status volta a sair das parcelas — e elas estão quitadas");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6 e 7 — `valorPago` desnormalizado
  // ═════════════════════════════════════════════════════════════════════════

  describe("6. `valorPago` bate com a soma dos pagamentos ativos", () => {
    test("a soma acompanha cada pagamento, e desativar reduz", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });

      assert.equal(parcela.valorPago, 0, "parcela nova nasce com valorPago 0");

      const pg1 = await criarPagamento(api, parcela._id, { valorPago: 400 });
      assert.equal((await lerParcela(parcela._id)).valorPago, 400);

      const pg2 = await criarPagamento(api, parcela._id, { valorPago: 250.5 });
      assert.equal((await lerParcela(parcela._id)).valorPago, 650.5);

      // Desativar um pagamento REDUZ a soma: ela é refeita a cada recálculo, e
      // não incrementada — é isso que faz o estorno funcionar.
      esperado(await api.delete(`/payments/${pg1._id}`), 200, "desativa o 1º pagamento");
      assert.equal((await lerParcela(parcela._id)).valorPago, 250.5);

      esperado(await api.delete(`/payments/${pg2._id}`), 200, "desativa o 2º pagamento");
      assert.equal((await lerParcela(parcela._id)).valorPago, 0);
    });

    test("centavos não acumulam resíduo de float", async () => {
      // 0,1 + 0,2 em float dá 0,30000000000000004. Numa ficha financeira isso
      // vira "em aberto: R$ 0,00000000001" na tela da advogada.
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1, dataVencimento: AMANHA });

      await criarPagamento(api, parcela._id, { valorPago: 0.1 });
      await criarPagamento(api, parcela._id, { valorPago: 0.2 });

      assert.equal((await lerParcela(parcela._id)).valorPago, 0.3);
    });
  });

  describe("7. `valorPago` não aceita escrita direta por rota nenhuma", () => {
    test("criar parcela com `valorPago` no corpo → 400", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const r = await api.post("/installments", {
        ...dadosParcela(fee._id, 1, { valor: 1000, dataVencimento: AMANHA }),
        valorPago: 999
      });

      assert.equal(r.status, 400, `esperado 400 — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.campo, "valorPago");
      assert.match(r.body.message, /pagamento/i, "a mensagem tem de apontar o caminho certo");
    });

    test("atualizar parcela com `valorPago` no corpo → 400, nos DOIS verbos", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarPagamento(api, parcela._id, { valorPago: 100 });

      for (const [verbo, chamar] of [
        ["PATCH", (corpo) => api.patch(`/installments/${parcela._id}`, corpo)],
        ["PUT", (corpo) => api.put(`/installments/${parcela._id}`, corpo)]
      ]) {
        const r = await chamar({ valorPago: 999 });
        assert.equal(r.status, 400, `${verbo}: esperado 400 — ${JSON.stringify(r.body)}`);
        assert.equal(r.body.campo, "valorPago", verbo);
      }

      // E o valor real não se moveu.
      assert.equal((await lerParcela(parcela._id)).valorPago, 100);
    });

    test("mandar `valorPago: 0` também é recusado", async () => {
      // Zerar à mão é a tentação mais provável — "só quero corrigir a soma" —
      // e é exatamente o que criaria a segunda fonte de escrita.
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarPagamento(api, parcela._id, { valorPago: 700 });

      const r = await api.patch(`/installments/${parcela._id}`, { valorPago: 0 });
      assert.equal(r.status, 400, `esperado 400 — ${JSON.stringify(r.body)}`);
      assert.equal((await lerParcela(parcela._id)).valorPago, 700);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 8 — O 409 de excedente não regrediu com o campo novo
  // ═════════════════════════════════════════════════════════════════════════

  test("8. o 409 de excedente segue com as 4 chaves e `saldoDisponivel` certo", async () => {
    // Coberto em profundidade em `chain.test.js`. A asserção aqui é sobre a
    // convivência: com `valorPago` desnormalizado ao lado, o saldo continua
    // batendo. Se um dia o 409 passar a ler o campo em vez de somar, é este
    // teste que precisa continuar verde.
    const fee = await criarHonorario(api, processo._id, { valor: 1000 });
    const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
    await criarPagamento(api, parcela._id, { valorPago: 700 });

    const r = await api.post("/payments", dadosPagamento(parcela._id, { valorPago: 350 }));

    assert.equal(r.status, 409, `esperado 409 — ${JSON.stringify(r.body)}`);
    assert.equal(r.body.campo, "valorPago");
    assert.equal(r.body.regra, "pagamentoExcedeParcela");
    assert.equal(r.body.saldoDisponivel, 300);
    assert.equal(r.body.valorParcela, 1000);

    // E o saldo do 409 é o complemento exato do `valorPago` desnormalizado.
    const atual = await lerParcela(parcela._id);
    assert.equal(
      r.body.valorParcela - atual.valorPago,
      r.body.saldoDisponivel,
      "o saldo do 409 e o `valorPago` da parcela discordam"
    );
  });
});
