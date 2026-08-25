// ═══════════════════════════════════════════════════════════════════════════
// F-3, PARTE 4 — O SINO: TRÊS CASOS, SEM ESTADO DE LIDO
//
// O contador soma o que EXIGE ATENÇÃO: eventos de hoje, eventos atrasados
// (data passada, não concluídos) e parcelas vencidas.
//
// ── O que este arquivo prova, e por que cada coisa importa ─────────────
//   • os três casos somam, e somam UMA vez cada (o de hoje não conta também
//     como atrasado — seria o mesmo compromisso contado duas vezes);
//   • **o concluído NÃO conta**. É a linha que faz o número significar algo:
//     resolver o item é o que o baixa;
//   • zero é ZERO — e a tela não mostra badge nenhum (travado no frontend).
//
// ── Sem "marcar como lido", e a ausência é a regra ────────────────────
// Não há rota que zere o contador, e não há campo de leitura em lugar nenhum.
// Um contador que só zera com clique treina a pessoa a zerar sem olhar — e a
// partir daí ele deixa de significar qualquer coisa.
//
// ── As datas são RELATIVAS ao hoje do servidor, e têm de ser ──────────
// Este é o único arquivo da fase que não pode usar datas fixas: "hoje" e
// "atrasado" só existem em relação ao dia da execução. O `hoje` sai do mesmo
// ponto único que o serviço usa, para o teste não desenhar um "hoje" próprio.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario, criarParcela, esperado
} from "../helpers/setup.js";
import {
  hojeComoDataDeCalendario,
  escreverDataDeCalendario,
  lerDataDeCalendario
} from "../../src/utils/dataDeCalendario.js";

const COLECOES = [
  "users", "clients", "processes", "processo_clientes", "fees",
  "installments", "payments", "events"
];

const UM_DIA = 24 * 60 * 60 * 1000;

const HOJE = hojeComoDataDeCalendario();
const deslocar = (dias) =>
  escreverDataDeCalendario(new Date(lerDataDeCalendario(HOJE).getTime() + dias * UM_DIA));

let api;
let processo;

before(async () => {
  await subirApp();
  await limparColecoes(COLECOES);
  api = await registrarUsuario("advogada do sino");
  const cliente = await criarClientePF(api);
  processo = await criarProcesso(api, [{ clienteId: cliente._id, papel: "autor", principal: true }]);
});

after(async () => {
  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

const criarEvento = async (corpo) =>
  esperado(await api.post("/events", corpo), 201, `evento "${corpo.titulo}"`);

const avisos = async () => esperado(await api.get("/calendar/avisos"), 200, "avisos");

describe("Parte 4 — o sino começa em ZERO e não inventa nada", () => {
  test("base vazia: total 0, e as três listas vazias", async () => {
    const corpo = await avisos();
    assert.equal(corpo.total, 0);
    assert.equal(corpo.contagens.eventosHoje, 0);
    assert.equal(corpo.contagens.eventosAtrasados, 0);
    assert.equal(corpo.contagens.parcelasVencidas, 0);
    assert.deepEqual(corpo.eventosHoje, []);
  });

  test("o `hoje` do sino é o mesmo do calendário — um relógio só", async () => {
    const sino = await avisos();
    const calendario = esperado(
      await api.get(`/calendar?de=${HOJE}&ate=${HOJE}`),
      200,
      "calendário de hoje"
    );
    assert.equal(sino.hoje, calendario.hoje);
  });
});

describe("Parte 4 — a contagem soma os TRÊS casos", () => {
  test("evento de HOJE entra", async () => {
    await criarEvento({ tipo: "audiencia", titulo: "Audiência de hoje", data: HOJE });

    const corpo = await avisos();
    assert.equal(corpo.contagens.eventosHoje, 1);
    assert.equal(corpo.eventosHoje[0].titulo, "Audiência de hoje");
    assert.equal(corpo.eventosHoje[0].motivo, "hoje");
  });

  test("evento ATRASADO entra, e não é contado como 'de hoje'", async () => {
    await criarEvento({ tipo: "prazo", titulo: "Prazo de anteontem", data: deslocar(-2) });

    const corpo = await avisos();
    assert.equal(corpo.contagens.eventosAtrasados, 1);
    assert.equal(corpo.contagens.eventosHoje, 1, "o de hoje continua sendo um só");
    assert.equal(corpo.eventosAtrasados[0].motivo, "atrasado");
  });

  test("evento FUTURO não entra — o sino é o que exige atenção AGORA", async () => {
    await criarEvento({ tipo: "reuniao", titulo: "Reunião da semana que vem", data: deslocar(7) });

    const corpo = await avisos();
    assert.equal(corpo.contagens.eventosHoje, 1);
    assert.equal(corpo.contagens.eventosAtrasados, 1);
  });

  test("parcela VENCIDA entra, pelo status derivado — o sino não recalcula", async () => {
    const honorario = await criarHonorario(api, processo._id, {
      valor: 1000,
      descricao: "Honorário com parcela vencida"
    });
    // Vencida de verdade: data no passado. O status é derivado pela cadeia do
    // `paymentService` (DEC-028), que é a mesma fonte do painel — se o sino
    // recalculasse "vencido" por conta própria, os dois números divergiriam no
    // dia em que a derivação mudasse.
    await criarParcela(api, honorario._id, 1, { valor: 1000, dataVencimento: deslocar(-10) });
    esperado(await api.patch(`/installments/${(await api.get(`/installments?honorarioId=${honorario._id}`)).body.data[0]._id}`, { status: "vencido" }), 200, "marcar vencida");

    const corpo = await avisos();
    assert.equal(corpo.contagens.parcelasVencidas, 1);
    assert.equal(corpo.parcelasVencidas[0].natureza, "derivada");
    assert.equal(corpo.parcelasVencidas[0].motivo, "vencida");
  });

  test("o TOTAL é a soma dos três, e vem calculado do backend", async () => {
    const corpo = await avisos();
    const soma =
      corpo.contagens.eventosHoje +
      corpo.contagens.eventosAtrasados +
      corpo.contagens.parcelasVencidas;

    assert.equal(corpo.total, soma);
    assert.equal(corpo.total, 3, "um de hoje, um atrasado, uma parcela vencida");
    // O total vai calculado, e a tela não soma: se ela somasse, o dia em que um
    // quarto caso entrasse ela continuaria mostrando três — e ninguém notaria,
    // porque o número continuaria plausível.
  });
});

describe("Parte 4 — o CONCLUÍDO não conta, e é isso que faz o número valer", () => {
  test("concluir o evento de hoje baixa o número", async () => {
    const antes = await avisos();
    const doDia = antes.eventosHoje[0];

    esperado(await api.patch(`/events/${doDia._id}/concluir`, { concluido: true }), 200, "concluir");

    const depois = await avisos();
    assert.equal(depois.contagens.eventosHoje, antes.contagens.eventosHoje - 1);
    assert.equal(depois.total, antes.total - 1);
  });

  test("concluir o ATRASADO também baixa", async () => {
    const antes = await avisos();
    const atrasado = antes.eventosAtrasados[0];

    esperado(await api.patch(`/events/${atrasado._id}/concluir`, { concluido: true }), 200, "concluir");

    const depois = await avisos();
    assert.equal(depois.contagens.eventosAtrasados, 0);
  });

  test("DESMARCAR devolve o item à contagem — o número segue o mundo", async () => {
    const evento = await criarEvento({ tipo: "outro", titulo: "Vai e volta", data: HOJE });
    esperado(await api.patch(`/events/${evento._id}/concluir`, { concluido: true }), 200, "concluir");
    const comConcluido = await avisos();

    esperado(await api.patch(`/events/${evento._id}/concluir`, { concluido: false }), 200, "desmarcar");
    const depois = await avisos();

    assert.equal(depois.total, comConcluido.total + 1);
  });

  test("evento DESATIVADO não conta", async () => {
    const evento = await criarEvento({ tipo: "outro", titulo: "Some do sino", data: HOJE });
    const comEle = await avisos();

    esperado(await api.delete(`/events/${evento._id}`), 200, "desativar");

    const semEle = await avisos();
    assert.equal(semEle.total, comEle.total - 1);
  });
});

describe("Parte 4 — não existe estado de LIDO", () => {
  test("consultar o sino repetidas vezes não muda o número", async () => {
    const primeira = await avisos();
    const segunda = await avisos();
    const terceira = await avisos();

    assert.equal(primeira.total, segunda.total);
    assert.equal(segunda.total, terceira.total);
    // Se houvesse "marcar como lido" na leitura, a segunda chamada já viria
    // zerada — e o contador passaria a medir "quantas vezes eu não olhei",
    // que não é a pergunta.
  });

  test("não há rota para zerar o contador", async () => {
    for (const chamada of [
      api.post("/calendar/avisos/lidos", {}),
      api.patch("/calendar/avisos", { lido: true }),
      api.delete("/calendar/avisos")
    ]) {
      const r = await chamada;
      assert.equal(r.status, 404, "zerar o sino por rota não pode existir");
    }
  });
});
