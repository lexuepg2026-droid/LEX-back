// ═══════════════════════════════════════════════════════════════════════════
// PAGINAÇÃO ESTÁVEL COM EMPATE DE `createdAt` (achado da semeadura com volume)
//
// `skip/limit` sobre uma ordenação com empate não é determinístico: o MongoDB
// pode devolver os empatados em ordens diferentes entre uma página e a outra,
// e a listagem repete uma linha e pula outra. Medido no ambiente publicado com
// o volume novo: 290 processos lidos → 289 distintos; 371 honorários → 369.
//
// O empate é NORMAL, não exótico — carga em lote, importação e datas de
// calendário gravadas à meia-noite produzem o mesmo `createdAt` para vários
// registros. Clientes já tinham o desempate por `_id` desde a DEC-062; as três
// listagens abaixo ordenavam só por `createdAt`.
//
// Aqui o empate é FABRICADO (todos com o mesmo `createdAt`) e a listagem é
// percorrida em páginas de 2: cada id tem de aparecer exatamente uma vez.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario, criarModelo, esperado
} from "../helpers/setup.js";

const QUANTOS = 7;
const INSTANTE = new Date("2026-03-10T00:00:00.000Z");

describe("paginação estável quando createdAt empata", () => {
  let api;

  const empatar = (colecao) =>
    mongoose.connection.db.collection(colecao).updateMany({}, { $set: { createdAt: INSTANTE } });

  const percorrer = async (rota) => {
    const ids = [];
    let pagina = 1, totalPages = 1, total = 0;
    do {
      const r = esperado(await api.get(`${rota}?page=${pagina}&limit=2`), 200, `${rota} página ${pagina}`);
      totalPages = r.totalPages; total = r.total;
      ids.push(...r.data.map((d) => String(d._id)));
      pagina += 1;
    } while (pagina <= totalPages);
    return { ids, total };
  };

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("paginacao");
    const pf = await criarClientePF(api);
    const processos = [];
    for (let i = 0; i < QUANTOS; i++) {
      processos.push(await criarProcesso(api, [{ clienteId: pf._id, papel: "autor", principal: true }], {
        numeroProcesso: `${1000000 + i}-00.2026.8.16.0019`
      }));
    }
    for (const p of processos) await criarHonorario(api, p._id);
    for (let i = 0; i < QUANTOS; i++) await criarModelo(api, { nome: `Modelo empate ${i}` });
    for (const c of ["processes", "fees", "documents"]) await empatar(c);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  for (const [rotulo, rota] of [
    ["processos", "/processes"],
    ["honorários", "/fees"],
    ["documentos", "/documents/modelos"]
  ]) {
    test(`${rotulo}: cada linha aparece exatamente uma vez, com todos empatados`, async () => {
      const { ids, total } = await percorrer(rota);
      assert.equal(total, QUANTOS, `a listagem deveria ter ${QUANTOS}`);
      assert.equal(ids.length, QUANTOS);
      assert.equal(new Set(ids).size, QUANTOS, `há id repetido entre as páginas de ${rota}`);
    });
  }
});
