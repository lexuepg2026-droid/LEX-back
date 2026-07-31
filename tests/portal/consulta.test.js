// ═══════════════════════════════════════════════════════════════════════════
// CONSULTA DO PORTAL — projeção allowlist, documentos e a checagem tripla.
//
// O que este arquivo protege não é "a rota responde 200": é que ela responde
// SÓ o que foi decidido. Um campo a mais numa resposta de portal é dado
// pessoal de um cliente indo para fora do escritório, e é o tipo de defeito
// que nenhuma tela mostra.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarProcesso, criarSecao, criarModelo, vincularSecao,
  criarHonorario, esperado
} from "../helpers/setup.js";
import { dadosClientePF } from "../helpers/factories.js";
import { extrairTextoDoPdf } from "../helpers/pdfText.js";
import {
  montarCenarioPortal, entrarNoPortalComSenhaPropria, entrarNoPortal,
  codigoAcessoDe, SENHA_PROVISORIA
} from "../helpers/portal.js";
import { ERRO_PORTAL } from "../../src/config/portalErrors.js";

const TEXTO_PROCURACAO =
  "{{nomeCliente}}, {{profissaoCliente}}, CPF {{cpfCliente}}, no processo " +
  "{{numeroProcesso}}, outorga poderes a {{nomeAdvogada}}, OAB/{{estadoOAB}} {{numOAB}}.";

// Gera um documento para um cliente e devolve-o, opcionalmente já visível.
const gerarDocumento = async (adv, processoId, clienteId, { visivel = false } = {}) => {
  const secao = await criarSecao(adv, { texto: TEXTO_PROCURACAO });
  const modelo = await criarModelo(adv);
  await vincularSecao(adv, modelo._id, secao._id);

  const doc = esperado(
    await adv.post(`/documents/modelos/${modelo._id}/gerar`, { processoId, clienteId }),
    201,
    "geração de documento"
  );

  if (visivel) {
    esperado(
      await adv.patch(`/documents/${doc._id}/visibilidade-portal`, { visivelPortal: true }),
      200,
      "liberar para o portal"
    );
  }

  return doc;
};

describe("portal: consulta", () => {
  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Projeção do processo
  // ═════════════════════════════════════════════════════════════════════════

  describe("GET /portal/processo — allowlist", () => {
    test("devolve o processo da sessão com o papel do próprio cliente", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("consulta-proc");

      // Observações nos DOIS lados, para provar que nenhuma sai.
      esperado(
        await adv.patch(`/clients/${cliente._id}`, {
          observacoes: "ANOTACAO INTERNA SOBRE O CLIENTE, NUNCA MOSTRAR"
        }),
        200, "observação no cliente"
      );
      esperado(
        await adv.patch(`/processes/${processo._id}`, {
          observacoes: "ESTRATEGIA INTERNA DO PROCESSO, NUNCA MOSTRAR",
          descricao: "Resumo escrito para o cliente ler."
        }),
        200, "observação no processo"
      );

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const r = esperado(await portal.get("/portal/processo"), 200, "processo");

      assert.equal(r.processo.numeroProcesso, processo.numeroProcesso);
      assert.equal(r.processo.meuPapel, "autor");
      assert.equal(r.processo.souPrincipal, true);
      assert.equal(r.processo.descricao, "Resumo escrito para o cliente ler.");
      assert.equal(r.cliente.nome, cliente.nomeCompleto);

      // As chaves de topo são EXATAMENTE estas três.
      assert.deepEqual(Object.keys(r).sort(), ["acesso", "cliente", "processo"]);
    });

    test("nenhum campo fora da allowlist sai na resposta", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("consulta-fields");
      esperado(
        await adv.patch(`/clients/${cliente._id}`, { observacoes: "SEGREDO-CLIENTE" }),
        200, "obs cliente"
      );
      esperado(
        await adv.patch(`/processes/${processo._id}`, { observacoes: "SEGREDO-PROCESSO" }),
        200, "obs processo"
      );

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const r = esperado(await portal.get("/portal/processo"), 200, "processo");

      // Conjunto FECHADO de chaves. Um campo novo no schema não pode aparecer
      // aqui sem alguém escrever a linha na projeção — e sem este teste cair.
      assert.deepEqual(
        Object.keys(r.processo).sort(),
        [
          "area", "comarca", "dataDistribuicao", "descricao", "id", "meuPapel",
          "numeroProcesso", "orgao", "souPrincipal", "status", "tipoAcao",
          "titulo", "vara"
        ]
      );
      assert.deepEqual(
        Object.keys(r.cliente).sort(),
        ["id", "nome", "senhaPortalProvisoria", "tipoPessoa"]
      );
      assert.deepEqual(
        Object.keys(r.acesso).sort(),
        ["primeiroAcesso", "ultimaConfirmacao", "ultimoAcesso"]
      );

      const bruto = JSON.stringify(r);

      // Valores plantados: busca por substring é o certo aqui, porque o que
      // importa é o TEXTO aparecer em qualquer lugar da resposta.
      for (const valor of ["SEGREDO-CLIENTE", "SEGREDO-PROCESSO"]) {
        assert.ok(!bruto.includes(valor), `VAZAMENTO — "${valor}" saiu na resposta: ${bruto}`);
      }

      // Nomes de campo: busca por CHAVE, recursivamente, e não por substring.
      // Procurar `"rg"` como substring acusava `"orgao":"TJPR"` — falso
      // positivo do próprio teste, não do produto. Nome de campo se confere
      // como nome de campo.
      const chavesDe = (obj, acc = new Set()) => {
        if (Array.isArray(obj)) { for (const i of obj) chavesDe(i, acc); return acc; }
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) { acc.add(k); chavesDe(v, acc); }
        }
        return acc;
      };
      const chaves = chavesDe(r);

      for (const proibida of [
        "observacoes", "senhaPortalHash", "senhaPortalDefinidaEm", "usuarioId",
        "__v", "codigoAcesso", "clientePrincipalId", "cpf", "cnpj", "rg",
        "endereco", "email", "telefone", "dataNascimento", "estadoCivil",
        "profissao", "_id"
      ]) {
        assert.ok(
          !chaves.has(proibida),
          `VAZAMENTO — a chave "${proibida}" saiu na resposta: ${[...chaves].join(", ")}`
        );
      }
    });

    test("não expõe os outros participantes do processo", async () => {
      // DEC-029 ponto 10. Num litisconsórcio, o cliente vê o papel dele, não a
      // lista de quem mais está no polo.
      const adv = await registrarUsuario("consulta-litis");
      const a = esperado(
        await adv.post("/clients", { ...dadosClientePF({ nomeCompleto: "Cliente A do Portal" }), senhaPortal: SENHA_PROVISORIA }),
        201, "cliente A"
      );
      const b = esperado(
        await adv.post("/clients", dadosClientePF({ nomeCompleto: "LITISCONSORTE SECRETO" })),
        201, "cliente B"
      );
      const processo = await criarProcesso(adv, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false }
      ]);

      const codigo = await codigoAcessoDe(adv, processo._id, a._id);
      const portal = await entrarNoPortalComSenhaPropria(codigo);
      const r = esperado(await portal.get("/portal/processo"), 200, "processo");

      const bruto = JSON.stringify(r);
      assert.ok(!bruto.includes("LITISCONSORTE SECRETO"), "o outro participante vazou");
      assert.ok(!bruto.includes(String(b._id)), "o id do outro participante vazou");
      assert.equal(r.processo.meuPapel, "autor");
    });

    test("nenhum dado financeiro sai no portal", async () => {
      // DEC-029 ponto 8, e a decisão NÃO foi reaberta pela Fase 4.1: o portal
      // continua sem honorário, sem parcela e sem pagamento. A Fase 3.2
      // registrou que a exibição poderia ser reconsiderada "quando a Fase 4
      // fechar o financeiro" — fechou, e a decisão segue a mesma. Cliente não
      // precisa do extrato da advogada dentro do portal de acompanhamento.
      const { adv, processo, codigoAcesso } = await montarCenarioPortal("consulta-fin");

      // Um honorário PERCENTUAL, com os campos que a Fase 4.1 criou. Sem eles
      // no cenário, a varredura passaria por não haver o que vazar.
      const honorario = await criarHonorario(adv, processo._id, {
        tipo: "percentual", percentual: 42, valorBase: 987654,
        descricao: "VALOR SECRETO"
      });
      const parcela = esperado(
        await adv.post("/installments", {
          feeId: honorario._id, numeroParcela: 1,
          valor: 100, dataVencimento: "2099-12-31"
        }),
        201, "parcela do cenário"
      );
      esperado(
        await adv.post("/payments", {
          installmentId: parcela._id, valorPago: 77,
          dataPagamento: "2026-02-10", formaPagamento: "pix"
        }),
        201, "pagamento do cenário"
      );

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      // Todas as rotas de dado do portal, não só a do processo: um campo novo
      // entra por qualquer uma delas.
      const respostas = [
        ["GET /portal/processo", await portal.get("/portal/processo")],
        ["GET /portal/documentos", await portal.get("/portal/documentos")],
        ["GET /portal/confirmacoes", await portal.get("/portal/confirmacoes")],
        ["GET /portal/sessao", await portal.get("/portal/sessao")]
      ];

      // Os nomes de campo da Fase 4.1 entram na mesma rede que já pegava os
      // antigos. Nomes de campo, e não só valores: um campo pode sair zerado
      // hoje e preenchido amanhã, e a varredura precisa cair na primeira vez.
      const PROIBIDOS = [
        "987654", "VALOR SECRETO",
        "honorario", "valor", "parcela", "pagamento",
        "percentual", "valorBase", "valorPago", "saldoDisponivel",
        "valorParcela", "contratado", "emAberto", "parcialmente_pago"
      ];

      for (const [rotulo, r] of respostas) {
        assert.equal(r.status, 200, `${rotulo} — ${JSON.stringify(r.body)}`);
        const bruto = JSON.stringify(r.body ?? {}).toLowerCase();
        for (const proibido of PROIBIDOS) {
          assert.ok(
            !bruto.includes(proibido.toLowerCase()),
            `VAZAMENTO — ${rotulo} trouxe "${proibido}": ${JSON.stringify(r.body)}`
          );
        }
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Documentos
  // ═════════════════════════════════════════════════════════════════════════

  describe("GET /portal/documentos", () => {
    test("lista apenas os visíveis, e o invisível não aparece", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("docs-lista");

      const visivel = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });
      const invisivel = await gerarDocumento(adv, processo._id, cliente._id, { visivel: false });

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const r = esperado(await portal.get("/portal/documentos"), 200, "documentos");

      const ids = r.data.map((d) => d.id);
      assert.deepEqual(ids, [String(visivel._id)], "a listagem não bate com o esperado");
      assert.ok(!ids.includes(String(invisivel._id)), "documento não liberado apareceu");
      assert.equal(r.total, 1);

      // Envelope de listagem, como no resto da API.
      assert.deepEqual(
        Object.keys(r).sort(),
        ["data", "limit", "page", "total", "totalPages"]
      );
      // E a projeção do documento é fechada. `textoResolvido` fora de
      // propósito: o portal entrega o ARQUIVO, não o conteúdo cru na listagem.
      assert.deepEqual(
        Object.keys(r.data[0]).sort(),
        ["dataGeracao", "descricao", "formatosDisponiveis", "id", "nome", "tipo"]
      );
    });

    test("documento de OUTRO participante do mesmo processo não aparece", async () => {
      // O filtro por clienteId não é redundante com o de processo: num
      // litisconsórcio cada participante tem a SUA procuração, e sem ele um
      // leria a peça do outro — dado pessoal de terceiro dentro do mesmo
      // processo.
      const adv = await registrarUsuario("docs-litis");
      const a = esperado(
        await adv.post("/clients", { ...dadosClientePF(), senhaPortal: SENHA_PROVISORIA }),
        201, "A"
      );
      const b = esperado(await adv.post("/clients", dadosClientePF()), 201, "B");
      const processo = await criarProcesso(adv, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false }
      ]);

      const doA = await gerarDocumento(adv, processo._id, a._id, { visivel: true });
      const doB = await gerarDocumento(adv, processo._id, b._id, { visivel: true });

      const codigo = await codigoAcessoDe(adv, processo._id, a._id);
      const portal = await entrarNoPortalComSenhaPropria(codigo);
      const r = esperado(await portal.get("/portal/documentos"), 200, "documentos");

      const ids = r.data.map((d) => d.id);
      assert.ok(ids.includes(String(doA._id)), "o documento do próprio cliente sumiu");
      assert.ok(!ids.includes(String(doB._id)), "VAZAMENTO — documento do litisconsorte apareceu");

      // E o download direto também é negado, com 404.
      assert.equal((await portal.get(`/portal/documentos/${doB._id}/download`)).status, 404);
    });

    test("modelo e documento de upload nunca aparecem", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("docs-tipos");

      const modelo = await criarModelo(adv);
      const upload = esperado(
        await adv.post("/documents", {
          nome: "Upload da advogada",
          tipo: "outro",
          processoId: processo._id,
          urlArquivo: "https://arquivos.lex.test/x.pdf"
        }),
        201, "upload"
      );
      // Mesmo liberado à força, upload não é `origem: "gerado"`.
      await adv.patch(`/documents/${upload._id}/visibilidade-portal`, { visivelPortal: true });

      await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);
      const ids = esperado(await portal.get("/portal/documentos"), 200, "docs").data.map((d) => d.id);

      assert.ok(!ids.includes(String(modelo._id)), "modelo apareceu no portal");
      assert.ok(!ids.includes(String(upload._id)), "documento de upload apareceu no portal");
      assert.equal(ids.length, 1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Download
  // ═════════════════════════════════════════════════════════════════════════

  describe("GET /portal/documentos/:id/download", () => {
    test("baixa o mesmo arquivo que a advogada baixa", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("docs-download");
      const doc = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      const doPortal = await portal.get(`/portal/documentos/${doc._id}/download?formato=pdf`);
      const daAdvogada = await adv.get(`/documents/${doc._id}/download?formato=pdf`);

      assert.equal(doPortal.status, 200, `download do portal falhou: ${doPortal.status}`);
      assert.equal(daAdvogada.status, 200);
      assert.match(doPortal.tipo, /application\/pdf/);
      assert.match(doPortal.headers.get("content-disposition") ?? "", /attachment/);
      assert.equal(doPortal.bytes.subarray(0, 5).toString("latin1"), "%PDF-");

      // O conteúdo tem de ser o mesmo: dois renderizadores divergiriam e o
      // cliente receberia peça diferente da que está no processo.
      const textoPortal = extrairTextoDoPdf(doPortal.bytes);
      const textoAdvogada = extrairTextoDoPdf(daAdvogada.bytes);
      assert.equal(textoPortal, textoAdvogada, "o PDF do portal difere do da advogada");
      assert.ok(textoPortal.includes(cliente.nomeCompleto), "o nome do cliente não saiu no PDF");
    });

    test("DOCX também é entregue", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("docs-docx");
      const doc = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      const r = await portal.get(`/portal/documentos/${doc._id}/download?formato=docx`);
      assert.equal(r.status, 200);
      assert.equal(r.bytes.subarray(0, 2).toString("latin1"), "PK");
    });

    test("documento NÃO visível → 404, nunca 403", async () => {
      // 403 confirmaria a existência do documento para quem tem só o id.
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("docs-404");
      const invisivel = await gerarDocumento(adv, processo._id, cliente._id, { visivel: false });
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      const r = await portal.get(`/portal/documentos/${invisivel._id}/download`);
      assert.equal(r.status, 404, `esperado 404, veio ${r.status}`);
    });

    test("documento inativo → 404", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("docs-inativo");
      const doc = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      esperado(await portal.get(`/portal/documentos/${doc._id}/download`), 200, "antes");
      esperado(await adv.delete(`/documents/${doc._id}`), 200, "desativa o documento");

      assert.equal((await portal.get(`/portal/documentos/${doc._id}/download`)).status, 404);
      assert.equal(
        esperado(await portal.get("/portal/documentos"), 200, "docs").total,
        0
      );
    });

    test("id inexistente e id malformado → 404", async () => {
      const { codigoAcesso } = await montarCenarioPortal("docs-id");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      assert.equal((await portal.get("/portal/documentos/000000000000000000000000/download")).status, 404);
      assert.equal((await portal.get("/portal/documentos/nao-e-um-id/download")).status, 404);
    });

    test("formato inválido → 400", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("docs-formato");
      const doc = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      assert.equal(
        (await portal.get(`/portal/documentos/${doc._id}/download?formato=txt`)).status,
        400
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Portão da senha provisória
  // ═════════════════════════════════════════════════════════════════════════

  describe("senha provisória bloqueia a consulta", () => {
    test("cada rota de consulta responde 403 com o código estável", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("provisoria-403");
      const doc = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });

      const portal = await entrarNoPortal(codigoAcesso); // sem trocar a senha

      const rotas = [
        ["GET", "/portal/processo"],
        ["GET", "/portal/documentos"],
        ["GET", `/portal/documentos/${doc._id}/download`]
      ];

      for (const [metodo, rota] of rotas) {
        const r = await portal.requisitar(metodo, rota);
        assert.equal(r.status, 403, `${metodo} ${rota}: esperado 403, veio ${r.status}`);
        assert.equal(
          r.body.codigo,
          ERRO_PORTAL.SENHA_PROVISORIA,
          `${metodo} ${rota}: código de erro errado`
        );
      }
    });

    test("depois da troca, as mesmas rotas respondem 200", async () => {
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("provisoria-200");
      const doc = await gerarDocumento(adv, processo._id, cliente._id, { visivel: true });

      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      assert.equal((await portal.get("/portal/processo")).status, 200);
      assert.equal((await portal.get("/portal/documentos")).status, 200);
      assert.equal((await portal.get(`/portal/documentos/${doc._id}/download`)).status, 200);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Registro de acesso
  // ═════════════════════════════════════════════════════════════════════════

  describe("registro de acesso", () => {
    test("primeiro acesso é gravado uma vez; o último se atualiza", async () => {
      const { codigoAcesso } = await montarCenarioPortal("acesso");
      const portal = await entrarNoPortalComSenhaPropria(codigoAcesso);

      // A primeira leitura ainda devolve o estado ANTES da escrita, porque o
      // registro não bloqueia a requisição. A segunda já enxerga.
      esperado(await portal.get("/portal/processo"), 200, "1º acesso");
      const segunda = esperado(await portal.get("/portal/processo"), 200, "2º acesso");

      assert.ok(segunda.acesso.primeiroAcesso, "primeiroAcesso não foi gravado");
      assert.ok(segunda.acesso.ultimoAcesso, "ultimoAcesso não foi gravado");

      const primeiroRegistrado = segunda.acesso.primeiroAcesso;

      await new Promise((r) => setTimeout(r, 1100));
      esperado(await portal.get("/portal/processo"), 200, "3º acesso");
      const quarta = esperado(await portal.get("/portal/processo"), 200, "4º acesso");

      assert.equal(
        quarta.acesso.primeiroAcesso,
        primeiroRegistrado,
        "primeiroAcesso não pode mudar depois da primeira vez"
      );
      assert.ok(
        new Date(quarta.acesso.ultimoAcesso) > new Date(primeiroRegistrado),
        "ultimoAcesso deveria ter avançado"
      );
    });

    test("acesso com senha provisória NÃO é registrado", async () => {
      // Enquanto a senha for provisória, quem está entrando pode ser a
      // advogada testando a credencial que acabou de criar. Registrar isso
      // como "o cliente acessou" seria rastro falso — e é justamente o rastro
      // que ela vai olhar antes de afirmar que a pessoa foi informada.
      const { adv, cliente, processo, codigoAcesso } = await montarCenarioPortal("acesso-provisoria");

      const portal = await entrarNoPortal(codigoAcesso);
      await portal.get("/portal/processo"); // 403
      await portal.get("/portal/documentos"); // 403

      const participantes = esperado(
        await adv.get(`/processes/${processo._id}/clientes`),
        200, "participantes"
      );
      const vinculo = participantes.data.find(
        (v) => String(v.clienteId._id ?? v.clienteId) === String(cliente._id)
      );

      assert.equal(
        vinculo.primeiroAcessoPortal ?? null,
        null,
        "acesso com senha provisória não pode contar como acesso do cliente"
      );
    });
  });
});
