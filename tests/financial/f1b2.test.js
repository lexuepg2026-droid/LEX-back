// ═══════════════════════════════════════════════════════════════════════════
// FASE F-1b.2 — DEC-044: toda linha do extrato que deixou de valer diz isso
//
// ── O defeito, com o caso real ────────────────────────────────────────────
// Estornar R$ 1.000,00 de um pagamento de R$ 4.500,00 e depois ANULAR o
// estorno deixa o extrato assim:
//
//     Alocação  R$ 3.000,00   (viva)
//     Alocação  R$ 1.500,00   (desfeita pelo estorno — mas nada dizia isso)
//     Alocação  R$   500,00   (substituta: o resto da de 1.500)
//     Alocação  R$ 1.000,00   (nasceu da anulação)
//                 ─────────
//                 R$ 6.000,00  ← para um pagamento de R$ 4.500,00
//
// A CONTA do sistema está certa: a alocação de 1.500 não vale mais, e o
// líquido continua 4.500. O que estava errado é a LEITURA — quem lê de cima a
// baixo soma 6.000 e não tem como saber que uma das linhas foi anulada.
//
// O estorno anulado já tinha o tratamento certo desde a F-1b (`anulado: true`,
// e a tela escreve "este estorno foi anulado depois"). A alocação desfeita não
// tinha nenhum. DEC-044 é a simetria: `desfeitaEm`, `estornoQueDesfezId` e
// `valorEstornoQueDesfez` na linha da alocação, `substituiAlocacaoId` e
// `estornoQueGerouId` na substituta.
//
// ── Por que é teste de BACKEND ────────────────────────────────────────────
// A frase é da tela, mas a INFORMAÇÃO é do contrato: sem estes campos a tela
// não teria como escrever "desfeita em 18/08/2026 pelo estorno de R$ 1.000,00"
// sem sair inventando (ou sem abrir uma segunda leitura por linha). O que se
// prova aqui é que o contrato carrega o fato; que a tela o escreve é a
// varredura estática do front.
//
// ── `dataPagamento` ───────────────────────────────────────────────────────
// A alocação nascida de uma ANULAÇÃO grava `data` = data da anulação. A frase
// do extrato dizia "Do pagamento de {data da alocação}" — ou seja, afirmava
// uma data em que pagamento nenhum aconteceu. O contrato passa a expor a data
// real do pagamento ao lado do `pagamentoId`.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarEstorno, anularEstorno, esperado
} from "../helpers/setup.js";

const centavos = (n) => Math.round(Number(n || 0) * 100);
const iguais = (a, b, msg) => assert.equal(centavos(a), centavos(b), msg);

describe("F-1b.2 — o extrato se lê sem somar errado (DEC-044)", () => {
  let api, processo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("f1b2");
    const cliente = await criarClientePF(api);
    processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const extratoDe = async (feeId) =>
    esperado(await api.get(`/fees/${feeId}/statement?limit=100`), 200, "extrato");

  // O caso do Daniel, montado do zero: 6.000 em duas parcelas de 3.000, um
  // pagamento de 4.500 (quita a 1ª e abate 1.500 da 2ª), estorno de 1.000 e
  // anulação dele.
  const casoDoDaniel = async () => {
    const fee = await criarHonorario(api, processo._id, { valor: 6000 });
    await criarParcela(api, fee._id, 1, { valor: 3000, dataVencimento: "2026-06-15" });
    await criarParcela(api, fee._id, 2, { valor: 3000, dataVencimento: "2026-07-15" });

    const { pagamento } = await criarPagamento(api, fee._id, {
      valor: 4500, data: "2026-05-08", formaPagamento: "pix"
    });
    const { estorno } = await criarEstorno(api, pagamento._id, {
      valor: 1000, motivo: "Devolucao parcial acordada", data: "2026-08-18"
    });
    await anularEstorno(api, pagamento._id, estorno._id, { data: "2026-08-18" });

    return { fee, pagamento, estorno };
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 1. A ALOCAÇÃO DESFEITA
  // ═══════════════════════════════════════════════════════════════════════
  describe("1. alocação desfeita: quando, e por qual estorno", () => {
    test("a linha da alocação carrega a data em que foi desfeita e o estorno que a desfez", async () => {
      const { fee, estorno } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);

      const desfeitas = extrato.data.filter((e) => e.tipo === "alocacao" && e.ativa === false);
      assert.equal(desfeitas.length, 1, "exatamente uma alocação foi desfeita neste caso");

      const [a] = desfeitas;
      iguais(a.valor, 1500, "é a alocação de 1.500 da parcela 2 que caiu");
      assert.ok(a.desfeitaEm, "`desfeitaEm` diz QUANDO — sem ele a tela só sabe QUE caiu");
      assert.equal(
        new Date(a.desfeitaEm).toISOString().slice(0, 10), "2026-08-18",
        "e a data é a do estorno, não a da alocação"
      );
      assert.equal(String(a.estornoQueDesfezId), String(estorno._id), "e POR QUAL estorno");
      iguais(a.valorEstornoQueDesfez, 1000, "com o valor dele, para a frase da tela");
    });

    test("alocação viva não carrega marca de desfeita — nem `null` disfarçado de data", async () => {
      const { fee } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);

      const vivas = extrato.data.filter((e) => e.tipo === "alocacao" && e.ativa !== false);
      assert.ok(vivas.length >= 3, "as três alocações vivas do caso");
      for (const a of vivas) {
        assert.equal(a.desfeitaEm, null, "alocação viva não tem data de desfazimento");
        assert.equal(a.estornoQueDesfezId, null);
        assert.equal(a.valorEstornoQueDesfez, null);
      }
    });

    // A asserção que dá nome à fase.
    test("A SOMA DAS ALOCAÇÕES VIVAS É O VALOR DO PAGAMENTO — e a das exibidas, não", async () => {
      const { fee } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);
      const alocacoes = extrato.data.filter((e) => e.tipo === "alocacao");

      const soma = (lista) => lista.reduce((t, e) => t + centavos(e.valor), 0);

      assert.equal(soma(alocacoes), 600000, "o total ingênuo é 6.000 — o defeito que a fase corrige");
      assert.equal(
        soma(alocacoes.filter((e) => e.ativa !== false)), 450000,
        "as VIVAS somam exatamente o pagamento de 4.500"
      );
      // E o que separa uma leitura da outra está na própria linha: nenhuma
      // alocação desfeita fica sem marca.
      for (const a of alocacoes.filter((e) => e.ativa === false)) {
        assert.ok(a.desfeitaEm && a.estornoQueDesfezId, "toda desfeita diz que foi desfeita");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. A ALOCAÇÃO SUBSTITUTA (DEC-035)
  // ═══════════════════════════════════════════════════════════════════════
  describe("2. alocação substituta: de onde ela veio", () => {
    test("a substituta aponta a alocação que ela substitui e o estorno que a gerou", async () => {
      const { fee, estorno } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);

      const substitutas = extrato.data.filter(
        (e) => e.tipo === "alocacao" && e.substituiAlocacaoId
      );
      assert.equal(substitutas.length, 1, "o estorno parcial produziu UMA substituta");

      const [s] = substitutas;
      iguais(s.valor, 500, "é o resto de 1.500 menos os 1.000 estornados");
      assert.equal(String(s.estornoQueGerouId), String(estorno._id));
      iguais(s.valorEstornoQueGerou, 1000);

      // O vínculo aponta a alocação certa: a de 1.500, que está desfeita.
      const original = extrato.data.find(
        (e) => e.tipo === "alocacao" && String(e.alocacaoId) === String(s.substituiAlocacaoId)
      );
      assert.ok(original, "a alocação substituída está no mesmo extrato");
      iguais(original.valor, 1500);
      assert.equal(original.ativa, false, "e ela é justamente a que deixou de valer");
    });

    test("a substituta herda a data do pagamento — e é por isso que precisa se declarar", async () => {
      const { fee, pagamento } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);
      const [s] = extrato.data.filter((e) => e.tipo === "alocacao" && e.substituiAlocacaoId);

      assert.equal(
        new Date(s.data).toISOString().slice(0, 10),
        new Date(pagamento.data).toISOString().slice(0, 10),
        "ela aparece no bloco do dia do pagamento, junto das originais"
      );
      // Sem `substituiAlocacaoId` ela seria indistinguível de uma original —
      // e é isso que fazia o bloco daquele dia parecer alocar mais do que o
      // pagamento tinha.
      const originaisDoDia = extrato.data.filter(
        (e) => e.tipo === "alocacao" && !e.substituiAlocacaoId &&
               new Date(e.data).getTime() === new Date(s.data).getTime()
      );
      assert.ok(originaisDoDia.length > 0, "há originais no mesmo dia — o caso que confundia");
    });

    test("alocação original NÃO se declara substituta", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: "2026-06-15" });
      await criarPagamento(api, fee._id, { valor: 1000, data: "2026-05-08" });

      const extrato = await extratoDe(fee._id);
      const alocacoes = extrato.data.filter((e) => e.tipo === "alocacao");
      assert.equal(alocacoes.length, 1);
      assert.equal(alocacoes[0].substituiAlocacaoId, null);
      assert.equal(alocacoes[0].estornoQueGerouId, null);
      assert.equal(alocacoes[0].valorEstornoQueGerou, null);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. A REFERÊNCIA DO PAGAMENTO
  // ═══════════════════════════════════════════════════════════════════════
  describe("3. a linha diz de QUAL pagamento veio", () => {
    test("alocação e desalocação expõem a data REAL do pagamento, não a própria", async () => {
      const { fee, pagamento } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);

      const dia = (d) => new Date(d).toISOString().slice(0, 10);

      for (const e of extrato.data.filter((x) => x.tipo === "alocacao" || x.tipo === "desalocacao")) {
        assert.ok(e.dataPagamento, `${e.id} precisa da data do pagamento`);
        assert.equal(dia(e.dataPagamento), dia(pagamento.data), `${e.id}`);
      }

      // A prova de que os dois campos são MESMO diferentes: a alocação nascida
      // da anulação está datada em 18/08, e o pagamento é de 08/05. Era esta a
      // linha que dizia "Do pagamento de 18/08/2026".
      const daAnulacao = extrato.data.find(
        (e) => e.tipo === "alocacao" && dia(e.data) !== dia(pagamento.data)
      );
      assert.ok(daAnulacao, "a realocação da anulação tem data própria");
      assert.equal(dia(daAnulacao.data), "2026-08-18");
      assert.equal(dia(daAnulacao.dataPagamento), "2026-05-08", "e o pagamento continua sendo o de maio");
    });

    test("DOIS pagamentos no MESMO DIA são distinguíveis pelo `pagamentoId`", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 4000 });
      await criarParcela(api, fee._id, 1, { valor: 2000, dataVencimento: "2026-06-15" });
      await criarParcela(api, fee._id, 2, { valor: 2000, dataVencimento: "2026-07-15" });

      const a = await criarPagamento(api, fee._id, { valor: 2000, data: "2026-05-20", formaPagamento: "pix" });
      const b = await criarPagamento(api, fee._id, { valor: 2000, data: "2026-05-20", formaPagamento: "transferencia" });

      const extrato = await extratoDe(fee._id);
      const alocacoes = extrato.data.filter((e) => e.tipo === "alocacao");
      assert.equal(alocacoes.length, 2);

      const ids = new Set(alocacoes.map((e) => String(e.pagamentoId)));
      assert.equal(ids.size, 2, "os dois pagamentos do dia têm ids distintos na linha");
      assert.ok(ids.has(String(a.pagamento._id)) && ids.has(String(b.pagamento._id)));

      // O sufixo curto que a tela exibe ("Pagamento #1ebee9") também separa os
      // dois: se colidisse, a referência curta não referenciaria nada.
      const curtos = new Set([...ids].map((id) => id.slice(-6)));
      assert.equal(curtos.size, 2, "e os sufixos de 6 caracteres não colidem");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. A DESALOCAÇÃO CUJO ESTORNO FOI ANULADO
  // ═══════════════════════════════════════════════════════════════════════
  describe("4. a desalocação diz quando o estorno dela já não vale", () => {
    test("`estornoAnulado` na desalocação — simetria com o `anulado` do estorno", async () => {
      const { fee } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);

      const [d] = extrato.data.filter((e) => e.tipo === "desalocacao");
      assert.ok(d, "a desalocação de 1.500 existe");
      assert.equal(d.estornoAnulado, true, "e o estorno que a causou foi anulado depois");

      const [estorno] = extrato.data.filter((e) => e.tipo === "estorno");
      assert.equal(estorno.anulado, true, "o par: a linha do estorno já dizia isso desde a F-1b");
    });

    test("estorno VIVO deixa a desalocação sem a marca", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 2000 });
      await criarParcela(api, fee._id, 1, { valor: 2000, dataVencimento: "2026-06-15" });
      const { pagamento } = await criarPagamento(api, fee._id, { valor: 2000, data: "2026-05-08" });
      await criarEstorno(api, pagamento._id, { valor: 2000, motivo: "Boleto devolvido" });

      const extrato = await extratoDe(fee._id);
      const [d] = extrato.data.filter((e) => e.tipo === "desalocacao");
      assert.equal(d.estornoAnulado, false, "este estorno continua valendo");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. A ORDEM CRONOLÓGICA, COMO DECISÃO (DEC-044, item 4)
  // ═══════════════════════════════════════════════════════════════════════
  describe("5. o extrato conta a história do começo", () => {
    test("os eventos saem do MAIS ANTIGO para o mais novo, e isso é contrato", async () => {
      const { fee } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);

      const datas = extrato.data.map((e) => new Date(e.data).getTime());
      for (let i = 1; i < datas.length; i += 1) {
        assert.ok(datas[i] >= datas[i - 1], `o evento ${i} não pode anteceder o ${i - 1}`);
      }
      // Não é divergência do prompt da F-1b: é a escolha registrada na
      // DEC-044. Extrato conta uma história, e história se lê do começo — é o
      // que permite somar as alocações vivas conferindo com o pagamento.
      //
      // A criação do honorário está na lista, mas NÃO é necessariamente a
      // primeira linha: `historicoStatus` é carimbado com o instante real da
      // criação, e um pagamento com `data` retroativa (o caso normal — a
      // advogada lança em agosto o PIX que caiu em maio) o antecede. Ordenar
      // por instante de gravação em vez de por data do fato faria o extrato
      // contar a história na ordem em que foi digitada, não na em que
      // aconteceu.
      assert.ok(
        extrato.data.some((e) => e.tipo === "mudancaStatus" && e.de === null),
        "a criação do honorário está na linha do tempo"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. NADA DAS DECISÕES ANTERIORES FOI AFROUXADO
  // ═══════════════════════════════════════════════════════════════════════
  describe("6. as regras das DEC-040/041/042/043 continuam de pé", () => {
    test("os totais do honorário não mudaram com os campos novos", async () => {
      const { fee } = await casoDoDaniel();
      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário");

      // O pagamento vale 4.500 outra vez (o estorno foi anulado), contra
      // 6.000 contratados.
      iguais(lido.totais.contratado, 6000);
      iguais(lido.totais.pago, 4500, "o líquido voltou ao valor cheio do pagamento");
      iguais(lido.totais.emAberto, 1500);
      iguais(lido.totais.saldoAdiantado, 0, "nada virou crédito neste caso");
    });

    test("a soma das alocações VIVAS é o que o backend chama de recebido", async () => {
      const { fee } = await casoDoDaniel();
      const extrato = await extratoDe(fee._id);
      const lido = esperado(await api.get(`/fees/${fee._id}`), 200, "honorário");

      const vivas = extrato.data
        .filter((e) => e.tipo === "alocacao" && e.ativa !== false)
        .reduce((t, e) => t + centavos(e.valor), 0);

      assert.equal(vivas, centavos(lido.totais.pago),
        "extrato e ficha não podem discordar — a regra da DEC-040");
    });
  });
});
