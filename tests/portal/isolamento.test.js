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
import { dadosClientePF, dadosClientePJ } from "../helpers/factories.js";
import { ClienteApi } from "../helpers/client.js";
import {
  montarCenarioPortal, entrarNoPortalComSenhaPropria, codigoAcessoDe,
  novoClientePortal, SENHA_PROVISORIA, SENHA_DO_CLIENTE, liberarNoPortal,
  entrarNoPortal, codigoDeVinculoDe
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
    const { pagamento } = await criarPagamento(adv, honorario._id);
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

    await liberarNoPortal(adv, processo._id, cliente._id);

    const codigoAcesso = await codigoAcessoDe(adv, processo._id, cliente._id);
    const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "iso-portal" });
    esperado(await portal.post(`/portal/processos/${processo._id}/confirmacoes`), 201, "confirmação");

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
      ["GET", `/clients/${c.cliente._id}/acesso-portal`],

      ["POST", "/processes"], ["GET", "/processes"], ["GET", `/processes/${c.processo._id}`],
      ["PATCH", `/processes/${c.processo._id}`], ["PUT", `/processes/${c.processo._id}`],
      ["DELETE", `/processes/${c.processo._id}`],
      ["GET", `/processes/${c.processo._id}/clientes`],
      ["POST", `/processes/${c.processo._id}/clientes`],
      ["GET", `/processes/${c.processo._id}/clientes/${c.cliente._id}/codigo-acesso`],
      ["PATCH", `/processes/${c.processo._id}/clientes/${c.cliente._id}/liberacao`],
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
      ["GET", `/payments/${c.pagamento._id}/recibo`],

      // ── As superfícies do Financeiro 2.0 (F-1a) ────────────────────────
      //
      // `DELETE /payments/:id` e as duas rotas de reativação saíram da lista
      // porque as rotas não existem mais: manter um 404 esperado aqui mediria
      // o `notFoundMiddleware`, não o isolamento, e o teste passaria por
      // acidente no dia em que alguém recriasse a rota sem o middleware certo.
      //
      // No lugar entram as cinco rotas novas — estorno, extrato,
      // reparcelamento e a listagem de pagamentos do processo. Rota nova é
      // superfície nova, e a DEC-029 ponto 8 mantém o portal SEM nada
      // financeiro. O extrato é o pior lugar possível para um 200 indevido:
      // devolve a linha do tempo do dinheiro de uma cobrança inteira.
      ["POST", "/payments/preview"],
      ["POST", `/payments/${c.pagamento._id}/reversals`],
      ["GET", `/payments/${c.pagamento._id}/reversals`],
      ["GET", `/fees/${c.honorario._id}/statement`],
      ["POST", `/fees/${c.honorario._id}/renegotiations`],
      ["GET", `/fees/${c.honorario._id}/renegotiations`],
      ["GET", `/financeiro/processos/${c.processo._id}/payments`],

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
      // Fase 2.5: a lista da pessoa e as rotas por processo.
      ["GET", "/portal/processos"],
      ["GET", `/portal/processos/${c.processo._id}`],
      ["GET", `/portal/processos/${c.processo._id}/documentos`],
      ["GET", `/portal/processos/${c.processo._id}/documentos/${c.documento._id}/download`],
      ["GET", `/portal/processos/${c.processo._id}/confirmacoes`],
      ["GET", "/portal/confirmacoes/texto"],
      ["POST", `/portal/processos/${c.processo._id}/confirmacoes`]
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

      await liberarNoPortal(adv, p1._id, c1._id);

      const cod1 = await codigoAcessoDe(adv, p1._id, c1._id);
      const sessao1 = await entrarNoPortalComSenhaPropria(cod1, { rotulo: "vinculo-1" });

      // A sessão de 1 enxerga o processo de 1, e só.
      const visto = esperado(await sessao1.get(`/portal/processos/${p1._id}`), 200, "processo");
      assert.equal(visto.processo.id, String(p1._id));
      assert.notEqual(visto.processo.id, String(p2._id));

      // O processo de 2, pela URL direta: o mesmo 404 de "não existe".
      for (const rota of [
        `/portal/processos/${p2._id}`,
        `/portal/processos/${p2._id}/documentos`,
        `/portal/processos/${p2._id}/confirmacoes`,
        `/portal/processos/${p2._id}/documentos/${doc2._id}/download`
      ]) {
        placar.tentativasCruzadas += 1;
        const cruzada = await sessao1.get(rota);
        registrar(cruzada.status === 404, `${rota} pela sessão de 1 devolveu ${cruzada.status}`);
        assert.equal(cruzada.status, 404, `VAZAMENTO — ${rota}`);
      }

      // E não alcança o documento do outro processo pelo caminho do próprio.
      placar.tentativasCruzadas += 1;
      const r = await sessao1.get(`/portal/processos/${p1._id}/documentos/${doc2._id}/download`);
      registrar(r.status === 404, `download cruzado entre vínculos devolveu ${r.status}`);
      assert.equal(r.status, 404, "VAZAMENTO — sessão alcançou documento de outro processo");

      // A listagem de 1 não cita nada de 2.
      const docs = esperado(await sessao1.get(`/portal/processos/${p1._id}/documentos`), 200, "documentos");
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

      await liberarNoPortal(adv, pa._id, a._id);

      const codA = await codigoAcessoDe(adv, pa._id, a._id);
      const sessao = await entrarNoPortalComSenhaPropria(codA, { rotulo: "codigo-a" });

      const r = esperado(await sessao.get(`/portal/processos/${pa._id}`), 200, "processo");
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

      await liberarNoPortal(adv, pa._id, a._id);

      const codA = await codigoAcessoDe(adv, pa._id, a._id);
      await liberarNoPortal(adv, pb._id, b._id);
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
    await liberarNoPortal(advA, processoA._id, clienteA._id);
    const codigoA = await codigoAcessoDe(advA, processoA._id, clienteA._id);

    const portalA = await entrarNoPortalComSenhaPropria(codigoA, { rotulo: "portal-de-a" });
    esperado(await portalA.post(`/portal/processos/${processoA._id}/confirmacoes`), 201, "confirmação no portal de A");

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
    esperado(await portalA.get(`/portal/processos/${processoA._id}`), 200, "portal de A ainda vivo");
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
      ["GET /portal/processos", await c.portal.get("/portal/processos")],
      ["GET /portal/processos/:id", await c.portal.get(`/portal/processos/${c.processo._id}`)],
      ["GET /portal/processos/:id/documentos", await c.portal.get(`/portal/processos/${c.processo._id}/documentos`)],
      ["GET /portal/processos/:id/confirmacoes", await c.portal.get(`/portal/processos/${c.processo._id}/confirmacoes`)],
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
      ["PATCH /clients/:id", await c.adv.patch(`/clients/${c.cliente._id}`, { telefone: "(42) 90000-0000" })],
      ["GET /clients/:id/acesso-portal", await c.adv.get(`/clients/${c.cliente._id}/acesso-portal`)]
    ];

    for (const [rotulo, resposta] of daAdvogada) {
      placar.respostasVarridas += 1;
      const bruto = JSON.stringify(resposta.body ?? {});
      for (const proibido of ["senhaPortalHash", "senhaHash", "$2b$", "$2a$"]) {
        if (bruto.includes(proibido)) placar.vazamentos.push(`${rotulo} vazou "${proibido}"`);
        assert.ok(!bruto.includes(proibido), `VAZAMENTO — ${rotulo} vazou "${proibido}"`);
      }
    }

    // Fase 2.5: o código PESSOAL também não sai em leitura ampla — nem na
    // listagem, nem no detalhe, nem no participante populado.
    for (const [rotulo, resposta] of daAdvogada.filter(([r]) => !r.includes("acesso-portal"))) {
      const bruto = JSON.stringify(resposta.body ?? {});
      assert.ok(!bruto.includes("codigoAcessoPessoal"), `VAZAMENTO — ${rotulo} trouxe o código pessoal`);
      assert.ok(!bruto.includes(c.codigoAcesso), `VAZAMENTO — ${rotulo} trouxe o valor do código pessoal`);
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

  // ═════════════════════════════════════════════════════════════════════════
  // Fase 2.5 — login por PESSOA, liberação por PROCESSO (DEC-089 a DEC-092)
  //
  // A sessão deixou de ser de um vínculo. O que impede um cliente de ver o que
  // não é dele passou a ser o filtro de `exigirVinculoLiberado` (a cada
  // requisição) e o de `listarProcessos`. Cada teste abaixo tenta atravessar
  // esse filtro por um lado diferente, e registra no placar.
  // ═════════════════════════════════════════════════════════════════════════
  describe("Fase 2.5 — portal por pessoa", () => {
    // Um cliente com portal e N processos, cada um liberado ou não.
    const montarPessoa = async (rotulo, liberacoes, extraCliente = {}, fabrica = dadosClientePF) => {
      const adv = await registrarUsuario(rotulo);
      const cliente = esperado(
        await adv.post("/clients", { ...fabrica(extraCliente), senhaPortal: SENHA_PROVISORIA }),
        201, "cliente com portal"
      );
      const processos = [];
      for (const liberado of liberacoes) {
        const processo = await criarProcesso(adv, [
          { clienteId: cliente._id, papel: "autor", principal: true }
        ]);
        if (liberado) await liberarNoPortal(adv, processo._id, cliente._id);
        processos.push(processo);
      }
      const { codigoAcesso } = esperado(
        await adv.get(`/clients/${cliente._id}/acesso-portal`).then((r) => ({
          status: r.status, body: { codigoAcesso: r.body.codigoAcessoPessoal }
        })),
        200, "código pessoal"
      );
      return { adv, cliente, processos, codigoAcesso };
    };

    const NAO_ENCONTRADO = JSON.stringify({ message: "Processo não encontrado" });

    test("vínculo NÃO liberado não aparece na lista e responde como inexistente", async () => {
      const { processos, codigoAcesso } = await montarPessoa("p25-nao-liberado", [true, false]);
      const [liberado, naoLiberado] = processos;
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "p25-nl" });

      const lista = esperado(await portal.get("/portal/processos"), 200, "lista");
      assert.deepEqual(lista.data.map((p) => p.id), [String(liberado._id)]);

      // Mesmo corpo para "não liberado" e para um id que não existe.
      for (const rota of [
        `/portal/processos/${naoLiberado._id}`,
        `/portal/processos/${naoLiberado._id}/documentos`,
        `/portal/processos/${naoLiberado._id}/confirmacoes`
      ]) {
        placar.tentativasCruzadas += 1;
        const r = await portal.get(rota);
        registrar(r.status === 404, `${rota} (não liberado) devolveu ${r.status}`);
        assert.equal(r.status, 404);
        assert.equal(JSON.stringify(r.body), NAO_ENCONTRADO);
      }
      const inexistente = await portal.get("/portal/processos/000000000000000000000000");
      assert.equal(inexistente.status, 404);
      assert.equal(JSON.stringify(inexistente.body), NAO_ENCONTRADO, "'não é seu' e 'não existe' iguais");
      const malformado = await portal.get("/portal/processos/nao-e-um-id");
      assert.equal(JSON.stringify(malformado.body), NAO_ENCONTRADO, "id malformado também");

      // E confirmar no não liberado também não passa.
      placar.tentativasCruzadas += 1;
      const conf = await portal.post(`/portal/processos/${naoLiberado._id}/confirmacoes`);
      registrar(conf.status === 404, `confirmação em processo não liberado devolveu ${conf.status}`);
      assert.equal(conf.status, 404);
    });

    test("processo de OUTRA advogada não aparece, nem pela URL direta", async () => {
      const a = await montarPessoa("p25-adv-a", [true]);
      const b = await montarPessoa("p25-adv-b", [true]);
      const portalA = await entrarNoPortalComSenhaPropria(a.codigoAcesso, { rotulo: "p25-a" });

      const lista = esperado(await portalA.get("/portal/processos"), 200, "lista de A");
      assert.ok(!JSON.stringify(lista).includes(String(b.processos[0]._id)));

      placar.tentativasCruzadas += 1;
      const r = await portalA.get(`/portal/processos/${b.processos[0]._id}`);
      registrar(r.status === 404, `processo de outra advogada devolveu ${r.status}`);
      assert.equal(JSON.stringify(r.body), NAO_ENCONTRADO);
    });

    test("processo de OUTRO cliente da mesma advogada não aparece", async () => {
      const { adv, codigoAcesso } = await montarPessoa("p25-outro-cliente", [true]);
      const outro = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "outro cliente"
      );
      const doOutro = await criarProcesso(adv, [{ clienteId: outro._id, papel: "autor", principal: true }]);
      await liberarNoPortal(adv, doOutro._id, outro._id);

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "p25-oc" });
      const lista = esperado(await portal.get("/portal/processos"), 200, "lista");
      assert.ok(!JSON.stringify(lista).includes(String(doOutro._id)));

      placar.tentativasCruzadas += 1;
      const r = await portal.get(`/portal/processos/${doOutro._id}`);
      registrar(r.status === 404, `processo de outro cliente devolveu ${r.status}`);
      assert.equal(JSON.stringify(r.body), NAO_ENCONTRADO);
    });

    test("desliberado no meio da sessão: a requisição SEGUINTE já é recusada", async () => {
      const { adv, cliente, processos, codigoAcesso } = await montarPessoa("p25-desliberar", [true]);
      const [processo] = processos;
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "p25-dl" });

      esperado(await portal.get(`/portal/processos/${processo._id}`), 200, "visível");
      await liberarNoPortal(adv, processo._id, cliente._id, false);

      placar.tentativasCruzadas += 1;
      const r = await portal.get(`/portal/processos/${processo._id}`);
      registrar(r.status === 404, `desliberado ainda respondeu ${r.status}`);
      assert.equal(r.status, 404, "VAZAMENTO — a liberação ficou no token");
      assert.equal(esperado(await portal.get("/portal/processos"), 200, "lista").total, 0);
      esperado(await portal.get("/portal/sessao"), 200, "a sessão continua");

      // Liberar de novo devolve, sem novo login.
      await liberarNoPortal(adv, processo._id, cliente._id, true);
      esperado(await portal.get(`/portal/processos/${processo._id}`), 200, "de volta");
    });

    test("o código de vínculo antigo não autentica, nem com a senha certa", async () => {
      const { processos, cliente, codigoAcesso } = await montarPessoa("p25-antigo", [true]);
      const antigo = await codigoDeVinculoDe(processos[0]._id, cliente._id);
      assert.ok(antigo && antigo !== codigoAcesso, "o vínculo tem código próprio, diferente do pessoal");

      placar.tentativasCruzadas += 1;
      const api = novoClientePortal("p25-antigo-login");
      const r = await api.post("/portal/login", { codigoAcesso: antigo, senha: SENHA_PROVISORIA });
      registrar(r.status === 401, `código de vínculo autenticou (${r.status})`);
      assert.equal(r.status, 401);
      assert.equal(r.body.codigo, "credenciaisInvalidas");
    });

    test("senha provisória bloqueia tudo menos a troca (e a sessão)", async () => {
      const { processos, codigoAcesso } = await montarPessoa("p25-provisoria", [true]);
      const [processo] = processos;
      const portal = await entrarNoPortal(codigoAcesso, SENHA_PROVISORIA, "p25-prov");

      for (const rota of [
        "/portal/processos",
        `/portal/processos/${processo._id}`,
        `/portal/processos/${processo._id}/documentos`,
        `/portal/processos/${processo._id}/confirmacoes`
      ]) {
        const r = await portal.get(rota);
        assert.equal(r.status, 403, `${rota} com senha provisória`);
        assert.equal(r.body.codigo, "senhaPortalProvisoria");
      }
      const conf = await portal.post(`/portal/processos/${processo._id}/confirmacoes`);
      assert.equal(conf.status, 403);
      assert.equal(conf.body.codigo, "confirmacaoExigeSenhaPropria", "o 403 próprio da confirmação");

      esperado(await portal.get("/portal/sessao"), 200, "sessão responde");
      esperado(
        await portal.patch("/portal/senha", { senhaAtual: SENHA_PROVISORIA, novaSenha: SENHA_DO_CLIENTE }),
        200, "troca"
      );
      esperado(await portal.get("/portal/processos"), 200, "depois da troca, a lista");
    });

    test("PJ entra com o código DELA e vê os processos liberados dela", async () => {
      const { cliente, processos, codigoAcesso } = await montarPessoa(
        "p25-pj", [true, true, false], {}, dadosClientePJ
      );
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "p25-pj" });
      const sessao = esperado(await portal.get("/portal/sessao"), 200, "sessão");
      assert.equal(sessao.cliente.tipoPessoa, "juridica");
      assert.equal(sessao.cliente.nome, cliente.razaoSocial);

      const lista = esperado(await portal.get("/portal/processos"), 200, "lista");
      assert.deepEqual(
        lista.data.map((p) => p.id).sort(),
        [String(processos[0]._id), String(processos[1]._id)].sort()
      );
    });

    test("cliente sem NENHUM processo liberado entra e vê a lista vazia", async () => {
      const { codigoAcesso } = await montarPessoa("p25-vazio", [false]);
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "p25-vazio" });
      const lista = esperado(await portal.get("/portal/processos"), 200, "lista");
      assert.deepEqual(lista, { data: [], total: 0, page: 1, limit: 0, totalPages: 1 });
    });

    test("a lista traz N processos com fase, trânsito e os indicadores", async () => {
      const { adv, cliente, processos, codigoAcesso } = await montarPessoa("p25-lista", [true, true]);
      const [comDoc] = processos;
      const secao = await criarSecao(adv, { texto: "Texto sem variável." });
      const modelo = await criarModelo(adv);
      await vincularSecao(adv, modelo._id, secao._id);
      const doc = esperado(
        await adv.post(`/documents/modelos/${modelo._id}/gerar`, { processoId: comDoc._id, clienteId: cliente._id }),
        201, "doc"
      );
      esperado(await adv.patch(`/documents/${doc._id}/visibilidade-portal`, { visivelPortal: true }), 200, "visível");

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "p25-lista" });
      let lista = esperado(await portal.get("/portal/processos"), 200, "lista");
      assert.equal(lista.total, 2);
      const item = lista.data.find((p) => p.id === String(comDoc._id));
      assert.deepEqual(Object.keys(item).sort(), [
        "confirmacaoPendente", "documentosNovos", "documentosVisiveis", "fase", "id", "meuPapel",
        "numeroProcesso", "status", "titulo", "transitoEmJulgadoEm", "ultimaConfirmacao"
      ], "a projeção é allowlist");
      assert.equal(item.fase, "conhecimento");
      assert.equal(item.documentosVisiveis, 1);
      assert.equal(item.documentosNovos, 1);
      assert.equal(item.confirmacaoPendente, true);

      esperado(await portal.post(`/portal/processos/${comDoc._id}/confirmacoes`), 201, "confirma");
      lista = esperado(await portal.get("/portal/processos"), 200, "lista depois");
      const depois = lista.data.find((p) => p.id === String(comDoc._id));
      assert.equal(depois.documentosNovos, 0);
      assert.equal(depois.confirmacaoPendente, false);
      assert.ok(depois.ultimaConfirmacao);

      // O recibo diz de QUAL processo.
      const recibos = esperado(await portal.get(`/portal/processos/${comDoc._id}/confirmacoes`), 200, "recibos");
      assert.equal(recibos.data[0].processo.id, String(comDoc._id));
    });

    test("reativar o processo NÃO libera sozinho um vínculo que estava não liberado", async () => {
      const { adv, processos, codigoAcesso } = await montarPessoa("p25-reativa", [false]);
      const [processo] = processos;
      esperado(await adv.delete(`/processes/${processo._id}`), 200, "desativa");
      esperado(await adv.patch(`/processes/${processo._id}/reactivate`, {}), 200, "reativa");

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso, { rotulo: "p25-reat" });
      assert.equal(esperado(await portal.get("/portal/processos"), 200, "lista").total, 0);
      assert.equal((await portal.get(`/portal/processos/${processo._id}`)).status, 404);
    });

    test("a liberação só aceita boolean, e só no vínculo da própria advogada", async () => {
      const a = await montarPessoa("p25-lib-a", [false]);
      const b = await registrarUsuario("p25-lib-b");
      const [processo] = a.processos;
      const base = `/processes/${processo._id}/clientes/${a.cliente._id}/liberacao`;

      const semValor = await a.adv.patch(base, {});
      assert.equal(semValor.status, 400);
      assert.equal(semValor.body.campo, "liberadoNoPortal");
      const texto = await a.adv.patch(base, { liberadoNoPortal: "sim" });
      assert.equal(texto.status, 400);
      const intruso = await a.adv.patch(base, { liberadoNoPortal: true, ativo: false });
      assert.equal(intruso.status, 400);
      assert.equal(intruso.body.campo, "ativo");

      placar.tentativasCruzadas += 1;
      const deB = await b.patch(base, { liberadoNoPortal: true });
      registrar(deB.status === 404, `outra advogada liberou um vínculo (${deB.status})`);
      assert.equal(deB.status, 404);
      placar.tentativasCruzadas += 1;
      const acessoDeB = await b.get(`/clients/${a.cliente._id}/acesso-portal`);
      registrar(acessoDeB.status === 404, `outra advogada leu o acesso ao portal (${acessoDeB.status})`);
      assert.equal(acessoDeB.status, 404);
    });

    test("o acesso ao portal do cliente: código, senha e N de M liberados", async () => {
      const { adv, cliente, codigoAcesso } = await montarPessoa("p25-acesso", [true, false, true]);
      const r = esperado(await adv.get(`/clients/${cliente._id}/acesso-portal`), 200, "acesso");
      assert.equal(r.codigoAcessoPessoal, codigoAcesso);
      assert.equal(r.temSenhaPortal, true);
      assert.equal(r.senhaPortalProvisoria, true);
      assert.equal(r.processosLiberados, 2);
      assert.equal(r.processosAtivos, 3);
      assert.equal(r.processos.length, 3);
      assert.ok(!JSON.stringify(r).includes("senhaPortalHash"));
      assert.ok(!JSON.stringify(r).includes("$2"), "nenhum hash");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // A unicidade entre os dois espaços de código (DEC-089/090)
  //
  // Índice não atravessa coleção. O que garante que um código pessoal nunca
  // coincide com um de vínculo (e o contrário) é o gerador, que consulta os
  // dois. Para provar sem depender de sorte, o sorteio é FORÇADO: a primeira
  // tentativa devolve exatamente um código já usado no outro espaço.
  // ═════════════════════════════════════════════════════════════════════════
  describe("Fase 2.5 — código pessoal único contra os códigos de vínculo", () => {
    const bytesDoCodigo = (codigo) => {
      const alfabeto = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      const sorteado = codigo.replace(/^LEX-/, "").replace("-", "");
      return Buffer.from([...sorteado].map((c) => alfabeto.indexOf(c)));
    };

    test("o gerador PESSOAL pula um código que já é de vínculo", async () => {
      const { default: crypto } = await import("crypto");
      const { gerarCodigoPessoal } = await import("../../src/services/codigoPessoal.js");
      const { processos, cliente } = await (async () => {
        const adv = await registrarUsuario("p25-uni-1");
        const c = esperado(await adv.post("/clients", dadosClientePF()), 201, "c");
        const p = await criarProcesso(adv, [{ clienteId: c._id, papel: "autor", principal: true }]);
        return { processos: [p], cliente: c };
      })();
      const deVinculo = await codigoDeVinculoDe(processos[0]._id, cliente._id);

      const original = crypto.randomBytes;
      let chamadas = 0;
      crypto.randomBytes = (n) => {
        chamadas += 1;
        return chamadas === 1 ? bytesDoCodigo(deVinculo) : original(n);
      };
      try {
        const gerado = await gerarCodigoPessoal();
        assert.equal(chamadas, 2, "a primeira tentativa (colidindo) foi descartada");
        assert.notEqual(gerado, deVinculo);
      } finally {
        crypto.randomBytes = original;
      }
    });

    test("o gerador de VÍNCULO pula um código que já é pessoal", async () => {
      const { default: crypto } = await import("crypto");
      const { gerarCodigoParaVinculo } = await import("../../src/services/processoClienteService.js");
      const { codigoAcesso: pessoal } = await montarCenarioPortal("p25-uni-2");

      const original = crypto.randomBytes;
      let chamadas = 0;
      crypto.randomBytes = (n) => {
        chamadas += 1;
        return chamadas === 1 ? bytesDoCodigo(pessoal) : original(n);
      };
      try {
        const gerado = await gerarCodigoParaVinculo();
        assert.equal(chamadas, 2, "a primeira tentativa (colidindo) foi descartada");
        assert.notEqual(gerado, pessoal);
      } finally {
        crypto.randomBytes = original;
      }
    });

    test("redefinir a senha mantém o código pessoal; revogar não o apaga", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("p25-mantem");
      esperado(await adv.patch(`/clients/${cliente._id}`, { senhaPortal: "OutraProvisoria1" }), 200, "redefine");
      assert.equal(await codigoAcessoDe(adv, processo._id, cliente._id), codigoAcesso, "mesmo código");

      esperado(await adv.delete(`/clients/${cliente._id}/senha-portal`), 200, "revoga");
      const { acharEm, COLECOES } = await import("../helpers/db.js");
      const { default: mongoose } = await import("mongoose");
      const [gravado] = await acharEm(COLECOES.CLIENTS, { _id: new mongoose.Types.ObjectId(String(cliente._id)) });
      assert.equal(gravado.codigoAcessoPessoal, codigoAcesso, "o código continua reservado");
      // Sem senha, a rota não entrega código nenhum.
      assert.equal(await codigoAcessoDe(adv, processo._id, cliente._id), null);
    });
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
