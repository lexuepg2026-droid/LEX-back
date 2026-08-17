// ═══════════════════════════════════════════════════════════════════════════
// CADEIA FINANCEIRA — recálculo de status, 409 de excedente e integridade.
//
// Honorário → Parcela → Pagamento. É a cadeia onde um erro custa dinheiro real
// da advogada, e onde as três formas de 409 do projeto convivem.
//
// ── Uma correção de premissa, e o que aconteceu com ela depois ─────────────
// A Fase 2E.2 registrou aqui que `Fee.status` NÃO era derivado das parcelas —
// era enum `pendente|pago|cancelado` que só mudava por escrita explícita — e
// deixou um teste travando esse comportamento, para que a fase seguinte caísse
// nele.
//
// A Fase 4.1 caiu. A DEC-028 tornou o status derivado, em quatro estados, e
// aquele teste foi INVERTIDO no mesmo arquivo (ver "DEC-028" mais abaixo). Os
// quatro estados e a guarda de `cancelado` têm suíte própria, ao lado deste
// arquivo em `tests/financial/`.
//
// `Installment.status` continua derivado por `recalcularStatusInstallment`
// (`paymentService.js`), e é o recálculo testado aqui.
//
// ── A Fase F-1a mexeu em duas das quatro seções, e não nas outras duas ────
// 4.1 e 4.2 mudaram porque o modelo embaixo mudou: o pagamento nasce contra o
// HONORÁRIO, o vínculo com a parcela virou `Allocation`, e desfazer dinheiro
// virou ESTORNO. O bloco 4.2 era o 409 de excedente — regra REVOGADA pela
// DEC-035 — e foi invertido no lugar, no mesmo padrão do teste que a 4.1
// inverteu aqui: o histórico do Git mostra a transição, não um teste que sumiu.
//
// 4.3 e 4.4 continuam quase intactas: o contrato do 409 de integridade
// (`dependencia` + `quantidade`) NÃO mudou. O que mudou é quem é o dependente
// de uma parcela — antes pagamentos, agora alocações ativas — e o número que
// sai continua sendo de PAGAMENTOS distintos.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarEstorno, criarSecao, criarModelo,
  vincularSecao, esperado
} from "../helpers/setup.js";

// O vocabulário é IMPORTADO, nunca reescrito à mão no teste. É isso que impede
// `parcelas`, `parcela` e `installments` de coexistirem em três fases: quem
// renomear um valor quebra o teste na hora, em vez de o frontend descobrir
// depois que passou a receber uma palavra que não conhece.
import { DEPENDENCIA, DEPENDENCIAS, REGRAS_CONFLITO } from "../../src/config/integrityConflicts.js";

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

      // parcial — pagamento menor que o valor.
      //
      // O pagamento nasce contra o HONORÁRIO (F-1a) e o motor aloca no
      // vencimento mais ANTIGO. Aqui a vencida (parcela 2, ONTEM) vem antes da
      // pendente, então ela é quitada primeiro: são precisos 1000 para
      // atravessá-la e só então encostar na parcela 1.
      await criarPagamento(api, fee._id, { valor: 1000 });
      assert.equal((await lerParcela(vencida._id)).status, "pago", "a vencida recebe primeiro");

      await criarPagamento(api, fee._id, { valor: 400 });
      assert.equal((await lerParcela(pendente._id)).status, "parcial");

      // pago — a soma das alocações alcança o valor
      await criarPagamento(api, fee._id, { valor: 600 });
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

      await criarPagamento(api, fee._id, { valor: 500 });
      assert.equal((await lerParcela(parcela._id)).status, "pago");
    });

    test("ESTORNAR o pagamento devolve a parcela ao estado anterior", async () => {
      // Era "desativar o pagamento" até a F-0. `DELETE /payments/:id` morreu
      // (DEC-032) e o caminho passou a ser o estorno. A propriedade sob teste
      // não mudou: o recálculo é REFEITO a partir das alocações ativas, e por
      // isso a parcela desce de volta estado a estado.
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });

      const { pagamento: p1 } = await criarPagamento(api, fee._id, { valor: 400 });
      const { pagamento: p2 } = await criarPagamento(api, fee._id, { valor: 600 });
      assert.equal((await lerParcela(parcela._id)).status, "pago");

      // Volta 1: estorna o segundo pagamento → parcial (400 de 1000).
      await criarEstorno(api, p2._id, { valor: 600, motivo: "Estorno do segundo pagamento" });
      const depoisDeUm = await lerParcela(parcela._id);
      assert.equal(depoisDeUm.status, "parcial", "com 400 de 1000 a parcela é parcial");
      assert.equal(depoisDeUm.dataPagamento, null, "parcela não-paga não guarda dataPagamento");

      // Volta 2: estorna o primeiro também → pendente (vencimento no futuro).
      await criarEstorno(api, p1._id, { valor: 400, motivo: "Estorno do primeiro pagamento" });
      assert.equal((await lerParcela(parcela._id)).status, "pendente");
    });

    test("estornar o pagamento de parcela VENCIDA devolve `vencido`, não `pendente`", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 300, dataVencimento: ONTEM });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 300 });
      assert.equal((await lerParcela(parcela._id)).status, "pago");

      await criarEstorno(api, pg._id, { valor: 300, motivo: "Estorno integral" });
      assert.equal(
        (await lerParcela(parcela._id)).status,
        "vencido",
        "o estado anterior de uma parcela vencida é `vencido`, não `pendente`"
      );
    });

    // ── TESTE INVERTIDO NA FASE 4.1 — DEC-028 ────────────────────────────────
    // Até a Fase 3.2 este teste afirmava o contrário: travava o FATO de que
    // `Fee.status` NÃO era derivado das parcelas, para que a fase que
    // implementasse a derivação caísse aqui e tivesse de decidir
    // conscientemente. Foi o que aconteceu.
    //
    // A DEC-028 (Fase 4.1) tornou o status derivado, e o teste foi invertido no
    // mesmo arquivo em vez de apagado: assim o histórico do Git mostra a
    // transição deliberada, e não um teste que sumiu.
    test("DEC-028: `Fee.status` É derivado das parcelas", async () => {
      const fee = await novoHonorario({ status: "pendente" });
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 1000 });

      assert.equal((await lerParcela(parcela._id)).status, "pago", "a parcela foi quitada");
      assert.equal(
        (await lerHonorario(fee._id)).status,
        "pago",
        "com todas as parcelas quitadas o honorário passa a `pago` — era `pendente` até a Fase 3.2"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4.2 — 409 de excedente, com a forma exata
  // ═════════════════════════════════════════════════════════════════════════

  describe("4.2 o excedente virou alocação — a regra 409 foi REVOGADA", () => {
    // ── INVERTIDO na Fase F-1a, no mesmo padrão do teste da DEC-028 acima ──
    //
    // Este bloco travava o 409 `pagamentoExcedeParcela` com as quatro chaves
    // (`regra`, `campo`, `saldoDisponivel`, `valorParcela`). A regra caiu com a
    // DEC-035, e caiu porque recusava um fato: o cliente depositou mais do que
    // a parcela comportava, e o sistema mandava a advogada registrar outra
    // coisa — o depósito real não existia em lugar nenhum do sistema.
    //
    // Não foi apagado. Passou a travar o comportamento que o substituiu, e a
    // AUSÊNCIA da regra antiga: sem isso, alguém poderia reintroduzir a guarda
    // sem nada acusar, quebrando o caso que a DEC-036 existe para atender.

    test("o valor atravessa as parcelas, do vencimento mais antigo em diante", async () => {
      const fee = await novoHonorario();
      const p1 = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: ONTEM });
      const p2 = await criarParcela(api, fee._id, 2, { valor: 1000, dataVencimento: AMANHA });

      // 1500 num pagamento só: quita a vencida e abate metade da futura. Antes
      // isto exigiria DOIS pagamentos e dois recibos para um depósito único.
      const { alocacoes } = await criarPagamento(api, fee._id, { valor: 1500 });

      assert.equal(alocacoes.length, 2, "uma alocação por parcela tocada");
      assert.equal((await lerParcela(p1._id)).status, "pago", "a vencida primeiro");
      assert.equal((await lerParcela(p2._id)).valorPago, 500, "e o resto na seguinte");
      assert.equal((await lerParcela(p2._id)).status, "parcial");
    });

    test("o que passa de TODAS as parcelas vira `saldoAdiantado`", async () => {
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 100, dataVencimento: AMANHA });

      const { sobra, saldoAdiantado } = await criarPagamento(api, fee._id, { valor: 250 });

      assert.equal((await lerParcela(parcela._id)).status, "pago");
      assert.equal(sobra, 150, "250 − 100");
      assert.equal(saldoAdiantado, 150, "e fica visível no honorário, não some");
    });

    test("nenhuma resposta carrega mais a regra nem as chaves que ela levava", async () => {
      const fee = await novoHonorario();
      await criarParcela(api, fee._id, 1, { valor: 100, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 99.5 });

      // O caso exato que dava 409: 0,51 sobre um saldo de 0,50.
      const r = await api.post("/payments", {
        honorarioId: fee._id,
        valor: 0.51,
        data: "2026-05-10",
        formaPagamento: "pix"
      });

      assert.equal(r.status, 201, `esperado 201 — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.saldoAdiantado, 0.01, "o centavo excedente vira saldo");

      // E as chaves da regra revogada não voltam por nenhum caminho.
      assert.equal(r.body.regra, undefined);
      assert.equal(r.body.saldoDisponivel, undefined);
      assert.equal(r.body.valorParcela, undefined);
    });

    test("`pagamentoExcedeParcela` saiu do vocabulário fechado de regras", () => {
      // Vocabulário fechado com entrada morta é como, em duas fases, alguém
      // volta a emitir a regra achando que ela ainda vale.
      assert.ok(
        !REGRAS_CONFLITO.includes("pagamentoExcedeParcela"),
        "a regra revogada continua no vocabulário — remova a entrada"
      );
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

    test("parcela com alocações ativas → `pagamentos`, contando PAGAMENTOS distintos", async () => {
      // O contrato do 409 não mudou na F-1a: `dependencia: "pagamentos"` +
      // `quantidade`. O que mudou é a consulta por trás — antes contava
      // `Payment.installmentId`, agora conta alocações ativas — e a contagem
      // continua sendo de PAGAMENTOS distintos, não de linhas de alocação: um
      // pagamento parcialmente estornado deixa a linha carimbada e uma
      // substituta, e contar linhas diria "2 pagamentos" onde há um.
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 300 });
      await criarPagamento(api, fee._id, { valor: 200 });

      const r = await api.delete(`/installments/${parcela._id}`);
      assertIntegridade(r, DEPENDENCIA.PAGAMENTOS, 2, "parcela com 2 pagamentos");
      assert.equal(r.body.dependencia, "pagamentos");
    });

    test("pagamento parcialmente estornado continua contando como UM", async () => {
      // A linha original é carimbada com o `estornoId` e uma substituta toma o
      // lugar dela (decisão intocável da fundação). São duas linhas de
      // alocação, uma ativa — e um pagamento só.
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 800 });
      await criarEstorno(api, pagamento._id, { valor: 300, motivo: "Devolução parcial" });

      const r = await api.delete(`/installments/${parcela._id}`);
      assertIntegridade(r, DEPENDENCIA.PAGAMENTOS, 1, "parcela com 1 pagamento parcialmente estornado");
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
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 500 });

      // O pagamento não se apaga (DEC-032): ele se ESTORNA. Estornado por
      // inteiro, não há mais alocação ativa segurando a parcela, e a cadeia
      // volta a poder ser desmontada de baixo para cima.
      await criarEstorno(api, pagamento._id, { valor: 500, motivo: "Estorno para desmontar a cadeia" });
      assert.equal(
        (await api.delete(`/payments/${pagamento._id}`)).status, 404,
        "DELETE de pagamento morreu na F-1a"
      );
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

    test("parcela cujas alocações foram todas estornadas exclui com 200", async () => {
      // Era "pagamentos desativados" até a F-0. O dependente virou a ALOCAÇÃO
      // ativa, e o jeito de desfazê-la é o estorno. A propriedade é a mesma:
      // dependente que não vale mais não pode prender a exclusão para sempre.
      const fee = await novoHonorario();
      const parcela = await criarParcela(api, fee._id, 1, { valor: 800, dataVencimento: AMANHA });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 800 });

      assert.equal((await api.delete(`/installments/${parcela._id}`)).status, 409);

      await criarEstorno(api, pagamento._id, { valor: 800, motivo: "Estorno integral" });
      esperado(
        await api.delete(`/installments/${parcela._id}`),
        200, "parcela sem alocação ativa exclui"
      );
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
