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
  criarParcela, criarPagamento, esperado
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
    quitadaVencida = await criarParcela(api, honorario._id, 1, {
      valor: 2000, dataVencimento: dataUTC(-1, 10)
    });
    await criarPagamento(api, quitadaVencida._id, {
      valorPago: 2000, dataPagamento: dataUTC(-1, 12)
    });

    // 2) Vencida no mês passado e em aberto: é a única que sustenta
    //    `valorVencido` e a contagem `vencidas`.
    vencidaEmAberto = await criarParcela(api, honorario._id, 2, {
      valor: 3000, dataVencimento: dataUTC(-1, 20)
    });

    // 3) Vence no mês corrente, com pagamento PARCIAL feito neste mês.
    //    Sustenta `aReceberNoMes` (pelo que falta) e `recebidoNoMes` (pelo que
    //    entrou).
    doMesCorrente = await criarParcela(api, honorario._id, 3, {
      valor: 4000, dataVencimento: dataUTC(0, 15)
    });
    await criarPagamento(api, doMesCorrente._id, {
      valorPago: 1000, dataPagamento: dataUTC(0, AGORA.getUTCDate())
    });

    // 4) Vence no mês que vem, intocada.
    doMesQueVem = await criarParcela(api, honorario._id, 4, {
      valor: 1000, dataVencimento: dataUTC(1, 10)
    });

    // ── Honorário CANCELADO, com parcela quitada NESTE mês ──────────────────
    // O caso mais perigoso do arquivo: se o cancelado entrasse na cadeia, ele
    // inflaria contratado, recebido E recebidoNoMes de uma vez.
    cancelado = await criarHonorario(api, processo._id, {
      tipo: "custas", valor: 5000, status: "cancelado", descricao: "Custas — cancelada"
    });
    const parcelaCancelada = await criarParcela(api, cancelado._id, 1, {
      valor: 5000, dataVencimento: dataUTC(0, 5)
    });
    await criarPagamento(api, parcelaCancelada._id, {
      valorPago: 5000, dataPagamento: dataUTC(0, AGORA.getUTCDate())
    });

    // ── Processo DESATIVADO, com honorário e pagamento vivos ────────────────
    // A ficha de um processo desativado responde 404: ele não aparece em soma
    // nenhuma que a advogada consiga conferir. O resumo tem de concordar.
    const desativado = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    const feeOrfao = await criarHonorario(api, desativado._id, {
      tipo: "fixo", valor: 7000, descricao: "Honorário de processo desativado"
    });
    const parcelaOrfa = await criarParcela(api, feeOrfao._id, 1, {
      valor: 7000, dataVencimento: dataUTC(0, 20)
    });
    await criarPagamento(api, parcelaOrfa._id, {
      valorPago: 700, dataPagamento: dataUTC(0, AGORA.getUTCDate())
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
        "recebido", "recebidoNoMes", "valorContratado", "valorVencido", "vencidas"
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

    const pagamento = await criarPagamento(api, vencidaEmAberto._id, {
      valorPago: 500, dataPagamento: dataUTC(0, AGORA.getUTCDate())
    });

    const depois = await resumo();
    assert.equal(
      depois.recebidoNoMes, antes.recebidoNoMes + 500,
      "o pagamento deste mês numa parcela velha não entrou no mês"
    );

    // Devolve ao estado do arranjo, para os testes seguintes não dependerem da
    // ordem de execução.
    esperado(await api.delete(`/payments/${pagamento._id}`), 200, "desfaz o pagamento do teste");
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
    const pagamento = await criarPagamento(api, vencidaEmAberto._id, {
      valorPago: 1200, dataPagamento: dataUTC(0, AGORA.getUTCDate())
    });

    const r = await resumo();
    assert.equal(r.valorVencido, 0, "a parcela virou `parcial` e sai do vencido");
    assert.equal(r.vencidas, 0);

    esperado(await api.delete(`/payments/${pagamento._id}`), 200, "desfaz o pagamento parcial");

    const voltou = await resumo();
    assert.equal(voltou.valorVencido, 3000, "desativar o pagamento devolve o vencido");
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
          "_id", "dataVencimento", "descricaoHonorario", "emAberto",
          "numeroParcela", "numeroProcesso", "processoId", "status", "valor", "valorPago"
        ],
        "o formato do próximo vencimento mudou"
      );
      assert.equal(p.descricaoHonorario, "Honorários contratuais");
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
});
