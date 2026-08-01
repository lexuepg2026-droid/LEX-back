// ═══════════════════════════════════════════════════════════════════════════
// HONORÁRIOS CONTRATADOS POR MÊS — `GET /api/dashboard/honorarios-por-mes`
//
// A Fase 4.3 reportou e NÃO corrigiu: o gráfico de barras somava honorário
// `cancelado`, enquanto o `valorContratado` do resumo passara a excluí-lo. Os
// dois números falam do mesmo assunto, aparecem na MESMA tela, e não fechavam —
// a advogada podia ler no cartão um contratado menor do que a soma das barras
// logo abaixo, sem nada explicando a diferença.
//
// A Fase 4.4 fecha o achado. Este arquivo trava as duas pontas: o cancelado
// fora da soma do mês, e o gráfico concordando com o resumo.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario, esperado
} from "../helpers/setup.js";

// O gráfico agrupa por `createdAt`, que é do momento da criação — o mês
// corrente, sempre, para tudo que a suíte cria.
const AGORA = new Date();
const MES_CORRENTE = `${AGORA.getUTCFullYear()}-${String(AGORA.getUTCMonth() + 1).padStart(2, "0")}`;

describe("gráfico de honorários contratados por mês", () => {
  let api, cliente, processo, vigente, cancelado;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("grafico");
    cliente = await criarClientePF(api);
    processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);

    // 5.000 vigentes, em dois honorários.
    vigente = await criarHonorario(api, processo._id, {
      tipo: "fixo", valor: 3000, descricao: "Honorários contratuais"
    });
    await criarHonorario(api, processo._id, {
      tipo: "fixo", valor: 2000, descricao: "Honorários de acompanhamento"
    });

    // E 800 cancelados, que NÃO podem entrar na barra.
    cancelado = await criarHonorario(api, processo._id, {
      tipo: "custas", valor: 800, status: "cancelado", descricao: "Custas — cancelada"
    });
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const porMes = async () =>
    esperado(await api.get("/dashboard/honorarios-por-mes"), 200, "honorários por mês");

  const doMesCorrente = (serie) => serie.find((m) => m.mes === MES_CORRENTE);

  test("a forma da resposta não mudou: `[{ mes, total }]`", async () => {
    const serie = await porMes();
    assert.ok(Array.isArray(serie), "a rota deixou de devolver array");
    for (const ponto of serie) {
      assert.deepEqual(Object.keys(ponto).sort(), ["mes", "total"]);
      assert.match(ponto.mes, /^\d{4}-(0[1-9]|1[0-2])$/);
    }
  });

  // ── O TESTE DA FASE ──────────────────────────────────────────────────────
  test("honorário cancelado NÃO aparece na soma do mês", async () => {
    const serie = await porMes();
    const mes = doMesCorrente(serie);

    assert.ok(mes, `nenhum ponto para o mês corrente (${MES_CORRENTE})`);
    assert.equal(
      mes.total, 5000,
      "3.000 + 2.000 dos vigentes. Os 800 do cancelado entraram na barra"
    );
    assert.notEqual(mes.total, 5800, "a soma incluiu o honorário cancelado");
  });

  test("cancelar um honorário DERRUBA a barra do mês", async () => {
    // Contraprova dinâmica: não basta o cancelado nascer fora da soma — sair
    // dela ao ser cancelado é o que a advogada vai ver acontecer.
    const antes = doMesCorrente(await porMes()).total;

    esperado(
      await api.patch(`/fees/${vigente._id}`, { status: "cancelado" }),
      200, "cancela o honorário vigente"
    );

    const depois = doMesCorrente(await porMes()).total;
    assert.equal(depois, antes - 3000, "cancelar não tirou o valor da barra");

    // Descancelar devolve à derivação (DEC-028) e o valor volta ao gráfico.
    esperado(
      await api.patch(`/fees/${vigente._id}`, { status: "pendente" }),
      200, "descancela"
    );
    assert.equal(doMesCorrente(await porMes()).total, antes, "descancelar não devolveu o valor");
  });

  test("honorário desativado também fica fora", async () => {
    // Regra antiga, que a mudança desta fase não pode ter afrouxado.
    const antes = doMesCorrente(await porMes()).total;
    const descartavel = await criarHonorario(api, processo._id, {
      tipo: "fixo", valor: 999, descricao: "Para desativar"
    });
    assert.equal(doMesCorrente(await porMes()).total, antes + 999);

    esperado(await api.delete(`/fees/${descartavel._id}`), 200, "desativa o honorário");
    assert.equal(doMesCorrente(await porMes()).total, antes, "o desativado continuou somando");
  });

  test("o gráfico concorda com o `valorContratado` do resumo", async () => {
    // A razão de existir da correção. Os dois números aparecem na mesma tela;
    // divergir é o defeito, e não um detalhe de implementação.
    const serie = await porMes();
    const somaDasBarras = Math.round(serie.reduce((s, m) => s + m.total, 0) * 100) / 100;

    const resumo = esperado(
      await api.get("/financeiro/resumo"), 200, "resumo financeiro"
    );

    assert.equal(
      somaDasBarras, resumo.valorContratado,
      "a soma das barras divergiu do contratado do resumo"
    );
  });

  test("usuário sem honorário nenhum recebe série vazia", async () => {
    const vazio = await registrarUsuario("grafico vazio");
    const serie = esperado(
      await vazio.get("/dashboard/honorarios-por-mes"), 200, "série de usuário vazio"
    );
    assert.deepEqual(serie, []);
  });

  test("o cancelado continua existindo — saiu da SOMA, não da base", async () => {
    // Sumir da base levaria junto o histórico da cobrança que ela desfez.
    const r = esperado(await api.get(`/fees/${cancelado._id}`), 200, "honorário cancelado");
    assert.equal(r.status, "cancelado");
    assert.equal(r.ativo, true);
  });
});
