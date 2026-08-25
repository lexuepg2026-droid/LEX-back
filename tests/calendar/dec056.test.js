// ═══════════════════════════════════════════════════════════════════════════
// DEC-056 — A LINHA DO TEMPO É APRESENTAÇÃO DO HISTÓRICO DA DEC-054
//
// ── O que este arquivo prova ───────────────────────────────────────────
//   1. a linha traz as mudanças de fase, o encerramento, a liminar e os
//      eventos, em ordem de data;
//   2. os FUTUROS entram, marcados, e ficam do lado certo do "hoje";
//   3. **o financeiro NÃO entra** — e esta é a asserção que impede a próxima
//      fase de "completar" a linha do tempo sem decisão;
//   4. a rota é só LEITURA: nada é coletado aqui, porque a F-2d já coletou.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario, criarParcela, esperado
} from "../helpers/setup.js";
import { montarLinhaDoTempo } from "../../src/services/timelineService.js";
import {
  hojeComoDataDeCalendario, lerDataDeCalendario, escreverDataDeCalendario
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
  api = await registrarUsuario("advogada da linha do tempo");
  const cliente = await criarClientePF(api);
  processo = await criarProcesso(api, [{ clienteId: cliente._id, papel: "autor", principal: true }]);
});

after(async () => {
  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

const linha = async (id = processo._id) =>
  esperado(await api.get(`/processes/${id}/timeline`), 200, "linha do tempo");

describe("DEC-056 — o substrato JÁ EXISTE: a linha nasce COM passado", () => {
  test("um processo recém-criado já tem a entrada de NASCIMENTO", async () => {
    const corpo = await linha();

    const fases = corpo.entradas.filter((e) => e.tipo === "fase");
    assert.equal(fases.length, 1, "a DEC-054 grava a primeira entrada no nascimento");
    assert.equal(fases[0].de, null);
    assert.equal(fases[0].nascimento, true);
    // Sem a marca, um processo criado direto em "execução" apareceria como se
    // sempre tivesse estado lá — e não haveria como distinguir "nasceu assim"
    // de "nunca mudou".
    assert.equal(fases[0].para, "conhecimento");
  });

  test("os rótulos vêm PRONTOS — nenhuma tela monta rótulo de fase", async () => {
    const corpo = await linha();
    const nascimento = corpo.entradas.find((e) => e.tipo === "fase");
    assert.equal(nascimento.paraRotulo, "Fase de conhecimento");
    assert.equal(nascimento.deRotulo, null, "o nascimento não tem fase anterior");
    assert.equal(corpo.faseAtualRotulo, "Fase de conhecimento");
  });

  test("cada mudança de fase vira uma entrada, com de→para", async () => {
    esperado(
      await api.patch(`/processes/${processo._id}/fase`, { fase: "sentenca" }),
      200,
      "para sentença"
    );
    esperado(
      await api.patch(`/processes/${processo._id}/fase`, {
        fase: "conhecimento",
        motivo: "Sentença anulada em segundo grau"
      }),
      200,
      "de volta para conhecimento"
    );

    const corpo = await linha();
    const fases = corpo.entradas.filter((e) => e.tipo === "fase");

    assert.equal(fases.length, 3, "nascimento + duas transições");
    assert.deepEqual(
      fases.map((f) => [f.de, f.para]),
      [[null, "conhecimento"], ["conhecimento", "sentenca"], ["sentenca", "conhecimento"]]
    );
    // A volta é permitida: *"sim, pode voltar"*. Não existe máquina de estados,
    // e a linha do tempo mostra o movimento na ordem em que ele aconteceu.
  });

  test("o motivo aparece QUANDO HOUVER, e é `null` quando ela não anotou", async () => {
    const corpo = await linha();
    const fases = corpo.entradas.filter((e) => e.tipo === "fase");

    assert.equal(fases[1].motivo, null, '*"não precisa anotar o porquê"*');
    assert.equal(fases[2].motivo, "Sentença anulada em segundo grau");
  });
});

describe("DEC-056 — o encerramento e a liminar", () => {
  test("o trânsito em julgado entra como entrada PRÓPRIA, não como fase", async () => {
    esperado(
      await api.patch(`/processes/${processo._id}`, {
        transitoEmJulgadoEm: "2026-06-30",
        motivoEncerramento: "Acordo cumprido"
      }),
      200,
      "encerrar"
    );

    const corpo = await linha();
    const encerramentos = corpo.entradas.filter((e) => e.tipo === "encerramento");

    assert.equal(encerramentos.length, 1);
    assert.equal(encerramentos[0].motivo, "Acordo cumprido");
    // NÃO é a quinta fase (DEC-054): um processo transitado continua tendo a
    // fase em que parou, e representá-lo como transição apagaria isso.
    assert.equal(
      corpo.entradas.some((e) => e.tipo === "fase" && e.para === "transito"),
      false
    );
    assert.ok(corpo.faseAtual, "a fase continua existindo depois do encerramento");
  });

  test("a liminar entra quando tem DATA", async () => {
    esperado(
      await api.patch(`/processes/${processo._id}`, {
        liminar: true,
        liminarEm: "2026-03-15",
        liminarObservacao: "Pedido de tutela de urgência"
      }),
      200,
      "marcar liminar"
    );

    const corpo = await linha();
    const liminares = corpo.entradas.filter((e) => e.tipo === "liminar");

    assert.equal(liminares.length, 1);
    assert.equal(liminares[0].data, "2026-03-15");
    assert.equal(liminares[0].observacao, "Pedido de tutela de urgência");
  });

  test("liminar SEM data não entra — sinalizador sem momento não cabe na linha", async () => {
    const cliente = await criarClientePF(api);
    const outro = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    esperado(await api.patch(`/processes/${outro._id}`, { liminar: true }), 200, "só o sinalizador");

    const corpo = await linha(outro._id);
    assert.equal(corpo.entradas.filter((e) => e.tipo === "liminar").length, 0);
    // Ele continua aparecendo como SELO no cabeçalho da tela (DEC-054), que é
    // onde um sinalizador sem data pertence — omiti-lo aqui não perde nada.
  });
});

describe("DEC-056 — os EVENTOS, e os futuros à frente do hoje", () => {
  test("evento passado e evento futuro entram, e o futuro vem marcado", async () => {
    esperado(
      await api.post("/events", {
        tipo: "audiencia", titulo: "Audiência que já houve",
        data: deslocar(-30), processoId: processo._id
      }),
      201,
      "evento passado"
    );
    esperado(
      await api.post("/events", {
        tipo: "audiencia", titulo: "Audiência marcada",
        data: deslocar(30), hora: "14:30", processoId: processo._id
      }),
      201,
      "evento futuro"
    );

    const corpo = await linha();
    const eventos = corpo.entradas.filter((e) => e.tipo === "evento");

    assert.equal(eventos.length, 2);

    const passado = eventos.find((e) => e.titulo === "Audiência que já houve");
    const futuro = eventos.find((e) => e.titulo === "Audiência marcada");

    assert.equal(passado.futuro, false);
    assert.equal(futuro.futuro, true);
    assert.equal(futuro.hora, "14:30");

    // O corte é do BACKEND, e não da tela: o navegador não sabe o "hoje" do
    // servidor, e um relógio atrasado poria uma audiência de amanhã do lado
    // errado da linha.
    assert.equal(corpo.hoje, HOJE);
  });

  test("evento de OUTRO processo não entra", async () => {
    const cliente = await criarClientePF(api);
    const outro = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    esperado(
      await api.post("/events", {
        tipo: "reuniao", titulo: "Reunião do outro processo",
        data: HOJE, processoId: outro._id
      }),
      201,
      "evento do outro"
    );

    const corpo = await linha();
    assert.equal(
      corpo.entradas.some((e) => e.titulo === "Reunião do outro processo"),
      false
    );
  });

  test("evento SOLTO (sem processo) não entra em linha do tempo nenhuma", async () => {
    esperado(
      await api.post("/events", { tipo: "reuniao", titulo: "Reunião solta", data: HOJE }),
      201,
      "evento solto"
    );

    const corpo = await linha();
    assert.equal(corpo.entradas.some((e) => e.titulo === "Reunião solta"), false);
  });

  test("a linha inteira está em ORDEM DE DATA", async () => {
    const corpo = await linha();
    const datas = corpo.entradas.map((e) => e.data);
    assert.deepEqual([...datas].sort(), datas, "a ordem cronológica é a única que uma linha do tempo pode ter");
  });
});

describe("DEC-056 — o FINANCEIRO NÃO ENTRA, e a exclusão é a decisão", () => {
  test("honorário, parcela e pagamento não aparecem na linha do tempo", async () => {
    const honorario = await criarHonorario(api, processo._id, {
      valor: 5000, descricao: "Honorário contratual"
    });
    await criarParcela(api, honorario._id, 1, { valor: 2500, dataVencimento: deslocar(15) });
    await criarParcela(api, honorario._id, 2, { valor: 2500, dataVencimento: deslocar(45) });

    const corpo = await linha();

    // Nenhum tipo financeiro entrou.
    for (const entrada of corpo.entradas) {
      assert.ok(
        ["fase", "encerramento", "liminar", "evento"].includes(entrada.tipo),
        `tipo inesperado na linha do tempo: ${entrada.tipo}`
      );
    }

    // E nenhuma entrada carrega valor, honorário ou parcela.
    const serializada = JSON.stringify(corpo);
    assert.equal(serializada.includes("Honorário contratual"), false, "o honorário vazou");
    assert.equal(/"valor"\s*:/.test(serializada), false, "um valor em reais vazou");
    assert.equal(/"feeId"\s*:/.test(serializada), false, "um vínculo com honorário vazou");
    assert.equal(/"parcela"/i.test(serializada), false, "uma parcela vazou");

    // O extrato do honorário responde outra pergunta, e já a responde bem.
    // Misturar as duas faria uma tela que não responde nenhuma: cinco entradas
    // de fase somem debaixo de quarenta linhas de um plano parcelado em doze.
  });

  test("o serviço não IMPORTA nenhum model financeiro", () => {
    const fonte = readFileSync(
      fileURLToPath(new URL("../../src/services/timelineService.js", import.meta.url)),
      "utf8"
    );
    const codigo = fonte.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    for (const model of ["Fee", "Installment", "Payment", "Allocation", "Reversal", "Renegotiation"]) {
      assert.equal(
        new RegExp(`import .*${model}.* from`).test(codigo),
        false,
        `\`${model}\` importado — o financeiro não entra na linha do tempo`
      );
    }
  });
});

describe("DEC-056 — apresentação, e não coleta", () => {
  test("o serviço não ESCREVE nada", () => {
    const fonte = readFileSync(
      fileURLToPath(new URL("../../src/services/timelineService.js", import.meta.url)),
      "utf8"
    );
    const codigo = fonte.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    // O substrato é o `historicoFase` que a DEC-054 já grava desde a F-2d. Se
    // esta parte coletasse alguma coisa, a linha do tempo teria nascido sem
    // passado — que é exatamente o que aquela decisão evitou.
    for (const escrita of [".save(", ".create(", "updateOne", "updateMany", "insertMany", "deleteOne", "findOneAndUpdate"]) {
      assert.equal(codigo.includes(escrita), false, `\`${escrita}\` em timelineService`);
    }
  });

  test("não existe rota de ESCRITA em /timeline", async () => {
    for (const chamada of [
      api.post(`/processes/${processo._id}/timeline`, { tipo: "fase" }),
      api.patch(`/processes/${processo._id}/timeline`, {}),
      api.delete(`/processes/${processo._id}/timeline`)
    ]) {
      const r = await chamada;
      assert.equal(r.status, 404, "a linha do tempo é só leitura");
    }
  });

  test("processo de outra usuária responde 404", async () => {
    const b = await registrarUsuario("advogada B da linha");
    const r = await b.get(`/processes/${processo._id}/timeline`);
    assert.equal(r.status, 404);
  });

  test("id malformado é 400", async () => {
    const r = await api.get("/processes/nao-e-um-id/timeline");
    assert.equal(r.status, 400);
  });
});

describe("DEC-056 — a montagem é função pura, testável sem banco", () => {
  const processoFalso = {
    fase: "execucao",
    historicoFase: [
      { de: null, para: "conhecimento", data: new Date("2025-01-10T09:00:00Z"), motivo: null },
      { de: "conhecimento", para: "execucao", data: new Date("2025-06-20T15:30:00Z"), motivo: "Sentença transitada" }
    ],
    transitoEmJulgadoEm: null,
    liminar: false,
    liminarEm: null
  };

  test("no MESMO dia, o fato consumado vem antes do compromisso marcado", () => {
    // A mudança de fase registrada hoje às 10h é fato consumado; a audiência
    // marcada para hoje pode ainda não ter acontecido. Pôr o que talvez não
    // tenha ocorrido antes do que certamente ocorreu inverteria a leitura no
    // único dia em que ela importa.
    const entradas = montarLinhaDoTempo(
      {
        ...processoFalso,
        historicoFase: [
          { de: null, para: "conhecimento", data: new Date("2026-09-15T10:00:00Z"), motivo: null }
        ]
      },
      [{ _id: "e1", titulo: "Audiência", tipo: "audiencia", data: "2026-09-15", hora: "14:30" }],
      "2026-09-20"
    );

    assert.equal(entradas[0].tipo, "fase");
    assert.equal(entradas[1].tipo, "evento");
  });

  test("o corte de `futuro` é comparação de string, sem fuso para errar", () => {
    const entradas = montarLinhaDoTempo(processoFalso, [
      { _id: "a", titulo: "Ontem", tipo: "outro", data: "2026-09-14" },
      { _id: "b", titulo: "Hoje", tipo: "outro", data: "2026-09-15" },
      { _id: "c", titulo: "Amanhã", tipo: "outro", data: "2026-09-16" }
    ], "2026-09-15");

    const porTitulo = Object.fromEntries(
      entradas.filter((e) => e.tipo === "evento").map((e) => [e.titulo, e.futuro])
    );

    assert.equal(porTitulo["Ontem"], false);
    // HOJE não é futuro. O que está marcado para hoje ainda exige atenção, mas
    // não está "à frente" da linha — e pô-lo do outro lado faria a advogada
    // procurar amanhã o que é para agora.
    assert.equal(porTitulo["Hoje"], false);
    assert.equal(porTitulo["Amanhã"], true);
  });

  test("a mesma montagem dá o mesmo resultado em qualquer fuso", () => {
    const original = process.env.TZ;
    const saidas = [];

    for (const fuso of ["America/Sao_Paulo", "Pacific/Kiritimati", "UTC"]) {
      process.env.TZ = fuso;
      saidas.push(
        JSON.stringify(
          montarLinhaDoTempo(processoFalso, [
            { _id: "x", titulo: "Audiência", tipo: "audiencia", data: "2026-09-01" }
          ], "2026-09-15").map((e) => `${e.tipo}@${e.data}:${e.futuro}`)
        )
      );
    }

    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;

    assert.equal(new Set(saidas).size, 1, "a linha do tempo mudou de fuso para fuso");
  });
});
