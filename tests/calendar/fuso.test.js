// ═══════════════════════════════════════════════════════════════════════════
// F-3 — O FUSO: A DATA GRAVADA É A DATA LIDA
//
// ── Por que este arquivo existe separado ────────────────────────────────
// É o risco número um da fase, e o projeto já teve um defeito de fuso (o
// recibo do portal, passo 91). Um evento gravado como INSTANTE e lido no
// navegador MUDA DE DIA — e ninguém desconfia do calendário, desconfia da
// própria memória.
//
// ── A DATA NOMEADA, e o dia da semana esperado ─────────────────────────
// **01/09/2026 é uma TERÇA-FEIRA.**
//
// A data foi escolhida porque o modo de falha aponta para trás: um instante
// `2026-09-01T00:00:00.000Z` lido a oeste de Greenwich vira **31/08/2026,
// segunda-feira**. Se a audiência de terça aparecer na segunda, o teste vê.
//
// ── Os dois fusos, e por que são estes ─────────────────────────────────
//   `America/Sao_Paulo`  UTC−3  — o fuso da advogada. É onde o defeito
//                                 aconteceria de verdade, e onde a data
//                                 recuaria um dia.
//   `Pacific/Kiritimati` UTC+14 — o extremo oposto, e o maior deslocamento
//                                 positivo que existe. É onde a data
//                                 AVANÇARIA um dia.
//
// Um fuso a leste e outro a oeste: um teste com dois fusos do mesmo lado
// provaria metade da regra e passaria com o erro do outro lado intacto.
//
// ── Como o fuso é trocado, e por que isso é honesto ────────────────────
// `process.env.TZ` é escrito ANTES de cada bloco de leitura. Node reavalia o
// fuso local a cada operação de `Date` que dependa dele, então a troca vale
// para as chamadas seguintes no mesmo processo.
//
// O ponto do teste, porém, não é que a troca funcione: é que ela **não faça
// diferença nenhuma**. Um pipeline que nunca chama um método de hora local
// (`getDate`, `getMonth`, `toLocaleDateString` sem `timeZone`) é indiferente
// ao fuso por construção — e é isso que o teste mede. Por isso ele também
// confere, no fim, que o valor GRAVADO no banco é meia-noite UTC exata: se
// alguém trocar o parser por `new Date(string)` local, o banco denuncia
// mesmo que a leitura, por acaso, ainda bata.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, acharEm, desconectar } from "../helpers/db.js";
import { registrarUsuario, esperado } from "../helpers/setup.js";
import {
  lerDataDeCalendario,
  escreverDataDeCalendario,
  hojeComoDataDeCalendario
} from "../../src/utils/dataDeCalendario.js";

const COLECOES = ["users", "clients", "processes", "processo_clientes", "fees", "installments", "events"];

// A data nomeada da fase, e o dia da semana que ela tem de ter.
const DATA = "2026-09-01";
const DIA_DA_SEMANA = 2; // terça-feira (0 = domingo)

const FUSO_OESTE = "America/Sao_Paulo";   // UTC−3
const FUSO_LESTE = "Pacific/Kiritimati";  // UTC+14

let api;
let tzOriginal;

before(async () => {
  tzOriginal = process.env.TZ;
  await subirApp();
  await limparColecoes(COLECOES);
  api = await registrarUsuario("advogada do fuso");
});

after(async () => {
  // O fuso volta ao que era: os arquivos da suíte rodam em série, no mesmo
  // processo, e deixar `TZ` alterado contaminaria quem vier depois.
  if (tzOriginal === undefined) delete process.env.TZ;
  else process.env.TZ = tzOriginal;

  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

describe("F-3 — 01/09/2026 gravado é 01/09/2026 lido, em dois fusos", () => {
  test("a data nomeada é uma TERÇA-FEIRA — a âncora do teste", () => {
    const dia = lerDataDeCalendario(DATA).getUTCDay();
    assert.equal(
      dia,
      DIA_DA_SEMANA,
      "se esta linha falhar, a premissa do teste mudou, não o código"
    );
  });

  for (const fuso of [FUSO_OESTE, FUSO_LESTE]) {
    test(`gravado e lido em ${fuso} — a data NÃO muda de dia`, async () => {
      process.env.TZ = fuso;

      const criado = esperado(
        await api.post("/events", {
          tipo: "audiencia",
          titulo: `Audiência de terça (${fuso})`,
          data: DATA
        }),
        201,
        `criação em ${fuso}`
      );

      assert.equal(criado.data, DATA, `a resposta da criação em ${fuso}`);

      const lido = esperado(await api.get(`/events/${criado._id}`), 200, `leitura em ${fuso}`);
      assert.equal(lido.data, DATA, `a leitura em ${fuso}`);

      // A prova pelo BANCO, e não só pela resposta: o instante gravado tem de
      // ser meia-noite UTC exata. É esta asserção que pega a troca do parser
      // por um `new Date(...)` local, mesmo que a leitura ainda bata por acaso.
      // `acharEm` vai pelo driver cru, que não converte string em ObjectId —
      // a conversão é do teste, e sem ela o filtro simplesmente não casa.
      const [documento] = await acharEm("events", {
        _id: new mongoose.Types.ObjectId(criado._id)
      });
      assert.ok(documento, "o evento precisa estar no banco");
      const gravado = new Date(documento.data);
      assert.equal(gravado.toISOString(), "2026-09-01T00:00:00.000Z", `o gravado em ${fuso}`);
      assert.equal(gravado.getUTCDay(), DIA_DA_SEMANA, `o dia da semana em ${fuso}`);
    });

    test(`o calendário devolve a data intacta em ${fuso}`, async () => {
      process.env.TZ = fuso;

      const corpo = esperado(
        await api.get(`/calendar?de=2026-09-01&ate=2026-09-30`),
        200,
        `calendário em ${fuso}`
      );

      const nossos = corpo.itens.filter((i) => i.natureza === "evento" && i.data === DATA);
      assert.ok(nossos.length > 0, `o evento de ${DATA} tem de aparecer em ${fuso}`);

      // Nenhum item do calendário pode sair como instante ISO. É a decisão de
      // fronteira da fase: a data cruza a rede como `AAAA-MM-DD`, e um `T` na
      // string significa que alguém devolveu um instante por outro caminho.
      for (const item of corpo.itens) {
        assert.match(
          item.data,
          /^\d{4}-\d{2}-\d{2}$/,
          `item "${item.titulo}" saiu com data ${item.data} — data de calendário não é instante`
        );
      }
    });
  }

  test("os dois fusos leem EXATAMENTE a mesma coisa", async () => {
    process.env.TZ = FUSO_OESTE;
    const oeste = esperado(await api.get("/calendar?de=2026-09-01&ate=2026-09-30"), 200, "oeste");

    process.env.TZ = FUSO_LESTE;
    const leste = esperado(await api.get("/calendar?de=2026-09-01&ate=2026-09-30"), 200, "leste");

    const datas = (corpo) => corpo.itens.map((i) => `${i.titulo}@${i.data}`).sort();
    assert.deepEqual(datas(oeste), datas(leste), "a janela lida nos dois fusos");
    assert.equal(oeste.de, leste.de);
    assert.equal(oeste.ate, leste.ate);
  });
});

describe("F-3 — o ponto único recusa o instante em vez de adivinhar", () => {
  test("um instante ISO é RECUSADO com 400, e a mensagem diz por quê", async () => {
    const r = await api.post("/events", {
      tipo: "audiencia",
      titulo: "Mandada como instante",
      data: "2026-09-01T00:00:00.000Z"
    });

    assert.equal(r.status, 400);
    // A frase precisa dizer o formato E dar o contraexemplo: um "data inválida"
    // seco, para um valor que parece perfeitamente válido, manda procurar o
    // erro no lugar errado.
    assert.match(r.body.message, /AAAA-MM-DD/);
    assert.match(r.body.message, /não um instante/);
  });

  test("um instante com hora de outro fuso também é recusado", async () => {
    const r = await api.post("/events", {
      tipo: "audiencia",
      titulo: "Instante às 3h de Brasília",
      data: "2026-09-01T03:00:00.000Z"
    });
    assert.equal(r.status, 400);
  });

  test("31 de fevereiro é recusado, e não deslizado para 3 de março", async () => {
    const r = await api.post("/events", {
      tipo: "prazo",
      titulo: "Data que não existe",
      data: "2026-02-31"
    });
    assert.equal(r.status, 400);
    // `Date.UTC(2026, 1, 31)` devolveria 03/03 em silêncio. Gravar 03/03 para
    // quem digitou 31/02 é pior que recusar: a advogada leria uma data que ela
    // não escreveu e não teria como saber disso.
    assert.equal(lerDataDeCalendario("2026-02-31"), null);
  });
});

describe("F-3 — as funções puras do ponto único", () => {
  test("ida e volta preserva a data em qualquer fuso", () => {
    for (const fuso of [FUSO_OESTE, FUSO_LESTE, "UTC"]) {
      process.env.TZ = fuso;
      for (const data of ["2026-01-01", "2026-02-29", "2024-02-29", "2026-12-31", DATA]) {
        const lida = lerDataDeCalendario(data);
        if (data === "2026-02-29") {
          // 2026 não é bissexto: 29/02 não existe e tem de sair `null`.
          assert.equal(lida, null, `${data} em ${fuso}`);
          continue;
        }
        assert.equal(escreverDataDeCalendario(lida), data, `${data} em ${fuso}`);
      }
    }
  });

  test("`hoje` sai como AAAA-MM-DD, e é o dia UTC", () => {
    const agora = new Date("2026-09-01T23:30:00.000Z");
    assert.equal(hojeComoDataDeCalendario(agora), "2026-09-01");

    // A janela conhecida e ACEITA: às 21h de Brasília (00h UTC do dia seguinte)
    // o "hoje" do sistema já virou. É a mesma conta que o `dashboardService` faz
    // desde a Fase 4 — e adotar o fuso do escritório só aqui faria o sino e o
    // painel contarem parcelas vencidas diferentes por três horas todo dia.
    const viradaUTC = new Date("2026-09-02T00:30:00.000Z");
    assert.equal(hojeComoDataDeCalendario(viradaUTC), "2026-09-02");
  });

  test("`escreverDataDeCalendario` NUNCA usa hora local", () => {
    // O mesmo instante, lido em três fusos, tem de dar a mesma string. Um
    // `getDate()` no lugar de `getUTCDate()` faria esta asserção cair.
    const instante = new Date("2026-09-01T00:00:00.000Z");
    const lidas = new Set();
    for (const fuso of [FUSO_OESTE, FUSO_LESTE, "UTC"]) {
      process.env.TZ = fuso;
      lidas.add(escreverDataDeCalendario(instante));
    }
    assert.equal(lidas.size, 1, `saiu diferente por fuso: ${[...lidas].join(", ")}`);
    assert.equal([...lidas][0], DATA);
  });
});
