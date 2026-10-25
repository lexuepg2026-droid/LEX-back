// ═══════════════════════════════════════════════════════════════════════════
// RESUMO FINANCEIRO GLOBAL — os indicadores da DEC-028(d) (Fase 4.3)
//
// `GET /api/financeiro/resumo`. Quatro números novos — `aReceberNoMes`,
// `recebidoNoMes`, `valorVencido` e `proximosVencimentos` — mais o
// `mesReferencia` que a tela usa para rotular os cartões.
//
// ── O que este arquivo existe para pegar ───────────────────────────────────
// 1. Um pagamento de mês PASSADO contando como recebimento do mês corrente.
//    É o erro que faria a advogada planejar o mês com dinheiro que já entrou.
// 2. Uma parcela vencida e QUITADA continuando a somar em `valorVencido`.
//    O status `vencido` só existe enquanto não há pagamento — mas quem somasse
//    `valor` em vez de `emAberto` traria a quitada de volta.
// 3. Honorário CANCELADO entrando em qualquer uma das contas.
// 4. O resumo não fechando com a soma das fichas — ver o bloco A.2 no fim.
//
// As datas são todas relativas ao relógio, e em UTC, porque é assim que o
// serviço recorta o mês e assim que as datas do domínio são gravadas.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarEstorno, esperado
} from "../helpers/setup.js";

const AGORA = new Date();
const ANO = AGORA.getUTCFullYear();
const MES = AGORA.getUTCMonth();

// `deslocamento` em meses a partir do mês corrente; `Date.UTC` normaliza
// virada de ano sozinho, então `-1` em janeiro cai em dezembro do ano anterior.
const dataUTC = (deslocamento, dia) =>
  new Date(Date.UTC(ANO, MES + deslocamento, dia)).toISOString().slice(0, 10);

const MES_REFERENCIA = `${ANO}-${String(MES + 1).padStart(2, "0")}`;

describe("resumo financeiro — indicadores da DEC-028(d)", () => {
  let api, cliente, processo, honorario, cancelado;
  let quitadaVencida, vencidaEmAberto, doMesCorrente, doMesQueVem;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("resumo");
    cliente = await criarClientePF(api);

    processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);

    // ── Honorário vigente: 10.000, em quatro parcelas de estados diferentes ──
    honorario = await criarHonorario(api, processo._id, {
      tipo: "fixo", valor: 10000, descricao: "Honorários contratuais"
    });

    // 1) Vencida no mês passado e QUITADA, com o pagamento também no mês
    //    passado. Não pode aparecer nem em `valorVencido` nem em
    //    `recebidoNoMes`.
    // ── A ORDEM DE CRIAÇÃO passa a fazer parte do arranjo (F-1a) ──────────
    //
    // O pagamento nasce contra o HONORÁRIO e o motor o aloca na parcela de
    // vencimento mais ANTIGO em aberto. Criar as quatro parcelas e só então
    // pagar levaria todo o dinheiro para as primeiras — e o estado que este
    // arquivo mede (uma quitada, uma vencida em aberto, uma parcial no mês)
    // seria impossível de montar.
    //
    // Por isso cada parcela nasce imediatamente antes do pagamento que lhe é
    // destinado, e as que ficam em aberto nascem por último. O `numeroParcela`
    // continua sendo o da leitura humana; quem manda na alocação é a data.

    // 1) Vencida no mês passado e QUITADA, com o pagamento também no mês
    //    passado. Não pode aparecer nem em `valorVencido` nem em
    //    `recebidoNoMes`.
    quitadaVencida = await criarParcela(api, honorario._id, 1, {
      valor: 2000, dataVencimento: dataUTC(-1, 10)
    });
    await criarPagamento(api, honorario._id, {
      valor: 2000, data: dataUTC(-1, 12)
    });

    // 3) Vence no mês corrente, com pagamento PARCIAL feito neste mês.
    //    Sustenta `aReceberNoMes` (pelo que falta) e `recebidoNoMes` (pelo que
    //    entrou). Nasce ANTES da parcela 2 justamente para receber este
    //    pagamento: com a 2 já existindo, o motor mandaria os 1.000 para ela.
    doMesCorrente = await criarParcela(api, honorario._id, 3, {
      valor: 4000, dataVencimento: dataUTC(0, 15)
    });
    await criarPagamento(api, honorario._id, {
      valor: 1000, data: dataUTC(0, AGORA.getUTCDate())
    });

    // 2) Vencida no mês passado e em aberto: é a única que sustenta
    //    `valorVencido` e a contagem `vencidas`.
    vencidaEmAberto = await criarParcela(api, honorario._id, 2, {
      valor: 3000, dataVencimento: dataUTC(-1, 20)
    });

    // 4) Vence no mês que vem, intocada.
    doMesQueVem = await criarParcela(api, honorario._id, 4, {
      valor: 1000, dataVencimento: dataUTC(1, 10)
    });

    // ── Honorário CANCELADO, com parcela quitada NESTE mês ──────────────────
    // O caso mais perigoso do arquivo: se o cancelado entrasse na cadeia, ele
    // inflaria contratado, recebido E recebidoNoMes de uma vez.
    // O cancelamento vem DEPOIS do pagamento: desde a F-1a, honorário
    // cancelado recusa pagamento com 409.
    cancelado = await criarHonorario(api, processo._id, {
      tipo: "custas", valor: 5000, descricao: "Custas — cancelada"
    });
    await criarParcela(api, cancelado._id, 1, {
      valor: 5000, dataVencimento: dataUTC(0, 5)
    });
    await criarPagamento(api, cancelado._id, {
      valor: 5000, data: dataUTC(0, AGORA.getUTCDate())
    });
    esperado(
      await api.patch(`/fees/${cancelado._id}`, { status: "cancelado" }),
      200, "cancela o honorário depois do pagamento"
    );

    // ── Processo DESATIVADO, com honorário e pagamento vivos ────────────────
    // A ficha de um processo desativado responde 404: ele não aparece em soma
    // nenhuma que a advogada consiga conferir. O resumo tem de concordar.
    const desativado = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    const feeOrfao = await criarHonorario(api, desativado._id, {
      tipo: "fixo", valor: 7000, descricao: "Honorário de processo desativado"
    });
    await criarParcela(api, feeOrfao._id, 1, {
      valor: 7000, dataVencimento: dataUTC(0, 20)
    });
    await criarPagamento(api, feeOrfao._id, {
      valor: 700, data: dataUTC(0, AGORA.getUTCDate())
    });
    esperado(await api.delete(`/processes/${desativado._id}`), 200, "desativa o processo");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const resumo = async () =>
    esperado(await api.get("/financeiro/resumo"), 200, "resumo financeiro");

  // ═══════════════════════════════════════════════════════════════════════════
  // A.1 — os campos novos
  // ═══════════════════════════════════════════════════════════════════════════

  test("a resposta traz os campos da 4.2 e os cinco da DEC-028(d)", async () => {
    const r = await resumo();

    assert.deepEqual(
      Object.keys(r).sort(),
      [
        "aReceberNoMes", "mesReferencia", "pendente", "proximosVencimentos",
        "recebido", "recebidoNoMes", "saldoAdiantado", "valorContratado",
        "valorVencido", "vencidas"
      ],
      "o contrato do resumo mudou de forma"
    );
  });

  test("`mesReferencia` é o mês do servidor, em `AAAA-MM`", async () => {
    const r = await resumo();
    assert.equal(r.mesReferencia, MES_REFERENCIA);
    assert.match(r.mesReferencia, /^\d{4}-(0[1-9]|1[0-2])$/);
  });

  test("`aReceberNoMes` soma o EM ABERTO das parcelas que vencem no mês", async () => {
    const r = await resumo();
    // Só a parcela 3 vence no mês corrente entre as vigentes: 4.000 de valor
    // menos 1.000 já pagos. A do honorário cancelado também vence neste mês e
    // NÃO entra.
    assert.equal(r.aReceberNoMes, 3000);
  });

  test("pagamento de mês passado NÃO conta em `recebidoNoMes`", async () => {
    // O teste nomeado que a fase pede. Os 2.000 da parcela 1 entraram no mês
    // passado; os 1.000 da parcela 3 entraram neste. `recebido` (acumulado)
    // enxerga os dois; `recebidoNoMes`, só o segundo.
    const r = await resumo();

    assert.equal(r.recebidoNoMes, 1000, "só o pagamento deste mês");
    assert.equal(r.recebido, 3000, "o acumulado enxerga os dois pagamentos");
    assert.notEqual(
      r.recebidoNoMes, r.recebido,
      "recebidoNoMes virou o acumulado — o recorte de mês sumiu"
    );
  });

  test("`recebidoNoMes` sai de Payment, e não da data de quitação da parcela", async () => {
    // Um pagamento feito NESTE mês numa parcela vencida no mês passado tem de
    // contar neste mês: é quando o dinheiro entrou. `Installment.dataPagamento`
    // é a data em que a parcela fechou, e responderia outra pergunta.
    const antes = await resumo();

    const { pagamento } = await criarPagamento(api, honorario._id, {
      valor: 500, data: dataUTC(0, AGORA.getUTCDate())
    });

    const depois = await resumo();
    assert.equal(
      depois.recebidoNoMes, antes.recebidoNoMes + 500,
      "o pagamento deste mês numa parcela velha não entrou no mês"
    );

    // Devolve ao estado do arranjo, para os testes seguintes não dependerem da
    // ordem de execução. O caminho é o ESTORNO — `DELETE /payments/:id` morreu
    // na F-1a (DEC-032).
    //
    // E o estorno abate `recebidoNoMes` do próprio mês do PAGAMENTO, que é o
    // que faz o número voltar ao valor de antes: o cartão responde "quanto
    // entrou e ficou".
    await criarEstorno(api, pagamento._id, { valor: 500, motivo: "Desfaz o pagamento do teste" });

    const voltou = await resumo();
    assert.equal(
      voltou.recebidoNoMes, antes.recebidoNoMes,
      "o estorno não abateu o recebido do mês do pagamento"
    );
  });

  test("parcela vencida e QUITADA não conta em `valorVencido`", async () => {
    const r = await resumo();

    // Duas parcelas venceram no mês passado. A de 2.000 foi quitada e some do
    // vencido; a de 3.000 continua em aberto e é a única que sobra.
    assert.equal(r.valorVencido, 3000);
    assert.equal(r.vencidas, 1, "a contagem acompanha o valor");
  });

  test("`valorVencido` usa o EM ABERTO, não o valor cheio da parcela", async () => {
    // Um pagamento parcial numa parcela vencida derruba o vencido pelo que
    // entrou — quem somasse `valor` continuaria acusando os 3.000 inteiros.
    const { pagamento } = await criarPagamento(api, honorario._id, {
      valor: 1200, data: dataUTC(0, AGORA.getUTCDate())
    });

    const r = await resumo();
    assert.equal(r.valorVencido, 0, "a parcela virou `parcial` e sai do vencido");
    assert.equal(r.vencidas, 0);

    await criarEstorno(api, pagamento._id, { valor: 1200, motivo: "Desfaz o pagamento parcial" });

    const voltou = await resumo();
    assert.equal(voltou.valorVencido, 3000, "estornar o pagamento devolve o vencido");
    assert.equal(voltou.vencidas, 1);
  });

  test("honorário cancelado fica fora de contratado, recebido e do mês", async () => {
    const r = await resumo();

    // 10.000 do vigente. Nem os 5.000 do cancelado, nem os 7.000 do processo
    // desativado.
    assert.equal(r.valorContratado, 10000);
    // 2.000 + 1.000 das parcelas do vigente. Não os 5.000 do cancelado nem os
    // 700 do órfão.
    assert.equal(r.recebido, 3000);
    assert.equal(r.recebidoNoMes, 1000);
    assert.equal(r.pendente, 7000, "10.000 contratados menos 3.000 recebidos");

    // Contraprova por string: nenhum id do cancelado atravessa a resposta.
    const bruto = JSON.stringify(r);
    assert.ok(
      !bruto.includes(String(cancelado._id)),
      "o honorário cancelado apareceu no resumo"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // `proximosVencimentos`
  // ═══════════════════════════════════════════════════════════════════════════

  test("cada próximo vencimento traz os campos que a tela precisa", async () => {
    const r = await resumo();

    assert.ok(Array.isArray(r.proximosVencimentos));
    assert.ok(r.proximosVencimentos.length > 0, "nenhum próximo vencimento no arranjo");

    for (const p of r.proximosVencimentos) {
      assert.deepEqual(
        Object.keys(p).sort(),
        [
          // `honorarioId` entrou na F-1b: o dashboard passou a LINKAR o nome do
          // honorário para a página dele, e um nome sem id obrigaria a tela a
          // exibir o texto sem caminho para o registro que o explica.
          //
          // `totalParcelas` entrou na F-1c.1 (DEC-048): o cartão passou a dizer
          // "Parcela 1 de 3" como as demais telas. Só o CONGELADO — o cartão
          // atravessa honorários e não tem como contar o plano vigente de cada
          // um, e um "de N" contado sobre gerações somadas é exatamente o que a
          // DEC-048 tirou do recibo.
          "_id", "dataVencimento", "descricaoHonorario", "emAberto", "honorarioId",
          "numeroParcela", "numeroProcesso", "processoId", "status", "totalParcelas",
          "valor", "valorPago"
        ],
        "o formato do próximo vencimento mudou"
      );
      assert.equal(p.descricaoHonorario, "Honorários contratuais");
      assert.ok(p.honorarioId, "o id do honorário, para o nome dele virar link (F-1b)");
      // Presente SEMPRE, mesmo que `null`: `undefined` some do JSON, e a tela
      // não distingue "plano ainda aberto" de "esqueci de projetar".
      assert.ok("totalParcelas" in p, "o `de N` congelado precisa vir na projeção (DEC-048)");
      assert.equal(String(p.processoId), String(processo._id));
      assert.equal(p.numeroProcesso, processo.numeroProcesso);
      assert.ok(p.emAberto > 0, "parcela quitada não é próximo vencimento");
    }
  });

  test("parcela quitada e parcela de honorário cancelado não são próximos vencimentos", async () => {
    const r = await resumo();
    const ids = r.proximosVencimentos.map((p) => String(p._id));

    assert.ok(!ids.includes(String(quitadaVencida._id)), "a parcela quitada entrou na lista");
    assert.ok(
      !ids.includes(String(vencidaEmAberto._id)),
      "parcela vencida no passado não é PRÓXIMO vencimento"
    );
    assert.ok(ids.includes(String(doMesQueVem._id)), "a parcela do mês que vem sumiu");
  });

  test("os próximos vencimentos vêm ordenados e são no máximo cinco", async () => {
    // Sete parcelas em aberto, todas no futuro, para a poda de 5 ficar visível.
    const outro = await criarHonorario(api, processo._id, {
      tipo: "fixo", valor: 700, descricao: "Parcelamento longo"
    });
    for (let i = 1; i <= 7; i += 1) {
      await criarParcela(api, outro._id, i, {
        valor: 100, dataVencimento: dataUTC(i + 1, 10)
      });
    }

    const r = await resumo();
    assert.equal(r.proximosVencimentos.length, 5, "a poda em 5 não aconteceu");

    const datas = r.proximosVencimentos.map((p) => new Date(p.dataVencimento).getTime());
    assert.deepEqual(
      datas, [...datas].sort((a, b) => a - b),
      "os próximos vencimentos não vieram do mais próximo para o mais distante"
    );
  });

  test("usuário sem nada nenhum recebe zeros, lista vazia e o mês mesmo assim", async () => {
    // O `mesReferencia` é do calendário, não dos dados: uma tela que rotula o
    // cartão com ele não pode ficar sem rótulo só porque a base está vazia.
    const vazio = await registrarUsuario("resumo vazio");
    const r = esperado(await vazio.get("/financeiro/resumo"), 200, "resumo de usuário vazio");

    assert.equal(r.valorContratado, 0);
    assert.equal(r.recebido, 0);
    assert.equal(r.pendente, 0);
    assert.equal(r.vencidas, 0);
    assert.equal(r.aReceberNoMes, 0);
    assert.equal(r.recebidoNoMes, 0);
    assert.equal(r.valorVencido, 0);
    assert.equal(r.saldoAdiantado, 0);
    assert.deepEqual(r.proximosVencimentos, []);
    assert.equal(r.mesReferencia, MES_REFERENCIA);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A.2 — o resumo fecha com a soma das fichas
  //
  // A ficha do processo é o contrato publicado na Fase 4.1 e não muda. Este é
  // o teste que obriga o resumo a concordar com ela — e é ele que acusou, na
  // entrada desta fase, que os dois NÃO fechavam: o resumo somava honorário
  // cancelado e honorário de processo desativado.
  // ═══════════════════════════════════════════════════════════════════════════

  test("resumo.contratado, .recebido e .pendente batem com a soma das fichas", async () => {
    const r = await resumo();

    const processos = esperado(
      await api.get("/processes?page=1&limit=100"), 200, "listagem de processos"
    ).data;

    assert.ok(processos.length > 0, "nenhum processo ativo — o teste ficaria vazio");

    const soma = { contratado: 0, pago: 0, emAberto: 0 };
    for (const p of processos) {
      const ficha = esperado(
        await api.get(`/financeiro/processos/${p._id}`), 200, `ficha de ${p._id}`
      );
      soma.contratado += ficha.totais.contratado;
      soma.pago += ficha.totais.pago;
      soma.emAberto += ficha.totais.emAberto;
    }

    const centavos = (n) => Math.round(n * 100) / 100;

    assert.equal(r.valorContratado, centavos(soma.contratado), "contratado divergiu das fichas");
    assert.equal(r.recebido, centavos(soma.pago), "recebido divergiu das fichas");
    assert.equal(r.pendente, centavos(soma.emAberto), "em aberto divergiu das fichas");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Fase 0 (DEC-068) — a parcela CANCELADA de um honorário VIGENTE
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // O honorário cancelado já ficava fora (bloco acima). O buraco era outro: a
  // parcela cancelada por REPARCELAMENTO pertence a um honorário que continua
  // vigente, e entrava em `proximosVencimentos` e em `aReceberNoMes` com o
  // valor cheio — o cartão "A receber em {mês}" somava uma cobrança que a
  // advogada substituiu, e o Início a listava como próximo vencimento.
  //
  // Usuário próprio: este cenário não pode mexer nos números dos testes acima.
  // ═══════════════════════════════════════════════════════════════════════════
  // Fase 3.1 (DEC-098) — `?mes=AAAA-MM`
  //
  // O arranjo acima tem dinheiro conhecido em três meses: no PASSADO a parcela
  // 1 (2.000, quitada no próprio mês) e a 2 (3.000, em aberto); no CORRENTE a
  // 3 (4.000, com 1.000 pagos); no SEGUINTE a 4 (1.000, intocada).
  // ═══════════════════════════════════════════════════════════════════════════
  describe("`?mes=` escolhe o mês dos campos do mês (DEC-098)", () => {
    const chaveDoMes = (deslocamento) => {
      const d = new Date(Date.UTC(ANO, MES + deslocamento, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    };
    const resumoDo = async (mes) =>
      esperado(await api.get(`/financeiro/resumo?mes=${mes}`), 200, `resumo de ${mes}`);

    // O que NÃO pode mudar com `mes`: acumulados, vencidos (são de HOJE) e
    // os próximos vencimentos (sempre a partir de hoje).
    const FIXOS = [
      "valorContratado", "recebido", "pendente", "saldoAdiantado",
      "vencidas", "valorVencido", "proximosVencimentos"
    ];

    test("sem `?mes=`, é o mesmo resumo do mês corrente pedido por extenso", async () => {
      const sem = await resumo();
      const com = await resumoDo(MES_REFERENCIA);
      assert.deepEqual(com, sem);
    });

    test("um mês PASSADO com parcelas e pagamentos conhecidos", async () => {
      const r = await resumoDo(chaveDoMes(-1));
      assert.equal(r.mesReferencia, chaveDoMes(-1), "mesReferencia é o mês usado");
      // Parcela 1 quitada (em aberto 0) + parcela 2 em aberto (3.000).
      assert.equal(r.aReceberNoMes, 3000);
      // O pagamento de 2.000 entrou no mês passado.
      assert.equal(r.recebidoNoMes, 2000);
    });

    test("um mês FUTURO", async () => {
      const r = await resumoDo(chaveDoMes(1));
      assert.equal(r.mesReferencia, chaveDoMes(1));
      assert.equal(r.aReceberNoMes, 1000, "só a parcela 4");
      assert.equal(r.recebidoNoMes, 0, "não entrou dinheiro no futuro");
    });

    test("os campos que não seguem o mês saem IGUAIS em qualquer mês", async () => {
      const base = await resumo();
      for (const mes of [chaveDoMes(-1), chaveDoMes(1), "2001-01"]) {
        const r = await resumoDo(mes);
        for (const campo of FIXOS) {
          assert.deepEqual(r[campo], base[campo], `${campo} mudou com mes=${mes}`);
        }
      }
    });

    for (const invalido of ["2026-13", "2026-00", "2026-1", "26-10", "outubro", "1999-12", "2101-01", "2026-10-01"]) {
      test(`mes=${invalido} → 400 com campo "mes"`, async () => {
        const r = await api.get(`/financeiro/resumo?mes=${encodeURIComponent(invalido)}`);
        assert.equal(r.status, 400);
        assert.equal(r.body.campo, "mes");
        assert.match(r.body.message, /AAAA-MM/);
      });
    }

    test("mês repetido na query (array) também é 400, não injeção", async () => {
      const r = await api.get("/financeiro/resumo?mes=2026-10&mes=2026-09");
      assert.equal(r.status, 400);
      assert.equal(r.body.campo, "mes");
    });

    test("`honorarios-por-mes` com `?mes=`: a janela de 6 meses TERMINA nele", async () => {
      // Os honorários do arranjo foram cadastrados HOJE.
      const atual = esperado(await api.get("/dashboard/honorarios-por-mes"), 200, "gráfico");
      assert.ok(atual.some((m) => m.mes === MES_REFERENCIA), "o mês corrente tem barra");

      const adiante = esperado(await api.get(`/dashboard/honorarios-por-mes?mes=${chaveDoMes(3)}`), 200, "+3");
      assert.deepEqual(adiante, atual, "três meses adiante, hoje ainda está na janela");

      const longe = esperado(await api.get(`/dashboard/honorarios-por-mes?mes=${chaveDoMes(6)}`), 200, "+6");
      assert.deepEqual(longe, [], "seis meses adiante, hoje saiu da janela");

      const antes = esperado(await api.get(`/dashboard/honorarios-por-mes?mes=${chaveDoMes(-1)}`), 200, "-1");
      assert.deepEqual(antes, [], "a janela que termina no mês passado não enxerga o que foi cadastrado hoje");

      const errado = await api.get("/dashboard/honorarios-por-mes?mes=2026-13");
      assert.equal(errado.status, 400);
      assert.equal(errado.body.campo, "mes");
    });
  });

  describe("parcela cancelada por reparcelamento (DEC-068)", () => {
    let api2, original, plano;

    // Último dia do mês corrente: no mês E de hoje em diante, em qualquer dia
    // em que a suíte rodar — é o caso exato que o defeito pegava.
    const ultimoDiaDoMes = new Date(Date.UTC(ANO, MES + 1, 0)).toISOString().slice(0, 10);

    before(async () => {
      api2 = await registrarUsuario("resumo-cancelada");
      const cli = await criarClientePF(api2);
      const proc = await criarProcesso(api2, [
        { clienteId: cli._id, papel: "autor", principal: true }
      ]);
      const fee = await criarHonorario(api2, proc._id, {
        tipo: "fixo", valor: 3000, descricao: "Honorário reparcelado"
      });
      original = await criarParcela(api2, fee._id, 1, {
        valor: 3000, dataVencimento: ultimoDiaDoMes
      });

      // O plano novo vence a partir do mês que vem: assim `aReceberNoMes`
      // deste usuário tem de ser ZERO, e qualquer valor ali é a cancelada.
      esperado(
        await api2.post(`/fees/${fee._id}/renegotiations`, {
          parcelas: [
            { valor: 1500, dataVencimento: dataUTC(1, 10) },
            { valor: 1500, dataVencimento: dataUTC(2, 10) }
          ],
          motivo: "cliente pediu para dividir"
        }),
        201, "reparcelamento"
      );

      const lida = esperado(
        await api2.get(`/installments/${original._id}`), 200, "parcela original"
      );
      // Guarda do próprio teste: sem isto, uma mudança no reparcelamento
      // deixaria a parcela viva e o teste passaria sem provar nada.
      assert.equal(lida.status, "cancelado", "o reparcelamento cancela a parcela original");

      plano = esperado(await api2.get("/financeiro/resumo"), 200, "resumo do usuário 2");
    });

    test("a cancelada também fica fora de `aReceberNoMes` com `?mes=` (DEC-068 + DEC-098)", async () => {
      const r = esperado(await api2.get(`/financeiro/resumo?mes=${MES_REFERENCIA}`), 200, "resumo com mes");
      assert.equal(r.aReceberNoMes, 0);
    });

    test("a cancelada não aparece em `proximosVencimentos`", () => {
      const ids = plano.proximosVencimentos.map((p) => String(p._id));
      assert.ok(!ids.includes(String(original._id)), "a parcela cancelada voltou ao Início");
      // E as do plano novo, essas sim, aparecem — senão o filtro teria
      // apagado tudo e o teste acima passaria por vazio.
      assert.equal(plano.proximosVencimentos.length, 2);
      assert.ok(plano.proximosVencimentos.every((p) => p.status !== "cancelado"));
    });

    test("a cancelada não soma em `aReceberNoMes`", () => {
      assert.equal(plano.aReceberNoMes, 0);
    });

    test("o em aberto do honorário continua sendo o do plano novo", () => {
      // `pendente` é por honorário (DEC-040) e não lia parcela; não pode mudar.
      assert.equal(plano.pendente, 3000);
    });
  });

  // A outra metade da DEC-068: a parcela PARCIAL reparcelada guarda o dinheiro
  // que recebeu (DEC-037), e a ficha o conta (emenda de 17/08 à DEC-028). Tirar
  // a cancelada dos vencimentos não pode tirar esse dinheiro do `recebido` nem
  // inflar o `pendente` — senão o resumo para de fechar com as fichas.
  describe("parcela PARCIAL reparcelada: o dinheiro dela continua no resumo (DEC-068)", () => {
    let api3, r, ficha;

    before(async () => {
      api3 = await registrarUsuario("resumo-parcial-reparcelada");
      const cli = await criarClientePF(api3);
      const proc = await criarProcesso(api3, [
        { clienteId: cli._id, papel: "autor", principal: true }
      ]);
      const fee = await criarHonorario(api3, proc._id, {
        tipo: "fixo", valor: 4000, descricao: "Honorário parcial reparcelado"
      });
      const parcela = await criarParcela(api3, fee._id, 1, {
        valor: 4000, dataVencimento: dataUTC(1, 5)
      });
      await criarPagamento(api3, fee._id, { valor: 1000, data: dataUTC(0, AGORA.getUTCDate()) });

      esperado(
        await api3.post(`/fees/${fee._id}/renegotiations`, {
          parcelas: [
            { valor: 1500, dataVencimento: dataUTC(2, 10) },
            { valor: 1500, dataVencimento: dataUTC(3, 10) }
          ]
        }),
        201, "reparcelamento da parcela parcial"
      );
      const lida = esperado(await api3.get(`/installments/${parcela._id}`), 200, "parcela original");
      assert.equal(lida.status, "cancelado", "a parcial foi cancelada pelo reparcelamento");
      assert.equal(lida.valorPago, 1000, "e guardou o que tinha recebido");

      r = esperado(await api3.get("/financeiro/resumo"), 200, "resumo do usuário 3");
      ficha = esperado(await api3.get(`/financeiro/processos/${proc._id}`), 200, "ficha");
    });

    test("`recebido` continua contando os 1.000 da parcela cancelada", () => {
      assert.equal(r.recebido, 1000);
    });

    test("`pendente` é 3.000, e não 4.000", () => {
      assert.equal(r.pendente, 3000);
    });

    test("o resumo continua fechando com a ficha", () => {
      assert.equal(r.recebido, ficha.totais.pago);
      assert.equal(r.pendente, ficha.totais.emAberto);
    });

    test("e a cancelada continua fora dos vencimentos", () => {
      assert.ok(r.proximosVencimentos.every((p) => p.status !== "cancelado"));
      assert.equal(r.proximosVencimentos.length, 2);
    });
  });
});
