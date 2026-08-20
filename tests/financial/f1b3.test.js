// ═══════════════════════════════════════════════════════════════════════════
// FASE F-1b.3 — ACHAR O LANÇAMENTO
//
// Esta fase acrescenta às três listagens financeiras o que faltava para
// encontrar um pagamento sem lembrar de qual honorário ele é: recorte por
// HONORÁRIO, BUSCA livre e PERÍODO. E muda a frase do vínculo do extrato
// (DEC-045).
//
// ── O que este arquivo mede, e o que ele NÃO mede ────────────────────────
// Mede o contrato: o filtro isolado recorta, os filtros combinam em AND, o
// parâmetro torto vira 400 com `campo`, e a paginação continua coerente com o
// filtro aplicado. Não mede a tela — quem faz isso é a varredura estática do
// frontend, e o roteiro (passos 172+) para o que só olho humano vê.
//
// ── A ARMADILHA do teste de filtro, e como cada bloco escapa dela ────────
// Um filtro quebrado que devolve TUDO passa em qualquer asserção do tipo
// "achei o que procurava". Por isso todo bloco aqui afirma as duas metades: o
// que ENTROU no recorte e o que FICOU DE FORA. Sem a segunda, `filter` vazio
// passaria em quase tudo — foi exatamente esse o defeito que a F-0 mediu nos
// filtros de id (`?processoId=xyz` devolvia a base inteira).
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario,
  criarClientePF,
  criarProcesso,
  criarHonorario,
  criarParcela,
  criarPagamento,
  esperado
} from "../helpers/setup.js";

describe("F-1b.3 — filtros de listagem financeira", () => {
  let api;
  // Dois processos, dois honorários, para todo recorte ter um lado de fora.
  let processoAlfa, processoBeta;
  let honorarioAlfa, honorarioBeta;
  let parcelaAlfa1, parcelaBeta1;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("f1b3");
    const pf = await criarClientePF(api);

    processoAlfa = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ], { titulo: "Execução Fiscal Alfa", numeroProcesso: "70000000000000001" });

    processoBeta = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ], { titulo: "Inventário Beta", numeroProcesso: "80000000000000002" });

    honorarioAlfa = await criarHonorario(api, processoAlfa._id, {
      descricao: "Honorários advocatícios — execução fiscal",
      valor: 6000,
      dataVencimento: "2026-06-30"
    });

    honorarioBeta = await criarHonorario(api, processoBeta._id, {
      descricao: "Honorários advocatícios — inventário e partilha",
      valor: 4000,
      dataVencimento: "2026-11-30"
    });

    parcelaAlfa1 = await criarParcela(api, honorarioAlfa._id, 1, {
      valor: 3000,
      dataVencimento: "2026-06-10"
    });
    await criarParcela(api, honorarioAlfa._id, 2, {
      valor: 3000,
      dataVencimento: "2026-07-10"
    });
    parcelaBeta1 = await criarParcela(api, honorarioBeta._id, 1, {
      valor: 4000,
      dataVencimento: "2026-11-10"
    });

    // Três pagamentos, com datas, formas e observações distintas — cada um
    // existe para ser o "de fora" de algum recorte.
    await criarPagamento(api, honorarioAlfa._id, {
      valor: 1000,
      data: "2026-06-05",
      formaPagamento: "pix",
      observacoes: "adiantamento combinado por telefone"
    });
    await criarPagamento(api, honorarioAlfa._id, {
      valor: 500,
      data: "2026-06-20",
      formaPagamento: "dinheiro",
      observacoes: "entregue na recepção"
    });
    await criarPagamento(api, honorarioBeta._id, {
      valor: 800,
      data: "2026-11-05",
      formaPagamento: "transferencia",
      observacoes: "depósito identificado"
    });
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const listar = async (rota, contexto = rota) =>
    esperado(await api.get(rota), 200, `listagem ${contexto}`);

  const recusa = async (rota) => {
    const r = await api.get(rota);
    return { status: r.status, body: r.body };
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — O DISCRIMINANTE: sem filtro, tudo está lá
  //
  // Sem esta asserção, os blocos abaixo passariam com um `filter` que esvazia
  // a listagem por acidente.
  // ═════════════════════════════════════════════════════════════════════════
  describe("o conjunto completo, antes de qualquer recorte", () => {
    test("as três listagens devolvem tudo quando não se filtra nada", async () => {
      assert.equal((await listar("/payments")).total, 3);
      assert.equal((await listar("/installments")).total, 3);
      assert.equal((await listar("/fees")).total, 2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — `?honorarioId=`
  // ═════════════════════════════════════════════════════════════════════════
  describe("recorte por honorário", () => {
    test("pagamentos: só os do honorário pedido", async () => {
      const corpo = await listar(`/payments?honorarioId=${honorarioAlfa._id}`);
      assert.equal(corpo.total, 2, "os dois pagamentos do Alfa");
      for (const p of corpo.data) {
        assert.equal(String(p.honorarioId?._id ?? p.honorarioId), String(honorarioAlfa._id));
      }
    });

    test("parcelas: `honorarioId` é o `feeId` do schema, com o nome da tela", async () => {
      const corpo = await listar(`/installments?honorarioId=${honorarioAlfa._id}`);
      assert.equal(corpo.total, 2, "as duas parcelas do Alfa");
      for (const i of corpo.data) {
        assert.equal(String(i.feeId?._id ?? i.feeId), String(honorarioAlfa._id));
      }
    });

    test("o outro honorário fica de fora — o filtro recorta, não ordena", async () => {
      const corpo = await listar(`/installments?honorarioId=${honorarioBeta._id}`);
      assert.equal(corpo.total, 1);
      assert.equal(corpo.data[0].numeroParcela, 1);
      assert.equal(String(corpo.data[0].feeId?._id ?? corpo.data[0].feeId), String(honorarioBeta._id));
    });

    test("id malformado é 400 com `campo`, e não lista vazia", async () => {
      for (const rota of [
        "/payments?honorarioId=nao-e-um-id",
        "/installments?honorarioId=nao-e-um-id"
      ]) {
        const { status, body } = await recusa(rota);
        assert.equal(status, 400, `${rota}: id torto tem de ser recusado`);
        assert.equal(body.campo, "honorarioId", `${rota}: o 400 tem de nomear o campo`);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — `?busca=`
  //
  // Três alvos declarados: descrição do honorário, número do processo e (só
  // onde o campo existe) observações. Cada teste abaixo prova UM alvo, e prova
  // que o outro conjunto não veio junto.
  // ═════════════════════════════════════════════════════════════════════════
  describe("busca livre", () => {
    test("casa a DESCRIÇÃO do honorário, nas três listagens", async () => {
      const pagamentos = await listar("/payments?busca=execução fiscal");
      assert.equal(pagamentos.total, 2);

      const parcelas = await listar("/installments?busca=execução fiscal");
      assert.equal(parcelas.total, 2);

      const honorarios = await listar("/fees?busca=execução fiscal");
      assert.equal(honorarios.total, 1);
      assert.equal(String(honorarios.data[0]._id), String(honorarioAlfa._id));
    });

    test("casa o NÚMERO DO PROCESSO — o dado que o cliente manda por mensagem", async () => {
      const pagamentos = await listar(`/payments?busca=${processoBeta.numeroProcesso}`);
      assert.equal(pagamentos.total, 1);
      assert.equal(pagamentos.data[0].valor, 800);

      const honorarios = await listar(`/fees?busca=${processoBeta.numeroProcesso}`);
      assert.equal(honorarios.total, 1);
      assert.equal(String(honorarios.data[0]._id), String(honorarioBeta._id));
    });

    test("casa as OBSERVAÇÕES, e só na listagem que tem o campo", async () => {
      const corpo = await listar("/payments?busca=recepção");
      assert.equal(corpo.total, 1, "só o pagamento entregue na recepção");
      assert.equal(corpo.data[0].valor, 500);

      // Alcance declarado: `Installment` não tem `observacoes`. O termo que só
      // existe numa observação de pagamento não devolve parcela nenhuma — e é
      // isso que o teste fixa, para o alcance não crescer por acidente nem
      // encolher em silêncio.
      const parcelas = await listar("/installments?busca=recepção");
      assert.equal(parcelas.total, 0);
    });

    test("termo sem correspondência devolve vazio, não a base inteira", async () => {
      assert.equal((await listar("/payments?busca=jamais-existiu")).total, 0);
      assert.equal((await listar("/installments?busca=jamais-existiu")).total, 0);
      assert.equal((await listar("/fees?busca=jamais-existiu")).total, 0);
    });

    test("termo vazio não filtra — filtro ausente não filtra", async () => {
      assert.equal((await listar("/payments?busca=")).total, 3);
      assert.equal((await listar("/payments?busca=%20%20")).total, 3);
    });

    test("metacaractere de regex é escapado, não interpretado", async () => {
      // `.*` casaria tudo se o termo virasse padrão. É o defeito que
      // `escaparRegex` existe para impedir, e a F-0 unificou em `utils/texto`.
      assert.equal((await listar("/payments?busca=.*")).total, 0);
      assert.equal((await listar("/fees?busca=.*")).total, 0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4 — `?de=` / `?ate=`
  // ═════════════════════════════════════════════════════════════════════════
  describe("período", () => {
    test("pagamentos: recorta por data do pagamento, com as bordas INCLUSIVAS", async () => {
      // 05/06 e 20/06 são exatamente as duas bordas. Um `ate` em meia-noite
      // engoliria o dia inteiro que a pessoa digitou.
      const corpo = await listar("/payments?de=2026-06-05&ate=2026-06-20");
      assert.equal(corpo.total, 2, "as duas bordas entram");

      const soPrimeiro = await listar("/payments?de=2026-06-05&ate=2026-06-05");
      assert.equal(soPrimeiro.total, 1, "um dia só é um período de um dia");
      assert.equal(soPrimeiro.data[0].valor, 1000);
    });

    test("aceita um sem o outro — período aberto de um lado", async () => {
      assert.equal((await listar("/payments?de=2026-07-01")).total, 1, "daqui em diante");
      assert.equal((await listar("/payments?ate=2026-06-30")).total, 2, "até aqui");
    });

    test("parcelas e honorários recortam por VENCIMENTO", async () => {
      const parcelas = await listar("/installments?de=2026-06-01&ate=2026-07-31");
      assert.equal(parcelas.total, 2, "as duas parcelas do Alfa vencem no recorte");

      const honorarios = await listar("/fees?de=2026-01-01&ate=2026-06-30");
      assert.equal(honorarios.total, 1);
      assert.equal(String(honorarios.data[0]._id), String(honorarioAlfa._id));
    });

    test("data malformada é 400 com `campo`", async () => {
      for (const [rota, campo] of [
        ["/payments?de=ontem", "de"],
        ["/payments?ate=10/06/2026", "ate"],
        ["/installments?de=2026-13-01", "de"],
        ["/fees?ate=2026-02-31", "ate"]
      ]) {
        const { status, body } = await recusa(rota);
        assert.equal(status, 400, `${rota}: data torta tem de ser recusada`);
        assert.equal(body.campo, campo, `${rota}: o 400 tem de nomear o campo`);
      }
    });

    test("`de` posterior a `ate` é 400 que EXPLICA, e não lista vazia", async () => {
      for (const rota of [
        "/payments?de=2026-06-20&ate=2026-06-05",
        "/installments?de=2026-12-01&ate=2026-01-01",
        "/fees?de=2026-12-01&ate=2026-01-01"
      ]) {
        const { status, body } = await recusa(rota);
        assert.equal(status, 400, `${rota}`);
        assert.equal(body.campo, "de");
        assert.match(
          body.message ?? body.erro ?? "",
          /posterior/i,
          "a mensagem tem de dizer o que está errado, não só recusar"
        );
      }
    });

    test("período sem lançamento devolve vazio — e o vazio é do recorte", async () => {
      const corpo = await listar("/payments?de=2027-01-01&ate=2027-12-31");
      assert.equal(corpo.total, 0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5 — OS FILTROS COMBINAM EM AND
  //
  // O erro clássico é montar `$or` no lugar de `$and` e o segundo filtro
  // ALARGAR o conjunto em vez de estreitá-lo. Cada teste aqui compara o
  // combinado com cada metade isolada.
  // ═════════════════════════════════════════════════════════════════════════
  describe("filtros compostos", () => {
    test("honorário + período + forma, na listagem de pagamentos", async () => {
      const soHonorario = await listar(`/payments?honorarioId=${honorarioAlfa._id}`);
      assert.equal(soHonorario.total, 2);

      const comPeriodo = await listar(
        `/payments?honorarioId=${honorarioAlfa._id}&de=2026-06-10&ate=2026-06-30`
      );
      assert.equal(comPeriodo.total, 1, "o período estreita o recorte do honorário");
      assert.equal(comPeriodo.data[0].valor, 500);

      const comForma = await listar(
        `/payments?honorarioId=${honorarioAlfa._id}&de=2026-06-10&ate=2026-06-30&formaPagamento=pix`
      );
      assert.equal(comForma.total, 0, "AND de verdade: pix está fora deste período");
    });

    test("busca + honorário: a busca não alarga o recorte do honorário", async () => {
      // "execução fiscal" casa o honorário Alfa; combinado com o Beta, o
      // resultado tem de ser vazio. Num `$or`, viriam os dois pagamentos do
      // Alfa junto — é este o teste que separa AND de OR.
      const corpo = await listar(
        `/payments?honorarioId=${honorarioBeta._id}&busca=execução fiscal`
      );
      assert.equal(corpo.total, 0);
    });

    test("busca + período, na listagem de parcelas", async () => {
      const corpo = await listar(
        "/installments?busca=execução fiscal&de=2026-07-01&ate=2026-07-31"
      );
      assert.equal(corpo.total, 1, "a parcela 2 do Alfa");
      assert.equal(corpo.data[0].numeroParcela, 2);
    });

    test("busca + tipo + status + período, na listagem de honorários", async () => {
      const corpo = await listar(
        "/fees?busca=honorários advocatícios&tipo=fixo&de=2026-01-01&ate=2026-06-30"
      );
      assert.equal(corpo.total, 1);
      assert.equal(String(corpo.data[0]._id), String(honorarioAlfa._id));

      const semNada = await listar(
        "/fees?busca=honorários advocatícios&tipo=percentual&de=2026-01-01&ate=2026-06-30"
      );
      assert.equal(semNada.total, 0, "o tipo continua estreitando");
    });

    test("`?installmentId=` continua filtrando por alocação, junto dos novos", async () => {
      const corpo = await listar(
        `/payments?installmentId=${parcelaAlfa1._id}&de=2026-06-01&ate=2026-06-30`
      );
      assert.ok(corpo.total >= 1, "o pagamento que encostou na parcela 1 está no período");
      const outraParcela = await listar(
        `/payments?installmentId=${parcelaBeta1._id}&de=2026-06-01&ate=2026-06-30`
      );
      assert.equal(outraParcela.total, 0, "a parcela do Beta não recebeu nada em junho");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6 — PAGINAÇÃO COM FILTRO APLICADO
  //
  // O defeito que este bloco procura é o registro que aparece nas DUAS
  // páginas: acontece quando a ordenação não é determinística e o `skip` cai
  // no meio de um empate. Com filtro aplicado, o conjunto é menor e o empate
  // fica mais provável, não menos.
  // ═════════════════════════════════════════════════════════════════════════
  describe("paginação com filtro", () => {
    let honorarioPaginado;

    before(async () => {
      honorarioPaginado = await criarHonorario(api, processoAlfa._id, {
        descricao: "Honorários advocatícios — cobrança paginada",
        valor: 5000,
        dataVencimento: "2026-09-30"
      });
      await criarParcela(api, honorarioPaginado._id, 1, {
        valor: 5000,
        dataVencimento: "2026-09-10"
      });
      // Cinco pagamentos NO MESMO DIA: o pior caso para a ordenação por data.
      for (let i = 0; i < 5; i += 1) {
        await criarPagamento(api, honorarioPaginado._id, {
          valor: 100 + i,
          data: "2026-09-01",
          formaPagamento: "pix"
        });
      }
    });

    test("duas páginas com o mesmo filtro, sem id repetido", async () => {
      const rota = `/payments?honorarioId=${honorarioPaginado._id}&de=2026-09-01&ate=2026-09-30`;
      const p1 = await listar(`${rota}&page=1&limit=3`);
      const p2 = await listar(`${rota}&page=2&limit=3`);

      assert.equal(p1.total, 5, "o total é do CONJUNTO FILTRADO, não da base");
      assert.equal(p2.total, 5);
      assert.equal(p1.totalPages, 2, "5 itens em páginas de 3 são 2 páginas");
      assert.equal(p1.data.length, 3);
      assert.equal(p2.data.length, 2);

      const ids = [...p1.data, ...p2.data].map((p) => String(p._id));
      assert.equal(new Set(ids).size, 5, "nenhum pagamento pode sair nas duas páginas");
    });

    test("o filtro continua valendo na página 2", async () => {
      const p2 = await listar(
        `/payments?honorarioId=${honorarioPaginado._id}&page=2&limit=3`
      );
      for (const p of p2.data) {
        assert.equal(
          String(p.honorarioId?._id ?? p.honorarioId),
          String(honorarioPaginado._id),
          "a página 2 vazou um pagamento de outro honorário"
        );
      }
    });

    test("página além do fim é lista vazia com `totalPages` coerente", async () => {
      const corpo = await listar(
        `/payments?honorarioId=${honorarioPaginado._id}&page=9&limit=3`
      );
      assert.equal(corpo.data.length, 0);
      assert.equal(corpo.total, 5);
      assert.equal(corpo.totalPages, 2);
    });
  });
});
