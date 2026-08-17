// ═══════════════════════════════════════════════════════════════════════════
// OS 11 INVARIANTES DO FINANCEIRO 2.0 — Fase F-1a
//
// Um bloco por invariante, na ordem em que a fase os enumerou. Cada um mede
// uma propriedade que precisa valer SEMPRE, e não um caminho feliz:
//
//    1. valorLiquido = valor − Σ estornos ativos; nunca negativo; excesso 422
//    2. estorno total zera; estorno-do-estorno restaura; anular 2× → 409
//    3. conservação: Σ alocações ativas + saldo = valor líquido
//    4. alocação antigo→novo; desalocação espelhada (novo→antigo)
//    5. pagamento maior que tudo quita e sobra em saldo; parcela nova auto-aloca
//    6. a invariante da ficha, antes e depois de pagamento/estorno/reparcelamento
//    7. reparcelamento: soma exigida, vínculo nas antigas, pagas intactas
//    8. `cancelado` de Fee nunca sobrescrito (regressão DEC-028)
//    9. `historicoStatus` só cresce; origem correta por transição
//   10. rotas `reativar` → 404; PATCH de payment fora de `observacoes` → 400
//   11. paginação do extrato: duas páginas sem id repetido
//
// ── O nº 3 NÃO é reescrito aqui ───────────────────────────────────────────
// A fundação desta branch provou a conservação como propriedade da função PURA
// `planejarAlocacao`, em 200 casos gerados. Aquela prova é mais forte do que
// qualquer arranjo por HTTP conseguiria ser, e por isso ela é INTEGRADA — o
// bloco 3 daqui roda a mesma verificação sobre o motor real, pela API, para
// travar a ponta que a prova pura não alcança: que a execução grava o que o
// planejamento decidiu.
//
// ── Tudo por HTTP, nada por model ─────────────────────────────────────────
// Um cenário montado por `insertMany` testaria um estado que a aplicação
// talvez nunca produza. Onde um teste precisa de estado impossível pela API,
// isso está dito na linha.
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

// Comparação em centavos inteiros. Comparar float com float é como o resíduo
// de 1e-13 entra num teste e o faz passar quando não devia.
const centavos = (n) => Math.round(Number(n) * 100);
const iguais = (a, b, msg) => assert.equal(centavos(a), centavos(b), msg);

describe("Financeiro 2.0 — os 11 invariantes (F-1a)", () => {
  let api, processo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("financeiro2");
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

  // Um honorário limpo por teste: os invariantes medem propriedades de um
  // honorário, e compartilhar um entre blocos faria a ordem dos testes virar
  // parte do resultado.
  const honorarioNovo = async (valor, extra = {}) =>
    criarHonorario(api, processo._id, { valor, tipo: "fixo", ...extra });

  const fichaDoProcesso = async () =>
    esperado(await api.get(`/financeiro/processos/${processo._id}`), 200, "ficha");

  const linhaDaFicha = async (feeId) => {
    const ficha = await fichaDoProcesso();
    return ficha.honorarios.find((h) => String(h._id) === String(feeId));
  };

  const buscarPagamento = async (id) =>
    esperado(await api.get(`/payments/${id}`), 200, "pagamento");

  // ═══════════════════════════════════════════════════════════════════════
  describe("1. valorLiquido = valor − Σ estornos ativos", () => {
    test("o líquido acompanha cada estorno, e nunca fica negativo", async () => {
      const fee = await honorarioNovo(5000);
      await criarParcela(api, fee._id, 1, { valor: 5000, dataVencimento: "2026-03-10" });

      const { pagamento } = await criarPagamento(api, fee._id, { valor: 5000 });

      let visao = await buscarPagamento(pagamento._id);
      iguais(visao.valorLiquido, 5000, "sem estorno, o líquido é o valor cheio");
      iguais(visao.totalEstornado, 0, "nada estornado ainda");

      await criarEstorno(api, pagamento._id, { valor: 1200, motivo: "Devolução parcial acordada" });
      visao = await buscarPagamento(pagamento._id);
      iguais(visao.valorLiquido, 3800, "5000 − 1200");
      iguais(visao.totalEstornado, 1200, "Σ estornos ativos");

      await criarEstorno(api, pagamento._id, { valor: 800, motivo: "Segunda devolução" });
      visao = await buscarPagamento(pagamento._id);
      iguais(visao.valorLiquido, 3000, "5000 − 1200 − 800");

      assert.ok(visao.valorLiquido >= 0, "o líquido NUNCA é negativo");
    });

    test("estorno acima do líquido → 422 dizendo quanto ainda é estornável", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });

      await criarEstorno(api, pagamento._id, { valor: 400, motivo: "Parte devolvida" });

      const r = await api.post(`/payments/${pagamento._id}/reversals`, {
        valor: 700,
        motivo: "Tentativa de estornar mais do que resta"
      });

      assert.equal(r.status, 422, `esperado 422, veio ${r.status}: ${JSON.stringify(r.body)}`);
      // O valor estornável vem NA RESPOSTA. Sem ele a advogada teria de
      // descobrir o limite por tentativa e erro — que é o beco que a Fase 4.6
      // fechou no módulo de documentos e que este módulo não reabre.
      iguais(r.body.errors.estornavel, 600, "1000 − 400 ainda estornáveis");
      assert.match(r.body.message, /600,00/, "a prosa cita o valor estornável");
    });

    test("pagamento já estornado por inteiro recusa novo estorno com 422", async () => {
      const fee = await honorarioNovo(900);
      await criarParcela(api, fee._id, 1, { valor: 900, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 900 });

      await criarEstorno(api, pagamento._id, { valor: 900, motivo: "Estorno integral" });

      const r = await api.post(`/payments/${pagamento._id}/reversals`, {
        valor: 1,
        motivo: "Não há mais nada a estornar"
      });
      assert.equal(r.status, 422);
      iguais(r.body.errors.estornavel, 0, "nada estornável");
      assert.equal(r.body.regra, "pagamentoTotalmenteEstornado");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("2. estorno total zera, anulação restaura, dupla anulação 409", () => {
    test("total zera o líquido; a anulação o traz de volta", async () => {
      const fee = await honorarioNovo(2000);
      await criarParcela(api, fee._id, 1, { valor: 2000, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 2000 });

      const { estorno } = await criarEstorno(api, pagamento._id, {
        valor: 2000,
        motivo: "Pagamento lançado por engano"
      });
      assert.equal(estorno.tipo, "total", "estorno que zera o líquido é `total`");

      let visao = await buscarPagamento(pagamento._id);
      iguais(visao.valorLiquido, 0, "o total zera");

      // O estorno-do-estorno. Restaura o líquido E re-aloca o valor pela regra
      // normal — não repõe nas mesmas parcelas, porque entre um e outro o
      // mundo pode ter mudado (ver o cabeçalho de `reversalService`).
      await anularEstorno(api, pagamento._id, estorno._id);

      visao = await buscarPagamento(pagamento._id);
      iguais(visao.valorLiquido, 2000, "a anulação restaura o líquido integral");
      iguais(visao.totalEstornado, 0, "o estorno anulado sai da conta");
    });

    test("anular o MESMO estorno duas vezes → 409", async () => {
      const fee = await honorarioNovo(1500);
      await criarParcela(api, fee._id, 1, { valor: 1500, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1500 });

      const { estorno } = await criarEstorno(api, pagamento._id, {
        valor: 500,
        motivo: "Estorno a ser anulado"
      });

      await anularEstorno(api, pagamento._id, estorno._id);

      const r = await api.post(`/payments/${pagamento._id}/reversals`, {
        estornoAnuladoId: estorno._id,
        motivo: "Segunda anulação do mesmo estorno"
      });
      assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.regra, "estornoJaAnulado");
    });

    test("anulação de anulação → 409 (anulação não se anula)", async () => {
      const fee = await honorarioNovo(1500);
      await criarParcela(api, fee._id, 1, { valor: 1500, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1500 });

      const { estorno } = await criarEstorno(api, pagamento._id, {
        valor: 500,
        motivo: "Estorno original"
      });
      const { estorno: anulacao } = await anularEstorno(api, pagamento._id, estorno._id);

      const r = await api.post(`/payments/${pagamento._id}/reversals`, {
        estornoAnuladoId: anulacao._id,
        motivo: "Tentando anular a anulação"
      });
      assert.equal(r.status, 409);
      assert.equal(r.body.regra, "anulacaoDeAnulacao");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("3. conservação — Σ alocações ativas + saldo = valor líquido", () => {
    // A prova de propriedade sobre a função PURA vive na fundação
    // (`planejarAlocacao`, 200 casos). Aqui a mesma conta é conferida sobre o
    // motor REAL, pela API: é a ponta que a prova pura não alcança — que a
    // execução grava exatamente o que o planejamento decidiu.
    const conservacaoVale = async (feeId, pagamentoId) => {
      const visao = await buscarPagamento(pagamentoId);
      const linha = await linhaDaFicha(feeId);

      const alocadoDestePagamento = visao.alocacoes
        .filter((a) => a.ativa)
        .reduce((t, a) => t + Number(a.valor), 0);

      // O saldo do honorário só é atribuível a este pagamento quando ele é o
      // único do honorário — que é o arranjo de todos os casos abaixo.
      iguais(
        alocadoDestePagamento + Number(linha.saldoAdiantado),
        visao.valorLiquido,
        "Σ alocações ativas + saldo = líquido"
      );
    };

    test("cabe inteiro numa parcela", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });
      await conservacaoVale(fee._id, pagamento._id);
    });

    test("atravessa duas parcelas", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 400, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 600, dataVencimento: "2026-04-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });
      await conservacaoVale(fee._id, pagamento._id);
    });

    test("sobra vai para o saldo", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 400, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });
      await conservacaoVale(fee._id, pagamento._id);
    });

    test("continua valendo DEPOIS de um estorno parcial", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 400, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 600, dataVencimento: "2026-04-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });

      await criarEstorno(api, pagamento._id, { valor: 350, motivo: "Devolução parcial" });
      await conservacaoVale(fee._id, pagamento._id);
    });

    test("sem parcela nenhuma, tudo vira saldo", async () => {
      const fee = await honorarioNovo(1000);
      const { pagamento } = await criarPagamento(api, fee._id, {
        valor: 700,
        tipo: "adiantamento"
      });
      await conservacaoVale(fee._id, pagamento._id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("4. alocação do mais ANTIGO; desalocação do mais NOVO", () => {
    test("três vencimentos distintos: aloca do antigo para o novo", async () => {
      const fee = await honorarioNovo(3000);
      // Criadas FORA de ordem de vencimento de propósito: a ordem que vale é a
      // do vencimento, não a de criação nem a do número da parcela.
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-05-10" });
      await criarParcela(api, fee._id, 2, { valor: 1000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 3, { valor: 1000, dataVencimento: "2026-04-10" });

      const { alocacoes } = await criarPagamento(api, fee._id, { valor: 1500 });

      const parcelas = esperado(
        await api.get(`/installments?processoId=${processo._id}&limit=100`), 200, "parcelas"
      ).data.filter((p) => String(p.feeId?._id ?? p.feeId) === String(fee._id));

      const porId = new Map(parcelas.map((p) => [String(p._id), p]));
      const emOrdem = alocacoes.map((a) => porId.get(String(a.parcelaId)));

      assert.equal(emOrdem.length, 2, "1500 cobrem a de março e metade da de abril");
      assert.equal(emOrdem[0].numeroParcela, 2, "março (parcela 2) recebe primeiro");
      assert.equal(emOrdem[1].numeroParcela, 3, "abril (parcela 3) recebe depois");
      iguais(alocacoes[0].valor, 1000, "quita março");
      iguais(alocacoes[1].valor, 500, "abate metade de abril");
    });

    test("a desalocação é ESPELHADA: sai do vencimento mais novo primeiro", async () => {
      const fee = await honorarioNovo(3000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 1000, dataVencimento: "2026-04-10" });
      await criarParcela(api, fee._id, 3, { valor: 1000, dataVencimento: "2026-05-10" });

      const { pagamento } = await criarPagamento(api, fee._id, { valor: 3000 });

      // Estorna 1200: pela ordem espelhada, sai TODO o de maio (1000) e 200 de
      // abril. Março, o mais antigo, não é tocado.
      //
      // A ordem oposta faria a parcela de março voltar a dever enquanto a de
      // maio seguisse quitada pelo mesmo dinheiro estornado — estado que
      // nenhuma leitura humana explica.
      await criarEstorno(api, pagamento._id, { valor: 1200, motivo: "Devolução parcial" });

      const parcelas = esperado(
        await api.get(`/installments?processoId=${processo._id}&limit=100`), 200, "parcelas"
      ).data.filter((p) => String(p.feeId?._id ?? p.feeId) === String(fee._id));

      const porNumero = new Map(parcelas.map((p) => [p.numeroParcela, p]));

      iguais(porNumero.get(1).valorPago, 1000, "março intacta — a mais antiga não é tocada");
      assert.equal(porNumero.get(1).status, "pago");
      iguais(porNumero.get(2).valorPago, 800, "abril perdeu 200");
      assert.equal(porNumero.get(2).status, "parcial");
      iguais(porNumero.get(3).valorPago, 0, "maio perdeu tudo — era a mais nova");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("5. pagamento maior que tudo, e a auto-alocação do saldo", () => {
    test("quita o que existe e o resto vira saldo", async () => {
      const fee = await honorarioNovo(5000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 1000, dataVencimento: "2026-04-10" });

      const { alocacoes, sobra, saldoAdiantado } = await criarPagamento(api, fee._id, {
        valor: 3000
      });

      assert.equal(alocacoes.length, 2, "as duas parcelas existentes são quitadas");
      iguais(sobra, 1000, "3000 − 1000 − 1000");
      iguais(saldoAdiantado, 1000, "a sobra fica visível no honorário");
    });

    test("parcela NOVA dispara a auto-alocação, a partir do primeiro vencimento", async () => {
      const fee = await honorarioNovo(5000);

      // Adiantamento num honorário SEM parcela: o valor inteiro fica em saldo.
      const { saldoAdiantado } = await criarPagamento(api, fee._id, {
        valor: 2500,
        tipo: "adiantamento"
      });
      iguais(saldoAdiantado, 2500, "sem parcela, tudo vira saldo");

      // Duas parcelas nascem. A primeira a vencer consome primeiro.
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      let linha = await linhaDaFicha(fee._id);
      iguais(linha.saldoAdiantado, 1500, "a parcela de março consumiu 1000");
      iguais(linha.parcelas.find((p) => p.numeroParcela === 1).valorPago, 1000, "quitada pelo saldo");

      await criarParcela(api, fee._id, 2, { valor: 2000, dataVencimento: "2026-04-10" });
      linha = await linhaDaFicha(fee._id);
      iguais(linha.saldoAdiantado, 0, "os 1500 restantes foram para abril");
      iguais(linha.parcelas.find((p) => p.numeroParcela === 2).valorPago, 1500, "parcial");
    });

    test("a alocação nascida de saldo é marcada como tal na origem", async () => {
      const fee = await honorarioNovo(5000);
      await criarPagamento(api, fee._id, { valor: 800, tipo: "adiantamento" });
      await criarParcela(api, fee._id, 1, { valor: 800, dataVencimento: "2026-03-10" });

      const extrato = esperado(
        await api.get(`/fees/${fee._id}/statement?limit=100`), 200, "extrato"
      );
      const alocacao = extrato.data.find((e) => e.tipo === "alocacao");

      // A distinção importa: uma parcela quitada por saldo adiantado NÃO teve
      // dinheiro entrando naquela data, e o cartão "recebido no mês" contaria
      // duas vezes o mesmo real se as duas origens fossem iguais.
      assert.equal(alocacao.origem, "saldoAdiantado");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("6. o em aberto da ficha — piso zero e crédito nomeado (DEC-040)", () => {
    // ── ESTA VERIFICAÇÃO É INDEPENDENTE, e a anterior não era ─────────────
    //
    // Até a F-1a este bloco recomputava
    // `contratado − pagoLiquidoAlocado − saldoAdiantado` a partir dos MESMOS
    // campos que a API devolvia, e comparava com o `emAberto` que a API
    // calculara com a MESMA fórmula. Era uma tautologia: só falharia se o
    // backend se contradissesse consigo mesmo, nunca se a fórmula estivesse
    // errada. Foi exatamente por isso que ele passou verde enquanto a ficha
    // exibia dívida menor do que a real — o defeito A-1 do smoke test.
    //
    // Agora a expectativa é montada a partir dos dados BRUTOS das parcelas
    // (`valor` e `valorPago`, que não são derivados da fórmula sob teste), e
    // do `contratado` do honorário. E o que se afirma é a REGRA, não a
    // aritmética: em aberto nunca é negativo, e o crédito nunca entra nele.
    const conferirFicha = async (feeId, momento) => {
      const linha = await linhaDaFicha(feeId);
      const t = linha.totais;

      // 1. Nenhum `emAberto` é negativo, em nível nenhum.
      assert.ok(
        t.emAberto >= 0,
        `${momento}: emAberto do honorário ficou negativo (${t.emAberto})`
      );
      for (const p of linha.parcelas) {
        assert.ok(
          p.emAberto >= 0,
          `${momento}: parcela ${p.numeroParcela} com emAberto negativo (${p.emAberto})`
        );
      }

      // 2. O em aberto é `max(0, contratado − pago)`, calculado aqui a partir
      //    do que as PARCELAS dizem ter recebido — e o crédito NÃO participa.
      const pagoPelasParcelas = linha.parcelas.reduce(
        (acc, p) => acc + centavos(p.valorPago ?? 0), 0
      );
      iguais(
        Math.max(0, centavos(t.contratado) - pagoPelasParcelas) / 100,
        t.emAberto,
        `${momento}: em aberto do honorário não é max(0, contratado − pago)`
      );

      // 3. O crédito sai NOMEADO e não foi consumido por conta nenhuma.
      assert.equal(
        centavos(t.saldoAdiantado), centavos(linha.saldoAdiantado),
        `${momento}: o saldo do honorário e o dos totais divergiram`
      );

      // 4. Quando o honorário está INTEIRAMENTE parcelado, o em aberto dele é
      //    a soma do em aberto das parcelas ativas. A condição não é
      //    frouxidão: um honorário de 3.000 com uma parcela de 1.000 emitida
      //    deve 3.000 na ficha e 1.000 pela soma das parcelas — decisão
      //    publicada desde a Fase 4.3, e a que vale é a da ficha. A igualdade
      //    só é exigível onde as duas descrevem a mesma coisa.
      const ativas = linha.parcelas.filter((p) => p.status !== "cancelado");
      const somaDasAtivas = ativas.reduce((acc, p) => acc + centavos(p.valor), 0);
      if (ativas.length > 0 && somaDasAtivas === centavos(t.contratado)) {
        const emAbertoDasAtivas = ativas.reduce((acc, p) => acc + centavos(p.emAberto), 0);
        assert.equal(
          emAbertoDasAtivas, centavos(t.emAberto),
          `${momento}: honorário integralmente parcelado, e o em aberto dele ` +
          `(${t.emAberto}) não bate com a soma das parcelas ativas (${emAbertoDasAtivas / 100})`
        );
      }

      return linha;
    };

    test("vale em cada passo: pagamento → estorno → reparcelamento", async () => {
      const fee = await honorarioNovo(4000);
      await criarParcela(api, fee._id, 1, { valor: 2000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 2000, dataVencimento: "2026-04-10" });

      let linha = await conferirFicha(fee._id, "no honorário recém-parcelado");
      iguais(linha.totais.emAberto, 4000, "nada pago ainda");

      const { pagamento } = await criarPagamento(api, fee._id, { valor: 2500 });
      linha = await conferirFicha(fee._id, "depois do pagamento");
      iguais(linha.totais.pagoLiquidoAlocado, 2500);
      iguais(linha.totais.emAberto, 1500);

      await criarEstorno(api, pagamento._id, { valor: 500, motivo: "Devolução parcial" });
      linha = await conferirFicha(fee._id, "depois do estorno");
      iguais(linha.totais.pagoLiquidoAlocado, 2000, "o estornado sai do alocado");
      iguais(linha.totais.emAberto, 2000);

      await criarReparcelamento(api, fee._id, [
        { valor: 1000, dataVencimento: "2026-06-10" },
        { valor: 1000, dataVencimento: "2026-07-10" }
      ]);
      linha = await conferirFicha(fee._id, "depois do reparcelamento");
      iguais(linha.totais.emAberto, 2000, "reparcelar não muda o quanto se deve");
    });

    test("crédito NÃO abate o em aberto: ele sai nomeado", async () => {
      // O honorário está integralmente adiantado. Até a F-1a a ficha dizia
      // "em aberto R$ 0,00" porque o crédito era SUBTRAÍDO — o número certo
      // pelo caminho errado, e o mesmo caminho produzia negativo no passo
      // seguinte.
      const fee = await honorarioNovo(3000);
      await criarPagamento(api, fee._id, { valor: 3000, tipo: "adiantamento" });

      const linha = await conferirFicha(fee._id, "com honorário integralmente adiantado");

      iguais(linha.totais.saldoAdiantado, 3000, "o crédito existe e tem nome");
      iguais(linha.totais.pagoLiquidoAlocado, 0, "não há parcela para alocar");
      iguais(
        linha.totais.emAberto, 3000,
        "sem parcela emitida, a cobrança ainda está inteira em aberto — " +
        "o crédito é o que vai quitá-la quando a parcela nascer, não um abatimento agora"
      );
    });

    test("crédito MAIOR que o contratado não produz negativo", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      // 4.000 numa cobrança de 1.000: quita a parcela e deixa 3.000 de crédito.
      await criarPagamento(api, fee._id, { valor: 4000 });

      const linha = await conferirFicha(fee._id, "com crédito maior que o contratado");

      iguais(linha.totais.emAberto, 0, "quitado — e o piso segura o resto");
      iguais(linha.totais.saldoAdiantado, 3000, "o excedente inteiro vira crédito");
      assert.ok(
        linha.totais.emAberto >= 0,
        "a fórmula antiga daria −3.000 aqui, e esse −3.000 abateria a dívida do vizinho"
      );
    });

    test("O CASO DO SMOKE TEST: crédito de um honorário não abate a dívida de outro", async () => {
      // ── O defeito A-1, reproduzido em números ────────────────────────────
      //
      // Observado em 17/08/2026: processo com contratado 10.500 e recebido
      // 7.500 exibindo em aberto 2.500, quando a cliente devia 3.000.
      //
      // O arranjo abaixo é o mesmo em escala menor: um honorário com crédito
      // e outro com dívida, no MESMO processo. A soma do processo tem de ser
      // a dívida real — não a dívida menos o crédito do vizinho.
      const pf = await criarClientePF(api);
      const proc = await criarProcesso(api, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);

      // Honorário A: 1.000 contratados, 1.500 recebidos → 500 de crédito.
      const comCredito = await criarHonorario(api, proc._id, { valor: 1000, tipo: "fixo" });
      await criarParcela(api, comCredito._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      await criarPagamento(api, comCredito._id, { valor: 1500 });

      // Honorário B: 3.000 contratados, nada recebido → 3.000 de dívida.
      const comDivida = await criarHonorario(api, proc._id, { valor: 3000, tipo: "fixo" });
      await criarParcela(api, comDivida._id, 1, { valor: 3000, dataVencimento: "2026-04-10" });

      const ficha = esperado(
        await api.get(`/financeiro/processos/${proc._id}`), 200, "ficha do caso observado"
      );

      iguais(ficha.totais.contratado, 4000, "1.000 + 3.000");
      iguais(ficha.totais.pagoLiquidoAlocado, 1000, "só o que encostou em parcela");
      iguais(ficha.totais.saldoAdiantado, 500, "o crédito do honorário A, nomeado");
      iguais(
        ficha.totais.emAberto, 3000,
        "a dívida real é 3.000. A fórmula antiga daria 2.500: o crédito de 500 " +
        "do honorário A comendo a dívida do honorário B"
      );

      // E a soma do processo é a soma das LINHAS, cada uma com piso.
      const somaDasLinhas = ficha.honorarios
        .filter((h) => h.status !== "cancelado")
        .reduce((acc, h) => acc + centavos(h.totais.emAberto), 0);
      assert.equal(
        somaDasLinhas, centavos(ficha.totais.emAberto),
        "o total do processo não é a soma dos honorários"
      );

      const linhaA = ficha.honorarios.find((h) => String(h._id) === String(comCredito._id));
      iguais(linhaA.totais.emAberto, 0, "o honorário com crédito deve zero, nunca −500");
      iguais(linhaA.totais.saldoAdiantado, 500);
    });

    test("crédito em honorário CANCELADO não entra em soma nenhuma", async () => {
      const pf = await criarClientePF(api);
      const proc = await criarProcesso(api, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);

      const cancelado = await criarHonorario(api, proc._id, { valor: 800, tipo: "fixo" });
      // O pagamento entra ANTES do cancelamento: depois dele a rota recusa.
      await criarPagamento(api, cancelado._id, { valor: 1200, tipo: "adiantamento" });
      esperado(
        await api.patch(`/fees/${cancelado._id}`, { status: "cancelado" }),
        200, "cancelamento"
      );

      const vigente = await criarHonorario(api, proc._id, { valor: 2000, tipo: "fixo" });
      await criarParcela(api, vigente._id, 1, { valor: 2000, dataVencimento: "2026-04-10" });

      const ficha = esperado(
        await api.get(`/financeiro/processos/${proc._id}`), 200, "ficha"
      );

      iguais(ficha.totais.contratado, 2000, "o cancelado fica fora do contratado");
      iguais(
        ficha.totais.saldoAdiantado, 0,
        "e o crédito DELE também: somá-lo faria a advogada ler como disponível " +
        "um valor preso numa cobrança que ela desfez"
      );
      iguais(ficha.totais.emAberto, 2000, "a dívida é só a do honorário vigente");

      // O crédito continua legível na LINHA do cancelado — sumir da ficha
      // levaria junto o histórico.
      const linha = ficha.honorarios.find((h) => String(h._id) === String(cancelado._id));
      iguais(linha.totais.saldoAdiantado, 1200, "o crédito do cancelado continua à vista");
    });

    test("parcela com `valor` reduzido depois de alocada não vira em aberto negativo", async () => {
      // O único caminho pelo qual a PARCELA pode ficar negativa: `PATCH
      // /installments/:id { valor }` aceita reduzir o valor depois de a parcela
      // ter recebido alocação, e `valorPago` é recalculado das alocações — não
      // do valor da parcela. Sem o piso, a ficha exibiria "−R$ 500,00" e o
      // número entraria em `aReceberNoMes` e `valorVencido`.
      const fee = await honorarioNovo(1000);
      const parcela = await criarParcela(api, fee._id, 1, {
        valor: 1000, dataVencimento: "2026-03-10"
      });
      await criarPagamento(api, fee._id, { valor: 1000 });

      esperado(
        await api.patch(`/installments/${parcela._id}`, { valor: 500 }),
        200, "reduz o valor da parcela já quitada"
      );

      const linha = await conferirFicha(fee._id, "com parcela reduzida abaixo do alocado");
      const p = linha.parcelas.find((x) => String(x._id) === String(parcela._id));

      iguais(p.valorPago, 1000, "o alocado não se move — ele é fato, não opinião");
      iguais(p.valor, 500);
      iguais(p.emAberto, 0, "e o em aberto tem piso: −500 abateria outras parcelas");
    });

    test("o resumo global fecha com a soma das fichas, com crédito em cena", async () => {
      // A Fase 4.3 existiu para fechar esta igualdade. A DEC-040 mudou o NÍVEL
      // da soma dos dois lados, e este teste é o que impede um dos dois de
      // ficar para trás.
      const resumo = esperado(await api.get("/financeiro/resumo"), 200, "resumo");

      const processos = esperado(
        await api.get("/processes?limit=100"), 200, "processos"
      ).data;

      const soma = { contratado: 0, pago: 0, emAberto: 0, saldo: 0 };
      for (const p of processos) {
        const ficha = esperado(
          await api.get(`/financeiro/processos/${p._id}`), 200, `ficha de ${p._id}`
        );
        soma.contratado += ficha.totais.contratado;
        soma.pago += ficha.totais.pago;
        soma.emAberto += ficha.totais.emAberto;
        soma.saldo += ficha.totais.saldoAdiantado;
      }

      iguais(resumo.valorContratado, soma.contratado, "contratado divergiu das fichas");
      iguais(resumo.recebido, soma.pago, "recebido divergiu das fichas");
      iguais(resumo.saldoAdiantado, soma.saldo, "saldo divergiu das fichas");
      iguais(resumo.pendente, soma.emAberto, "em aberto divergiu das fichas");
      assert.ok(resumo.pendente >= 0, "o pendente do resumo ficou negativo");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("7. reparcelamento", () => {
    test("soma errada → 422 com o valor esperado", async () => {
      const fee = await honorarioNovo(6000);
      await criarParcela(api, fee._id, 1, { valor: 3000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 3000, dataVencimento: "2026-04-10" });
      await criarPagamento(api, fee._id, { valor: 1000 });

      // Saldo real = 6000 − 1000 = 5000. O plano abaixo soma 4000.
      const r = await api.post(`/fees/${fee._id}/renegotiations`, {
        parcelas: [
          { valor: 2000, dataVencimento: "2026-06-10" },
          { valor: 2000, dataVencimento: "2026-07-10" }
        ],
        motivo: "Plano que não fecha"
      });

      assert.equal(r.status, 422, `esperado 422, veio ${r.status}: ${JSON.stringify(r.body)}`);
      iguais(r.body.errors.saldoEsperado, 5000, "o 422 diz quanto era esperado");
      iguais(r.body.errors.somaInformada, 4000, "e quanto veio");
      assert.equal(r.body.regra, "somaDivergeDoSaldo");
      assert.match(r.body.message, /5\.?000,00/, "a prosa cita o valor esperado");
    });

    test("as antigas em aberto saem canceladas COM `reparcelamentoId`", async () => {
      const fee = await honorarioNovo(6000);
      const p1 = await criarParcela(api, fee._id, 1, { valor: 3000, dataVencimento: "2026-03-10" });
      const p2 = await criarParcela(api, fee._id, 2, { valor: 3000, dataVencimento: "2026-04-10" });

      await criarReparcelamento(api, fee._id, [
        { valor: 2000, dataVencimento: "2026-06-10" },
        { valor: 2000, dataVencimento: "2026-07-10" },
        { valor: 2000, dataVencimento: "2026-08-10" }
      ]);

      for (const antiga of [p1, p2]) {
        const lida = esperado(
          await api.get(`/installments/${antiga._id}`), 200, "parcela antiga"
        );
        assert.equal(lida.status, "cancelado", "a antiga sai de circulação");
        assert.ok(lida.reparcelamentoId, "COM vínculo — o histórico continua navegável");
      }
    });

    test("parcela PAGA fica intacta e fora da conta", async () => {
      const fee = await honorarioNovo(6000);
      const paga = await criarParcela(api, fee._id, 1, { valor: 2000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 4000, dataVencimento: "2026-04-10" });

      await criarPagamento(api, fee._id, { valor: 2000 }); // quita a parcela 1

      // Saldo = 6000 − 2000 = 4000, e é só a parcela 2 que se redistribui.
      const { reparcelamento } = await criarReparcelamento(api, fee._id, [
        { valor: 2000, dataVencimento: "2026-06-10" },
        { valor: 2000, dataVencimento: "2026-07-10" }
      ]);

      const lida = esperado(await api.get(`/installments/${paga._id}`), 200, "parcela paga");
      assert.equal(lida.status, "pago", "a paga continua paga");
      assert.equal(lida.reparcelamentoId ?? null, null, "e sem vínculo — não foi renegociada");

      assert.equal(reparcelamento.parcelasCanceladas.length, 1, "só a em aberto entrou");
      iguais(reparcelamento.saldoRenegociado, 4000);
    });

    test("parcela PARCIAL é cancelada com vínculo, e o alocado nela fica", async () => {
      const fee = await honorarioNovo(6000);
      const parcial = await criarParcela(api, fee._id, 1, { valor: 3000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 3000, dataVencimento: "2026-04-10" });

      await criarPagamento(api, fee._id, { valor: 1200 }); // parcial na parcela 1

      const { reparcelamento } = await criarReparcelamento(api, fee._id, [
        { valor: 4800, dataVencimento: "2026-06-10" }
      ]);

      const lida = esperado(await api.get(`/installments/${parcial._id}`), 200, "parcela parcial");
      assert.equal(lida.status, "cancelado");
      assert.ok(lida.reparcelamentoId, "cancelada COM vínculo");
      iguais(lida.valorPago, 1200, "o que foi alocado nela FICA — é histórico, não volta");

      const snapshot = reparcelamento.parcelasCanceladas.find(
        (p) => String(p.parcelaId) === String(parcial._id)
      );
      assert.equal(snapshot.statusAnterior, "parcial", "o snapshot congela o estado de então");
      iguais(snapshot.emAberto, 1800, "só o que faltava entrou no saldo renegociado");
    });

    test("honorário quitado com crédito não tem o que reparcelar", async () => {
      // ── ATUALIZADO pela DEC-040 (F-1a.1) ─────────────────────────────────
      //
      // A asserção era `emAberto === -1000`, com o comentário "negativo é
      // honesto". Era a decisão nº 4 da F-1a, e ela estava errada: o negativo
      // propagava para a soma do processo e o crédito de um honorário abatia
      // a dívida de outro. Agora o em aberto tem piso e o crédito sai nomeado.
      const fee = await honorarioNovo(5000);
      await criarParcela(api, fee._id, 1, { valor: 5000, dataVencimento: "2026-03-10" });
      // 6000 num honorário de 5000: quita a parcela e deixa 1000 em saldo.
      await criarPagamento(api, fee._id, { valor: 6000 });

      const linha = await linhaDaFicha(fee._id);
      iguais(linha.saldoAdiantado, 1000, "sobra em saldo");
      iguais(linha.totais.emAberto, 0, "quitado: piso zero, e o crédito não vira dívida negativa");
      iguais(linha.totais.saldoAdiantado, 1000, "o crédito continua à vista, com nome");

      // Não há saldo em aberto: o reparcelamento é recusado, e a mensagem diz
      // por quê em vez de criar parcelas do nada.
      const r = await api.post(`/fees/${fee._id}/renegotiations`, {
        parcelas: [{ valor: 100, dataVencimento: "2026-06-10" }]
      });
      assert.equal(r.status, 422);
      assert.equal(r.body.regra, "semSaldoParaReparcelar");
    });

    test("o crédito se auto-aloca nas parcelas novas, e é consumido UMA vez", async () => {
      // ── O defeito que a DEC-040 fechou no reparcelamento ────────────────
      //
      // Enquanto `saldoEmAberto` subtraía o crédito, o plano novo era exigido
      // MENOR que a dívida — e a auto-alocação (DEC-036) consumia o crédito
      // dentro desse plano menor, descontando o mesmo dinheiro duas vezes.
      // O honorário e as parcelas dele passavam a discordar em exatamente o
      // valor do crédito.
      const fee = await honorarioNovo(7500);
      const p1 = await criarParcela(api, fee._id, 1, { valor: 3750, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 3750, dataVencimento: "2026-04-10" });

      // 1500 na parcela 1 (parcial). Depois um adiantamento de 500, que não
      // acha destino porque as duas parcelas seguem em aberto… na verdade
      // acha: o motor aloca. Para gerar crédito de verdade é preciso pagar
      // além do que as parcelas comportam.
      await criarPagamento(api, fee._id, { valor: 1500 });
      iguais((await linhaDaFicha(fee._id)).parcelas.find(
        (p) => String(p._id) === String(p1._id)
      ).valorPago, 1500, "arranjo: 1500 na parcela 1");

      // Reparcela o que resta: 7500 − 1500 = 6000, em três de 2000.
      await criarReparcelamento(api, fee._id, [
        { valor: 2000, dataVencimento: "2026-06-10" },
        { valor: 2000, dataVencimento: "2026-07-10" },
        { valor: 2000, dataVencimento: "2026-08-10" }
      ]);

      const linha = await linhaDaFicha(fee._id);
      iguais(linha.totais.emAberto, 6000, "reparcelar não muda o quanto se deve");

      // E os dois níveis concordam: o honorário está integralmente parcelado
      // pelas ATIVAS (3 × 2000 = 6000 sobre um saldo de 6000).
      const ativas = linha.parcelas.filter((p) => p.status !== "cancelado");
      const somaAtivas = ativas.reduce((acc, p) => acc + centavos(p.emAberto), 0);
      assert.equal(
        somaAtivas, centavos(linha.totais.emAberto),
        "o honorário e as parcelas novas discordam — o crédito foi contado duas vezes"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("8. `cancelado` de Fee nunca é sobrescrito (regressão DEC-028)", () => {
    test("honorário cancelado com TODAS as parcelas quitadas continua cancelado", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      // O pagamento entra ANTES do cancelamento: depois dele a rota recusa.
      await criarPagamento(api, fee._id, { valor: 1000 });

      esperado(await api.patch(`/fees/${fee._id}`, { status: "cancelado" }), 200, "cancelamento");

      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário");
      assert.equal(
        lido.status, "cancelado",
        "a guarda caiu: o recálculo sobrescreveu `cancelado` com `pago`"
      );
    });

    test("honorário cancelado RECUSA pagamento novo com 409", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      esperado(await api.patch(`/fees/${fee._id}`, { status: "cancelado" }), 200, "cancelamento");

      const r = await api.post("/payments", {
        honorarioId: fee._id,
        valor: 500,
        data: "2026-03-15",
        formaPagamento: "pix"
      });
      assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.regra, "honorarioCancelado");
    });

    test("descancelar é escrita explícita, e aí a derivação volta a valer", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      await criarPagamento(api, fee._id, { valor: 1000 });
      esperado(await api.patch(`/fees/${fee._id}`, { status: "cancelado" }), 200, "cancelamento");

      esperado(await api.patch(`/fees/${fee._id}`, { status: "pendente" }), 200, "descancelamento");

      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário");
      assert.equal(
        lido.status, "pago",
        "descancelado, a derivação manda de novo — a parcela está quitada"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("9. `historicoStatus` só cresce, com a origem certa", () => {
    const historico = async (feeId) => {
      const extrato = esperado(
        await api.get(`/fees/${feeId}/statement?limit=100`), 200, "extrato"
      );
      return extrato.data.filter((e) => e.tipo === "mudancaStatus");
    };

    test("a cadeia começa no nascimento, com `de: null` e origem `criacao`", async () => {
      const fee = await honorarioNovo(1000);
      const h = await historico(fee._id);

      assert.equal(h.length, 1, "um honorário recém-criado tem UMA linha");
      assert.equal(h[0].de, null, "o começo da cadeia é reconhecível");
      assert.equal(h[0].para, "pendente");
      assert.equal(h[0].origemStatus, "criacao");
    });

    test("cada transição acrescenta UMA linha, e nenhuma some", async () => {
      const fee = await honorarioNovo(2000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 1000, dataVencimento: "2026-04-10" });

      const antes = await historico(fee._id);

      await criarPagamento(api, fee._id, { valor: 1000 });   // → parcialmente_pago
      const depoisDoParcial = await historico(fee._id);

      await criarPagamento(api, fee._id, { valor: 1000 });   // → pago
      const depoisDoPago = await historico(fee._id);

      assert.ok(depoisDoParcial.length > antes.length, "o histórico cresceu");
      assert.ok(depoisDoPago.length > depoisDoParcial.length, "e cresceu de novo");

      // Só cresce: o prefixo antigo continua idêntico, linha a linha.
      antes.forEach((linha, i) => {
        assert.equal(depoisDoPago[i].id, linha.id, "uma linha antiga mudou de lugar ou sumiu");
        assert.equal(depoisDoPago[i].para, linha.para);
      });

      const ultima = depoisDoPago[depoisDoPago.length - 1];
      assert.equal(ultima.para, "pago");
      assert.equal(
        ultima.origemStatus, "recalculo",
        "quitar parcela é DERIVAÇÃO, não decisão de alguém"
      );
    });

    test("cancelar registra origem `cancelamento`, não `recalculo`", async () => {
      const fee = await honorarioNovo(1000);
      esperado(await api.patch(`/fees/${fee._id}`, { status: "cancelado" }), 200, "cancelamento");

      const h = await historico(fee._id);
      const ultima = h[h.length - 1];
      assert.equal(ultima.para, "cancelado");
      assert.equal(
        ultima.origemStatus, "cancelamento",
        "é o que distingue `o sistema derivou` de `alguém decidiu`"
      );
    });

    test("reparcelar registra origem `reparcelamento`", async () => {
      // ── O cenário precisa PRODUZIR uma transição ─────────────────────────
      //
      // A primeira versão deste teste quitava a parcela 1 por inteiro. Com uma
      // parcela `pago` sobrevivendo ao reparcelamento, o honorário continua
      // `parcialmente_pago` antes e depois — não há transição nenhuma, e
      // `registrarStatus` não grava linha para status igual, por desenho
      // (senão o array encheria de ruído).
      //
      // Era a premissa do teste que estava errada, não o código. Aqui o
      // pagamento é PARCIAL: a parcela 1 fica `parcial`, é cancelada pelo
      // reparcelamento junto com a 2, e as novas nascem sem alocação — o
      // honorário volta de `parcialmente_pago` para `pendente`, e é essa
      // transição que precisa levar o carimbo certo.
      const fee = await honorarioNovo(2000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 1000, dataVencimento: "2026-04-10" });
      await criarPagamento(api, fee._id, { valor: 400 }); // parcela 1 → parcial

      const antes = await historico(fee._id);
      assert.equal(
        antes[antes.length - 1].para, "parcialmente_pago",
        "arranjo: o honorário precisa estar `parcialmente_pago` antes"
      );

      // Saldo = 2000 − 400 = 1600, redistribuído em duas de 800.
      await criarReparcelamento(api, fee._id, [
        { valor: 800, dataVencimento: "2026-06-10" },
        { valor: 800, dataVencimento: "2026-07-10" }
      ]);

      const h = await historico(fee._id);
      const ultima = h[h.length - 1];

      assert.equal(ultima.para, "pendente", "as antigas saíram, as novas nasceram sem alocação");
      assert.equal(
        ultima.origemStatus, "reparcelamento",
        "a transição foi atribuída a `recalculo` — a origem não viajou pela cadeia"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("10. as rotas que morreram, e a allowlist de um campo", () => {
    test("PATCH /payments/:id/reativar → 404", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });

      const r = await api.patch(`/payments/${pagamento._id}/reativar`, {});
      assert.equal(r.status, 404, "a rota de reativação de pagamento morreu (DEC-034)");
    });

    test("PATCH /installments/:id/reativar → 404", async () => {
      const fee = await honorarioNovo(1000);
      const parcela = await criarParcela(api, fee._id, 1, {
        valor: 1000, dataVencimento: "2026-03-10"
      });

      const r = await api.patch(`/installments/${parcela._id}/reativar`, {});
      assert.equal(r.status, 404, "a rota de reativação de parcela morreu (DEC-034)");
    });

    test("DELETE /payments/:id → 404 (estornar é o caminho)", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });

      const r = await api.delete(`/payments/${pagamento._id}`);
      assert.equal(r.status, 404, "pagamento não se apaga (DEC-032)");
    });

    test("PATCH de payment fora de `observacoes` → 400 com `campo`", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });

      // Um por um, porque cada um tem de ser recusado por si — e porque um
      // teste que mandasse os quatro juntos passaria mesmo que só o primeiro
      // estivesse na guarda.
      for (const [campo, valor] of [
        ["valor", 5000],
        ["data", "2026-01-01"],
        ["formaPagamento", "dinheiro"],
        ["honorarioId", String(fee._id)],
        ["ativo", false]
      ]) {
        const r = await api.patch(`/payments/${pagamento._id}`, { [campo]: valor });
        assert.equal(
          r.status, 400,
          `PATCH { ${campo} } devia ser 400, veio ${r.status}: ${JSON.stringify(r.body)}`
        );
        assert.equal(r.body.campo, campo, `o 400 precisa nomear o campo recusado`);
      }
    });

    test("`observacoes` continua editável, e é a única", async () => {
      const fee = await honorarioNovo(1000);
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 1000 });

      const atualizado = esperado(
        await api.patch(`/payments/${pagamento._id}`, { observacoes: "Conferido no extrato" }),
        200, "PATCH observacoes"
      );
      assert.equal(atualizado.observacoes, "Conferido no extrato");
      iguais(atualizado.valor, 1000, "o valor não se move — pagamento é imutável");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe("11. paginação do extrato", () => {
    test("duas páginas, sem id repetido e sem linha perdida", async () => {
      const fee = await honorarioNovo(10000);
      await criarParcela(api, fee._id, 1, { valor: 2000, dataVencimento: "2026-03-10" });
      await criarParcela(api, fee._id, 2, { valor: 2000, dataVencimento: "2026-04-10" });
      await criarParcela(api, fee._id, 3, { valor: 2000, dataVencimento: "2026-05-10" });

      // Eventos suficientes para atravessar a fronteira de página: pagamentos,
      // um estorno (que gera estorno + desalocação) e mudanças de status.
      const { pagamento: p1 } = await criarPagamento(api, fee._id, { valor: 2000, data: "2026-03-11" });
      await criarPagamento(api, fee._id, { valor: 2000, data: "2026-04-11" });
      await criarPagamento(api, fee._id, { valor: 1500, data: "2026-05-11" });
      await criarEstorno(api, p1._id, { valor: 500, motivo: "Devolução parcial", data: "2026-05-20" });

      const inteiro = esperado(
        await api.get(`/fees/${fee._id}/statement?limit=100`), 200, "extrato inteiro"
      );
      assert.ok(inteiro.total > 5, `poucos eventos para o teste valer: ${inteiro.total}`);

      const tamanho = Math.ceil(inteiro.total / 2);
      const pag1 = esperado(
        await api.get(`/fees/${fee._id}/statement?page=1&limit=${tamanho}`), 200, "página 1"
      );
      const pag2 = esperado(
        await api.get(`/fees/${fee._id}/statement?page=2&limit=${tamanho}`), 200, "página 2"
      );

      assert.equal(pag1.total, inteiro.total, "o total não muda entre páginas");
      assert.equal(pag1.totalPages, 2);

      const ids1 = pag1.data.map((e) => e.id);
      const ids2 = pag2.data.map((e) => e.id);

      const repetidos = ids1.filter((id) => ids2.includes(id));
      assert.deepEqual(repetidos, [], `id repetido entre as páginas: ${repetidos.join(", ")}`);

      const juntos = new Set([...ids1, ...ids2]);
      assert.equal(
        juntos.size, inteiro.total,
        "a soma das páginas não reconstrói o extrato inteiro"
      );
    });

    test("o extrato traz os vínculos de cada linha", async () => {
      const fee = await honorarioNovo(3000);
      await criarParcela(api, fee._id, 1, { valor: 3000, dataVencimento: "2026-03-10" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 3000, data: "2026-03-11" });
      await criarEstorno(api, pagamento._id, {
        valor: 1000, motivo: "Devolução acordada", data: "2026-03-20"
      });

      const extrato = esperado(
        await api.get(`/fees/${fee._id}/statement?limit=100`), 200, "extrato"
      );
      const porTipo = (t) => extrato.data.filter((e) => e.tipo === t);

      const estorno = porTipo("estorno")[0];
      assert.equal(String(estorno.pagamentoId), String(pagamento._id), "o estorno aponta o pagamento");
      assert.equal(estorno.motivo, "Devolução acordada");

      const desalocacao = porTipo("desalocacao")[0];
      assert.ok(desalocacao, "a desalocação vira linha própria, com data própria");
      assert.equal(String(desalocacao.pagamentoId), String(pagamento._id));
      assert.ok(desalocacao.parcelaId, "e aponta a parcela");
      assert.ok(desalocacao.estornoId, "e o estorno que a causou");

      const alocacao = porTipo("alocacao")[0];
      assert.equal(String(alocacao.pagamentoId), String(pagamento._id));
      assert.ok(alocacao.numeroParcela, "a alocação nomeia a parcela");
    });

    test("teto de 100 no limit, no padrão da F-0", async () => {
      const fee = await honorarioNovo(1000);
      const r = esperado(
        await api.get(`/fees/${fee._id}/statement?limit=5000`), 200, "extrato"
      );
      assert.equal(r.limit, 100, "o teto de 100 vale aqui como em toda listagem");
    });
  });
});
