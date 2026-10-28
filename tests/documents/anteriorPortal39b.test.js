// ═══════════════════════════════════════════════════════════════════════════
// DEC-144 — o anterior do aviso de portal, sem o teto de 100 (Fase 3.9b)
//
// A geração procura "o documento anterior desta combinação que está visível
// no portal" — modelo × processo × cliente, a combinação de
// `buscarGeradoAnterior`. A tela pedia os 100 documentos do processo e
// procurava neles; num processo com mais de 100, o anterior mais antigo ficava
// de fora e o aviso sumia.
//
// `GET /documents` ganhou `?geradoDeModeloId=`, `?clienteId=` e
// `?visivelPortal=` — só aditivos. Sem eles, a listagem é a de sempre.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar, conectar, COLECOES } from "../helpers/db.js";
import {
  registrarUsuario, criarProcesso, criarClientePF, criarSecao, criarModelo, vincularSecao, esperado
} from "../helpers/setup.js";

const VOLUME = 105;

describe("DEC-144 — os filtros do anterior do aviso de portal", () => {
  let adv;
  let outra;
  let modelo;
  let outroModelo;
  let joao;
  let maria;
  let processo;
  let anterior;

  const montarModelo = async (quem, nome) => {
    const secao = await criarSecao(quem);
    const m = await criarModelo(quem, { nome });
    await vincularSecao(quem, m._id, secao._id);
    return m;
  };

  const gerar = async (quem, modeloId, processoId, clienteId) => {
    const corpo = esperado(
      await quem.post(`/documents/modelos/${modeloId}/gerar`, { processoId, clienteId }),
      201,
      "gerar"
    );
    return corpo.documento ?? corpo;
  };

  before(async () => {
    await subirApp();
    await limparColecoes();
    adv = await registrarUsuario("dona do processo cheio");
    outra = await registrarUsuario("outra advogada");

    joao = await criarClientePF(adv, { nomeCompleto: "João Herdeiro" });
    maria = await criarClientePF(adv, { nomeCompleto: "Maria Herdeira" });
    processo = await criarProcesso(adv, [
      { clienteId: joao._id, papel: "autor", principal: true },
      { clienteId: maria._id, papel: "autor", principal: false }
    ], { titulo: "Inventário com muitos documentos" });

    modelo = await montarModelo(adv, "Procuração do inventário");
    outroModelo = await montarModelo(adv, "Declaração de volume");

    // O anterior: gerado PRIMEIRO, liberado no portal. É o mais antigo.
    anterior = await gerar(adv, modelo._id, processo._id, joao._id);
    esperado(
      await adv.patch(`/documents/${anterior._id}/visibilidade-portal`, { visivelPortal: true }),
      200,
      "liberar no portal"
    );
    // O mesmo modelo para a Maria, visível: outra combinação, não é o anterior do João.
    const daMaria = await gerar(adv, modelo._id, processo._id, maria._id);
    esperado(
      await adv.patch(`/documents/${daMaria._id}/visibilidade-portal`, { visivelPortal: true }),
      200,
      "liberar o da Maria"
    );

    // Mais de 100 documentos MAIS NOVOS no mesmo processo, de outro modelo.
    // Inseridos direto no banco (gerar 105 pela API não muda o que se testa).
    await conectar();
    const colecao = mongoose.connection.db.collection(COLECOES.DOCUMENTS);
    const base = await colecao.findOne({ _id: new mongoose.Types.ObjectId(String(anterior._id)) });
    const depois = Date.now() + 60_000;
    const volume = Array.from({ length: VOLUME }, (_, i) => {
      const { _id, ...resto } = base;
      return {
        ...resto,
        nome: `Volume ${i + 1}`,
        geradoDeModeloId: new mongoose.Types.ObjectId(String(outroModelo._id)),
        visivelPortal: false,
        createdAt: new Date(depois + i * 1000),
        updatedAt: new Date(depois + i * 1000)
      };
    });
    await colecao.insertMany(volume);
  });

  after(async () => {
    await derrubarApp();
    await desconectar();
  });

  test("preparo: o anterior fica FORA dos 100 mais recentes do processo (a consulta antiga o perdia)", async () => {
    const antiga = esperado(await adv.get(`/documents?processoId=${processo._id}&limit=100`), 200, "antiga");
    assert.ok(antiga.total > 100, `total ${antiga.total}`);
    assert.equal(antiga.data.some((d) => String(d._id) === String(anterior._id)), false);
  });

  test("com modelo + cliente + visível, o anterior vem — e só ele", async () => {
    const corpo = esperado(
      await adv.get(
        `/documents?processoId=${processo._id}&geradoDeModeloId=${modelo._id}` +
        `&clienteId=${joao._id}&visivelPortal=true&ehModelo=false&limit=1`
      ),
      200,
      "nova"
    );
    assert.equal(corpo.total, 1);
    assert.equal(String(corpo.data[0]._id), String(anterior._id));
    assert.equal(corpo.data[0].visivelPortal, true);
  });

  test("cada filtro sozinho recorta pelo seu campo", async () => {
    const porModelo = esperado(await adv.get(`/documents?geradoDeModeloId=${outroModelo._id}&limit=1`), 200, "modelo");
    assert.equal(porModelo.total, VOLUME);
    const porCliente = esperado(await adv.get(`/documents?clienteId=${maria._id}&limit=100`), 200, "cliente");
    assert.equal(porCliente.total, 1);
    const visiveis = esperado(await adv.get("/documents?visivelPortal=true&limit=100"), 200, "visíveis");
    assert.equal(visiveis.total, 2);
    const invisiveis = esperado(await adv.get(`/documents?visivelPortal=false&processoId=${processo._id}&limit=1`), 200, "invisíveis");
    assert.equal(invisiveis.total, VOLUME);
  });

  test("sem os filtros novos, a listagem de sempre (o mesmo total)", async () => {
    const corpo = esperado(await adv.get(`/documents?processoId=${processo._id}&limit=1`), 200, "sempre");
    assert.equal(corpo.total, VOLUME + 2);
  });

  test("id torto → 400 com `campo`; booleano torto → 400 com `campo`", async () => {
    const m = await adv.get("/documents?geradoDeModeloId=xyz");
    assert.equal(m.status, 400);
    assert.equal(m.body.campo, "geradoDeModeloId");
    const c = await adv.get("/documents?clienteId=123");
    assert.equal(c.status, 400);
    assert.equal(c.body.campo, "clienteId");
    const v = await adv.get("/documents?visivelPortal=sim");
    assert.equal(v.status, 400);
    assert.equal(v.body.campo, "visivelPortal");
  });

  test("isolamento por `usuarioId`: os ids da outra não abrem nada", async () => {
    const dela = esperado(
      await outra.get(`/documents?geradoDeModeloId=${modelo._id}&clienteId=${joao._id}&visivelPortal=true`),
      200,
      "dela"
    );
    assert.equal(dela.total, 0);
  });
});
