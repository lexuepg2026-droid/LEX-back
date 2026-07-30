// ═══════════════════════════════════════════════════════════════════════════
// CADEIA FINANCEIRA — recálculo de status, 409 de excedente e integridade.
//
// Honorário → Parcela → Pagamento. É a cadeia onde um erro custa dinheiro real
// da advogada, e onde as três formas de 409 do projeto convivem.
//
// ── Uma correção de premissa, registrada aqui porque o teste é o registro ──
// O roteiro desta fase pedia "status do honorário derivado das parcelas". Ele
// NÃO é. `Fee.status` é enum `pendente|pago|cancelado` (`models/Fee.js:32`) e
// só muda por escrita explícita: nenhum service o recalcula — conferido em
// `feeService.js`, `installmentService.js` e `paymentService.js`.
//
// O que é derivado é `Installment.status`, por `recalcularStatusInstallment`
// (`paymentService.js:72`), nos 4 estados do enum. É esse o recálculo testado
// abaixo. A ausência do recálculo no Fee está reportada, e NÃO foi corrigida:
// o `Fee` é da Fase 4 (DEC-027) e esta fase não altera produção.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarSecao, criarModelo, vincularSecao, esperado
} from "../helpers/setup.js";
import { dadosParcela, dadosPagamento } from "../helpers/factories.js";

// O vocabulário é IMPORTADO, nunca reescrito à mão no teste. É isso que impede
// `parcelas`, `parcela` e `installments` de coexistirem em três fases: quem
// renomear um valor quebra o teste na hora, em vez de o frontend descobrir
// depois que passou a receber uma palavra que não conhece.
import { DEPENDENCIA, DEPENDENCIAS, REGRA_CONFLITO } from "../../src/config/integrityConflicts.js";

const ONTEM = "2020-01-10";     // vencida com folga
const AMANHA = "2099-12-31";    // longe de vencer

describe("cadeia financeira", () => {
  let api;
  let cliente, processo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("financeiro");
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

  const novoHonorario = (extra) => criarHonorario(api, processo._id, extra);
  const lerParcela = async (id) =>
    esperado(await api.get(`/installments/${id}`), 200, "leitura de parcela");
  const lerHonorario = async (id) =>
    esperado(await api.get(`/fees/${id}`), 200, "leitura de honorário");

  // ═════════════════════════════════════════════════════════════════════════
  // 4.1 — Recálculo de status
  // ═════════════════════════════════════════════════════════════════════════

  describe("4.1 recálculo de status da parcela", () => {
    test("os 4 estados do enum: pendente, vencido, parcial, pago", async () => {
      const fee = await novoHonorario();

      // pendente — sem pagamento, vencimento no futuro
      const pendente = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      assert.equal(pendente.status, "pendente", "parcela nova a vencer deveria nascer pendente");

      // vencido — sem pagamento, vencimento no passado
      const vencida = await criarParcela(api, fee._id, 2, { valor: 1000, dataVencimento: ONTEM });
      assert.equal(vencida.status, "vencido", "parcela sem pagamento e vencida deveria ser vencido");

      // parcial — pagamento menor que o valor
      await criarPagamento(api, pendente._id, { valorPago: 400 });
      assert.equal((await lerParcela(pendente._id)).status, "parcial");

      // pago — a soma dos pagamentos alcança o valor
      await criarPagamento(api, pendente._id, { valorPago: 600 });
      const paga = await lerParcela(pendente._id);
      assert.equal(paga.status, "pago");
      assert.ok(paga.dataPagamento, "parcela paga deveria registrar dataPagamento");
    });

    test("a parcela vencida vira paga, e `vencido` não gruda", async () => {
      // O caso que um `if` mal ordenado erra: quitar depois do vencimento tem
      // de virar `pago`, não continuar `vencido`.
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: ONTEM });
      assert.equal(parcela.status, "vencido");

      await criarPagamento(api, parcela._id, { valorPago: 500 });
      assert.equal((await lerParcela(parcela._id)).status, "pago");
    });

    test("desativar o pagamento devolve a parcela ao estado anterior", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });

      const p1 = await criarPagamento(api, parcela._id, { valorPago: 400 });
      const p2 = await criarPagamento(api, parcela._id, { valorPago: 600 });
      assert.equal((await lerParcela(parcela._id)).status, "pago");

      // Volta 1: some o segundo pagamento → parcial (400 de 1000).
      esperado(await api.delete(`/payments/${p2._id}`), 200, "exclusão do 2º pagamento");
      const depoisDeUm = await lerParcela(parcela._id);
      assert.equal(depoisDeUm.status, "parcial", "com 400 de 1000 a parcela é parcial");
      assert.equal(depoisDeUm.dataPagamento, null, "parcela não-paga não guarda dataPagamento");

      // Volta 2: some o primeiro também → pendente (vencimento no futuro).
      esperado(await api.delete(`/payments/${p1._id}`), 200, "exclusão do 1º pagamento");
      assert.equal((await lerParcela(parcela._id)).status, "pendente");
    });

    test("desativar o pagamento de parcela VENCIDA devolve `vencido`, não `pendente`", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 300, dataVencimento: ONTEM });
      const pg = await criarPagamento(api, parcela._id, { valorPago: 300 });
      assert.equal((await lerParcela(parcela._id)).status, "pago");

      esperado(await api.delete(`/payments/${pg._id}`), 200, "exclusão do pagamento");
      assert.equal(
        (await lerParcela(parcela._id)).status,
        "vencido",
        "o estado anterior de uma parcela vencida é `vencido`, não `pendente`"
      );
    });

    test("FATO REPORTADO: `Fee.status` NÃO é derivado das parcelas", async () => {
      // Este teste trava o comportamento REAL, não o desejado. Ele existe para
      // que a Fase 4, ao implementar a derivação (DEC-027), caia aqui e tenha
      // de decidir conscientemente — em vez de a mudança passar despercebida.
      const fee = await novoHonorario({ status: "pendente" });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarPagamento(api, parcela._id, { valorPago: 1000 });

      assert.equal((await lerParcela(parcela._id)).status, "pago", "a parcela foi quitada");
      assert.equal(
        (await lerHonorario(fee._id)).status,
        "pendente",
        "comportamento atual: o honorário continua `pendente` com todas as parcelas pagas"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4.2 — 409 de excedente, com a forma exata
  // ═════════════════════════════════════════════════════════════════════════

  describe("4.2 409 de pagamento que excede a parcela", () => {
    test("as 4 chaves, com `saldoDisponivel` numericamente certo", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarPagamento(api, parcela._id, { valorPago: 700 });

      // Restam 300. Tentar 350 excede em 50.
      const r = await api.post("/payments", dadosPagamento(parcela._id, { valorPago: 350 }));

      assert.equal(r.status, 409, `esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);

      // Este é o ÚNICO 409 do módulo que carrega `campo`, porque é o único com
      // input em conflito de verdade — o valor que ela acabou de digitar. As 4
      // asserções abaixo protegem essa distinção de ser apagada por uma
      // uniformização futura que resolvesse "todo 409 tem dependencia".
      assert.equal(r.body.regra, REGRA_CONFLITO.PAGAMENTO_EXCEDE_PARCELA);
      assert.equal(r.body.regra, "pagamentoExcedeParcela");
      assert.equal(r.body.campo, "valorPago");
      assert.equal(r.body.saldoDisponivel, 300, "1000 de parcela menos 700 já pagos = 300");
      assert.equal(r.body.valorParcela, 1000);

      assert.equal(typeof r.body.saldoDisponivel, "number", "saldoDisponivel tem de ser número, não string");
      assert.equal(typeof r.body.valorParcela, "number");

      // E NÃO leva as chaves de integridade: não é contagem de dependente.
      assert.equal(r.body.dependencia, undefined, "409 de regra não carrega `dependencia`");
      assert.equal(r.body.quantidade, undefined, "409 de regra não carrega `quantidade`");
    });

    test("pagar exatamente o saldo é aceito; um centavo a mais não", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 100, dataVencimento: AMANHA });
      await criarPagamento(api, parcela._id, { valorPago: 99.5 });

      const excedente = await api.post("/payments", dadosPagamento(parcela._id, { valorPago: 0.51 }));
      assert.equal(excedente.status, 409);
      assert.equal(excedente.body.saldoDisponivel, 0.5);

      const exato = await api.post("/payments", dadosPagamento(parcela._id, { valorPago: 0.5 }));
      assert.equal(exato.status, 201, `pagar o saldo exato deveria ser aceito — ${JSON.stringify(exato.body)}`);
      assert.equal((await lerParcela(parcela._id)).status, "pago");
    });

    test("o saldo desconta apenas pagamentos ATIVOS", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      const pg = await criarPagamento(api, parcela._id, { valorPago: 900 });

      // Com o pagamento ativo, 200 excede.
      assert.equal((await api.post("/payments", dadosPagamento(parcela._id, { valorPago: 200 }))).status, 409);

      // Desativado, o saldo volta a ser o valor cheio.
      esperado(await api.delete(`/payments/${pg._id}`), 200, "exclusão do pagamento");
      const agora = await api.post("/payments", dadosPagamento(parcela._id, { valorPago: 200 }));
      assert.equal(agora.status, 201, "pagamento desativado não deveria mais consumir saldo");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4.3 — Integridade no soft delete
  // ═════════════════════════════════════════════════════════════════════════

  describe("4.3 409 de integridade no soft delete", () => {
    // Asserção comum às quatro: forma exata e vocabulário fechado.
    const assertIntegridade = (r, dependenciaEsperada, quantidadeEsperada, contexto) => {
      assert.equal(r.status, 409, `${contexto}: esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.dependencia, dependenciaEsperada, `${contexto}: dependencia errada`);
      assert.equal(r.body.quantidade, quantidadeEsperada, `${contexto}: quantidade errada`);
      assert.equal(typeof r.body.quantidade, "number", `${contexto}: quantidade tem de ser número`);

      // O vocabulário é fechado: valor fora da lista é defeito, mesmo que a
      // palavra pareça razoável.
      assert.ok(
        DEPENDENCIAS.includes(r.body.dependencia),
        `${contexto}: "${r.body.dependencia}" não está no vocabulário fechado (${DEPENDENCIAS.join(", ")})`
      );

      // `campo` NÃO entra em 409 de integridade: não há input em conflito, e
      // sim registros já gravados. Mandar a tela destacar um campo que não tem
      // nada de errado é pior que não destacar nada.
      assert.equal(r.body.campo, undefined, `${contexto}: 409 de integridade não leva \`campo\``);

      // A prosa continua existindo e citando o número — é o que a advogada lê.
      assert.match(r.body.message, new RegExp(String(quantidadeEsperada)), `${contexto}: a mensagem deveria citar a quantidade`);
    };

    test("honorário com parcelas ativas → `parcelas`, com a quantidade exata", async () => {
      const fee = await novoHonorario();
      const p1 = await criarParcela(api, fee._id, 1, { dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 3, { dataVencimento: AMANHA });

      // 3 dependentes ativos → quantidade: 3
      const com3 = await api.delete(`/fees/${fee._id}`);
      assertIntegridade(com3, DEPENDENCIA.PARCELAS, 3, "honorário com 3 parcelas");
      assert.equal(com3.body.dependencia, "parcelas");

      // Desative uma → quantidade: 2. A contagem tem de ser a real, não um
      // "existem parcelas" genérico: a tela da Fase 4 vai escrever o número.
      esperado(await api.delete(`/installments/${p1._id}`), 200, "exclusão da parcela 1");
      const com2 = await api.delete(`/fees/${fee._id}`);
      assertIntegridade(com2, DEPENDENCIA.PARCELAS, 2, "honorário com 2 parcelas");
    });

    test("parcela com pagamentos ativos → `pagamentos`", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarPagamento(api, parcela._id, { valorPago: 300 });
      await criarPagamento(api, parcela._id, { valorPago: 200 });

      const r = await api.delete(`/installments/${parcela._id}`);
      assertIntegridade(r, DEPENDENCIA.PAGAMENTOS, 2, "parcela com 2 pagamentos");
      assert.equal(r.body.dependencia, "pagamentos");
    });

    test("cliente que participa de processo ativo → `processos`", async () => {
      const r = await api.delete(`/clients/${cliente._id}`);
      assertIntegridade(r, DEPENDENCIA.PROCESSOS, 1, "cliente em 1 processo");
      assert.equal(r.body.dependencia, "processos");
    });

    test("seção vinculada a documento ativo → `documentos`", async () => {
      const secao = await criarSecao(api, { texto: "Seção que vai ficar presa a um modelo." });
      const modelo = await criarModelo(api);
      await vincularSecao(api, modelo._id, secao._id);

      const r = await api.delete(`/secoes/${secao._id}`);
      assertIntegridade(r, DEPENDENCIA.DOCUMENTOS, 1, "seção em 1 documento");
      assert.equal(r.body.dependencia, "documentos");
    });

    test("o vocabulário fechado tem exatamente os 4 valores, e o teste os conhece", () => {
      // Se alguém acrescentar um quinto valor sem acrescentar teste, este cai.
      assert.deepEqual(
        [...DEPENDENCIAS].sort(),
        ["documentos", "pagamentos", "parcelas", "processos"]
      );
    });

    test("com todos os filhos desativados, a cadeia inteira exclui com 200", async () => {
      // A auditoria confirmou isto à mão. Aqui fica travado, de baixo para
      // cima: pagamento → parcela → honorário → processo → cliente.
      const proprio = await criarClientePF(api);
      const proc = await criarProcesso(api, [
        { clienteId: proprio._id, papel: "autor", principal: true }
      ]);
      const fee = await criarHonorario(api, proc._id);
      const parcela = await criarParcela(api, fee._id, 1, { valor: 500, dataVencimento: AMANHA });
      const pagamento = await criarPagamento(api, parcela._id, { valorPago: 500 });

      esperado(await api.delete(`/payments/${pagamento._id}`), 200, "exclusão do pagamento");
      esperado(await api.delete(`/installments/${parcela._id}`), 200, "exclusão da parcela");
      esperado(await api.delete(`/fees/${fee._id}`), 200, "exclusão do honorário");
      esperado(await api.delete(`/processes/${proc._id}`), 200, "exclusão do processo");
      esperado(await api.delete(`/clients/${proprio._id}`), 200, "exclusão do cliente");

      // E some das leituras, porque soft delete filtra `ativo: true`.
      assert.equal((await api.get(`/clients/${proprio._id}`)).status, 404);
      assert.equal((await api.get(`/fees/${fee._id}`)).status, 404);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4.4 — `ativo: true` no filtro de dependência
  //
  // O defeito que a auditoria suspeitou e descartou: contar dependente
  // DESATIVADO bloquearia a exclusão para sempre, e o único jeito de sair
  // seria mexer no banco à mão. O teste existe para que ninguém o reintroduza
  // ao "simplificar" um `countDocuments`.
  // ═════════════════════════════════════════════════════════════════════════

  describe("4.4 dependente desativado não bloqueia exclusão", () => {
    test("honorário cujas parcelas foram todas desativadas exclui com 200", async () => {
      const fee = await novoHonorario();
      const p1 = await criarParcela(api, fee._id, 1, { dataVencimento: AMANHA });
      const p2 = await criarParcela(api, fee._id, 2, { dataVencimento: AMANHA });

      assert.equal((await api.delete(`/fees/${fee._id}`)).status, 409, "com 2 parcelas ativas, bloqueia");

      esperado(await api.delete(`/installments/${p1._id}`), 200, "exclusão da parcela 1");
      esperado(await api.delete(`/installments/${p2._id}`), 200, "exclusão da parcela 2");

      esperado(await api.delete(`/fees/${fee._id}`), 200, "com as 2 parcelas desativadas, exclui");
    });

    test("parcela cujos pagamentos foram todos desativados exclui com 200", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 800, dataVencimento: AMANHA });
      const pg = await criarPagamento(api, parcela._id, { valorPago: 800 });

      assert.equal((await api.delete(`/installments/${parcela._id}`)).status, 409);
      esperado(await api.delete(`/payments/${pg._id}`), 200, "exclusão do pagamento");
      esperado(await api.delete(`/installments/${parcela._id}`), 200, "parcela sem pagamento ativo exclui");
    });

    test("cliente cujo único processo foi excluído exclui com 200", async () => {
      const outro = await criarClientePF(api);
      const proc = await criarProcesso(api, [
        { clienteId: outro._id, papel: "autor", principal: true }
      ]);

      assert.equal((await api.delete(`/clients/${outro._id}`)).status, 409);

      // A exclusão do processo cascateia soft delete nos vínculos; sem isso o
      // cliente ficaria preso a um processo que não existe mais.
      esperado(await api.delete(`/processes/${proc._id}`), 200, "exclusão do processo");
      esperado(await api.delete(`/clients/${outro._id}`), 200, "cliente sem processo ativo exclui");
    });

    test("parcela desativada não conta para o número do 409 nem para o saldo", async () => {
      const fee = await novoHonorario();
      const viva = await criarParcela(api, fee._id, 1, { dataVencimento: AMANHA });
      const morta = await criarParcela(api, fee._id, 2, { dataVencimento: AMANHA });
      esperado(await api.delete(`/installments/${morta._id}`), 200, "desativa a parcela 2");

      const r = await api.delete(`/fees/${fee._id}`);
      assert.equal(r.status, 409);
      assert.equal(r.body.quantidade, 1, "a parcela desativada não deveria entrar na contagem");

      esperado(await api.delete(`/installments/${viva._id}`), 200, "desativa a parcela 1");
      esperado(await api.delete(`/fees/${fee._id}`), 200, "honorário sem parcela ativa exclui");
    });
  });
});
