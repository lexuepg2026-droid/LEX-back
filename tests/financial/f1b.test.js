// ═══════════════════════════════════════════════════════════════════════════
// FASE F-1b — o que a UX do dinheiro exige do backend
//
// A fase é de TELA, e o backend dela é pequeno de propósito: o motor de
// alocação, o extrato e os estornos ficaram prontos e provados na F-1a. O que
// esta suíte trava é a fronteira que as telas novas passam a depender.
//
// ── O bloco 1 é o mais importante da fase ────────────────────────────────
// O preview promete à advogada, ANTES de ela confirmar, em quais parcelas o
// dinheiro vai encostar. Se ele divergir do que a criação faz, o preview
// mente — e mentir sobre dinheiro é pior do que não ter preview nenhum, porque
// ela decide com base nele e só descobre depois de gravado.
//
// A garantia estrutural é que `planejarAlocacao` é UMA função, chamada pelos
// dois caminhos (`preverAlocacao` e `alocarPagamento`). Este bloco é a prova
// pela ponta de fora: mesma entrada → mesmo plano, pela API, sem confiar na
// leitura do código.
//
// ── O bloco 3 existe porque a conta dos totais MUDOU DE ARQUIVO ──────────
// A DEC-040 vivia dentro de `montarFichaFinanceira`. A F-1b a moveu para
// `services/feeTotals.js` para que a página do honorário não escrevesse uma
// segunda cópia. Mover fórmula de dinheiro é exatamente o tipo de mudança que
// precisa de uma asserção dizendo que as duas leituras continuam concordando.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar, contarEm } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarClientePJ, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarReparcelamento, esperado
} from "../helpers/setup.js";

// Comparação em centavos inteiros — mesma razão de `financeiro2.test.js`:
// comparar float com float é como o resíduo de 1e-13 entra num teste.
const centavos = (n) => Math.round(Number(n) * 100);
const iguais = (a, b, msg) => assert.equal(centavos(a), centavos(b), msg);

// O PLANO, reduzido ao que ele afirma sobre o dinheiro: para qual parcela, e
// quanto. É esta forma que o preview e a criação têm de produzir igual.
//
// A ORDEM entra na comparação de propósito: o motor aloca do vencimento mais
// antigo para o mais novo, e um preview que acertasse os valores na ordem
// errada diria à advogada que a parcela 3 será quitada antes da 2.
const planoDoPreview = (preview) =>
  preview.destinos.map((d) => ({
    parcelaId: String(d.parcelaId),
    valor: centavos(d.valor)
  }));

const planoDaCriacao = (criacao) =>
  criacao.alocacoes.map((a) => ({
    parcelaId: String(a.parcelaId),
    valor: centavos(a.valor)
  }));

describe("F-1b — preview, leitura do honorário e a conta única dos totais", () => {
  let api, processo, clientePJ;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("f1b");
    clientePJ = await criarClientePJ(api);
    processo = await criarProcesso(api, [
      { clienteId: clientePJ._id, papel: "autor", principal: true }
    ]);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // Um honorário limpo por teste: compartilhar um entre blocos faria a ordem
  // dos testes virar parte do resultado.
  const honorarioCom = async (valor, parcelas = []) => {
    const fee = await criarHonorario(api, processo._id, { valor });
    let numero = 1;
    for (const v of parcelas) {
      await criarParcela(api, fee._id, numero, { valor: v });
      numero += 1;
    }
    return fee;
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 1. O PREVIEW E A CRIAÇÃO PRODUZEM O MESMO PLANO
  // ═══════════════════════════════════════════════════════════════════════
  describe("1. preview ≡ criação (a asserção central da fase)", () => {
    test("o caso que ATRAVESSA DUAS PARCELAS: mesmo plano, mesma ordem", async () => {
      // 1.000 + 1.000 em aberto, pagamento de 1.500: quita a primeira e abate
      // 500 da segunda. É o caso que a DEC-035 criou e o que a tela precisa
      // conseguir explicar antes de gravar.
      const fee = await honorarioCom(2000, [1000, 1000]);

      const preview = esperado(
        await api.post("/payments/preview", { honorarioId: fee._id, valor: 1500, tipo: "comum" }),
        200,
        "preview de 1.500 sobre duas parcelas"
      );

      const criacao = await criarPagamento(api, fee._id, { valor: 1500 });

      assert.deepEqual(
        planoDoPreview(preview),
        planoDaCriacao(criacao),
        "o plano previsto e o plano executado precisam ser o MESMO — " +
          "se divergirem, o preview mentiu para a advogada antes de ela confirmar"
      );
      iguais(preview.sobra, criacao.sobra, "a sobra prevista e a realizada");

      // E o plano é o que a fase promete na tela: duas parcelas tocadas, a
      // primeira quitada, a segunda abatida pela metade.
      assert.equal(preview.destinos.length, 2, "o pagamento atravessa duas parcelas");
      assert.equal(preview.destinos[0].quita, true, "a primeira parcela é quitada");
      assert.equal(preview.destinos[1].quita, false, "a segunda é apenas abatida");
      iguais(preview.destinos[1].valor, 500, "o abatimento parcial da segunda");
      iguais(preview.sobra, 0, "nada sobra neste caso");
    });

    test("o caso COM SOBRA EM CRÉDITO: mesmo plano e mesma sobra", async () => {
      const fee = await honorarioCom(3000, [1000]);

      const preview = esperado(
        await api.post("/payments/preview", { honorarioId: fee._id, valor: 2500, tipo: "comum" }),
        200,
        "preview com sobra"
      );
      const criacao = await criarPagamento(api, fee._id, { valor: 2500 });

      assert.deepEqual(planoDoPreview(preview), planoDaCriacao(criacao), "o plano");
      iguais(preview.sobra, criacao.sobra, "a sobra");
      iguais(preview.sobra, 1500, "1.500 sobram da única parcela de 1.000");
      iguais(
        preview.saldoAdiantadoDepois,
        criacao.saldoAdiantado,
        "o saldo adiantado projetado e o saldo gravado"
      );
    });

    test("ADIANTAMENTO SEM PARCELAS: o valor inteiro vira crédito, e o preview diz isso", async () => {
      // O caso que a tela precisa narrar por extenso ("fica como crédito e
      // será aplicado quando as parcelas nascerem"). Sem parcela alocável, o
      // plano é vazio e a sobra é tudo.
      const fee = await honorarioCom(5000, []);

      const preview = esperado(
        await api.post("/payments/preview", {
          honorarioId: fee._id,
          valor: 2000,
          tipo: "adiantamento"
        }),
        200,
        "preview de adiantamento sem parcelas"
      );
      const criacao = await criarPagamento(api, fee._id, {
        valor: 2000,
        tipo: "adiantamento"
      });

      assert.deepEqual(preview.destinos, [], "sem parcela, não há destino");
      assert.deepEqual(planoDoPreview(preview), planoDaCriacao(criacao), "o plano vazio");
      iguais(preview.sobra, 2000, "o valor inteiro vira crédito");
      iguais(preview.sobra, criacao.sobra, "a sobra prevista e a realizada");
      assert.equal(preview.tipo, "adiantamento", "o tipo do pedido volta na resposta");
    });

    test("o preview NÃO GRAVA NADA — nem pagamento, nem alocação, nem saldo", async () => {
      const fee = await honorarioCom(2000, [1000, 1000]);

      const pagamentosAntes = await contarEm("payments");
      const alocacoesAntes = await contarEm("alocacoes");

      esperado(
        await api.post("/payments/preview", { honorarioId: fee._id, valor: 1500, tipo: "comum" }),
        200,
        "preview"
      );

      assert.equal(await contarEm("payments"), pagamentosAntes, "nenhum pagamento gravado");
      assert.equal(await contarEm("alocacoes"), alocacoesAntes, "nenhuma alocação gravada");

      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário depois do preview");
      iguais(lido.saldoAdiantado, 0, "o saldo adiantado não se moveu");
      iguais(lido.totais.pago, 0, "nada foi recebido");
    });

    test("as recusas do preview são as MESMAS da criação: 409 cancelado, 400 com campo", async () => {
      const fee = await honorarioCom(2000, [1000]);
      esperado(await api.patch(`/fees/${fee._id}`, { status: "cancelado" }), 200, "cancelamento");

      const cancelado = await api.post("/payments/preview", {
        honorarioId: fee._id,
        valor: 500,
        tipo: "comum"
      });
      assert.equal(cancelado.status, 409, "honorário cancelado não recebe dinheiro");
      assert.equal(cancelado.body.regra, "honorarioCancelado", "a regra vem nomeada");

      const outro = await honorarioCom(2000, [1000]);
      const zerado = await api.post("/payments/preview", {
        honorarioId: outro._id,
        valor: 0,
        tipo: "comum"
      });
      assert.equal(zerado.status, 400, "valor zero é recusado");
      assert.equal(zerado.body.campo, "valor", "com o campo, para a tela destacar o input");
    });

    test("o preview é ISOLADO POR TENANT: honorário de outra usuária responde 404", async () => {
      const fee = await honorarioCom(2000, [1000]);
      const outra = await registrarUsuario("f1b-invasora");

      const r = await outra.post("/payments/preview", {
        honorarioId: fee._id,
        valor: 500,
        tipo: "comum"
      });
      assert.equal(r.status, 404, "quem não é dona não fica sabendo que o honorário existe");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. GET /fees/:id — a leitura que sustenta a página do honorário
  // ═══════════════════════════════════════════════════════════════════════
  describe("2. GET /fees/:id devolve o que a página precisa numa leitura", () => {
    test("processo, cliente, totais da DEC-040 e contagem de parcelas", async () => {
      const fee = await honorarioCom(3000, [1000, 1000, 1000]);
      await criarPagamento(api, fee._id, { valor: 1500 });

      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "leitura do honorário");

      // O cabeçalho da página: processo e cliente CLICÁVEIS precisam de id e
      // nome — sem eles a tela teria de fazer duas leituras a mais só para
      // escrever dois links.
      assert.ok(lido.processoId?._id, "o processo vem populado");
      assert.ok(lido.processoId?.titulo, "com título, para o link ter texto");
      assert.equal(String(lido.cliente?._id), String(clientePJ._id), "o cliente principal");
      assert.equal(lido.cliente.tipoPessoa, "juridica", "o tipo de pessoa");
      assert.equal(
        lido.cliente.nome,
        clientePJ.razaoSocial,
        "PJ é identificada pela razão social, como no portal e nos documentos"
      );

      // Os quatro números do cabeçalho.
      iguais(lido.totais.contratado, 3000, "contratado");
      iguais(lido.totais.pago, 1500, "recebido");
      iguais(lido.totais.emAberto, 1500, "em aberto");
      iguais(lido.totais.saldoAdiantado, 0, "saldo adiantado");

      assert.equal(lido.contagemParcelas.total, 3, "três parcelas");
      assert.equal(lido.parcelas.length, 3, "e elas vêm na resposta");
      assert.equal(lido.parcelas[0].numeroParcela, 1, "ordenadas pelo número");
      iguais(lido.parcelas[0].valorPago, 1000, "a primeira foi quitada");
      iguais(lido.parcelas[1].emAberto, 500, "a segunda ficou pela metade");
    });

    test("CRÉDITO é campo próprio: nunca dentro de recebido, nunca abatendo o em aberto", async () => {
      // A regra que o smoke test de 17/08/2026 pegou mentindo. Pagamento maior
      // que a única parcela: 1.000 encostam nela, 1.500 viram crédito.
      const fee = await honorarioCom(3000, [1000]);
      await criarPagamento(api, fee._id, { valor: 2500 });

      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário com crédito");

      iguais(lido.totais.pago, 1000, "recebido conta só o que ENCOSTOU em parcela");
      iguais(lido.totais.saldoAdiantado, 1500, "o crédito sai nomeado à parte");
      iguais(
        lido.totais.emAberto,
        2000,
        "em aberto = contratado − recebido, SEM descontar o crédito (DEC-040)"
      );
    });

    test("em aberto tem PISO ZERO na leitura do honorário", async () => {
      // O caminho que produz `valorPago > valor`: reduzir a parcela DEPOIS de
      // ela ter recebido alocação. Sem o piso a página exibiria negativo.
      const fee = await honorarioCom(1000, [1000]);
      const parcela = esperado(
        await api.get(`/installments?processoId=${processo._id}&limit=100`),
        200,
        "listagem de parcelas"
      ).data.find((p) => String(p.feeId?._id ?? p.feeId) === String(fee._id));

      await criarPagamento(api, fee._id, { valor: 1000 });
      esperado(
        await api.patch(`/installments/${parcela._id}`, { valor: 400 }),
        200,
        "redução da parcela já paga"
      );

      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário");
      assert.ok(lido.totais.emAberto >= 0, "em aberto nunca é negativo");
      assert.ok(lido.parcelas[0].emAberto >= 0, "nem o da parcela");
    });

    test("parcela REPARCELADA traz o vínculo e a data da operação", async () => {
      const fee = await honorarioCom(2000, [1000, 1000]);
      await criarReparcelamento(api, fee._id, [
        { valor: 1000, dataVencimento: "2027-01-10" },
        { valor: 1000, dataVencimento: "2027-02-10" }
      ]);

      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário reparcelado");
      const substituidas = lido.parcelas.filter((p) => p.reparcelamentoId);

      assert.equal(substituidas.length, 2, "as duas antigas saíram por reparcelamento");
      for (const p of substituidas) {
        assert.ok(
          p.reparceladaEm,
          "com a DATA da operação, para a página escrever a frase sem outra ida ao banco"
        );
      }
      // O rótulo "Reparcelada" é de LEITURA: no banco continua `cancelado`
      // com o vínculo preenchido. É a distinção da F-1a.1.
      assert.equal(substituidas[0].status, "cancelado", "no banco é cancelado");
    });

    test("honorário de outra usuária responde 404, com os campos novos e tudo", async () => {
      const fee = await honorarioCom(1000, [1000]);
      const outra = await registrarUsuario("f1b-invasora-2");
      assert.equal((await outra.get(`/fees/${fee._id}`)).status, 404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. A CONTA DOS TOTAIS É UMA SÓ
  // ═══════════════════════════════════════════════════════════════════════
  describe("3. a ficha do processo e a página do honorário não podem discordar", () => {
    test("os totais de GET /fees/:id batem com os da ficha, número a número", async () => {
      // Um honorário com o caso difícil: pagamento que atravessa parcela e
      // deixa crédito. É onde duas fórmulas divergiriam.
      const fee = await honorarioCom(4000, [1000, 1000]);
      await criarPagamento(api, fee._id, { valor: 2600 });

      const daPagina = esperado(await api.get(`/fees/${fee._id}`), 200, "página do honorário").totais;
      const ficha = esperado(
        await api.get(`/financeiro/processos/${processo._id}`),
        200,
        "ficha do processo"
      );
      const naFicha = ficha.honorarios.find((h) => String(h._id) === String(fee._id)).totais;

      for (const chave of ["contratado", "pago", "pagoLiquidoAlocado", "saldoAdiantado", "emAberto"]) {
        iguais(
          daPagina[chave],
          naFicha[chave],
          `\`${chave}\` precisa ser o MESMO número nas duas telas — ` +
            "as duas leem a conta de `services/feeTotals.js`"
        );
      }

      // E os números são os que a DEC-040 manda.
      iguais(daPagina.pago, 2000, "recebido: o que encostou nas duas parcelas");
      iguais(daPagina.saldoAdiantado, 600, "o crédito, à parte");
      iguais(daPagina.emAberto, 2000, "em aberto, sem desconto do crédito");
    });
  });
});
