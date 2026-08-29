// ═══════════════════════════════════════════════════════════════════════════
// F-5b, PARTE 1.1 — A MESMA GRAVAÇÃO, DUAS VEZES, NÃO CRIA DUAS
//
// O caso que este arquivo protege não é o raro, é o comum: a rede cai **depois**
// de o servidor gravar e **antes** de a resposta chegar. Para o aparelho a
// requisição falhou; para o banco ela aconteceu. A fila reenvia — e sem
// idempotência a advogada acaba com duas audiências no mesmo horário, sem nunca
// ter pedido a segunda.
//
// Aqui o servidor é exercitado de verdade, pela API, com o cabeçalho
// `Idempotency-Key` — que é como a fila do frontend vai mandar.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, contarEm, acharEm, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";
import {
  ehChaveValida,
  identidadeDaOperacao
} from "../../src/middleware/idempotencyMiddleware.js";
import {
  VALIDADE_DA_CHAVE_MS,
  calcularExpiracao,
  chaveExpirada
} from "../../src/models/IdempotencyKey.js";

const COLECOES = [
  "users", "clients", "processes", "processo_clientes",
  "events", "idempotency_keys"
];

let api;
let outraApi;
let processo;

before(async () => {
  await subirApp();
  await limparColecoes(COLECOES);
  api = await registrarUsuario("advogada da F-5b");
  outraApi = await registrarUsuario("estagiária da F-5b");
  const cliente = await criarClientePF(api);
  processo = await criarProcesso(api, [{ clienteId: cliente._id, papel: "autor", principal: true }]);
});

after(async () => {
  await limparColecoes(COLECOES);
  await derrubarApp();
  await desconectar();
});

// UUID por teste, para um teste nunca herdar a chave do outro.
let contador = 0;
const uuid = () => {
  contador += 1;
  const n = String(contador).padStart(12, "0");
  return `3f2504e0-4f89-11d3-9a0c-${n}`;
};

const comChave = (chave) => ({ headers: { "Idempotency-Key": chave } });

const evento = (extra = {}) => ({
  tipo: "audiencia",
  titulo: "Audiência de instrução",
  data: "2026-09-01",
  ...extra
});

// ═════════════════════════════════════════════════════════════════════════
// As funções puras
// ═════════════════════════════════════════════════════════════════════════

describe("a chave: formato, identidade da operação e validade", () => {
  test("só UUID serve", () => {
    assert.equal(ehChaveValida("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), true);
    assert.equal(ehChaveValida("3F2504E0-4F89-11D3-9A0C-0305E82C3301"), true);
    // Chave curta ou previsível colidiria entre operações diferentes e faria
    // uma devolver a resposta da outra.
    for (const ruim of ["salvar", "1", "", "   ", null, undefined, 42, "3f2504e0-4f89-11d3-9a0c"]) {
      assert.equal(ehChaveValida(ruim), false, `deveria recusar: ${ruim}`);
    }
  });

  test("a identidade da operação é método + caminho, sem query", () => {
    const req = { method: "PATCH", originalUrl: "/api/events/abc123?page=2" };
    assert.equal(identidadeDaOperacao(req), "PATCH /api/events/abc123");
  });

  test("a validade é de 30 dias, e é uma conta só", () => {
    const agora = new Date("2026-08-29T10:00:00.000Z");
    assert.equal(VALIDADE_DA_CHAVE_MS, 30 * 24 * 60 * 60 * 1000);
    assert.equal(calcularExpiracao(agora).toISOString(), "2026-09-28T10:00:00.000Z");
  });

  test("expirada é pela DATA, não pelo coletor do Mongo", () => {
    // O TTL do Mongo passa a cada ~60s: um documento pode sobreviver alguns
    // segundos ao próprio vencimento. Quem lê confere.
    const agora = new Date("2026-08-29T10:00:00.000Z");
    assert.equal(chaveExpirada({ expiraEm: new Date("2026-08-29T09:59:59.000Z") }, agora), true);
    assert.equal(chaveExpirada({ expiraEm: new Date("2026-08-29T10:00:01.000Z") }, agora), false);
    assert.equal(chaveExpirada({}, agora), true, "sem data, não vale");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// O servidor, executado
// ═════════════════════════════════════════════════════════════════════════

describe("a mesma chave duas vezes: um registro só, a mesma resposta", () => {
  test("criar compromisso — o reenvio devolve o mesmo corpo e não grava de novo", async () => {
    const chave = uuid();
    const corpo = evento({ titulo: "Audiência que a rede engoliu" });

    const primeira = await api.post("/events", corpo, comChave(chave));
    const criado = esperado(primeira, 201, "primeira gravação");

    const antes = await contarEm("events", { titulo: corpo.titulo });
    assert.equal(antes, 1);

    // O reenvio da fila: mesma chave, mesmo corpo.
    const segunda = await api.post("/events", corpo, comChave(chave));

    assert.equal(segunda.status, 201, "o reenvio devolve o MESMO status");
    assert.deepEqual(segunda.body, criado, "o reenvio devolve o MESMO corpo");
    assert.equal(
      segunda.headers.get("idempotent-replay"), "true",
      "a repetição precisa se anunciar — é o que permite depurar uma fila sem adivinhação"
    );

    const depois = await contarEm("events", { titulo: corpo.titulo });
    assert.equal(depois, 1, "o reenvio criou um segundo compromisso — é a duplicação da fila");
  });

  test("editar compromisso — o reenvio não grava de novo", async () => {
    const criado = esperado(
      await api.post("/events", evento({ titulo: "Reunião com a cliente" })),
      201, "arranjo"
    );

    const chave = uuid();
    const primeira = await api.patch(
      `/events/${criado._id}`, { local: "Fórum de Ponta Grossa" }, comChave(chave)
    );
    const atualizado = esperado(primeira, 200, "primeira edição");

    // Alguém edita por outro caminho no meio — o reenvio NÃO pode desfazer.
    await api.patch(`/events/${criado._id}`, { local: "Sala 3" });

    const segunda = await api.patch(
      `/events/${criado._id}`, { local: "Fórum de Ponta Grossa" }, comChave(chave)
    );

    assert.equal(segunda.status, 200);
    assert.deepEqual(segunda.body, atualizado, "o reenvio repete a resposta guardada");

    const atual = esperado(await api.get(`/events/${criado._id}`), 200, "leitura final");
    assert.equal(
      atual.local, "Sala 3",
      "o reenvio EXECUTOU de novo e desfez a edição do meio — a repetição não pode gravar"
    );
  });

  test("mudar a fase — o reenvio não grava um segundo item de histórico", async () => {
    const chave = uuid();
    const primeira = await api.patch(
      `/processes/${processo._id}/fase`, { fase: "sentenca" }, comChave(chave)
    );
    esperado(primeira, 200, "primeira mudança de fase");

    const segunda = await api.patch(
      `/processes/${processo._id}/fase`, { fase: "sentenca" }, comChave(chave)
    );
    assert.equal(segunda.status, 200);

    const atual = esperado(
      await api.get(`/processes/${processo._id}`), 200, "leitura do processo"
    );
    const paraSentenca = (atual.historicoFase ?? []).filter((h) => h.para === "sentenca");
    assert.equal(
      paraSentenca.length, 1,
      "o histórico ganhou duas entradas para a mesma transição — o reenvio executou de novo"
    );
  });
});

describe("chaves diferentes com o corpo igual: são DUAS intenções", () => {
  test("dois compromissos idênticos, criados de propósito, continuam sendo dois", async () => {
    // A advogada tem duas audiências iguais no mesmo dia — acontece. A
    // idempotência protege contra o REENVIO, e não contra a repetição
    // deliberada: quem distingue as duas é a chave, que nasce no clique.
    const corpo = evento({ titulo: "Audiência dupla", data: "2026-09-02" });

    esperado(await api.post("/events", corpo, comChave(uuid())), 201, "primeira");
    esperado(await api.post("/events", corpo, comChave(uuid())), 201, "segunda");

    assert.equal(await contarEm("events", { titulo: "Audiência dupla" }), 2);
  });

  test("sem cabeçalho nenhum, o comportamento é o de antes da F-5b", async () => {
    const corpo = evento({ titulo: "Sem chave", data: "2026-09-03" });
    esperado(await api.post("/events", corpo), 201, "primeira");
    esperado(await api.post("/events", corpo), 201, "segunda");

    assert.equal(await contarEm("events", { titulo: "Sem chave" }), 2);
    assert.equal(
      await contarEm("idempotency_keys", { operacao: "POST /api/events" }) > 0, true,
      "as chaves das requisições COM cabeçalho continuam guardadas"
    );
  });
});

describe("a chave recusada, e a que não vale mais", () => {
  test("chave que não é UUID é 400, e não passa despercebida", async () => {
    const r = await api.post("/events", evento(), comChave("salvar-agora"));
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Idempotency-Key/);
  });

  test("a mesma chave em OUTRA operação é recusada, não respondida", async () => {
    const chave = uuid();
    esperado(await api.post("/events", evento({ titulo: "Origem da chave" }), comChave(chave)), 201, "criação");

    const r = await api.patch(`/processes/${processo._id}/fase`, { fase: "execucao" }, comChave(chave));

    assert.equal(r.status, 409);
    assert.equal(r.body.regra, "chaveReutilizada");
    // Devolver a resposta do compromisso a uma mudança de fase seria pior do
    // que recusar: a tela mostraria "fase alterada" para algo que não mudou.
  });

  test("resposta de ERRO não é guardada — a correção precisa poder executar", async () => {
    const chave = uuid();

    // Falta o título: 400 do validador escrito à mão.
    const ruim = await api.post("/events", { tipo: "audiencia", data: "2026-09-04" }, comChave(chave));
    assert.equal(ruim.status, 400);

    // A MESMA chave, agora com o corpo corrigido, precisa gravar.
    const bom = await api.post(
      "/events", evento({ titulo: "Corrigido depois do 400", data: "2026-09-04" }), comChave(chave)
    );
    assert.equal(
      bom.status, 201,
      "o 400 ficou guardado e a correção foi respondida com o erro antigo — a advogada ficaria presa"
    );
  });

  test("chave vencida executa de novo; chave no prazo repete a resposta", async () => {
    const chave = uuid();
    const corpo = evento({ titulo: "Compromisso da chave vencida", data: "2026-09-05" });

    esperado(await api.post("/events", corpo, comChave(chave)), 201, "primeira");
    assert.equal(await contarEm("events", { titulo: corpo.titulo }), 1);

    // Antes da hora: repete, não executa.
    esperado(await api.post("/events", corpo, comChave(chave)), 201, "reenvio dentro do prazo");
    assert.equal(
      await contarEm("events", { titulo: corpo.titulo }), 1,
      "a chave ainda valia e mesmo assim executou de novo"
    );

    // Envelhece a chave à força — é o que 30 dias fariam, sem esperar por eles.
    await mongoose.connection.db.collection("idempotency_keys").updateOne(
      { chave },
      { $set: { expiraEm: new Date(Date.now() - 1000) } }
    );

    esperado(await api.post("/events", corpo, comChave(chave)), 201, "reenvio com a chave vencida");
    assert.equal(
      await contarEm("events", { titulo: corpo.titulo }), 2,
      "chave vencida precisa deixar a requisição executar como se fosse nova"
    );
  });

  test("a coleção tem o índice de expiração — sem ele, ela cresce para sempre", async () => {
    const indices = await mongoose.connection.db.collection("idempotency_keys").indexes();
    const ttl = indices.find((i) => i.expireAfterSeconds !== undefined);
    assert.ok(ttl, `nenhum índice TTL em idempotency_keys: ${JSON.stringify(indices.map(i => i.name))}`);
    assert.equal(ttl.key.expiraEm, 1);
    assert.equal(ttl.expireAfterSeconds, 0, "a expiração é pela DATA de cada documento");
  });

  test("a chave guardada nasce com 30 dias de prazo", async () => {
    const chave = uuid();
    esperado(await api.post("/events", evento({ titulo: "Prazo da chave", data: "2026-09-06" }), comChave(chave)), 201, "criação");

    const [registro] = await acharEm("idempotency_keys", { chave });
    assert.ok(registro, "a chave não foi guardada");
    assert.equal(registro.estado, "concluida");
    assert.equal(registro.respostaStatus, 201);

    const prazo = new Date(registro.expiraEm).getTime() - new Date(registro.createdAt).getTime();
    // Um segundo de folga: `createdAt` e `expiraEm` são carimbados no mesmo
    // instante, mas por caminhos diferentes.
    assert.ok(
      Math.abs(prazo - VALIDADE_DA_CHAVE_MS) < 1000,
      `prazo de ${prazo}ms, esperado ~${VALIDADE_DA_CHAVE_MS}ms`
    );
  });
});

describe("a chave é ESCOPADA por usuário", () => {
  test("a mesma chave, em duas contas, são duas gravações", async () => {
    // Mesma razão de sempre neste projeto: nada de um usuário responde pelo
    // outro. O UUID repetido entre contas é improvável, mas o escopo custa
    // nada — e é o que impede a resposta de uma advogada de vazar para outra.
    const chave = uuid();
    const corpo = evento({ titulo: "Compromisso homônimo", data: "2026-09-07" });

    const daAdvogada = esperado(await api.post("/events", corpo, comChave(chave)), 201, "advogada");
    const daEstagiaria = esperado(await outraApi.post("/events", corpo, comChave(chave)), 201, "estagiária");

    assert.notEqual(daAdvogada._id, daEstagiaria._id);
    assert.equal(await contarEm("idempotency_keys", { chave }), 2);
  });
});
