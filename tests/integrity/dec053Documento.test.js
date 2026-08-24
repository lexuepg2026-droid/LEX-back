// ═══════════════════════════════════════════════════════════════════════════
// DEC-053 ALCANÇA DOCUMENTO — a lacuna do passo 204 (F-2d)
//
// ── O achado ─────────────────────────────────────────────────────────────
// A auditoria da F-2c, rodada contra o banco de desenvolvimento em 24/08/2026,
// achou UM órfão, e ele era de Documento:
//
//   Documento → Processo
//     filho ATIVO   : Peticao de Suspensao da Execucao
//     pai   INATIVO : Execucao Fiscal - IPTU
//
// ── O diagnóstico, antes da correção ─────────────────────────────────────
// A pergunta era: a cascata não alcança o documento, ou alcança e ele escapou?
// Os carimbos do próprio banco responderam: o documento foi criado
// 13:38:45 e o processo desativado 13:48:05, com `vinculosAfetados: 1`.
//
// **A cascata não o alcança** — `deleteProcess` derruba os vínculos
// processo↔cliente e mais nada, por decisão da DEC-052. O órfão NASCEU da
// desativação, não escapou de nada.
//
// E a boca 2 da DEC-053 já RECUSAVA a criação sob processo inativo — mas com
// **404 "Processo não encontrado"**, para um processo que existe e que a
// advogada está vendo com a tag "Desativado". É literalmente a frase que a
// DEC-053 nomeou como o defeito: Documento era o único módulo que a F-2c não
// passou para `assertProcessoAtivoParaCriar`.
//
// ── O que este arquivo trava ─────────────────────────────────────────────
// As TRÊS portas por onde um documento nasce sob um processo, e a AUSÊNCIA da
// reativação — que é o que fecha a boca 1.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarSecao, criarModelo,
  vincularSecao, esperado
} from "../helpers/setup.js";
import { REGRA_CONFLITO } from "../../src/config/integrityConflicts.js";

const ler = (caminho) =>
  readFileSync(fileURLToPath(new URL(`../../${caminho}`, import.meta.url)), "utf8");

describe("DEC-053 alcança Documento", () => {
  let api;
  let cliente;
  let processo;
  let modelo;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("dec053doc");
    cliente = await criarClientePF(api, { nomeCompleto: "Otávio Ribeiro Nunes" });
    processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ], { titulo: "Execução Fiscal — IPTU" });

    // Um modelo com uma seção, para a porta da GERAÇÃO poder ser exercida.
    modelo = await criarModelo(api, { nome: "Petição de suspensão" });
    const secao = await criarSecao(api, { titulo: "Pedido", texto: "Requer a suspensão." });
    await vincularSecao(api, modelo._id, secao._id);

    // O processo sai. A cascata derruba os vínculos e MAIS NADA — é assim
    // desde a DEC-052, e é por isso que o órfão do banco de desenvolvimento
    // nasceu de uma desativação, não de uma criação.
    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // A forma da recusa, nas três portas: 409, a regra da DEC-053, e o NOME do
  // processo. Não é 404 — o processo existe.
  const conferirRecusa = (r, contexto) => {
    assert.equal(r.status, 409, `${contexto}: esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);
    assert.equal(r.body.regra, REGRA_CONFLITO.PAI_INATIVO, `${contexto}: regra`);
    assert.ok(
      r.body.message.includes("Execução Fiscal — IPTU"),
      `${contexto}: a recusa precisa NOMEAR o processo — ${r.body.message}`
    );
    assert.match(r.body.message, /desativado/, `${contexto}: precisa dizer que está desativado`);
    assert.match(r.body.message, /Reative o processo primeiro/, `${contexto}: precisa dizer o que fazer`);
    // A frase que a DEC-053 nomeou como o defeito, e que Documento ainda dava.
    assert.doesNotMatch(
      r.body.message,
      /não encontrado/i,
      `${contexto}: "não encontrado" manda procurar o que não está perdido`
    );
  };

  // ═══════════════════════════════════════════════════════════════════════
  // BOCA 2 — as TRÊS portas por onde um documento nasce sob um processo
  // ═══════════════════════════════════════════════════════════════════════

  describe("boca 2: criar documento sob processo inativo", () => {
    test("porta 1 — POST /documents é recusado, nomeando o processo", async () => {
      const r = await api.post("/documents", {
        processoId: processo._id,
        nome: "Petição de Suspensão da Execução",
        tipo: "peticao",
        origem: "gerado"
      });
      conferirRecusa(r, "POST /documents");
    });

    test("porta 2 — MOVER um documento para o processo inativo é recusado", async () => {
      // Um documento que já existe, num processo ativo, sendo apontado para o
      // inativo. Faz o órfão nascer do mesmo jeito, pela porta do PATCH — e era
      // a porta em que a guarda local também dava 404.
      const outro = await criarProcesso(api, [
        { clienteId: cliente._id, papel: "autor", principal: true }
      ], { titulo: "Processo vivo" });

      const documento = esperado(
        await api.post("/documents", {
          processoId: outro._id,
          nome: "Petição qualquer",
          tipo: "peticao",
          origem: "gerado"
        }),
        201,
        "documento no processo vivo"
      );

      const r = await api.patch(`/documents/${documento._id}`, { processoId: processo._id });
      conferirRecusa(r, "PATCH /documents/:id { processoId }");

      // E o documento NÃO se moveu.
      const depois = esperado(
        await api.get(`/documents/${documento._id}`),
        200,
        "releitura"
      );
      assert.equal(
        String(depois.processoId?._id ?? depois.processoId),
        String(outro._id),
        "o documento continua no processo vivo"
      );
    });

    test("porta 3 — GERAR do modelo é recusado, nomeando o processo", async () => {
      const r = await api.post(`/documents/modelos/${modelo._id}/gerar`, {
        processoId: processo._id
      });
      conferirRecusa(r, "POST /documents/modelos/:id/gerar");
    });

    test("porta 3b — o PREVIEW também, e é de propósito", async () => {
      // Pré-visualizar não grava nada. Mas oferecer a prévia de uma peça que a
      // geração recusaria é levar a advogada até o último clique para dizer não.
      const r = await api.get(`/documents/${modelo._id}/preview?processoId=${processo._id}`);
      conferirRecusa(r, "GET /documents/:id/preview");
    });

    test("o caminho CORRETO continua aberto: reativar o processo e então criar", async () => {
      // Tão importante quanto a recusa. Uma guarda que fechasse a criação
      // legítima trocaria um órfão por um módulo inutilizado.
      const vivo = await criarProcesso(api, [
        { clienteId: cliente._id, papel: "autor", principal: true }
      ], { titulo: "Processo reativado" });

      esperado(await api.delete(`/processes/${vivo._id}`), 200, "desativar");
      esperado(await api.patch(`/processes/${vivo._id}/reactivate`), 200, "reativar");

      esperado(
        await api.post("/documents", {
          processoId: vivo._id,
          nome: "Petição depois da volta",
          tipo: "peticao",
          origem: "gerado"
        }),
        201,
        "criar no processo reativado"
      );
    });

    test("processo INEXISTENTE continua 404 — e a distinção importa", async () => {
      // "Não existe" e "está desativado" são respostas diferentes, e o 404
      // continua sendo o caminho de quem manda um id de outro usuário: a
      // mensagem não confirma nem nega a existência alheia.
      const r = await api.post("/documents", {
        processoId: "6a8c4965e2ed6915acce0000",
        nome: "Petição fantasma",
        tipo: "peticao",
        origem: "gerado"
      });
      assert.equal(r.status, 404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BOCA 1 — fechada POR AUSÊNCIA
  // ═══════════════════════════════════════════════════════════════════════

  describe("boca 1: reativar documento sob processo inativo", () => {
    test("não existe reativação de documento — a ausência é o que fecha a boca", async () => {
      // Não se acrescenta guarda para um caminho que não existe: guarda que
      // nunca roda é código que ninguém consegue testar sem fabricar o estado
      // por fora do sistema. É a mesma decisão escrita para `PAI_TENANT`.
      //
      // O que se faz é TRAVAR A AUSÊNCIA, para que o dia em que a reativação de
      // documento nascer, ela nasça já sabendo desta regra — este teste cai, e
      // quem o estiver corrigindo lê a nota acima antes de mexer.
      const rotas = ler("src/routes/documentRoutes.js");
      assert.doesNotMatch(
        rotas,
        /reactivate|reativar/i,
        "documentRoutes ganhou uma rota de reativação — leia a nota da DEC-053 " +
        "em `activationHierarchy.js` antes de seguir: ela precisa recusar " +
        "documento sob processo inativo, nomeando o processo."
      );
    });

    test("`ativo` está fora da allowlist do PATCH de documento", async () => {
      // O segundo caminho por onde um documento voltaria: `{ ativo: true }` no
      // corpo do update. Fechado desde a Fase 4.5, e travado aqui de novo
      // porque é ele que tornaria a ausência de rota irrelevante.
      const documento = esperado(
        await api.post("/documents", {
          nome: "Modelo solto",
          tipo: "peticao",
          origem: "gerado",
          ehModelo: true
        }),
        201,
        "documento"
      );

      esperado(await api.delete(`/documents/${documento._id}`), 200, "desativar documento");

      const r = await api.patch(`/documents/${documento._id}`, { ativo: true });
      assert.equal(r.status, 400, `esperado 400, veio ${r.status}`);
      assert.equal(r.body.campo, "ativo");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // A CASCATA, e por que ela NÃO mudou
  // ═══════════════════════════════════════════════════════════════════════

  describe("a cascata do processo NÃO alcança o documento", () => {
    test("desativar o processo deixa o documento ativo — e isso é a DEC-052", async () => {
      // É o mecanismo exato que produziu o órfão do banco de desenvolvimento.
      // Fica registrado por teste e NÃO é corrigido nesta fase: mudar o alcance
      // da cascata é mexer na DEC-052, que decidiu de propósito que honorário,
      // parcela, pagamento e documento não caem junto com o processo.
      //
      // Se algum dia a cascata passar a alcançá-los, ESTE é o teste que cai — e
      // a decisão precisa estar escrita antes de ele ser reescrito.
      const p = await criarProcesso(api, [
        { clienteId: cliente._id, papel: "autor", principal: true }
      ], { titulo: "Processo com documento" });

      const documento = esperado(
        await api.post("/documents", {
          processoId: p._id,
          nome: "Petição que fica",
          tipo: "peticao",
          origem: "gerado"
        }),
        201,
        "documento"
      );

      esperado(await api.delete(`/processes/${p._id}`), 200, "desativar processo");

      const depois = esperado(
        await api.get(`/documents/${documento._id}`),
        200,
        "o documento continua alcançável"
      );
      assert.equal(depois.ativo, true, "o documento continua ATIVO sob processo inativo");
    });
  });
});
