// ═══════════════════════════════════════════════════════════════════════════
// HONORÁRIO — DEC-027: hook condicional, `save()` e `campo`
//
// Os três pedaços da DEC-027 saíram no mesmo commit porque, separados, cada um
// entrega menos do que parece. Este arquivo testa os três juntos, pela mesma
// razão.
//
// O teste que justifica a fase inteira é o 1.2: o hook recusado por CADA rota
// de update existente. Sem ele, "migramos para `save()`" é promessa — o hook
// continuaria no schema e `findOneAndUpdate` continuaria passando por cima, e
// nenhum teste veria a diferença.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario, esperado
} from "../helpers/setup.js";
import { dadosHonorario } from "../helpers/factories.js";

// Os vocabulários vêm do model, nunca reescritos à mão: quem renomear um valor
// quebra o teste na hora, em vez de o frontend descobrir depois.
import { TIPOS_HONORARIO, STATUS_HONORARIO, TIPO_PERCENTUAL } from "../../src/models/Fee.js";

describe("honorário — DEC-027", () => {
  let api, cliente, processo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("honorario");
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

  const criar = (extra) => api.post("/fees", dadosHonorario(processo._id, extra));

  // Um 400 do hook: status, o caminho reprovado em `errors`, e o `campo` que a
  // tela usa para destacar o input.
  const recusado = (r, campoEsperado, contexto) => {
    assert.equal(r.status, 400, `${contexto}: esperado 400, veio ${r.status} — ${JSON.stringify(r.body)}`);
    assert.equal(r.body.campo, campoEsperado, `${contexto}: \`campo\` errado — ${JSON.stringify(r.body)}`);
    assert.ok(
      r.body.errors?.[campoEsperado],
      `${contexto}: faltou a mensagem por caminho em errors.${campoEsperado} — ${JSON.stringify(r.body)}`
    );
    return r.body;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — O hook condicional
  // ═════════════════════════════════════════════════════════════════════════

  describe("1. validação condicional ao tipo", () => {
    test("percentual AUSENTE onde é obrigatório → 400 com o campo", async () => {
      const corpo = recusado(
        await criar({ tipo: TIPO_PERCENTUAL, valorBase: 1000 }),
        "percentual",
        "tipo percentual sem percentual"
      );
      assert.match(corpo.errors.percentual, /exige o percentual/i);
    });

    test("`valorBase` ausente com percentual presente → 400", async () => {
      const corpo = recusado(
        await criar({ tipo: TIPO_PERCENTUAL, percentual: 10 }),
        "valorBase",
        "percentual sem valor base"
      );
      // Percentual sobre nada não é valor: a mensagem tem de dizer o que falta,
      // não "dados inválidos".
      assert.match(corpo.errors.valorBase, /valor base/i);
    });

    test("percentual fora de faixa → 400, nas duas bordas", async () => {
      for (const fora of [0, -5, 100.01, 150, 1000]) {
        const corpo = recusado(
          await criar({ tipo: TIPO_PERCENTUAL, percentual: fora, valorBase: 1000 }),
          "percentual",
          `percentual ${fora}`
        );
        assert.match(corpo.errors.percentual, /maior que zero e no máximo 100/i);
      }
    });

    test("as bordas VÁLIDAS da faixa são aceitas", async () => {
      // Contraprova: uma faixa implementada com `>=`/`<` no lugar errado
      // recusaria 100, que é percentual legítimo (honorário sobre a totalidade
      // do proveito).
      for (const dentro of [0.01, 1, 50, 100]) {
        const r = await criar({ tipo: TIPO_PERCENTUAL, percentual: dentro, valorBase: 1000 });
        assert.equal(r.status, 201, `percentual ${dentro} deveria ser aceito — ${JSON.stringify(r.body)}`);
      }
    });

    test("tipo que NÃO admite percentual recebendo um → 400", async () => {
      for (const tipo of TIPOS_HONORARIO.filter((t) => t !== TIPO_PERCENTUAL)) {
        const corpo = recusado(
          await criar({ tipo, valor: 500, percentual: 10, valorBase: 1000 }),
          "percentual",
          `tipo ${tipo} com percentual`
        );
        assert.match(corpo.errors.percentual, /não admite percentual/i);
      }
    });

    test("honorário fixo continua nascendo sem percentual nem valor base", async () => {
      const fee = await criarHonorario(api, processo._id, { tipo: "fixo", valor: 2000 });
      assert.equal(fee.tipo, "fixo");
      // Campo apagado é `null`, nunca `undefined` — convenção do projeto.
      assert.equal(fee.percentual, null, "honorário fixo deveria nascer com percentual null");
      assert.equal(fee.valorBase, null);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — A PROVA de que o hook não é contornável
  //
  // É o teste que justifica a migração de `findOneAndUpdate` para `save()`.
  // Sem ele, a Parte 1.2 da fase é promessa: o hook existiria no schema e
  // `findOneAndUpdate` passaria por cima dele em silêncio, no update — que é
  // exatamente onde a advogada troca o tipo de cobrança.
  // ═════════════════════════════════════════════════════════════════════════

  describe("2. o hook não é contornável por NENHUMA rota de update", () => {
    // As duas que existem: `PATCH`, o verbo do projeto, e `PUT`, o alias
    // depreciado que o frontend ainda usa até a Fase 4.2. Se amanhã nascer uma
    // terceira, ela entra aqui.
    const ROTAS_DE_UPDATE = [
      ["PATCH", (api, id, corpo) => api.patch(`/fees/${id}`, corpo)],
      ["PUT", (api, id, corpo) => api.put(`/fees/${id}`, corpo)]
    ];

    test("payload inválido é recusado por PATCH **e** por PUT", async () => {
      for (const [verbo, chamar] of ROTAS_DE_UPDATE) {
        // Honorário percentual válido, um por verbo — o update não pode
        // depender do estado deixado pelo anterior.
        const fee = await criarHonorario(api, processo._id, {
          tipo: TIPO_PERCENTUAL, percentual: 10, valorBase: 1000
        });

        // a) percentual fora de faixa
        recusado(await chamar(api, fee._id, { percentual: 150 }), "percentual", `${verbo} percentual 150`);

        // b) apagar o valor base de um honorário que tem percentual
        recusado(await chamar(api, fee._id, { valorBase: null }), "valorBase", `${verbo} valorBase null`);

        // c) apagar o percentual de um honorário do tipo percentual
        recusado(await chamar(api, fee._id, { percentual: null }), "percentual", `${verbo} percentual null`);

        // d) virar tipo fixo mantendo o percentual — o caso real: a advogada
        //    troca a forma de cobrança e esquece de limpar o campo.
        recusado(await chamar(api, fee._id, { tipo: "fixo" }), "percentual", `${verbo} tipo fixo com percentual`);

        // E o honorário continua íntegro depois das quatro recusas.
        const depois = esperado(await api.get(`/fees/${fee._id}`), 200, `leitura após ${verbo}`);
        assert.equal(depois.tipo, TIPO_PERCENTUAL, `${verbo}: o tipo mudou apesar da recusa`);
        assert.equal(depois.percentual, 10, `${verbo}: o percentual mudou apesar da recusa`);
        assert.equal(depois.valorBase, 1000, `${verbo}: o valor base mudou apesar da recusa`);
      }
    });

    test("trocar para fixo APAGANDO o percentual é aceito", async () => {
      // O caminho legítimo do caso (d): a mudança tem de ser explícita nos dois
      // campos. Sem esta contraprova, um hook que recusasse tudo passaria no
      // teste de cima.
      const fee = await criarHonorario(api, processo._id, {
        tipo: TIPO_PERCENTUAL, percentual: 20, valorBase: 5000
      });

      const r = await api.patch(`/fees/${fee._id}`, {
        tipo: "fixo", percentual: null, valorBase: null, valor: 750
      });

      assert.equal(r.status, 200, `esperado 200 — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.tipo, "fixo");
      assert.equal(r.body.percentual, null);
      assert.equal(r.body.valorBase, null);
      assert.equal(r.body.valor, 750, "no tipo fixo o valor volta a ser o que ela digitou");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — `valor` derivado
  // ═════════════════════════════════════════════════════════════════════════

  describe("3. `valor` é derivado no honorário percentual", () => {
    test("`valor` bate com percentual × valorBase em toda gravação", async () => {
      const casos = [
        { percentual: 10, valorBase: 12000, esperado: 1200 },
        { percentual: 6, valorBase: 200000, esperado: 12000 },
        { percentual: 12.5, valorBase: 1000, esperado: 125 },
        { percentual: 100, valorBase: 999.99, esperado: 999.99 },
        { percentual: 33.33, valorBase: 1000, esperado: 333.3 }
      ];

      for (const caso of casos) {
        const fee = await criarHonorario(api, processo._id, {
          tipo: TIPO_PERCENTUAL,
          percentual: caso.percentual,
          valorBase: caso.valorBase,
          // O que vier em `valor` é DESCARTADO de propósito: num honorário
          // percentual o valor não é opinião, é conta.
          valor: 999999
        });
        assert.equal(
          fee.valor, caso.esperado,
          `${caso.percentual}% de ${caso.valorBase} deveria dar ${caso.esperado}, veio ${fee.valor}`
        );
      }
    });

    test("alterar `valorBase` recalcula `valor`", async () => {
      const fee = await criarHonorario(api, processo._id, {
        tipo: TIPO_PERCENTUAL, percentual: 10, valorBase: 50000
      });
      assert.equal(fee.valor, 5000);

      const r = esperado(
        await api.patch(`/fees/${fee._id}`, { valorBase: 80000 }),
        200, "aumento do valor base"
      );
      assert.equal(r.valor, 8000, "o valor deveria ter acompanhado o novo valor base");

      // E pelo alias depreciado também: os dois passam pelo mesmo `save()`.
      const viaPut = esperado(
        await api.put(`/fees/${fee._id}`, { percentual: 20 }),
        200, "aumento do percentual por PUT"
      );
      assert.equal(viaPut.valor, 16000, "20% de 80.000 = 16.000");
    });

    test("no tipo fixo, `valor` continua sendo o que ela digitou", async () => {
      const fee = await criarHonorario(api, processo._id, { tipo: "fixo", valor: 4321.99 });
      assert.equal(fee.valor, 4321.99);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 10 e 11 — `campo` nos erros, e os dois verbos com o mesmo efeito
  // ═════════════════════════════════════════════════════════════════════════

  describe("10. `campo` nos erros de campo do honorário", () => {
    test("erro de campo do feeService emite `campo`", async () => {
      // O `getApiErrorField` do FeeFormPage lê `data.campo` INDEPENDENTE do
      // status (`utils/apiError.js:19`). Antes da DEC-027 o feeService não o
      // emitia em erro nenhum, e o helper estava inerte.
      const r = await criar({ tipo: TIPO_PERCENTUAL, percentual: 150, valorBase: 1000 });
      assert.equal(r.status, 400);
      assert.equal(r.body.campo, "percentual");

      // E a validação escrita à mão também o emite, quando um único campo é
      // responsável.
      const semDescricao = await api.post("/fees", {
        ...dadosHonorario(processo._id), descricao: "   "
      });
      assert.equal(semDescricao.status, 400);
      assert.equal(semDescricao.body.campo, "descricao");
    });

    test("com DOIS campos errados, `campo` NÃO sai", async () => {
      // Mandar a tela destacar o primeiro esconderia o segundo: a advogada
      // corrigiria um, reenviaria e levaria o mesmo 400.
      const r = await api.post("/fees", {
        ...dadosHonorario(processo._id), descricao: "", tipo: "inexistente"
      });
      assert.equal(r.status, 400);
      assert.equal(r.body.campo, undefined, `esperado sem \`campo\` — ${JSON.stringify(r.body)}`);
    });

    test("o 409 de integridade continua SEM `campo`", async () => {
      // A outra metade da DEC-027 item 3, e a que não muda. Coberta em
      // profundidade em `chain.test.js`; aqui fica a asserção de fronteira,
      // ao lado do 400 que PASSOU a levar `campo` — é o par que descreve a
      // distinção.
      const fee = await criarHonorario(api, processo._id);
      esperado(
        await api.post("/installments", {
          feeId: fee._id, numeroParcela: 1, valor: 100, dataVencimento: "2099-12-31"
        }),
        201, "parcela"
      );

      const r = await api.delete(`/fees/${fee._id}`);
      assert.equal(r.status, 409);
      assert.equal(r.body.campo, undefined, "409 de integridade não leva `campo`");
      assert.equal(r.body.dependencia, "parcelas");
      assert.equal(r.body.quantidade, 1);
    });
  });

  describe("11. `PATCH` e `PUT` produzem o mesmo efeito", () => {
    test("as três rotas respondem aos dois verbos com o mesmo resultado", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      const parcela = esperado(
        await api.post("/installments", {
          feeId: fee._id, numeroParcela: 1, valor: 1000, dataVencimento: "2099-12-31"
        }),
        201, "parcela"
      );
      const pagamento = esperado(
        await api.post("/payments", {
          installmentId: parcela._id, valorPago: 100,
          dataPagamento: "2026-02-10", formaPagamento: "pix"
        }),
        201, "pagamento"
      );

      const casos = [
        ["/fees", fee._id, { descricao: "descrição por PATCH" }, { descricao: "descrição por PUT" }, "descricao"],
        ["/installments", parcela._id, { valor: 900 }, { valor: 800 }, "valor"],
        ["/payments", pagamento._id, { observacoes: "obs por PATCH" }, { observacoes: "obs por PUT" }, "observacoes"]
      ];

      for (const [rota, id, corpoPatch, corpoPut, campo] of casos) {
        const viaPatch = await api.patch(`${rota}/${id}`, corpoPatch);
        assert.equal(viaPatch.status, 200, `PATCH ${rota} — ${JSON.stringify(viaPatch.body)}`);
        assert.equal(String(viaPatch.body[campo]), String(Object.values(corpoPatch)[0]));

        const viaPut = await api.put(`${rota}/${id}`, corpoPut);
        assert.equal(viaPut.status, 200, `PUT ${rota} — ${JSON.stringify(viaPut.body)}`);
        assert.equal(String(viaPut.body[campo]), String(Object.values(corpoPut)[0]));
      }
    });

    test("o alias `PUT` continua existindo nas três rotas", async () => {
      // Depreciado não é proibido: o frontend só migra na Fase 4.2. Um 404 aqui
      // significaria que alguém removeu o alias "por limpeza" e derrubou as três
      // telas financeiras.
      // Corpo mínimo válido por rota: `/payments` recusa update vazio com 400
      // antes de procurar o recurso, e o que se quer aqui é chegar ao 404.
      const corpos = {
        "/fees": { descricao: "existe?" },
        "/installments": { valor: 1 },
        "/payments": { observacoes: "existe?" }
      };

      for (const [rota, corpo] of Object.entries(corpos)) {
        const r = await api.put(`${rota}/000000000000000000000000`, corpo);

        // Id válido mas inexistente responde 404 DO RECURSO. A rota removida
        // responderia o 404 do `notFoundMiddleware`, que fala de rota — é a
        // mensagem que distingue "não existe esse honorário" de "não existe
        // essa rota".
        assert.equal(r.status, 404, `PUT ${rota}/:id — ${JSON.stringify(r.body)}`);
        assert.ok(
          !/rota/i.test(r.body?.message ?? ""),
          `o alias PUT sumiu de ${rota}: caiu no notFound de rota — ${JSON.stringify(r.body)}`
        );
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Vocabulário — precisa de RATIFICAÇÃO DA ADVOGADA antes da Fase 5
  // ═════════════════════════════════════════════════════════════════════════

  test("os enums do módulo têm exatamente os valores registrados", () => {
    // Se alguém acrescentar um valor sem acrescentar teste, este cai — e o
    // vocabulário de tipo de honorário é jurídico, da prática dela, não decisão
    // técnica. Está anotado no CLAUDE.md como pendente de ratificação.
    assert.deepEqual([...TIPOS_HONORARIO], ["fixo", "percentual", "custas"]);
    assert.deepEqual(
      [...STATUS_HONORARIO],
      ["pendente", "parcialmente_pago", "pago", "cancelado"]
    );
  });
// ═════════════════════════════════════════════════════════════════════════
  // 12 — O SEPARADOR entre erros de validação (Fase F-0)
  //
  // `erroDeValidacao` juntava os erros com ", ". Vários deles CONTÊM vírgula:
  // `tipo inválido. Use: fixo, percentual, custas` e `status inválido. Use:
  // pendente, parcialmente_pago, pago, cancelado`. Com dois erros, a frase
  // saía assim:
  //
  //   "status inválido. Use: pendente, parcialmente_pago, pago, cancelado,
  //    dataVencimento é obrigatória"
  //
  // que se lê como se `dataVencimento é obrigatória` fosse mais um valor
  // válido de status. Gramaticalmente correta, apontando para o lugar errado —
  // o defeito que a Fase 4.6 nomeou, sobrevivendo no separador.
  // ═════════════════════════════════════════════════════════════════════════
  describe("12. a lista do enum não se funde com o erro seguinte", () => {
    test("dois erros, sendo um com enum: a fronteira entre eles é inequívoca", async () => {
      // `status` inválido (mensagem com vírgulas) + `dataVencimento` ausente.
      const r = await api.post("/fees", {
        processoId: processo._id,
        descricao: "Honorário com dois erros",
        valor: 100,
        tipo: "fixo",
        status: "inventado"
      });

      assert.equal(r.status, 400, JSON.stringify(r.body));

      const ultimoValor = "cancelado";
      assert.doesNotMatch(
        r.body.message,
        new RegExp(`${ultimoValor},\\s*dataVencimento`),
        "o último valor do enum não pode ser seguido de vírgula e do erro seguinte — " +
        `a lista se funde e vira "…, ${ultimoValor}, dataVencimento é obrigatória". Veio: "${r.body.message}"`
      );

      assert.match(
        r.body.message, /;/,
        `os erros precisam de um separador que não apareça DENTRO deles. Veio: "${r.body.message}"`
      );

      // A prova que não depende de redação: o array vem junto, e cada erro é
      // um item — a tela que quiser listar um por linha não desfaz concatenação.
      assert.ok(Array.isArray(r.body.errors), `errors deveria ser array — ${JSON.stringify(r.body.errors)}`);
      assert.equal(r.body.errors.length, 2, JSON.stringify(r.body.errors));
      assert.ok(
        r.body.errors.some((e) => /^status inválido/.test(e)),
        JSON.stringify(r.body.errors)
      );
      assert.ok(
        r.body.errors.some((e) => /dataVencimento/.test(e)),
        JSON.stringify(r.body.errors)
      );
    });

    test("erro único continua sendo uma frase limpa, sem separador sobrando", async () => {
      const r = await api.post("/fees", {
        processoId: processo._id,
        descricao: "Só um erro",
        valor: 100,
        tipo: "fixo",
        dataVencimento: "2026-12-31",
        status: "inventado"
      });

      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.errors.length, 1, JSON.stringify(r.body.errors));
      assert.doesNotMatch(r.body.message, /;/, `sem separador com um erro só — veio: "${r.body.message}"`);
    });
  });
});
