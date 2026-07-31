// ═══════════════════════════════════════════════════════════════════════════
// A TERCEIRA DIMENSÃO DO ISOLAMENTO
//
// A Fase 2E.2 travou duas dimensões: advogada A × advogada B (86 tentativas,
// zero vazamentos). Esta fase acrescenta a terceira, que é a que muda a
// natureza do risco — até aqui todo mundo que autenticava era a dona dos
// dados; agora entra gente de fora.
//
// Quatro direções, e as quatro varrem TODAS as rotas, não uma amostra:
//   7.1a  token de portal contra cada rota da advogada  → 401
//   7.1b  token da advogada contra cada rota do portal  → 401
//   7.1c  sessão do vínculo A contra dados do vínculo B → 404
//   7.1d  cliente de outra advogada                     → isolado por usuarioId
//
// Mais a varredura de vazamento de campo (7.3), que estende para
// `senhaPortalHash` o que a 2E.2 já fazia com `senhaHash`.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarProcesso, criarSecao, criarModelo, vincularSecao,
  criarHonorario, criarParcela, criarPagamento, esperado
} from "../helpers/setup.js";
import { dadosClientePF } from "../helpers/factories.js";
import { ClienteApi } from "../helpers/client.js";
import {
  montarCenarioPortal, entrarNoPortalComSenhaPropria, codigoAcessoDe,
  novoClientePortal, SENHA_PROVISORIA, SENHA_DO_CLIENTE
} from "../helpers/portal.js";
import { NOME_COOKIE_PORTAL } from "../../src/services/portalAuthService.js";

const COLECAO_CONFIRMACOES = "confirmacoes_visualizacao";

// Placar, para a Parte 9.11 e 9.12. Sai da execução, não de contagem à mão.
const placar = {
  rotasDaAdvogadaVarridas: 0,
  rotasDoPortalVarridas: 0,
  tentativasCruzadas: 0,
  respostasVarridas: 0,
  vazamentos: []
};

const registrar = (condicao, descricao) => {
  placar.tentativasCruzadas += 1;
  if (!condicao) placar.vazamentos.push(descricao);
};

describe("portal: isolamento — a terceira dimensão", () => {
  let cenario;

  before(async () => {
    await subirApp();
    await limparColecoes([...TODAS_AS_COLECOES, COLECAO_CONFIRMACOES]);

    // Um parque completo da advogada A, com um cliente que tem portal.
    const adv = await registrarUsuario("iso-adv");
    const cliente = esperado(
      await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
      201, "cliente"
    );
    const processo = await criarProcesso(adv, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    const honorario = await criarHonorario(adv, processo._id);
    const parcela = await criarParcela(adv, honorario._id, 1);
    const pagamento = await criarPagamento(adv, parcela._id);
    const secao = await criarSecao(adv, { texto: "Texto sem variável." });
    const modelo = await criarModelo(adv);
    await vincularSecao(adv, modelo._id, secao._id);
    const documento = esperado(
      await adv.post(`/documents/modelos/${modelo._id}/gerar`, {
        processoId: processo._id, clienteId: cliente._id
      }),
      201, "documento"
    );
    esperado(
      await adv.patch(`/documents/${documento._id}/visibilidade-portal`, { visivelPortal: true }),
      200, "libera"
    );

    const codigoAcesso = await codigoAcessoDe(adv, processo._id, cliente._id);
    const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "iso-portal" });
    esperado(await portal.post("/portal/confirmacoes"), 201, "confirmação");

    cenario = {
      adv, cliente, processo, honorario, parcela, pagamento,
      secao, modelo, documento, codigoAcesso, portal
    };
  });

  after(async () => {
    await limparColecoes([...TODAS_AS_COLECOES, COLECAO_CONFIRMACOES]);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7.1a — Token de portal contra TODAS as rotas da advogada
  // ═════════════════════════════════════════════════════════════════════════

  test("token de portal não vale em NENHUMA rota da advogada", async () => {
    const c = cenario;
    // Todas as rotas autenticadas da API da advogada. `/auth/register` e
    // `/auth/login` ficam de fora por serem públicas — não há o que isolar.
    const rotas = [
      ["GET", "/auth/me"], ["PATCH", "/auth/me"], ["POST", "/auth/alterar-senha"],

      ["POST", "/clients"], ["GET", "/clients"], ["GET", `/clients/${c.cliente._id}`],
      ["PATCH", `/clients/${c.cliente._id}`], ["PUT", `/clients/${c.cliente._id}`],
      ["DELETE", `/clients/${c.cliente._id}`],
      ["DELETE", `/clients/${c.cliente._id}/senha-portal`],

      ["POST", "/processes"], ["GET", "/processes"], ["GET", `/processes/${c.processo._id}`],
      ["PATCH", `/processes/${c.processo._id}`], ["PUT", `/processes/${c.processo._id}`],
      ["DELETE", `/processes/${c.processo._id}`],
      ["GET", `/processes/${c.processo._id}/clientes`],
      ["POST", `/processes/${c.processo._id}/clientes`],
      ["GET", `/processes/${c.processo._id}/clientes/${c.cliente._id}/codigo-acesso`],
      ["PATCH", `/processes/${c.processo._id}/clientes/${c.cliente._id}/principal`],
      ["PATCH", `/processes/${c.processo._id}/clientes/${c.cliente._id}`],
      ["DELETE", `/processes/${c.processo._id}/clientes/${c.cliente._id}`],
      ["GET", `/processes/${c.processo._id}/confirmacoes`],
      ["PATCH", `/processes/${c.processo._id}/confirmacoes/vistas`],

      ["GET", "/documents/variaveis"], ["POST", "/documents/modelos"],
      ["GET", "/documents/modelos"], ["POST", `/documents/modelos/${c.modelo._id}/gerar`],
      ["POST", "/documents"], ["GET", "/documents"],
      ["GET", `/documents/${c.documento._id}`], ["PATCH", `/documents/${c.documento._id}`],
      ["PUT", `/documents/${c.documento._id}`], ["DELETE", `/documents/${c.documento._id}`],
      ["GET", `/documents/${c.documento._id}/preview`],
      ["GET", `/documents/${c.documento._id}/download`],
      ["PATCH", `/documents/${c.documento._id}/texto`],
      ["GET", `/documents/${c.modelo._id}/secoes`],
      ["POST", `/documents/${c.modelo._id}/secoes`],
      ["PATCH", `/documents/${c.modelo._id}/secoes/reordenar`],
      ["DELETE", `/documents/${c.modelo._id}/secoes/${c.secao._id}`],
      ["PATCH", `/documents/${c.documento._id}/visibilidade-portal`],

      ["POST", "/secoes"], ["GET", "/secoes"], ["GET", `/secoes/${c.secao._id}`],
      ["PATCH", `/secoes/${c.secao._id}`], ["DELETE", `/secoes/${c.secao._id}`],

      // O `PATCH` das três rotas financeiras e as duas rotas novas da Fase 4.1
      // entram aqui: verbo novo e rota nova são superfície nova, e a DEC-029
      // ponto 8 mantém o portal SEM nada financeiro. A ficha devolve a árvore
      // inteira do processo e o recibo devolve um PDF — os dois piores lugares
      // para um 200 indevido.
      ["POST", "/fees"], ["GET", "/fees"], ["GET", `/fees/${c.honorario._id}`],
      ["PATCH", `/fees/${c.honorario._id}`], ["PUT", `/fees/${c.honorario._id}`],
      ["DELETE", `/fees/${c.honorario._id}`],

      ["POST", "/installments"], ["GET", "/installments"],
      ["GET", `/installments/${c.parcela._id}`],
      ["PATCH", `/installments/${c.parcela._id}`], ["PUT", `/installments/${c.parcela._id}`],
      ["DELETE", `/installments/${c.parcela._id}`],

      ["POST", "/payments"], ["GET", "/payments"],
      ["GET", `/payments/${c.pagamento._id}`],
      ["PATCH", `/payments/${c.pagamento._id}`], ["PUT", `/payments/${c.pagamento._id}`],
      ["DELETE", `/payments/${c.pagamento._id}`],
      ["GET", `/payments/${c.pagamento._id}/recibo`],

      ["GET", "/dashboard"], ["GET", "/dashboard/status"],
      ["GET", "/dashboard/honorarios-por-mes"], ["GET", "/financeiro/resumo"],
      ["GET", `/financeiro/processos/${c.processo._id}`]
    ];

    // O token do portal, colocado no cookie da advogada. Nome de cookie não é
    // fronteira de segurança — quem controla o navegador escolhe o nome.
    const tokenDoPortal = c.portal.cookies.get(NOME_COOKIE_PORTAL);
    const disfarcado = new ClienteApi("portal-disfarcado");
    disfarcado.cookies.set("lex-token", tokenDoPortal);

    for (const [metodo, rota] of rotas) {
      placar.rotasDaAdvogadaVarridas += 1;
      const r = await disfarcado.requisitar(metodo, rota, metodo === "GET" || metodo === "DELETE" ? undefined : {});
      registrar(r.status === 401, `${metodo} ${rota} aceitou token de portal (${r.status})`);
      assert.equal(
        r.status, 401,
        `VAZAMENTO — ${metodo} ${rota} respondeu ${r.status} a um token de portal`
      );
    }

    assert.ok(placar.rotasDaAdvogadaVarridas >= 60, "a varredura precisa cobrir a API inteira");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7.1b — Token da advogada contra TODAS as rotas do portal
  // ═════════════════════════════════════════════════════════════════════════

  test("token da advogada não vale em NENHUMA rota do portal", async () => {
    const c = cenario;
    const rotas = [
      ["GET", "/portal/sessao"],
      ["PATCH", "/portal/senha"],
      ["GET", "/portal/processo"],
      ["GET", "/portal/documentos"],
      ["GET", `/portal/documentos/${c.documento._id}/download`],
      ["GET", "/portal/confirmacoes"],
      ["GET", "/portal/confirmacoes/texto"],
      ["POST", "/portal/confirmacoes"]
    ];

    const tokenDaAdvogada = c.adv.cookies.get("lex-token");
    const disfarcada = novoClientePortal("advogada-disfarcada");
    disfarcada.cookies.set(NOME_COOKIE_PORTAL, tokenDaAdvogada);

    for (const [metodo, rota] of rotas) {
      placar.rotasDoPortalVarridas += 1;
      const r = await disfarcada.requisitar(metodo, rota, metodo === "GET" ? undefined : {});
      registrar(r.status === 401, `${metodo} ${rota} aceitou token da advogada (${r.status})`);
      assert.equal(
        r.status, 401,
        `VAZAMENTO — ${metodo} ${rota} respondeu ${r.status} a um token da advogada`
      );
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7.1c — Sessão do vínculo A contra dados do vínculo B
  // ═════════════════════════════════════════════════════════════════════════

  describe("sessão de um vínculo não alcança outro", () => {
    test("mesma advogada, dois processos: cada sessão vê o seu", async () => {
      const adv = await registrarUsuario("iso-dois-processos");

      const c1 = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "cliente 1"
      );
      const c2 = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "cliente 2"
      );
      const p1 = await criarProcesso(adv, [{ clienteId: c1._id, papel: "autor", principal: true }]);
      const p2 = await criarProcesso(adv, [{ clienteId: c2._id, papel: "autor", principal: true }]);

      const doc2 = await (async () => {
        const secao = await criarSecao(adv, { texto: "Texto sem variável." });
        const modelo = await criarModelo(adv);
        await vincularSecao(adv, modelo._id, secao._id);
        const d = esperado(
          await adv.post(`/documents/modelos/${modelo._id}/gerar`, {
            processoId: p2._id, clienteId: c2._id
          }),
          201, "doc do processo 2"
        );
        esperado(
          await adv.patch(`/documents/${d._id}/visibilidade-portal`, { visivelPortal: true }),
          200, "libera"
        );
        return d;
      })();

      const cod1 = await codigoAcessoDe(adv, p1._id, c1._id);
      const sessao1 = await entrarNoPortalComSenhaPropria(cod1, { rotulo: "vinculo-1" });

      // A sessão de 1 enxerga o processo de 1, e só.
      const visto = esperado(await sessao1.get("/portal/processo"), 200, "processo");
      assert.equal(visto.processo.id, String(p1._id));
      assert.notEqual(visto.processo.id, String(p2._id));

      // E não alcança o documento do outro processo.
      placar.tentativasCruzadas += 1;
      const r = await sessao1.get(`/portal/documentos/${doc2._id}/download`);
      registrar(r.status === 404, `download cruzado entre vínculos devolveu ${r.status}`);
      assert.equal(r.status, 404, "VAZAMENTO — sessão alcançou documento de outro processo");

      // A listagem de 1 não cita nada de 2.
      const docs = esperado(await sessao1.get("/portal/documentos"), 200, "documentos");
      assert.ok(
        !JSON.stringify(docs).includes(String(doc2._id)),
        "VAZAMENTO — documento de outro processo apareceu na listagem"
      );
    });

    test("o código do cliente A nunca devolve o processo do cliente B", async () => {
      const adv = await registrarUsuario("iso-codigos");
      const a = esperado(
        await adv.post("/clients", { ...dadosClientePF({ nomeCompleto: "Cliente A" }), senhaPortal: SENHA_PROVISORIA }),
        201, "A"
      );
      const b = esperado(
        await adv.post("/clients", { ...dadosClientePF({ nomeCompleto: "Cliente B" }), senhaPortal: SENHA_PROVISORIA }),
        201, "B"
      );
      const pa = await criarProcesso(adv, [{ clienteId: a._id, papel: "autor", principal: true }]);
      const pb = await criarProcesso(adv, [{ clienteId: b._id, papel: "autor", principal: true }]);

      const codA = await codigoAcessoDe(adv, pa._id, a._id);
      const sessao = await entrarNoPortalComSenhaPropria(codA, { rotulo: "codigo-a" });

      const r = esperado(await sessao.get("/portal/processo"), 200, "processo");
      placar.tentativasCruzadas += 1;
      registrar(r.processo.id === String(pa._id), "o código de A devolveu processo errado");
      assert.equal(r.processo.id, String(pa._id));
      assert.equal(r.cliente.nome, "Cliente A");
      assert.ok(!JSON.stringify(r).includes(String(pb._id)), "VAZAMENTO — citou o processo de B");
      assert.ok(!JSON.stringify(r).includes("Cliente B"), "VAZAMENTO — citou o cliente B");
    });

    test("a senha de um cliente não abre o código de outro", async () => {
      // A senha é do cliente e o código é do vínculo. Cruzar os dois tem de
      // falhar, senão a senha viraria chave-mestra de qualquer código.
      const adv = await registrarUsuario("iso-senha-cruzada");
      const a = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "A"
      );
      const b = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: "OutraSenha987" }),
        201, "B"
      );
      const pa = await criarProcesso(adv, [{ clienteId: a._id, papel: "autor", principal: true }]);
      const pb = await criarProcesso(adv, [{ clienteId: b._id, papel: "autor", principal: true }]);

      const codA = await codigoAcessoDe(adv, pa._id, a._id);
      const codB = await codigoAcessoDe(adv, pb._id, b._id);

      for (const [codigo, senha, rotulo] of [
        [codA, "OutraSenha987", "código de A com senha de B"],
        [codB, SENHA_PROVISORIA, "código de B com senha de A"]
      ]) {
        const api = novoClientePortal(rotulo);
        const r = await api.post("/portal/login", { codigoAcesso: codigo, senha });
        registrar(r.status === 401, `${rotulo} autenticou (${r.status})`);
        assert.equal(r.status, 401, `VAZAMENTO — ${rotulo} autenticou`);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7.1d — Isolamento por usuarioId também no portal
  // ═════════════════════════════════════════════════════════════════════════

  test("cliente de outra advogada: o portal respeita o usuarioId", async () => {
    const advA = await registrarUsuario("iso-usuario-a");
    const advB = await registrarUsuario("iso-usuario-b");

    const clienteA = esperado(
      await advA.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
      201, "cliente de A"
    );
    const processoA = await criarProcesso(advA, [
      { clienteId: clienteA._id, papel: "autor", principal: true }
    ]);
    const codigoA = await codigoAcessoDe(advA, processoA._id, clienteA._id);

    const portalA = await entrarNoPortalComSenhaPropria(codigoA, { rotulo: "portal-de-a" });
    esperado(await portalA.post("/portal/confirmacoes"), 201, "confirmação no portal de A");

    // A advogada B não enxerga nada disso.
    placar.tentativasCruzadas += 1;
    const confs = await advB.get(`/processes/${processoA._id}/confirmacoes`);
    registrar(confs.status === 404, `B leu confirmações de A (${confs.status})`);
    assert.equal(confs.status, 404);

    placar.tentativasCruzadas += 1;
    const codigo = await advB.get(`/processes/${processoA._id}/clientes/${clienteA._id}/codigo-acesso`);
    registrar(codigo.status === 404, `B leu o código de acesso de A (${codigo.status})`);
    assert.equal(codigo.status, 404);

    placar.tentativasCruzadas += 1;
    const revoga = await advB.delete(`/clients/${clienteA._id}/senha-portal`);
    registrar(revoga.status === 404, `B revogou o portal de um cliente de A (${revoga.status})`);
    assert.equal(revoga.status, 404, "VAZAMENTO — B revogou acesso de cliente de A");

    // E o dashboard de B não conta a confirmação de A.
    const dash = esperado(await advB.get("/dashboard"), 200, "dashboard de B");
    assert.equal(dash.confirmacoesNaoVistas, 0, "VAZAMENTO — contador de B contou confirmação de A");

    // A sessão de portal de A continua funcionando: a contraprova.
    esperado(await portalA.get("/portal/processo"), 200, "portal de A ainda vivo");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7.3 — Varredura de vazamento de campo
  // ═════════════════════════════════════════════════════════════════════════

  test("varredura: senhaPortalHash, observacoes, codigoAcesso, usuarioId e __v", async () => {
    const c = cenario;

    esperado(
      await c.adv.patch(`/clients/${c.cliente._id}`, { observacoes: "ANOTACAO-INTERNA-XYZ" }),
      200, "observação no cliente"
    );
    esperado(
      await c.adv.patch(`/processes/${c.processo._id}`, { observacoes: "ESTRATEGIA-INTERNA-XYZ" }),
      200, "observação no processo"
    );

    // Respostas do PORTAL: nada disso pode sair.
    const doPortal = [
      ["GET /portal/sessao", await c.portal.get("/portal/sessao")],
      ["GET /portal/processo", await c.portal.get("/portal/processo")],
      ["GET /portal/documentos", await c.portal.get("/portal/documentos")],
      ["GET /portal/confirmacoes", await c.portal.get("/portal/confirmacoes")],
      ["GET /portal/confirmacoes/texto", await c.portal.get("/portal/confirmacoes/texto")]
    ];

    const PROIBIDOS_NO_PORTAL = [
      "senhaPortalHash", "senhaHash", "observacoes", "ANOTACAO-INTERNA-XYZ",
      "ESTRATEGIA-INTERNA-XYZ", "codigoAcesso", "LEX-", "usuarioId", "__v", "$2b$", "$2a$"
    ];

    for (const [rotulo, resposta] of doPortal) {
      placar.respostasVarridas += 1;
      const bruto = JSON.stringify(resposta.body ?? {});
      for (const proibido of PROIBIDOS_NO_PORTAL) {
        if (bruto.includes(proibido)) placar.vazamentos.push(`${rotulo} vazou "${proibido}"`);
        assert.ok(!bruto.includes(proibido), `VAZAMENTO — ${rotulo} vazou "${proibido}": ${bruto}`);
      }
    }

    // Respostas da ADVOGADA: `senhaPortalHash` também nunca sai. É a extensão
    // da varredura que a 2E.2 já fazia para `senhaHash` — o hash novo tem de
    // entrar na mesma rede, senão a rede protege o segredo antigo e não o novo.
    const daAdvogada = [
      ["GET /auth/me", await c.adv.get("/auth/me")],
      ["GET /clients", await c.adv.get("/clients")],
      ["GET /clients/:id", await c.adv.get(`/clients/${c.cliente._id}`)],
      ["GET /processes", await c.adv.get("/processes")],
      ["GET /processes/:id", await c.adv.get(`/processes/${c.processo._id}`)],
      ["GET /processes/:id/clientes", await c.adv.get(`/processes/${c.processo._id}/clientes`)],
      ["GET /processes/:id/confirmacoes", await c.adv.get(`/processes/${c.processo._id}/confirmacoes`)],
      ["GET /documents", await c.adv.get("/documents")],
      ["GET /dashboard", await c.adv.get("/dashboard")],
      ["PATCH /clients/:id", await c.adv.patch(`/clients/${c.cliente._id}`, { telefone: "(42) 90000-0000" })]
    ];

    for (const [rotulo, resposta] of daAdvogada) {
      placar.respostasVarridas += 1;
      const bruto = JSON.stringify(resposta.body ?? {});
      for (const proibido of ["senhaPortalHash", "senhaHash", "$2b$", "$2a$"]) {
        if (bruto.includes(proibido)) placar.vazamentos.push(`${rotulo} vazou "${proibido}"`);
        assert.ok(!bruto.includes(proibido), `VAZAMENTO — ${rotulo} vazou "${proibido}"`);
      }
    }

    // `codigoAcesso` continua saindo SÓ na rota dedicada — e ali é para sair.
    const dedicada = esperado(
      await c.adv.get(`/processes/${c.processo._id}/clientes/${c.cliente._id}/codigo-acesso`),
      200, "rota dedicada do código"
    );
    assert.match(dedicada.codigoAcesso, /^LEX-/, "a rota dedicada precisa devolver o código");
    assert.ok(
      !JSON.stringify(dedicada).includes("senhaPortalHash"),
      "nem a rota dedicada pode vazar o hash"
    );
  });

  test("o cadastro do cliente nunca devolve o hash, em nenhum verbo", async () => {
    const adv = await registrarUsuario("iso-hash");
    const respostas = [];

    respostas.push(["POST /clients", await adv.post("/clients", {
      ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA
    })]);
    const id = respostas[0][1].body._id;

    respostas.push(["PATCH /clients/:id", await adv.patch(`/clients/${id}`, {
      senhaPortal: SENHA_DO_CLIENTE
    })]);
    respostas.push(["PUT /clients/:id", await adv.put(`/clients/${id}`, { telefone: "(42) 91111-2222" })]);
    respostas.push(["GET /clients/:id", await adv.get(`/clients/${id}`)]);
    respostas.push(["DELETE senha-portal", await adv.delete(`/clients/${id}/senha-portal`)]);

    for (const [rotulo, r] of respostas) {
      placar.respostasVarridas += 1;
      const bruto = JSON.stringify(r.body ?? {});
      for (const proibido of ["senhaPortalHash", "$2b$", "$2a$"]) {
        if (bruto.includes(proibido)) placar.vazamentos.push(`${rotulo} vazou "${proibido}"`);
        assert.ok(!bruto.includes(proibido), `VAZAMENTO — ${rotulo} vazou "${proibido}": ${bruto}`);
      }
      // Mas `senhaPortalProvisoria` DEVE sair: é o que a advogada precisa ver
      // para saber que o cliente ainda não trocou a senha (Parte 2.3).
      if (rotulo === "POST /clients") {
        assert.equal(r.body.senhaPortalProvisoria, true);
      }
    }
  });

  test("placar do isolamento do portal: zero vazamentos", () => {
    console.log(
      `\n  ── PLACAR DO ISOLAMENTO DO PORTAL ──\n` +
      `     rotas da advogada varridas : ${placar.rotasDaAdvogadaVarridas}\n` +
      `     rotas do portal varridas   : ${placar.rotasDoPortalVarridas}\n` +
      `     tentativas cruzadas        : ${placar.tentativasCruzadas}\n` +
      `     respostas varridas (campos): ${placar.respostasVarridas}\n` +
      `     vazamentos                 : ${placar.vazamentos.length}\n`
    );
    assert.deepEqual(
      placar.vazamentos, [],
      `VAZAMENTOS:\n  - ${placar.vazamentos.join("\n  - ")}`
    );
  });
});
