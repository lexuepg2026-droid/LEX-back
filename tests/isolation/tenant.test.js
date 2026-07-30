// ═══════════════════════════════════════════════════════════════════════════
// ISOLAMENTO POR `usuarioId` — o bloco mais importante da suíte.
//
// É a propriedade que sustenta o multi-tenant, e a que a Fase 3 (portal do
// cliente) pode quebrar sem ninguém ver: hoje o único olho sobre a API é o da
// advogada, que só tem os próprios dados. No portal, um filtro esquecido deixa
// de ser incômodo e passa a ser dado de um cliente aparecendo para outro.
//
// Dois usuários REAIS, A e B, criados pela API. Tudo de A é criado com a
// sessão de A. Toda tentativa é feita com a sessão de B, usando os `_id` reais
// de A. Nada de mock: se o filtro `{ usuarioId }` sumir de um service, este
// arquivo cai.
//
// Três direções de ataque, porque são três defeitos diferentes:
//   3.1  B lê/altera/apaga recurso de A pelo id            → 404 ou 403
//   3.2  as listagens de B mostram algo de A               → zero itens de A
//   3.3  recurso PRÓPRIO de B apontando para `_id` de A    → 400 ou 404
//   3.4  depois de tudo, nada de A foi alterado
//
// A 3.3 é a que escapa de filtro aplicado só no recurso de topo, e por isso
// tem bloco próprio.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario,
  criarClientePF,
  criarClientePJ,
  criarProcesso,
  criarHonorario,
  criarParcela,
  criarPagamento,
  criarSecao,
  criarModelo,
  vincularSecao,
  esperado
} from "../helpers/setup.js";
import { dadosClientePF, dadosHonorario, dadosParcela, dadosPagamento } from "../helpers/factories.js";

// ── Placar ─────────────────────────────────────────────────────────────────
// A Parte 10.7 pede o número: quantos recursos, quantas tentativas, quantos
// vazamentos. Zero vazamentos é condição de aceite da fase, então o número
// precisa sair da execução, não de contagem à mão sobre o código.
const placar = { recursos: 0, tentativas: 0, vazamentos: [] };

// Uma tentativa de B contra recurso de A. `200` é vazamento; `500` também é
// falha, porque significa que a defesa é acidental (uma exceção não tratada),
// não um filtro.
const negado = async (resposta, descricao) => {
  placar.tentativas += 1;

  if (resposta.status === 200 || resposta.status === 201) {
    placar.vazamentos.push(`${descricao} → ${resposta.status}`);
  }

  assert.ok(
    resposta.status === 404 || resposta.status === 403,
    `VAZAMENTO — ${descricao}: esperado 404 ou 403, veio ${resposta.status} — ` +
    `${JSON.stringify(resposta.body ?? "(binário)")}`
  );
};

// Referência cruzada: B cria recurso PRÓPRIO apontando para id de A. Aqui o
// recurso de topo é legitimamente de B, então o service recusa a referência —
// 400 (payload aponta para coisa que não existe para ele) ou 404.
const recusado = async (resposta, descricao) => {
  placar.tentativas += 1;

  if (resposta.status === 200 || resposta.status === 201) {
    placar.vazamentos.push(`${descricao} → ${resposta.status}`);
  }

  assert.ok(
    resposta.status === 400 || resposta.status === 404,
    `VAZAMENTO — ${descricao}: esperado 400 ou 404, veio ${resposta.status} — ` +
    `${JSON.stringify(resposta.body ?? "(binário)")}`
  );
};

const idsDe = (envelope) => (envelope?.data ?? envelope ?? []).map((x) => String(x._id));

describe("isolamento por usuarioId", () => {
  let A, B;
  let a = {}; // recursos de A
  let b = {}; // recursos de B

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    A = await registrarUsuario("usuário A");
    B = await registrarUsuario("usuário B");

    // ── Tudo de A, com a sessão de A ────────────────────────────────────────
    a.pf = await criarClientePF(A);
    a.pj = await criarClientePJ(A);
    a.processo = await criarProcesso(A, [
      { clienteId: a.pf._id, papel: "autor", principal: true },
      { clienteId: a.pj._id, papel: "litisconsorte", principal: false }
    ]);
    a.honorario = await criarHonorario(A, a.processo._id);
    a.parcela = await criarParcela(A, a.honorario._id, 1);
    a.pagamento = await criarPagamento(A, a.parcela._id);
    a.secao = await criarSecao(A, {
      texto:
        "{{nomeCliente}}, {{profissaoCliente}}, CPF {{cpfCliente}}, no processo " +
        "{{numeroProcesso}}, outorga poderes a {{nomeAdvogada}}, OAB/{{estadoOAB}} {{numOAB}}."
    });
    a.modelo = await criarModelo(A);
    await vincularSecao(A, a.modelo._id, a.secao._id);

    a.documento = esperado(
      await A.post(`/documents/modelos/${a.modelo._id}/gerar`, {
        processoId: a.processo._id,
        clienteId: a.pf._id
      }),
      201,
      "geração do documento de A"
    );

    // O vínculo de A, para as sub-rotas de participante.
    const participantes = esperado(
      await A.get(`/processes/${a.processo._id}/clientes`),
      200,
      "participantes de A"
    );
    a.vinculo = participantes.data.find((v) => String(v.clienteId._id) === String(a.pf._id));
    a.vinculoSecundario = participantes.data.find((v) => String(v.clienteId._id) === String(a.pj._id));

    // Estado de A no fim do arranjo, para a conferência da 3.4.
    a.snapshot = {
      cliente: esperado(await A.get(`/clients/${a.pf._id}`), 200, "snapshot cliente"),
      processo: esperado(await A.get(`/processes/${a.processo._id}`), 200, "snapshot processo"),
      honorario: esperado(await A.get(`/fees/${a.honorario._id}`), 200, "snapshot honorário"),
      documento: esperado(await A.get(`/documents/${a.documento._id}`), 200, "snapshot documento"),
      secao: esperado(await A.get(`/secoes/${a.secao._id}`), 200, "snapshot seção")
    };

    // 10 recursos de A sob ataque: PF, PJ, processo, vínculo, honorário,
    // parcela, pagamento, seção, documento, modelo.
    placar.recursos = 10;

    // ── O mínimo de B, para a 3.3 ───────────────────────────────────────────
    b.pf = await criarClientePF(B);
    b.processo = await criarProcesso(B, [
      { clienteId: b.pf._id, papel: "autor", principal: true }
    ]);
    b.honorario = await criarHonorario(B, b.processo._id);
    b.parcela = await criarParcela(B, b.honorario._id, 1);
    b.secao = await criarSecao(B, { texto: "Seção de B, sem variável." });
    b.modelo = await criarModelo(B);
    await vincularSecao(B, b.modelo._id, b.secao._id);

    // Um segundo modelo de B cujo texto USA variável de honorário. Sem ele não
    // dá para testar o cruzamento de `honorarioId`: `resolver` só chama
    // `resolverHonorario` quando o texto pede alguma das 6 variáveis da origem
    // `honorario` (`documentGenerationService.js:298`). Com o modelo de texto
    // seco, `honorarioId` é ignorado e a checagem de dono nunca é exercida —
    // o 201 que sairia dali não provaria isolamento nenhum.
    b.secaoComHonorario = await criarSecao(B, {
      texto: "O valor contratado é de {{valorHonorario}} ({{valorHonorarioExtenso}})."
    });
    b.modeloComHonorario = await criarModelo(B);
    await vincularSecao(B, b.modeloComHonorario._id, b.secaoComHonorario._id);
    b.documento = esperado(
      await B.post("/documents", {
        nome: "Documento próprio de B",
        tipo: "outro",
        processoId: b.processo._id,
        urlArquivo: "https://arquivos.lex.test/b.pdf"
      }),
      201,
      "documento de B"
    );
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3.1 — Acesso direto ao recurso de A com a sessão de B
  // ═════════════════════════════════════════════════════════════════════════

  describe("3.1 acesso direto a recurso alheio", () => {
    test("cliente PF de A", async () => {
      await negado(await B.get(`/clients/${a.pf._id}`), "GET /clients/:id de A");
      await negado(await B.patch(`/clients/${a.pf._id}`, { profissao: "invadida" }), "PATCH /clients/:id de A");
      await negado(await B.delete(`/clients/${a.pf._id}`), "DELETE /clients/:id de A");
    });

    test("cliente PJ de A", async () => {
      await negado(await B.get(`/clients/${a.pj._id}`), "GET /clients/:id (PJ) de A");
      await negado(await B.patch(`/clients/${a.pj._id}`, { nomeFantasia: "invadida" }), "PATCH /clients/:id (PJ) de A");
      await negado(await B.delete(`/clients/${a.pj._id}`), "DELETE /clients/:id (PJ) de A");
    });

    test("processo de A", async () => {
      await negado(await B.get(`/processes/${a.processo._id}`), "GET /processes/:id de A");
      await negado(await B.patch(`/processes/${a.processo._id}`, { titulo: "invadido" }), "PATCH /processes/:id de A");
      await negado(await B.put(`/processes/${a.processo._id}`, { titulo: "invadido" }), "PUT /processes/:id de A");
      await negado(await B.delete(`/processes/${a.processo._id}`), "DELETE /processes/:id de A");
    });

    test("vínculo processo-cliente de A", async () => {
      const p = a.processo._id;
      const c = a.pf._id;
      await negado(await B.get(`/processes/${p}/clientes`), "GET /processes/:id/clientes de A");
      await negado(await B.post(`/processes/${p}/clientes`, { clienteId: b.pf._id, papel: "reu" }), "POST /processes/:id/clientes de A");
      await negado(await B.patch(`/processes/${p}/clientes/${c}`, { papel: "reu" }), "PATCH vínculo de A");
      await negado(await B.delete(`/processes/${p}/clientes/${c}`), "DELETE vínculo de A");
    });

    test("sub-rotas de participante de A (código de acesso e principal)", async () => {
      const p = a.processo._id;
      await negado(
        await B.get(`/processes/${p}/clientes/${a.pf._id}/codigo-acesso`),
        "GET codigo-acesso de A"
      );
      await negado(
        await B.patch(`/processes/${p}/clientes/${a.pj._id}/principal`, {}),
        "PATCH clientes/:cid/principal de A"
      );
    });

    test("honorário de A", async () => {
      await negado(await B.get(`/fees/${a.honorario._id}`), "GET /fees/:id de A");
      await negado(await B.put(`/fees/${a.honorario._id}`, { valor: 1 }), "PUT /fees/:id de A");
      await negado(await B.delete(`/fees/${a.honorario._id}`), "DELETE /fees/:id de A");
    });

    test("parcela de A", async () => {
      await negado(await B.get(`/installments/${a.parcela._id}`), "GET /installments/:id de A");
      await negado(await B.put(`/installments/${a.parcela._id}`, { valor: 1 }), "PUT /installments/:id de A");
      await negado(await B.delete(`/installments/${a.parcela._id}`), "DELETE /installments/:id de A");
    });

    test("pagamento de A", async () => {
      await negado(await B.get(`/payments/${a.pagamento._id}`), "GET /payments/:id de A");
      await negado(await B.put(`/payments/${a.pagamento._id}`, { valorPago: 1 }), "PUT /payments/:id de A");
      await negado(await B.delete(`/payments/${a.pagamento._id}`), "DELETE /payments/:id de A");
    });

    test("seção de A", async () => {
      await negado(await B.get(`/secoes/${a.secao._id}`), "GET /secoes/:id de A");
      await negado(await B.patch(`/secoes/${a.secao._id}`, { titulo: "invadida" }), "PATCH /secoes/:id de A");
      await negado(await B.delete(`/secoes/${a.secao._id}`), "DELETE /secoes/:id de A");
    });

    test("documento de A", async () => {
      await negado(await B.get(`/documents/${a.documento._id}`), "GET /documents/:id de A");
      await negado(await B.patch(`/documents/${a.documento._id}`, { nome: "invadido" }), "PATCH /documents/:id de A");
      await negado(await B.put(`/documents/${a.documento._id}`, { nome: "invadido" }), "PUT /documents/:id de A");
      await negado(await B.delete(`/documents/${a.documento._id}`), "DELETE /documents/:id de A");
    });

    test("modelo de A", async () => {
      await negado(await B.get(`/documents/${a.modelo._id}`), "GET modelo de A");
      await negado(await B.patch(`/documents/${a.modelo._id}`, { nome: "invadido" }), "PATCH modelo de A");
      await negado(await B.delete(`/documents/${a.modelo._id}`), "DELETE modelo de A");
    });

    // As sub-rotas que a auditoria cobriu. São as que mais facilmente escapam:
    // ficam num controller diferente do CRUD e é onde um filtro se esquece.
    test("sub-rotas de documento de A", async () => {
      const d = a.documento._id;

      await negado(
        await B.get(`/documents/${d}/preview?processoId=${a.processo._id}&clienteId=${a.pf._id}`),
        "GET /documents/:id/preview de A"
      );
      await negado(
        await B.patch(`/documents/${d}/texto`, { textoResolvido: "TEXTO INJETADO POR B" }),
        "PATCH /documents/:id/texto de A"
      );
      await negado(
        await B.patch(`/documents/${d}/visibilidade-portal`, { visivelPortal: true }),
        "PATCH /documents/:id/visibilidade-portal de A"
      );
      await negado(await B.get(`/documents/${d}/download?formato=pdf`), "GET /documents/:id/download de A");
      await negado(await B.get(`/documents/${a.modelo._id}/secoes`), "GET /documents/:id/secoes de A");
      await negado(
        await B.post(`/documents/${a.modelo._id}/secoes`, { secaoId: b.secao._id }),
        "POST /documents/:id/secoes de A"
      );
      await negado(
        await B.delete(`/documents/${a.modelo._id}/secoes/${a.secao._id}`),
        "DELETE /documents/:id/secoes/:secaoId de A"
      );
    });

    test("gerar a partir do modelo de A", async () => {
      await negado(
        await B.post(`/documents/modelos/${a.modelo._id}/gerar`, {
          processoId: b.processo._id,
          clienteId: b.pf._id
        }),
        "POST /documents/modelos/:id/gerar com modelo de A"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3.2 — Listagens e agregações
  //
  // A contagem é sobre o que pertence a A, não sobre o total: recurso criado
  // por B durante o próprio teste aparece legitimamente na listagem de B. Foi
  // exatamente aqui que a auditoria teve um falso positivo, ao ler "a listagem
  // de B não está vazia" como vazamento.
  // ═════════════════════════════════════════════════════════════════════════

  describe("3.2 listagens e agregações", () => {
    const semVestigioDeA = (envelope, idsDeA, rota) => {
      placar.tentativas += 1;
      const vistos = new Set(idsDe(envelope));
      const vazados = idsDeA.filter((id) => vistos.has(String(id)));
      if (vazados.length > 0) placar.vazamentos.push(`${rota} → ${vazados.join(", ")}`);
      assert.deepEqual(vazados, [], `VAZAMENTO — ${rota} devolveu recursos de A: ${vazados.join(", ")}`);
    };

    test("as 8 listagens de B não trazem nenhum item de A", async () => {
      const casos = [
        ["/clients", [a.pf._id, a.pj._id]],
        ["/processes", [a.processo._id]],
        ["/fees", [a.honorario._id]],
        ["/installments", [a.parcela._id]],
        ["/payments", [a.pagamento._id]],
        ["/secoes", [a.secao._id]],
        ["/documents", [a.documento._id, a.modelo._id]],
        ["/documents/modelos", [a.modelo._id]]
      ];

      for (const [rota, idsDeA] of casos) {
        const r = await B.get(`${rota}?page=1&limit=100`);
        assert.equal(r.status, 200, `${rota} deveria responder 200 para B`);
        semVestigioDeA(r.body, idsDeA, rota);
      }
    });

    test("a listagem de A continua trazendo os recursos de A", async () => {
      // Contraprova. Sem ela, um filtro que devolvesse lista vazia para todo
      // mundo passaria no teste de cima e a suíte diria "isolado" sobre uma
      // API quebrada.
      const r = esperado(await A.get("/clients?page=1&limit=100"), 200, "listagem de A");
      const vistos = new Set(idsDe(r));
      assert.ok(vistos.has(String(a.pf._id)), "A deixou de enxergar o próprio cliente PF");
      assert.ok(vistos.has(String(a.pj._id)), "A deixou de enxergar o próprio cliente PJ");
    });

    test("dashboard de B ignora tudo o que é de A", async () => {
      // B tem processo e honorário próprios, então o dashboard dele NÃO é
      // zerado — o que se afirma é que os números dele batem com os recursos
      // dele, e não incluem os de A.
      const resumo = esperado(await B.get("/dashboard"), 200, "dashboard de B");
      const bruto = JSON.stringify(resumo);

      for (const [rotulo, id] of Object.entries({
        pf: a.pf._id, pj: a.pj._id, processo: a.processo._id,
        honorario: a.honorario._id, documento: a.documento._id
      })) {
        placar.tentativas += 1;
        if (bruto.includes(String(id))) placar.vazamentos.push(`dashboard de B cita ${rotulo} de A`);
        assert.ok(!bruto.includes(String(id)), `VAZAMENTO — dashboard de B cita o ${rotulo} de A`);
      }

      assert.equal(esperado(await B.get("/dashboard/status"), 200, "dashboard/status de B") !== null, true);
      assert.equal(esperado(await B.get("/dashboard/honorarios-por-mes"), 200, "honorarios-por-mes de B") !== null, true);
    });

    test("dashboard e financeiro de usuário SEM recurso nenhum vêm zerados", async () => {
      // O caso limpo do "200 zerado": um terceiro usuário, recém-criado, que
      // não tem nada. Qualquer número diferente de zero aqui é dado de A ou de
      // B atravessando.
      const C = await registrarUsuario("usuário C (vazio)");

      const resumo = esperado(await C.get("/dashboard"), 200, "dashboard de C");
      const financeiro = esperado(await C.get("/financeiro/resumo"), 200, "financeiro de C");

      const numerosDe = (obj) => {
        const nums = [];
        JSON.stringify(obj, (chave, valor) => {
          if (typeof valor === "number") nums.push([chave, valor]);
          return valor;
        });
        return nums;
      };

      for (const [chave, valor] of [...numerosDe(resumo), ...numerosDe(financeiro)]) {
        placar.tentativas += 1;
        if (valor !== 0) placar.vazamentos.push(`usuário vazio viu ${chave}=${valor}`);
        assert.equal(valor, 0, `VAZAMENTO — usuário sem recurso nenhum viu ${chave}=${valor}`);
      }

      for (const rota of ["/clients", "/processes", "/fees", "/installments", "/payments", "/secoes", "/documents", "/documents/modelos"]) {
        const r = esperado(await C.get(rota), 200, `${rota} de C`);
        placar.tentativas += 1;
        assert.equal(r.total, 0, `VAZAMENTO — ${rota} de usuário vazio devolveu total=${r.total}`);
        assert.deepEqual(r.data, [], `VAZAMENTO — ${rota} de usuário vazio devolveu ${r.data.length} itens`);
      }
    });

    test("financeiro de B não soma o honorário de A", async () => {
      const financeiro = esperado(await B.get("/financeiro/resumo"), 200, "financeiro de B");
      const bruto = JSON.stringify(financeiro);
      placar.tentativas += 1;
      assert.ok(
        !bruto.includes(String(a.honorario._id)),
        "VAZAMENTO — financeiro de B cita o honorário de A"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3.3 — Referência cruzada
  //
  // O recurso de topo é legitimamente de B. O que é de A é o que está DENTRO
  // do payload. Um filtro `{ usuarioId }` aplicado só na busca do recurso de
  // topo não pega nada disto — é o caminho que a Fase 3 mais facilmente abre.
  // ═════════════════════════════════════════════════════════════════════════

  describe("3.3 referência cruzada — recurso de B apontando para id de A", () => {
    test("processo de B com cliente de A", async () => {
      await recusado(
        await B.post("/processes", {
          ...dadosClientePF(),
          titulo: "Processo de B com cliente de A",
          numeroProcesso: `${Date.now()}`.slice(-15),
          clientes: [{ clienteId: a.pf._id, papel: "autor", principal: true }]
        }),
        "POST /processes de B com clienteId de A"
      );
    });

    test("vincular cliente de A a processo de B", async () => {
      await recusado(
        await B.post(`/processes/${b.processo._id}/clientes`, {
          clienteId: a.pf._id,
          papel: "reu"
        }),
        "POST /processes/:id/clientes de B com clienteId de A"
      );
    });

    test("honorário de B sobre processo de A", async () => {
      await recusado(
        await B.post("/fees", dadosHonorario(a.processo._id)),
        "POST /fees de B com processoId de A"
      );
    });

    test("parcela de B sobre honorário de A", async () => {
      await recusado(
        await B.post("/installments", dadosParcela(a.honorario._id, 9)),
        "POST /installments de B com feeId de A"
      );
    });

    test("pagamento de B sobre parcela de A", async () => {
      await recusado(
        await B.post("/payments", dadosPagamento(a.parcela._id)),
        "POST /payments de B com installmentId de A"
      );
    });

    test("documento de B sobre processo de A", async () => {
      await recusado(
        await B.post("/documents", {
          nome: "Documento de B sobre processo de A",
          tipo: "outro",
          processoId: a.processo._id,
          urlArquivo: "https://arquivos.lex.test/cruzado.pdf"
        }),
        "POST /documents de B com processoId de A"
      );
    });

    test("modelo PRÓPRIO de B gerado contra processo de A", async () => {
      // O modelo é de B, a sessão é de B, o filtro do recurso de topo passa
      // limpo. Só o `processoId` é de A. É o caso que mais parece legítimo.
      await recusado(
        await B.post(`/documents/modelos/${b.modelo._id}/gerar`, {
          processoId: a.processo._id,
          clienteId: a.pf._id
        }),
        "POST modelos/:id/gerar de B com processoId de A"
      );
    });

    test("modelo próprio de B gerado com cliente de A sobre processo de B", async () => {
      await recusado(
        await B.post(`/documents/modelos/${b.modelo._id}/gerar`, {
          processoId: b.processo._id,
          clienteId: a.pf._id
        }),
        "POST modelos/:id/gerar de B com clienteId de A"
      );
    });

    test("vincular seção de A a modelo de B", async () => {
      await recusado(
        await B.post(`/documents/${b.modelo._id}/secoes`, { secaoId: a.secao._id }),
        "POST /documents/:id/secoes de B com secaoId de A"
      );
    });

    test("reordenar vínculos de B informando seções de A", async () => {
      await recusado(
        await B.patch(`/documents/${b.modelo._id}/secoes/reordenar`, {
          secoes: [a.secao._id]
        }),
        "PATCH reordenar de B com secaoId de A"
      );
    });

    test("documento de B apontando para honorário de A", async () => {
      // Modelo COM variável de honorário, senão `honorarioId` nem é olhado.
      await recusado(
        await B.post(`/documents/modelos/${b.modeloComHonorario._id}/gerar`, {
          processoId: b.processo._id,
          clienteId: b.pf._id,
          honorarioId: a.honorario._id
        }),
        "POST modelos/:id/gerar de B com honorarioId de A"
      );
    });

    // Contraprova da anterior, e registro de comportamento DELIBERADO: quando o
    // texto não usa nenhuma das 6 variáveis de honorário, `honorarioId` é
    // irrelevante e nem é consultado. O documento sai 201 com
    // `honorarioId: null` — nenhum dado de A entra nele. Sem este teste, alguém
    // "consertaria" o 201 acima achando que é vazamento, e passaria a cobrar
    // honorário em procuração, que não fala de valores.
    test("honorarioId alheio em documento SEM variável de honorário é ignorado, não usado", async () => {
      const r = await B.post(`/documents/modelos/${b.modelo._id}/gerar`, {
        processoId: b.processo._id,
        clienteId: b.pf._id,
        honorarioId: a.honorario._id
      });

      assert.equal(r.status, 201, "documento sem variável de honorário deveria gerar normalmente");
      assert.equal(
        r.body.honorarioId,
        null,
        "VAZAMENTO — o honorário de A foi gravado no documento de B"
      );
      assert.ok(
        !JSON.stringify(r.body).includes(String(a.honorario._id)),
        "VAZAMENTO — o documento de B cita o honorário de A"
      );
      // E nenhum valor de honorário resolvido, já que não há variável pedindo.
      for (const chave of ["valorHonorario", "valorHonorarioExtenso", "tipoHonorario"]) {
        assert.equal(r.body.variaveisResolvidas[chave], "", `${chave} deveria vir vazio`);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3.4 — Integridade de A depois de tudo
  //
  // Um vazamento de ESCRITA não aparece necessariamente no status da resposta:
  // um service pode gravar e depois falhar ao reler. A única prova é reler com
  // a sessão de A e comparar com o estado de antes.
  // ═════════════════════════════════════════════════════════════════════════

  describe("3.4 integridade de A depois de todas as tentativas", () => {
    test("cliente, processo, honorário e seção de A estão intactos", async () => {
      const cliente = esperado(await A.get(`/clients/${a.pf._id}`), 200, "releitura do cliente de A");
      assert.equal(cliente.profissao, a.snapshot.cliente.profissao);
      assert.equal(cliente.nomeCompleto, a.snapshot.cliente.nomeCompleto);
      assert.equal(cliente.ativo, true, "o cliente de A foi desativado por B");

      const processo = esperado(await A.get(`/processes/${a.processo._id}`), 200, "releitura do processo de A");
      assert.equal(processo.titulo, a.snapshot.processo.titulo);
      assert.equal(processo.ativo, true, "o processo de A foi desativado por B");
      assert.equal(
        String(processo.clientePrincipalId?._id ?? processo.clientePrincipalId),
        String(a.pf._id),
        "o principal do processo de A mudou"
      );

      const honorario = esperado(await A.get(`/fees/${a.honorario._id}`), 200, "releitura do honorário de A");
      assert.equal(honorario.valor, a.snapshot.honorario.valor);
      assert.equal(honorario.ativo, true, "o honorário de A foi desativado por B");

      const secao = esperado(await A.get(`/secoes/${a.secao._id}`), 200, "releitura da seção de A");
      assert.equal(secao.titulo, a.snapshot.secao.titulo);
      assert.equal(secao.texto, a.snapshot.secao.texto);
    });

    test("o texto do documento de A não foi sobrescrito e ele não foi ao portal", async () => {
      const doc = esperado(await A.get(`/documents/${a.documento._id}`), 200, "releitura do documento de A");

      assert.equal(
        doc.textoResolvido,
        a.snapshot.documento.textoResolvido,
        "VAZAMENTO — o textoResolvido do documento de A mudou"
      );
      assert.ok(
        !String(doc.textoResolvido).includes("TEXTO INJETADO POR B"),
        "VAZAMENTO — o PATCH /texto de B gravou no documento de A"
      );
      assert.equal(doc.editadoManualmente, a.snapshot.documento.editadoManualmente);
      assert.equal(
        doc.visivelPortal,
        false,
        "VAZAMENTO — o documento de A ficou visível no portal por ação de B"
      );
      assert.deepEqual(
        doc.variaveisResolvidas,
        a.snapshot.documento.variaveisResolvidas,
        "as variáveis resolvidas do documento de A mudaram"
      );
      assert.equal(doc.dataGeracao, a.snapshot.documento.dataGeracao);
      assert.equal(doc.ativo, true, "o documento de A foi desativado por B");
    });

    test("o parque de A tem exatamente o que A criou, nem a mais nem a menos", async () => {
      const contagens = {
        "/clients": 2,
        "/processes": 1,
        "/fees": 1,
        "/installments": 1,
        "/payments": 1,
        "/secoes": 1,
        "/documents/modelos": 1
      };

      for (const [rota, esperada] of Object.entries(contagens)) {
        const r = esperado(await A.get(`${rota}?page=1&limit=100`), 200, `contagem de A em ${rota}`);
        assert.equal(r.total, esperada, `A tem ${r.total} em ${rota}, esperado ${esperada}`);
      }
    });

    test("o código de acesso do vínculo de A continua sendo o mesmo", async () => {
      const r = esperado(
        await A.get(`/processes/${a.processo._id}/clientes/${a.pf._id}/codigo-acesso`),
        200,
        "código de acesso de A"
      );
      assert.match(r.codigoAcesso, /^LEX-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    test("placar do bloco de isolamento: zero vazamentos", () => {
      // O número que a Parte 10.7 pede sai daqui, não de contagem à mão.
      console.log(
        `\n  ── PLACAR DO ISOLAMENTO ──\n` +
        `     recursos de A sob ataque : ${placar.recursos}\n` +
        `     tentativas               : ${placar.tentativas}\n` +
        `     vazamentos               : ${placar.vazamentos.length}\n`
      );
      assert.deepEqual(
        placar.vazamentos,
        [],
        `VAZAMENTOS ENCONTRADOS:\n  - ${placar.vazamentos.join("\n  - ")}`
      );
    });
  });
});
