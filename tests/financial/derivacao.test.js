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
//
// ── O que mudou na Fase F-1a, e o que NÃO mudou ───────────────────────────
// A DEC-028 continua inteira: os quatro estados, a derivação a partir das
// parcelas e a guarda do `cancelado` são exatamente os mesmos. O que mudou é a
// FONTE do número embaixo — `Installment.valorPago` deixou de somar pagamentos
// da parcela e passou a somar ALOCAÇÕES ativas (DEC-035) — e o caminho de
// desfazer, que era `DELETE /payments/:id` e passou a ser ESTORNO (DEC-033).
//
// Os testes de transição de VOLTA foram reescritos sobre o estorno, e não
// apagados: eles existem para provar que o recálculo é REFEITO e não
// incrementado, e essa é a propriedade que continua importando.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarEstorno, criarReparcelamento, esperado
} from "../helpers/setup.js";
import { dadosParcela } from "../helpers/factories.js";

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
      const p1 = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: ONTEM });
      await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });

      // Pagamento PARCIAL de uma parcela já tira o honorário de `pendente`: a
      // tabela diz "nenhuma parcela ativa com pagamento", e esta tem.
      //
      // O pagamento nasce contra o HONORÁRIO (F-1a) e o motor o aloca na
      // parcela de vencimento mais ANTIGO — a p1, que vence ontem.
      await criarPagamento(api, fee._id, { valor: 200 });
      assert.equal((await lerParcela(p1._id)).valorPago, 200, "o motor alocou na mais antiga");
      assert.equal(await statusDo(fee._id), "parcialmente_pago", "200 de 500 na parcela 1");

      // Completar a parcela 1, com a 2 ainda em aberto: continua parcial.
      await criarPagamento(api, fee._id, { valor: 300 });
      assert.equal((await lerParcela(p1._id)).status, "pago");
      assert.equal(await statusDo(fee._id), "parcialmente_pago", "1 de 2 parcelas quitada");
    });

    test("`pago`: todas as parcelas ativas quitadas", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: ONTEM });

      // UM pagamento cobrindo as duas: é o caso que a F-1a destravou, e o
      // resultado derivado é o mesmo que dois pagamentos davam antes.
      await criarPagamento(api, fee._id, { valor: 1000 });

      assert.equal(await statusDo(fee._id), "pago");
    });

    test("as transições de VOLTA, por ESTORNO", async () => {
      // O caminho que um recálculo incremental erraria: desfazer dinheiro tem
      // de puxar o honorário de volta, estado a estado.
      //
      // Até a F-0 o "desfazer" era `DELETE /payments/:id`. A rota morreu
      // (DEC-032) e o caminho passou a ser o estorno — que registra POR QUE o
      // dinheiro voltou em vez de apagar o fato de que entrou. A propriedade
      // sob teste é a mesma: a soma é REFEITA, nunca incrementada.
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: ONTEM });
      await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });

      const { pagamento: pg1 } = await criarPagamento(api, fee._id, { valor: 500 });
      const { pagamento: pg2 } = await criarPagamento(api, fee._id, { valor: 500 });
      assert.equal(await statusDo(fee._id), "pago");

      // pago → parcialmente_pago
      await criarEstorno(api, pg2._id, { valor: 500, motivo: "Estorno do segundo pagamento" });
      assert.equal(await statusDo(fee._id), "parcialmente_pago");

      // parcialmente_pago → pendente
      await criarEstorno(api, pg1._id, { valor: 500, motivo: "Estorno do primeiro pagamento" });
      assert.equal(await statusDo(fee._id), "pendente");

      // E de volta para cima, pelo mesmo caminho.
      await criarPagamento(api, fee._id, { valor: 500 });
      assert.equal(await statusDo(fee._id), "parcialmente_pago");
      await criarPagamento(api, fee._id, { valor: 500 });
      assert.equal(await statusDo(fee._id), "pago");
    });

    test("desativar a única parcela em aberto fecha o honorário", async () => {
      // `deletarInstallment` não passa por `recalcularStatusInstallment` (a
      // parcela deixou de ser ativa e a função devolveria null), então o
      // recálculo do honorário é chamado explicitamente lá. Sem isso o
      // honorário ficaria `parcialmente_pago` para sempre.
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: ONTEM });
      const emAberto = await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });

      // O pagamento cai na parcela 1 (vencimento mais antigo), deixando a 2
      // limpa — e por isso excluível: parcela com alocação ativa recusa com 409.
      await criarPagamento(api, fee._id, { valor: 500 });
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
      // ── A ordem mudou na F-1a, e não é arranjo de teste ──────────────────
      //
      // Antes o honorário nascia `cancelado` e recebia pagamento depois. Desde
      // a F-1a essa sequência é impossível pela API: honorário cancelado
      // RECUSA pagamento com 409, porque registrar dinheiro contra uma cobrança
      // desfeita deixaria um valor recebido pendurado numa dívida que não
      // existe.
      //
      // O estado sob teste continua alcançável — e continua sendo o caso real:
      // o cliente pagou, e SÓ DEPOIS a advogada cancelou a cobrança.
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const p1 = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: ONTEM });
      const p2 = await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });

      await criarPagamento(api, fee._id, { valor: 500 });
      assert.equal(await statusDo(fee._id), "parcialmente_pago");

      await criarPagamento(api, fee._id, { valor: 500 });
      assert.equal(await statusDo(fee._id), "pago", "as duas quitadas");

      esperado(
        await api.patch(`/fees/${fee._id}`, { status: "cancelado" }),
        200, "cancelamento explícito"
      );
      assert.equal(
        await statusDo(fee._id),
        "cancelado",
        "`cancelado` é o único status que a escrita explícita mantém"
      );

      // A guarda tem de sobreviver a um recálculo DISPARADO depois do
      // cancelamento — que é onde ela realmente é posta à prova. Criar uma
      // parcela nova dispara a cadeia inteira.
      await criarParcela(api, fee._id, 3, { valor: 500, dataVencimento: AMANHA });
      assert.equal(
        await statusDo(fee._id),
        "cancelado",
        "o recálculo sobrescreveu `cancelado` — a guarda da DEC-028 caiu"
      );

      // As parcelas, essas sim, são recalculadas normalmente: a guarda é do
      // honorário, e não uma parada geral da cadeia.
      assert.equal((await lerParcela(p1._id)).status, "pago");
      assert.equal((await lerParcela(p2._id)).status, "pago");
    });

    test("descancelar é escrita explícita, e aí a derivação volta a valer", async () => {
      // Contraprova: sem ela, uma guarda que travasse o status para sempre
      // passaria no teste de cima e deixaria o honorário preso.
      const fee = await criarHonorario(api, processo._id, { valor: 400 });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 400, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 400 });

      esperado(await api.patch(`/fees/${fee._id}`, { status: "cancelado" }), 200, "cancelamento");
      assert.equal(await statusDo(fee._id), "cancelado");

      const r = esperado(
        await api.patch(`/fees/${fee._id}`, { status: "pendente" }),
        200, "descancelamento explícito"
      );
      assert.equal(r.status, "pago", "descancelado, o status volta a sair das parcelas — e elas estão quitadas");
      assert.equal((await lerParcela(parcela._id)).status, "pago");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6 e 7 — `valorPago` desnormalizado
  // ═════════════════════════════════════════════════════════════════════════

  describe("6. `valorPago` bate com a soma das alocações ativas", () => {
    test("a soma acompanha cada pagamento, e o estorno reduz", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });

      assert.equal(parcela.valorPago, 0, "parcela nova nasce com valorPago 0");

      const { pagamento: pg1 } = await criarPagamento(api, fee._id, { valor: 400 });
      assert.equal((await lerParcela(parcela._id)).valorPago, 400);

      const { pagamento: pg2 } = await criarPagamento(api, fee._id, { valor: 250.5 });
      assert.equal((await lerParcela(parcela._id)).valorPago, 650.5);

      // Estornar REDUZ a soma: ela é refeita a cada recálculo a partir das
      // alocações ativas, e não incrementada — é isso que faz o estorno
      // funcionar sem tocar no registro do pagamento.
      await criarEstorno(api, pg1._id, { valor: 400, motivo: "Estorno do primeiro" });
      assert.equal((await lerParcela(parcela._id)).valorPago, 250.5);

      await criarEstorno(api, pg2._id, { valor: 250.5, motivo: "Estorno do segundo" });
      assert.equal((await lerParcela(parcela._id)).valorPago, 0);
    });

    test("centavos não acumulam resíduo de float", async () => {
      // 0,1 + 0,2 em float dá 0,30000000000000004. Numa ficha financeira isso
      // vira "em aberto: R$ 0,00000000001" na tela da advogada.
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1, dataVencimento: AMANHA });

      await criarPagamento(api, fee._id, { valor: 0.1 });
      await criarPagamento(api, fee._id, { valor: 0.2 });

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
      await criarPagamento(api, fee._id, { valor: 100 });

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
      await criarPagamento(api, fee._id, { valor: 700 });

      const r = await api.patch(`/installments/${parcela._id}`, { valorPago: 0 });
      assert.equal(r.status, 400, `esperado 400 — ${JSON.stringify(r.body)}`);
      assert.equal((await lerParcela(parcela._id)).valorPago, 700);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 8 — O 409 de excedente FOI REVOGADO, e o que o substituiu
  // ═════════════════════════════════════════════════════════════════════════

  describe("8. o excedente deixou de ser erro e virou alocação (DEC-035/036)", () => {
    // ── O teste antigo NÃO foi apagado: foi INVERTIDO ────────────────────────
    //
    // Até a F-0, pagar mais do que a parcela comportava respondia 409
    // `pagamentoExcedeParcela`, com `saldoDisponivel`, `valorParcela` e
    // `campo: "valorPago"`. A regra caiu com a DEC-035, e caiu de propósito:
    // ela recusava um fato. O cliente depositou 3.500 numa cobrança de 3.000, e
    // o sistema mandava a advogada registrar outra coisa — o depósito real não
    // existia em lugar nenhum.
    //
    // Agora o excedente atravessa as parcelas seguintes e o que sobrar vira
    // `saldoAdiantado`. Nada se perde e nada é inventado.
    //
    // O teste fica aqui, no lugar do antigo e com o mesmo número, para que o
    // histórico mostre a transição deliberada em vez de um teste que sumiu —
    // mesmo padrão do teste que a Fase 4.1 inverteu em `chain.test.js`.

    test("pagar mais que a parcela NÃO é mais 409: atravessa e sobra vira saldo", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const p1 = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 700 });

      // Antes: 409, porque 700 + 350 passa dos 1000. Agora: 201.
      const { pagamento, sobra, saldoAdiantado } = await criarPagamento(api, fee._id, {
        valor: 350
      });

      assert.ok(pagamento._id, "o pagamento foi registrado, e não recusado");
      assert.equal((await lerParcela(p1._id)).valorPago, 1000, "a parcela quitou");
      assert.equal((await lerParcela(p1._id)).status, "pago");
      assert.equal(sobra, 50, "os 50 que não coubem na parcela");
      assert.equal(saldoAdiantado, 50, "e ficam visíveis no honorário");
    });

    test("a regra `pagamentoExcedeParcela` não existe mais em resposta nenhuma", async () => {
      // Contraprova direta: se alguém reintroduzir a guarda antiga, este teste
      // cai. Sem ele, o 409 poderia voltar sem nada acusar — e voltaria
      // quebrando o caso que a DEC-036 existe para atender.
      const fee = await criarHonorario(api, processo._id, { valor: 500 });
      await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });

      const r = await api.post("/payments", {
        honorarioId: fee._id,
        valor: 999999,
        data: "2026-05-10",
        formaPagamento: "pix"
      });

      assert.equal(r.status, 201, `esperado 201 — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.saldoAdiantado, 999499, "999999 − 500 ficam em saldo");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 9 — EMENDA DE 17/08/2026 À DEC-028 (F-1a.2, achado A-4)
  //     O status olha o PAGO DO HONORÁRIO, não só as parcelas vigentes
  // ═════════════════════════════════════════════════════════════════════════

  describe("9. emenda de 17/08/2026 — o pago do honorário entra na derivação", () => {
    test("A-4: honorário reparcelado com pago > 0 é `parcialmente_pago`, não `pendente`", async () => {
      // ── O DEFEITO OBSERVADO ──────────────────────────────────────────────
      // Ficha da "Ação de Cobrança de Dívida", honorário "Assessoria
      // tributária — processo administrativo": a tela exibia
      // **"Recebido: R$ 1.500,00"** e o badge **"Pendente"**, contradição na
      // mesma linha do mesmo honorário.
      //
      // A causa: depois do reparcelamento, o dinheiro vive nas parcelas
      // CANCELADAS COM VÍNCULO, e a derivação filtrava as canceladas fora —
      // sobrava "tudo pendente". Os números do seed, reproduzidos.
      const fee = await criarHonorario(api, processo._id, {
        valor: 7500, descricao: "Assessoria tributária — processo administrativo"
      });
      await criarParcela(api, fee._id, 1, { valor: 3750, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 3750, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 1500 }); // parcela 1 → parcial

      assert.equal(await statusDo(fee._id), "parcialmente_pago", "arranjo");

      // Saldo em aberto = 7.500 − 1.500 = 6.000, em três de 2.000.
      await criarReparcelamento(api, fee._id, [
        { valor: 2000, dataVencimento: "2026-07-15" },
        { valor: 2000, dataVencimento: "2026-08-15" },
        { valor: 2000, dataVencimento: "2026-09-15" }
      ]);

      assert.equal(
        await statusDo(fee._id), "parcialmente_pago",
        "o honorário recebeu 1.500 — chamá-lo de `pendente` contradiz a própria ficha"
      );

      // E as duas leituras precisam SAIR DA MESMA FONTE, que é o ponto da
      // emenda: o badge e a linha "Recebido" não podem mais divergir.
      const ficha = esperado(
        await api.get(`/financeiro/processos/${processo._id}`), 200, "ficha do processo"
      );
      const linha = ficha.honorarios.find((h) => String(h._id) === String(fee._id));
      assert.equal(Math.round(linha.totais.pagoLiquidoAlocado * 100), 150000, "Recebido = 1.500,00");
      assert.equal(linha.status, "parcialmente_pago", "e o badge concorda com ele");

      // As parcelas VIGENTES continuam todas sem pagamento — é justamente por
      // isso que a derivação antiga errava, e o teste precisa dizer isso.
      const vigentes = linha.parcelas.filter((p) => p.status !== "cancelado");
      assert.equal(vigentes.length, 3, "as três novas");
      assert.ok(
        vigentes.every((p) => Number(p.valorPago) === 0),
        "nenhuma parcela vigente tem pagamento — o dinheiro está na cancelada"
      );
    });

    test("regressão: `pago` continua exigindo EM ABERTO ZERO nas vigentes", async () => {
      // O dinheiro em parcela cancelada tira o honorário de `pendente`; ele
      // NUNCA o promove a `pago`. Sem esta trava, a emenda transformaria
      // qualquer honorário reparcelado com pagamento antigo em quitado.
      const fee = await criarHonorario(api, processo._id, { valor: 2000, descricao: "Reparcelado e ainda devendo" });
      await criarParcela(api, fee._id, 1, { valor: 2000, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 500 });

      await criarReparcelamento(api, fee._id, [
        { valor: 1500, dataVencimento: "2026-07-15" }
      ]);

      assert.equal(
        await statusDo(fee._id), "parcialmente_pago",
        "há 1.500 em aberto na parcela nova: `pago` seria falso"
      );

      // Quitando a parcela nova, aí sim.
      await criarPagamento(api, fee._id, { valor: 1500 });
      assert.equal(await statusDo(fee._id), "pago", "agora o em aberto é zero");
    });

    test("regressão: `cancelado` não é sobrescrito, nem com pago > 0", async () => {
      // A guarda da DEC-028 é um `return` próprio em `recalcularStatusFee`,
      // acima da derivação, e a emenda não a tocou. Este é o caso do seed
      // (Custas administrativas de 800, pagas e depois canceladas): pela regra
      // derivada seria `pago`; pela emenda, com pago > 0, seria pelo menos
      // `parcialmente_pago`. Precisa continuar `cancelado` nos dois caminhos.
      const fee = await criarHonorario(api, processo._id, {
        valor: 800, tipo: "custas", descricao: "Custas administrativas — taxas e emolumentos"
      });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 800, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 800 });

      esperado(await api.patch(`/fees/${fee._id}`, { status: "cancelado" }), 200, "cancelamento");
      assert.equal(await statusDo(fee._id), "cancelado", "arranjo");

      // Um recálculo FORÇADO depois do cancelamento: tocar a parcela dispara
      // `recalcularStatusInstallment` → `recalcularStatusFee`, que é onde a
      // guarda mora. Sem disparar a cadeia, o teste provaria só que ninguém
      // escreveu no campo — e não é isso que está em jogo.
      esperado(await api.patch(`/installments/${parcela._id}`, { valor: 800 }), 200, "toque na parcela");

      assert.equal(
        await statusDo(fee._id), "cancelado",
        "a guarda da DEC-028 caiu: honorário cancelado voltou a ser derivado"
      );
    });
  });
});
