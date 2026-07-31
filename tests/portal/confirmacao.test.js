// ═══════════════════════════════════════════════════════════════════════════
// CONFIRMAÇÃO DE VISUALIZAÇÃO
//
// O artefato que a advogada vai usar para provar que o cliente foi informado.
// Três propriedades sustentam esse valor, e as três são testadas aqui:
//
//   1. Só vale com senha própria. Enquanto a advogada conhecer a senha, ela
//      poderia ter clicado — e a confirmação seria repudiável.
//   2. É imutável e NÃO cascateia. Recibo que some quando o processo encerra
//      não serve, e encerrar é exatamente quando ela pode precisar mostrá-lo.
//   3. O instantâneo descreve o que estava visível. Sem ele, "confirmo que li"
//      não diz o que foi lido.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import {
  limparColecoes, TODAS_AS_COLECOES, desconectar, acharEm, contarEm
} from "../helpers/db.js";
import {
  registrarUsuario, criarProcesso, criarSecao, criarModelo, vincularSecao, esperado
} from "../helpers/setup.js";
import { dadosClientePF } from "../helpers/factories.js";
import {
  montarCenarioPortal, entrarNoPortal, entrarNoPortalComSenhaPropria,
  codigoAcessoDe, SENHA_PROVISORIA
} from "../helpers/portal.js";
import { ERRO_PORTAL } from "../../src/config/portalErrors.js";
import { TEXTO_CONFIRMACAO } from "../../src/config/textoConfirmacao.js";
import { ESTADO_PORTAL } from "../../src/config/portalEstados.js";

const COLECAO_CONFIRMACOES = "confirmacoes_visualizacao";

const TEXTO_PROCURACAO =
  "{{nomeCliente}}, {{profissaoCliente}}, CPF {{cpfCliente}}, no processo " +
  "{{numeroProcesso}}, outorga poderes a {{nomeAdvogada}}, OAB/{{estadoOAB}} {{numOAB}}.";

const gerarDocumento = async (adv, processoId, clienteId, { visivel = false } = {}) => {
  const secao = await criarSecao(adv, { texto: TEXTO_PROCURACAO });
  const modelo = await criarModelo(adv);
  await vincularSecao(adv, modelo._id, secao._id);
  const doc = esperado(
    await adv.post(`/documents/modelos/${modelo._id}/gerar`, { processoId, clienteId }),
    201, "geração"
  );
  if (visivel) {
    esperado(
      await adv.patch(`/documents/${doc._id}/visibilidade-portal`, { visivelPortal: true }),
      200, "liberar"
    );
  }
  return doc;
};

describe("portal: confirmação de visualização", () => {
  before(async () => {
    await subirApp();
    await limparColecoes([...TODAS_AS_COLECOES, COLECAO_CONFIRMACOES]);
  });

  // Limpeza entre CADA teste, e não só no `before` do arquivo.
  //
  // Vários testes daqui leem a coleção inteira — `acharEm(confirmacoes, {})` —
  // para conferir o que foi gravado, porque é justamente o registro cru que
  // interessa quando se testa imutabilidade. Sem limpar entre os testes, o
  // primeiro `[gravada]` pega a confirmação de um teste anterior e a asserção
  // passa a falar de outro cenário. Cada teste monta o próprio arranjo do zero,
  // então zerar aqui é barato e torna a leitura crua confiável.
  beforeEach(async () => {
    await limparColecoes([...TODAS_AS_COLECOES, COLECAO_CONFIRMACOES]);
  });

  after(async () => {
    await limparColecoes([...TODAS_AS_COLECOES, COLECAO_CONFIRMACOES]);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // O portão da senha provisória
  // ═════════════════════════════════════════════════════════════════════════

  describe("só vale com senha própria", () => {
    test("confirmar com senha provisória é recusado, com código PRÓPRIO", async () => {
      const { codigoAcesso } = await montarCenarioPortal("conf-provisoria");
      const portal = await entrarNoPortal(codigoAcesso);

      const r = await portal.post("/portal/confirmacoes");

      assert.equal(r.status, 403, `esperado 403, veio ${r.status} — ${JSON.stringify(r.body)}`);
      // Distinto do 403 genérico da senha provisória: a tela precisa dizer
      // coisas diferentes. "Troque a senha para continuar" versus "a
      // confirmação só vale depois que você tiver uma senha que só você
      // conhece" — o segundo explica o porquê, e é o que sustenta o recibo.
      assert.equal(r.body.codigo, ERRO_PORTAL.CONFIRMACAO_EXIGE_SENHA_PROPRIA);
      assert.notEqual(r.body.codigo, ERRO_PORTAL.SENHA_PROVISORIA);

      assert.equal(await contarEm(COLECAO_CONFIRMACOES), 0, "nada pode ter sido gravado");
    });

    test("depois da troca, confirmar devolve 201 com data, texto e instantâneo", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("conf-ok");
      await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const antes = Date.now();
      const r = await portal.post("/portal/confirmacoes");

      assert.equal(r.status, 201, `esperado 201 — ${JSON.stringify(r.body)}`);
      assert.ok(r.body.dataHora, "faltou dataHora");
      assert.ok(new Date(r.body.dataHora).getTime() >= antes - 5000, "dataHora fora do intervalo");

      // O texto é o do BACKEND, copiado inteiro para dentro do registro.
      assert.equal(r.body.textoConfirmado, TEXTO_CONFIRMACAO);
      assert.match(r.body.textoConfirmado, /tomei ciência/i);

      assert.equal(r.body.instantaneo.statusProcesso, "ativo");
      assert.equal(r.body.instantaneo.quantidadeDocumentos, 1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // O texto vem do backend
  // ═════════════════════════════════════════════════════════════════════════

  describe("origem do texto confirmado", () => {
    test("o texto exposto ao portal é o mesmo que é gravado", async () => {
      // A tela e o recibo saem da mesma constante, e por isso não podem
      // divergir.
      const { codigoAcesso } = await montarCenarioPortal("conf-texto");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      const exibido = esperado(
        await portal.get("/portal/confirmacoes/texto"), 200, "texto"
      );
      assert.equal(exibido.texto, TEXTO_CONFIRMACAO);
      assert.ok(exibido.versao, "faltou a versão do texto");

      const gravado = esperado(await portal.post("/portal/confirmacoes"), 201, "confirmação");
      assert.equal(gravado.textoConfirmado, exibido.texto);
    });

    test("texto enviado pelo cliente é IGNORADO", async () => {
      // Se o texto viesse do corpo, alguém com o cookie gravaria "declaro que
      // li" com qualquer redação — inclusive uma que não diz nada. O recibo tem
      // de registrar o que o SISTEMA apresentou.
      const { codigoAcesso } = await montarCenarioPortal("conf-texto-forjado");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      const r = esperado(
        await portal.post("/portal/confirmacoes", {
          textoConfirmado: "NAO LI NADA E NAO CONCORDO COM COISA NENHUMA"
        }),
        201, "confirmação"
      );

      assert.equal(r.textoConfirmado, TEXTO_CONFIRMACAO);
      assert.ok(!r.textoConfirmado.includes("NAO LI NADA"), "o texto do cliente foi gravado");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // O instantâneo
  // ═════════════════════════════════════════════════════════════════════════

  describe("instantâneo", () => {
    test("bate exatamente com os documentos visíveis do momento", async () => {
      // 2 visíveis + 1 invisível → o instantâneo tem os 2, e a quantidade é 2.
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("conf-snap");

      const v1 = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });
      const v2 = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });
      const invisivel = await gerarDocumento(adv, processo._id, cliente._id, { visivel: false });

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const r = esperado(await portal.post("/portal/confirmacoes"), 201, "confirmação");

      assert.equal(r.instantaneo.quantidadeDocumentos, 2);
      assert.deepEqual(
        [...r.instantaneo.documentosVisiveis].sort(),
        [String(v1._id), String(v2._id)].sort()
      );
      assert.ok(
        !r.instantaneo.documentosVisiveis.includes(String(invisivel._id)),
        "documento não liberado entrou no instantâneo"
      );
    });

    test("o instantâneo NÃO acompanha mudanças posteriores", async () => {
      // É a razão de ele existir: sem congelar, liberar um documento depois
      // faria o registro antigo parecer cobri-lo.
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("conf-congelado");
      const primeiro = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const r1 = esperado(await portal.post("/portal/confirmacoes"), 201, "1ª confirmação");
      assert.equal(r1.instantaneo.quantidadeDocumentos, 1);

      const segundo = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });

      const [gravada] = await acharEm(COLECAO_CONFIRMACOES, {});
      assert.equal(gravada.instantaneo.quantidadeDocumentos, 1, "o instantâneo mudou sozinho");
      assert.equal(String(gravada.instantaneo.documentosVisiveis[0]), String(primeiro._id));
      assert.ok(
        !gravada.instantaneo.documentosVisiveis.map(String).includes(String(segundo._id)),
        "documento liberado DEPOIS entrou num registro antigo"
      );
    });

    test("o status do processo no instantâneo é o do momento", async () => {
      const { adv, processo, codigoAcesso } = await montarCenarioPortal("conf-status");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      const r1 = esperado(await portal.post("/portal/confirmacoes"), 201, "com processo ativo");
      assert.equal(r1.instantaneo.statusProcesso, "ativo");

      esperado(
        await adv.patch(`/processes/${processo._id}`, { status: "suspenso" }),
        200, "suspende o processo"
      );

      const r2 = esperado(await portal.post("/portal/confirmacoes"), 201, "com processo suspenso");
      assert.equal(r2.instantaneo.statusProcesso, "suspenso");
      assert.equal(
        r1.instantaneo.statusProcesso, "ativo",
        "a confirmação anterior não pode ter mudado"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Repetição e imutabilidade
  // ═════════════════════════════════════════════════════════════════════════

  describe("repetição e imutabilidade", () => {
    test("duas confirmações geram DOIS registros, nenhum sobrescrito", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("conf-duas");
      await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const p = esperado(await portal.post("/portal/confirmacoes"), 201, "1ª");

      await new Promise((r) => setTimeout(r, 1100));
      await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });
      const s = esperado(await portal.post("/portal/confirmacoes"), 201, "2ª");

      assert.notEqual(p.id, s.id, "a segunda sobrescreveu a primeira");
      assert.equal(await contarEm(COLECAO_CONFIRMACOES), 2);

      // Cada uma descreve o seu momento.
      assert.equal(p.instantaneo.quantidadeDocumentos, 1);
      assert.equal(s.instantaneo.quantidadeDocumentos, 2);
      assert.ok(new Date(s.dataHora) > new Date(p.dataHora));
    });

    test("não existe rota que altere ou apague uma confirmação", async () => {
      const { codigoAcesso } = await montarCenarioPortal("conf-imutavel");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const c = esperado(await portal.post("/portal/confirmacoes"), 201, "confirmação");

      // Nenhum verbo de escrita responde sobre uma confirmação individual.
      for (const [metodo, rota] of [
        ["PATCH", `/portal/confirmacoes/${c.id}`],
        ["PUT", `/portal/confirmacoes/${c.id}`],
        ["DELETE", `/portal/confirmacoes/${c.id}`],
        ["DELETE", "/portal/confirmacoes"]
      ]) {
        const r = await portal.requisitar(metodo, rota, metodo === "DELETE" ? undefined : {});
        assert.ok(
          r.status === 404 || r.status === 405,
          `${metodo} ${rota} respondeu ${r.status} — não deveria existir`
        );
      }

      const [gravada] = await acharEm(COLECAO_CONFIRMACOES, {});
      assert.equal(gravada.textoConfirmado, TEXTO_CONFIRMACAO);
      assert.equal(gravada.ativo, true);
      assert.equal(await contarEm(COLECAO_CONFIRMACOES), 1);
    });

    test("NÃO CASCATEIA: sobrevive à desativação de vínculo, processo e cliente", async () => {
      // A exceção deliberada ao padrão de soft delete do projeto. Encerrar o
      // processo é exatamente quando a advogada mais pode precisar mostrar que
      // informou.
      const adv = await registrarUsuario("conf-cascata");
      const cliente = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "cliente"
      );
      const outro = esperado(await adv.post("/clients", dadosClientePF()), 201, "outro");
      const processo = await criarProcesso(adv, [
        { clienteId: outro._id, papel: "autor", principal: true },
        { clienteId: cliente._id, papel: "litisconsorte", principal: false }
      ]);

      const codigo = await codigoAcessoDe(adv, processo._id, cliente._id);
      const portal = await entrarNoPortalComSenhaPropria(codigo);
      esperado(await portal.post("/portal/confirmacoes"), 201, "confirmação");

      const antes = esperado(
        await adv.get(`/processes/${processo._id}/confirmacoes`), 200, "antes"
      );
      assert.equal(antes.total, 1);

      // Desativa TUDO acima dela, na ordem que a cascata percorreria.
      esperado(
        await adv.delete(`/processes/${processo._id}/clientes/${cliente._id}`),
        200, "desativa o vínculo"
      );
      esperado(await adv.delete(`/clients/${cliente._id}`), 200, "desativa o cliente");

      // Com o processo ainda ativo, a confirmação continua legível.
      const depois = esperado(
        await adv.get(`/processes/${processo._id}/confirmacoes`), 200, "depois"
      );
      assert.equal(depois.total, 1, "a confirmação sumiu ao desativar vínculo e cliente");

      esperado(await adv.delete(`/processes/${processo._id}`), 200, "desativa o processo");

      // E no banco ela continua íntegra e ativa, mesmo com o processo inativo.
      const gravadas = await acharEm(COLECAO_CONFIRMACOES, {});
      assert.equal(gravadas.length, 1, "a confirmação foi apagada por cascata");
      assert.equal(gravadas[0].ativo, true, "a confirmação foi DESATIVADA por cascata");
      assert.equal(gravadas[0].textoConfirmado, TEXTO_CONFIRMACAO);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Lado da advogada
  // ═════════════════════════════════════════════════════════════════════════

  describe("lado da advogada", () => {
    test("lista as confirmações do processo com o participante", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("conf-adv-lista");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      esperado(await portal.post("/portal/confirmacoes"), 201, "confirmação");

      const r = esperado(
        await adv.get(`/processes/${processo._id}/confirmacoes`), 200, "confirmações"
      );

      assert.equal(r.total, 1);
      const c = r.data[0];
      assert.equal(String(c.clienteId._id ?? c.clienteId), String(cliente._id));
      assert.equal(c.textoConfirmado, TEXTO_CONFIRMACAO);
      assert.equal(c.vistaPelaAdvogada, false);
      assert.ok(c.instantaneo, "faltou o instantâneo");
    });

    test("contador de não vistas: conta, zera ao marcar, volta a contar", async () => {
      const { adv, processo, codigoAcesso } = await montarCenarioPortal("conf-contador");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      const contador = async () =>
        esperado(await adv.get("/dashboard"), 200, "dashboard").confirmacoesNaoVistas;

      assert.equal(await contador(), 0, "começa zerado");

      esperado(await portal.post("/portal/confirmacoes"), 201, "1ª");
      assert.equal(await contador(), 1);

      await new Promise((r) => setTimeout(r, 1100));
      esperado(await portal.post("/portal/confirmacoes"), 201, "2ª");
      assert.equal(await contador(), 2);

      const marcadas = esperado(
        await adv.patch(`/processes/${processo._id}/confirmacoes/vistas`),
        200, "marcar como vistas"
      );
      assert.equal(marcadas.marcadas, 2);
      assert.equal(await contador(), 0, "marcar deveria zerar");

      await new Promise((r) => setTimeout(r, 1100));
      esperado(await portal.post("/portal/confirmacoes"), 201, "3ª");
      assert.equal(await contador(), 1, "confirmação nova volta a contar");
    });

    test("marcar como vistas não altera mais nada da confirmação", async () => {
      const { adv, processo, codigoAcesso } = await montarCenarioPortal("conf-marcar");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      esperado(await portal.post("/portal/confirmacoes"), 201, "confirmação");

      const [antes] = await acharEm(COLECAO_CONFIRMACOES, {});
      esperado(
        await adv.patch(`/processes/${processo._id}/confirmacoes/vistas`), 200, "marcar"
      );
      const [depois] = await acharEm(COLECAO_CONFIRMACOES, {});

      assert.equal(depois.vistaPelaAdvogada, true, "não marcou");
      assert.equal(antes.vistaPelaAdvogada, false);
      // Todo o resto, byte a byte.
      assert.equal(depois.textoConfirmado, antes.textoConfirmado);
      assert.equal(String(depois.dataHora), String(antes.dataHora));
      assert.equal(
        depois.instantaneo.quantidadeDocumentos,
        antes.instantaneo.quantidadeDocumentos
      );
      assert.equal(depois.ativo, antes.ativo);
    });

    test("`ultimaConfirmacaoEm` desnormalizado bate com a última real", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("conf-desnorm");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      esperado(await portal.post("/portal/confirmacoes"), 201, "1ª");
      await new Promise((r) => setTimeout(r, 1100));
      const ultima = esperado(await portal.post("/portal/confirmacoes"), 201, "2ª");

      const participantes = esperado(
        await adv.get(`/processes/${processo._id}/clientes`), 200, "participantes"
      );
      const vinculo = participantes.data.find(
        (v) => String(v.clienteId._id ?? v.clienteId) === String(cliente._id)
      );

      assert.equal(
        new Date(vinculo.ultimaConfirmacaoEm).toISOString(),
        new Date(ultima.dataHora).toISOString(),
        "o desnormalizado não bate com a última confirmação"
      );
    });

    test("os três estados por participante, e o litisconsórcio misto", async () => {
      // O caso que a interface da 3.2 precisa mostrar bem: um confirmou, o
      // outro não.
      const adv = await registrarUsuario("conf-estados");
      const confirmou = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "confirmou"
      );
      const soAcessou = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "só acessou"
      );
      const nuncaEntrou = esperado(await adv.post("/clients", dadosClientePF()), 201, "nunca");

      const processo = await criarProcesso(adv, [
        { clienteId: confirmou._id, papel: "autor", principal: true },
        { clienteId: soAcessou._id, papel: "litisconsorte", principal: false },
        { clienteId: nuncaEntrou._id, papel: "litisconsorte", principal: false }
      ]);

      const cod1 = await codigoAcessoDe(adv, processo._id, confirmou._id);
      const cod2 = await codigoAcessoDe(adv, processo._id, soAcessou._id);

      const p1 = await entrarNoPortalComSenhaPropria(cod1, { rotulo: "p1" });
      esperado(await p1.post("/portal/confirmacoes"), 201, "confirma");

      const p2 = await entrarNoPortalComSenhaPropria(cod2, { rotulo: "p2" });
      esperado(await p2.get("/portal/processo"), 200, "só acessa");

      const participantes = esperado(
        await adv.get(`/processes/${processo._id}/clientes`), 200, "participantes"
      );
      const estadoDe = (id) =>
        participantes.data.find((v) => String(v.clienteId._id ?? v.clienteId) === String(id))
          .estadoPortal;

      assert.equal(estadoDe(confirmou._id), ESTADO_PORTAL.CONFIRMOU);
      assert.equal(estadoDe(soAcessou._id), ESTADO_PORTAL.ACESSOU_SEM_CONFIRMAR);
      assert.equal(estadoDe(nuncaEntrou._id), ESTADO_PORTAL.NUNCA_ACESSOU);

      // E `codigoAcesso` continua fora da listagem de participantes.
      assert.ok(
        !JSON.stringify(participantes).includes("codigoAcesso"),
        "VAZAMENTO — codigoAcesso apareceu na listagem de participantes"
      );
      assert.ok(!JSON.stringify(participantes).includes("LEX-"));
    });

    test("a advogada só enxerga confirmações do próprio usuário", async () => {
      const a = await montarCenarioPortal("conf-iso-a");
      const b = await montarCenarioPortal("conf-iso-b");

      const portalA = await entrarNoPortalComSenhaPropria(a.codigoAcesso, { rotulo: "iso-a" });
      esperado(await portalA.post("/portal/confirmacoes"), 201, "confirmação de A");

      // B pede as confirmações do processo de A: 404, como todo recurso alheio.
      assert.equal(
        (await b.adv.get(`/processes/${a.processo._id}/confirmacoes`)).status,
        404
      );
      assert.equal(
        (await b.adv.patch(`/processes/${a.processo._id}/confirmacoes/vistas`)).status,
        404
      );

      // E o contador de B não conta a confirmação de A.
      assert.equal(
        esperado(await b.adv.get("/dashboard"), 200, "dashboard de B").confirmacoesNaoVistas,
        0
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // O aviso da regeração (Parte 5.5)
  // ═════════════════════════════════════════════════════════════════════════

  describe("aviso da regeração", () => {
    test("o 409 avisa que o documento visível sairá do portal", async () => {
      // Comportamento MANTIDO: documento novo nasce `visivelPortal: false`, e
      // regerar um visível o faz sumir do portal. O que muda é que deixa de ser
      // silencioso.
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("conf-regera");

      const secao = await criarSecao(adv, { texto: TEXTO_PROCURACAO });
      const modelo = await criarModelo(adv);
      await vincularSecao(adv, modelo._id, secao._id);

      const doc = esperado(
        await adv.post(`/documents/modelos/${modelo._id}/gerar`, {
          processoId: processo._id, clienteId: cliente._id
        }),
        201, "geração"
      );
      esperado(
        await adv.patch(`/documents/${doc._id}/visibilidade-portal`, { visivelPortal: true }),
        200, "libera"
      );
      esperado(
        await adv.patch(`/documents/${doc._id}/texto`, {
          textoResolvido: `${doc.textoResolvido}\n\nCLAUSULA A MAO`
        }),
        200, "edita à mão"
      );

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      assert.equal(
        esperado(await portal.get("/portal/documentos"), 200, "antes").total, 1
      );

      // Regeração sem confirmar: 409 que agora avisa sobre o portal.
      const r = await adv.post(`/documents/modelos/${modelo._id}/gerar`, {
        processoId: processo._id, clienteId: cliente._id
      });

      assert.equal(r.status, 409, `esperado 409 — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.visivelPortal, true, "o 409 deveria dizer que o anterior está no portal");
      assert.equal(r.body.errors.sairaDoPortal, true);

      // Confirmando, o comportamento é o de sempre: o novo nasce fora do portal
      // e o cliente deixa de ver a peça até a advogada liberar de novo.
      esperado(
        await adv.post(`/documents/modelos/${modelo._id}/gerar`, {
          processoId: processo._id, clienteId: cliente._id, confirmarSobrescrita: true
        }),
        201, "regeração confirmada"
      );

      assert.equal(
        esperado(await portal.get("/portal/documentos"), 200, "depois").total,
        0,
        "o comportamento mudou — o documento novo não devia nascer visível"
      );
    });

    test("documento anterior invisível: o 409 diz que nada sai do portal", async () => {
      const { adv, cliente, processo } = await montarCenarioPortal("conf-regera-invisivel");

      const secao = await criarSecao(adv, { texto: TEXTO_PROCURACAO });
      const modelo = await criarModelo(adv);
      await vincularSecao(adv, modelo._id, secao._id);
      const doc = esperado(
        await adv.post(`/documents/modelos/${modelo._id}/gerar`, {
          processoId: processo._id, clienteId: cliente._id
        }),
        201, "geração"
      );
      esperado(
        await adv.patch(`/documents/${doc._id}/texto`, { textoResolvido: "editado" }),
        200, "edita"
      );

      const r = await adv.post(`/documents/modelos/${modelo._id}/gerar`, {
        processoId: processo._id, clienteId: cliente._id
      });
      assert.equal(r.status, 409);
      assert.equal(r.body.visivelPortal, false);
      assert.equal(r.body.errors.sairaDoPortal, false);
    });
  });
});
