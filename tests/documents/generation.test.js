// ═══════════════════════════════════════════════════════════════════════════
// GERAÇÃO DE DOCUMENTO — pendência, escolha de honorário, congelamento,
// cadeia de substituição e a validação no lugar certo.
//
// É o módulo com mais decisões fechadas do projeto (18, no CLAUDE.md), e
// quase todas são do tipo que uma "simplificação" futura desfaz sem perceber
// que desfez. Cada teste aqui trava uma delas.
//
// O teste central do arquivo é o da 5.4: download de documento editado à mão
// traz o texto EDITADO, não o recomposto das seções. Ele é o único que abre o
// arquivo entregue — asserção sobre `textoResolvido` no banco não provaria
// nada, porque o defeito que se quer pegar mora no renderizador, depois do
// banco.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { Types } from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar, acharEm, COLECOES } from "../helpers/db.js";

const { ObjectId } = Types;
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarSecao, criarModelo, vincularSecao, esperado
} from "../helpers/setup.js";
import { extrairTextoDoPdf } from "../helpers/pdfText.js";
import { CATALOGO_VARIAVEIS } from "../../src/config/templateVariables.js";

const TEXTO_QUALIFICACAO =
  "{{nomeCliente}}, {{profissaoCliente}}, portador(a) do CPF {{cpfCliente}}, " +
  "nos autos do processo {{numeroProcesso}}, outorga poderes a {{nomeAdvogada}}, " +
  "OAB/{{estadoOAB}} {{numOAB}}.";

const TEXTO_COM_HONORARIO =
  "Pelos serviços fica ajustado o valor de {{valorHonorario}} " +
  "({{valorHonorarioExtenso}}), em {{numeroParcelas}} parcela(s).";

describe("geração de documento", () => {
  let api;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("documentos");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // Um modelo com o texto pedido, pronto para gerar.
  const montarModelo = async (texto) => {
    const secao = await criarSecao(api, { texto });
    const modelo = await criarModelo(api);
    await vincularSecao(api, modelo._id, secao._id);
    return { secao, modelo };
  };

  const montarProcesso = async (extraCliente = {}) => {
    const cliente = await criarClientePF(api, extraCliente);
    const processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    return { cliente, processo };
  };

  const gerar = (modeloId, corpo) => api.post(`/documents/modelos/${modeloId}/gerar`, corpo);

  // ═════════════════════════════════════════════════════════════════════════
  // 5.1 — 422 de pendência
  // ═════════════════════════════════════════════════════════════════════════

  describe("5.1 pendência de cadastro", () => {
    test("cliente sem profissão → 422 com lista acionável, pelo RÓTULO do catálogo", async () => {
      const { modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      // `null` e não `undefined`: campo apagado grava null, é a convenção.
      const { cliente, processo } = await montarProcesso({ profissao: null });

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id });

      assert.equal(r.status, 422, `esperado 422, veio ${r.status} — ${JSON.stringify(r.body)}`);

      const pendencias = r.body.errors?.pendencias;
      assert.ok(Array.isArray(pendencias), "o 422 deveria trazer errors.pendencias[]");

      const profissao = pendencias.find((p) => p.variavel === "profissaoCliente");
      assert.ok(profissao, `a pendência de profissão não veio: ${JSON.stringify(pendencias)}`);

      // O rótulo vem do catálogo, não da chave. Derivar "Profissao Cliente" da
      // chave funciona e parece amador — a decisão de escrever os 48 rótulos à
      // mão está em `variableLabels.js`, e este teste é o que a defende.
      assert.equal(profissao.rotulo, CATALOGO_VARIAVEIS.profissaoCliente.rotulo);
      assert.equal(profissao.rotulo, "Profissão");
      assert.notEqual(profissao.rotulo, "profissaoCliente", "a lista veio com a chave crua");

      // Acionável quer dizer que diz ONDE resolver.
      //
      // Fase 4.6: a orientação passou a nomear a TELA e o CAMPO
      // ("Cadastro do cliente → Profissão") em vez de só a tela
      // ("no cadastro do cliente"). Dizer a tela deixava a advogada procurando
      // entre os campos do formulário; o caminho acaba a procura.
      assert.equal(profissao.origem, "cliente");
      assert.equal(profissao.motivo, "campoVazio", "é campo vazio, não incompatibilidade de tipo");
      assert.match(profissao.orientacao, /Cadastro do cliente/);
      assert.match(profissao.orientacao, /Profissão/);

      // E o documento NÃO foi criado: recusar é o comportamento, não avisar e
      // gerar assim mesmo.
      const lista = esperado(await api.get("/documents?page=1&limit=100"), 200, "listagem");
      assert.ok(
        !lista.data.some((d) => String(d.processoId?._id ?? d.processoId) === String(processo._id) && !d.ehModelo),
        "o documento foi gerado apesar do 422"
      );
    });

    test("com o cadastro completo, o mesmo modelo gera 201", async () => {
      // Contraprova: sem ela, um 422 emitido sempre passaria no teste de cima.
      const { modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      const { cliente, processo } = await montarProcesso();

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id });
      assert.equal(r.status, 201, `esperado 201, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.ok(r.body.textoResolvido.includes("engenheira"), "a profissão deveria estar no texto");
      assert.ok(!r.body.textoResolvido.includes("{{"), "sobrou marcador por resolver no texto");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5.2 — Escolha de honorário
  //
  // A regra é "nunca adivinhar". Nem o mais recente, nem o de maior valor:
  // qualquer critério automático estaria certo por acaso, e um contrato com o
  // honorário do processo errado é o defeito que ninguém revisa a tempo.
  // ═════════════════════════════════════════════════════════════════════════

  describe("5.2 escolha de honorário", () => {
    test("um honorário ativo e `honorarioId` omitido → usa esse", async () => {
      const { modelo } = await montarModelo(TEXTO_COM_HONORARIO);
      const { cliente, processo } = await montarProcesso();
      const fee = await criarHonorario(api, processo._id, { valor: 3000 });

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id });

      assert.equal(r.status, 201, `esperado 201, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.equal(String(r.body.honorarioId), String(fee._id), "gravou o honorário usado");
      assert.match(r.body.textoResolvido, /3\.000,00/);
      assert.match(r.body.textoResolvido, /três mil reais/);
      // Sem parcela cadastrada, o honorário é pagamento único: 1 parcela do
      // valor cheio. É assim que o contrato deve descrevê-lo, não como "0".
      assert.match(r.body.textoResolvido, /em 1 parcela/);
    });

    test("vários honorários ativos e `honorarioId` omitido → 422 pedindo escolha, com opções", async () => {
      const { modelo } = await montarModelo(TEXTO_COM_HONORARIO);
      const { cliente, processo } = await montarProcesso();
      const fee1 = await criarHonorario(api, processo._id, { valor: 3000, descricao: "Entrada" });
      const fee2 = await criarHonorario(api, processo._id, { valor: 6000, descricao: "Êxito" });

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id });

      assert.equal(r.status, 422, `esperado 422, veio ${r.status} — ${JSON.stringify(r.body)}`);
      const escolha = r.body.errors.pendencias.find((p) => p.variavel === "honorarioId");
      assert.ok(escolha, "faltou a pendência de escolha de honorário");
      assert.match(escolha.orientacao, /2 honorários ativos/);

      // `opcoes[]` é o que permite à tela montar o seletor sem uma segunda
      // chamada. Sem ele, "escolha um" não é acionável.
      assert.equal(escolha.opcoes.length, 2);
      const ids = escolha.opcoes.map((o) => String(o.honorarioId)).sort();
      assert.deepEqual(ids, [String(fee1._id), String(fee2._id)].sort());
      for (const opcao of escolha.opcoes) {
        assert.ok(opcao.descricao, "a opção precisa do texto que identifica o honorário");
        assert.equal(typeof opcao.valor, "number");
      }
    });

    test("com o `honorarioId` informado, os mesmos dois honorários geram 201", async () => {
      const { modelo } = await montarModelo(TEXTO_COM_HONORARIO);
      const { cliente, processo } = await montarProcesso();
      await criarHonorario(api, processo._id, { valor: 3000, descricao: "Entrada" });
      const escolhido = await criarHonorario(api, processo._id, { valor: 6000, descricao: "Êxito" });

      const r = await gerar(modelo._id, {
        processoId: processo._id,
        clienteId: cliente._id,
        honorarioId: escolhido._id
      });

      assert.equal(r.status, 201);
      assert.equal(String(r.body.honorarioId), String(escolhido._id));
      assert.match(r.body.textoResolvido, /6\.000,00/);
      assert.ok(!r.body.textoResolvido.includes("3.000,00"), "usou o honorário errado");
    });

    test("`honorarioId` de OUTRO processo → 400", async () => {
      const { modelo } = await montarModelo(TEXTO_COM_HONORARIO);
      const alvo = await montarProcesso();
      const alheio = await montarProcesso();

      await criarHonorario(api, alvo.processo._id, { valor: 3000 });
      const deOutroProcesso = await criarHonorario(api, alheio.processo._id, { valor: 9999 });

      const r = await gerar(modelo._id, {
        processoId: alvo.processo._id,
        clienteId: alvo.cliente._id,
        honorarioId: deOutroProcesso._id
      });

      // 400 e não 404: o honorário existe e é do mesmo usuário, só não é deste
      // processo. Gerar um contrato com o valor de outro processo é exatamente
      // o que a checagem impede.
      assert.equal(r.status, 400, `esperado 400, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.match(r.body.message, /não pertence a este processo/i);
    });

    test("documento SEM variável de honorário: `honorarioId` é irrelevante e não há pendência", async () => {
      // Uma procuração não fala de valores. Cobrar `honorarioId` nela seria
      // pedir informação que o documento não usa.
      const { modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      const { cliente, processo } = await montarProcesso();
      await criarHonorario(api, processo._id, { valor: 3000, descricao: "Um" });
      await criarHonorario(api, processo._id, { valor: 6000, descricao: "Dois" });

      // Dois honorários ativos — que causariam 422 se o texto os usasse.
      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id });

      assert.equal(r.status, 201, `esperado 201, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.honorarioId, null, "sem variável de honorário, nada é gravado");
    });

    test("parcelas desiguais deixam `valorParcela` sem valor, e isso vira pendência honesta", async () => {
      // Dividir o total pelo número produziria um valor que não corresponde a
      // nenhuma cobrança real. A pendência é a resposta honesta.
      const { modelo } = await montarModelo("Parcela de {{valorParcela}}.");
      const { cliente, processo } = await montarProcesso();
      const fee = await criarHonorario(api, processo._id, { valor: 1000 });
      await criarParcela(api, fee._id, 1, { valor: 400 });
      await criarParcela(api, fee._id, 2, { valor: 600 });

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id });
      assert.equal(r.status, 422, `esperado 422, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.ok(r.body.errors.pendencias.some((p) => p.variavel === "valorParcela"));
    });

    // ── `percentualHonorario`, a chave 48 (Fase 4.1) ───────────────────────
    // A Fase 2C manteve esta variável FORA do catálogo com razão escrita: o
    // campo `percentual` só nasceria na Fase 4, e declarar a variável antes do
    // campo produziria pendência perpétua. O campo nasceu na DEC-027, e com
    // ele a variável — mas honorário fixo continua não tendo percentual, e é
    // esse o caso que precisa continuar recusando.
    test("`percentualHonorario` num honorário FIXO → 422, sem inventar valor", async () => {
      const { modelo } = await montarModelo("Honorários de {{percentualHonorario}} sobre o proveito.");
      const { cliente, processo } = await montarProcesso();
      await criarHonorario(api, processo._id, { tipo: "fixo", valor: 1000 });

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id });

      assert.equal(r.status, 422, `esperado 422, veio ${r.status} — ${JSON.stringify(r.body)}`);

      const pendencia = r.body.errors.pendencias.find((p) => p.variavel === "percentualHonorario");
      assert.ok(pendencia, `a pendência não veio: ${JSON.stringify(r.body.errors.pendencias)}`);

      // Mensagem ACIONÁVEL, com o rótulo do catálogo e onde corrigir — nunca a
      // chave crua.
      assert.equal(pendencia.origem, "honorario");
      assert.equal(pendencia.rotulo, CATALOGO_VARIAVEIS.percentualHonorario.rotulo);
      // Fase 4.6: a orientação antiga ("Preencha ... no honorário vinculado ao
      // processo") era um BECO SEM SAÍDA — seguir aquilo devolve 400, porque o
      // hook do Fee recusa percentual fora do tipo percentual. Agora ela diz a
      // saída real: trocar o TIPO da cobrança.
      assert.equal(pendencia.motivo, "tipoHonorarioIncompativel");
      assert.equal(pendencia.tipoHonorario, "fixo");
      assert.match(pendencia.orientacao, /tipo fixo/i);
      assert.match(pendencia.orientacao, /percentual/i);
      assert.match(pendencia.orientacao, /Honorários|remova a variável/i);
      assert.notEqual(pendencia.rotulo, "percentualHonorario", "a lista veio com a chave crua");
    });

    test("no honorário PERCENTUAL a mesma variável resolve, formatada", async () => {
      // Contraprova: sem ela, um resolver que devolvesse "" para tudo passaria
      // no teste de cima e a variável nunca funcionaria.
      const { modelo } = await montarModelo("Honorários de {{percentualHonorario}} sobre o proveito.");
      const { cliente, processo } = await montarProcesso();
      await criarHonorario(api, processo._id, {
        tipo: "percentual", percentual: 12.5, valorBase: 40000
      });

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id });
      assert.equal(r.status, 201, `esperado 201, veio ${r.status} — ${JSON.stringify(r.body)}`);

      // Vírgula decimal e símbolo colado, como se escreve em contrato.
      assert.match(r.body.textoResolvido, /Honorários de 12,5% sobre o proveito\./);
      assert.equal(r.body.variaveisResolvidas.percentualHonorario, "12,5%");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5.3 — Congelamento do texto
  // ═════════════════════════════════════════════════════════════════════════

  describe("5.3 documento gerado é congelado", () => {
    test("alterar a seção de origem não muda o texto do documento já gerado", async () => {
      const { secao, modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      const { cliente, processo } = await montarProcesso();

      const doc = esperado(
        await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id }),
        201,
        "geração"
      );

      const textoAntes = doc.textoResolvido;
      const variaveisAntes = doc.variaveisResolvidas;
      const dataAntes = doc.dataGeracao;

      // A seção muda por completo, inclusive o texto.
      esperado(
        await api.patch(`/secoes/${secao._id}`, {
          texto: "TEXTO COMPLETAMENTE DIFERENTE, sem variável nenhuma."
        }),
        200,
        "alteração da seção"
      );

      const depois = esperado(await api.get(`/documents/${doc._id}`), 200, "releitura");

      assert.equal(depois.textoResolvido, textoAntes, "o texto do documento acompanhou a seção");
      assert.ok(
        !depois.textoResolvido.includes("COMPLETAMENTE DIFERENTE"),
        "o texto da seção nova vazou para o documento antigo"
      );
      assert.deepEqual(depois.variaveisResolvidas, variaveisAntes);
      assert.equal(depois.dataGeracao, dataAntes);
    });

    test("`PATCH /:id` não aceita textoResolvido nem variaveisResolvidas", async () => {
      const { modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      const { cliente, processo } = await montarProcesso();
      const doc = esperado(
        await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id }),
        201,
        "geração"
      );

      const r = await api.patch(`/documents/${doc._id}`, {
        nome: "Nome novo",
        textoResolvido: "TENTATIVA DE SOBRESCRITA PELO PATCH GENÉRICO"
      });

      // Seja recusando (400) ou ignorando o campo (200), o texto não muda. A
      // rota própria de edição é `PATCH /:id/texto`.
      const depois = esperado(await api.get(`/documents/${doc._id}`), 200, "releitura");
      assert.ok(
        !depois.textoResolvido.includes("TENTATIVA DE SOBRESCRITA"),
        `o PATCH genérico gravou no textoResolvido (status ${r.status})`
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5.4 — Edição à mão e cadeia de substituição
  // ═════════════════════════════════════════════════════════════════════════

  describe("5.4 edição à mão, regeração e cadeia de substituição", () => {
    const FRASE_A_MAO = "CLAUSULA INSERIDA A MAO PELA ADVOGADA 987654";

    test("PATCH /:id/texto marca editadoManualmente", async () => {
      const { modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      const { cliente, processo } = await montarProcesso();
      const doc = esperado(
        await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id }),
        201,
        "geração"
      );

      assert.equal(doc.editadoManualmente, false, "documento recém-gerado não é editado à mão");

      const r = esperado(
        await api.patch(`/documents/${doc._id}/texto`, {
          textoResolvido: `${doc.textoResolvido}\n\n${FRASE_A_MAO}`
        }),
        200,
        "edição do texto"
      );

      assert.equal(r.editadoManualmente, true);
      assert.ok(r.textoResolvido.includes(FRASE_A_MAO));
    });

    test("regerar sem confirmarSobrescrita → 409; com ela → 201 e a cadeia se forma", async () => {
      const { modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      const { cliente, processo } = await montarProcesso();
      const original = esperado(
        await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id }),
        201,
        "geração"
      );

      esperado(
        await api.patch(`/documents/${original._id}/texto`, {
          textoResolvido: `${original.textoResolvido}\n\n${FRASE_A_MAO}`
        }),
        200,
        "edição"
      );

      // Sem confirmação: recusa. O trabalho de revisão é justamente a parte
      // que o sistema não sabe refazer.
      const semConfirmar = await gerar(modelo._id, {
        processoId: processo._id,
        clienteId: cliente._id
      });
      assert.equal(semConfirmar.status, 409, `esperado 409, veio ${semConfirmar.status}`);
      assert.match(semConfirmar.body.message, /confirmarSobrescrita/);

      // O texto revisado continua intacto depois do 409.
      const intacto = esperado(await api.get(`/documents/${original._id}`), 200, "releitura");
      assert.ok(intacto.textoResolvido.includes(FRASE_A_MAO), "o 409 mexeu no documento");

      // Com confirmação: gera o novo e encadeia.
      const novo = esperado(
        await gerar(modelo._id, {
          processoId: processo._id,
          clienteId: cliente._id,
          confirmarSobrescrita: true
        }),
        201,
        "regeração confirmada"
      );

      assert.notEqual(String(novo._id), String(original._id), "regerar deveria criar documento novo");
      assert.equal(novo.editadoManualmente, false, "o documento novo nasce não editado");
      assert.ok(!novo.textoResolvido.includes(FRASE_A_MAO), "o novo saiu com a edição do antigo");

      // O antigo sai por soft delete. Como TODA leitura filtra `ativo: true`,
      // ele deixa de ser visível pela API — inclusive por `GET /documents/:id`,
      // que responde 404. Isso é a regra do projeto funcionando, não defeito.
      assert.equal(
        (await api.get(`/documents/${original._id}`)).status,
        404,
        "documento substituído não deveria mais aparecer nas leituras"
      );

      // Por isso a cadeia é conferida onde ela de fato mora. A asserção é sobre
      // o que ficou GRAVADO: `substituidoPorId` apontando para o novo, e o
      // texto revisado preservado — é ele que a cadeia existe para não perder.
      const [anterior] = await acharEm(COLECOES.DOCUMENTS, { _id: new ObjectId(String(original._id)) });

      assert.ok(anterior, "o documento anterior sumiu do banco — soft delete virou hard delete");
      assert.equal(anterior.ativo, false, "o documento anterior deveria sair por soft delete");
      assert.equal(
        String(anterior.substituidoPorId),
        String(novo._id),
        "substituidoPorId não aponta para o documento novo"
      );
      assert.ok(
        anterior.textoResolvido.includes(FRASE_A_MAO),
        "o texto revisado se perdeu — era ele que a cadeia existe para preservar"
      );

      // FATO REPORTADO: hoje NÃO há rota que leia documento inativo, então a
      // cadeia está gravada mas não é navegável pela API. Bate com o
      // `documents.substituidoPorId_1` estar registrado no CLAUDE.md como
      // índice mantido para "a reativação de documento, quando existir" — ou
      // seja, é funcionalidade que ainda não nasceu, não regressão. Não foi
      // corrigido aqui: criar rota de leitura de inativo é decisão de escopo.
    });

    test("O TESTE CENTRAL: o download traz o texto EDITADO, não o recomposto das seções", async () => {
      // A decisão 5 do módulo: depois de gerado, `textoResolvido` é a única
      // fonte da verdade, e os vínculos de seção ficam só como rastreabilidade
      // de origem. Se o renderizador recompusesse a partir das seções, a
      // edição dela sumiria no próximo download, EM SILÊNCIO — e ela só
      // descobriria ao ler a peça já protocolada.
      //
      // Por isso este teste abre o PDF entregue, e não o campo no banco.
      const { secao, modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      const { cliente, processo } = await montarProcesso();
      const doc = esperado(
        await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id }),
        201,
        "geração"
      );

      esperado(
        await api.patch(`/documents/${doc._id}/texto`, {
          textoResolvido: `${doc.textoResolvido}\n\n${FRASE_A_MAO}`
        }),
        200,
        "edição à mão"
      );

      // E a seção de origem muda DEPOIS da edição, para que recompor produza
      // um texto reconhecivelmente diferente.
      esperado(
        await api.patch(`/secoes/${secao._id}`, {
          texto: "TEXTO RECOMPOSTO QUE NAO PODE APARECER NO PDF."
        }),
        200,
        "alteração da seção após a edição"
      );

      const download = await api.get(`/documents/${doc._id}/download?formato=pdf`);
      assert.equal(download.status, 200, `download falhou: ${download.status}`);
      assert.match(download.tipo, /application\/pdf/);
      assert.ok(download.bytes.length > 1000, "PDF pequeno demais para ter conteúdo");
      assert.equal(
        download.bytes.subarray(0, 5).toString("latin1"),
        "%PDF-",
        "o corpo não é um PDF"
      );

      const texto = extrairTextoDoPdf(download.bytes);

      assert.ok(
        texto.includes(FRASE_A_MAO),
        `A FRASE INSERIDA À MÃO NÃO SAIU NO PDF.\nTexto extraído:\n${texto.slice(0, 1500)}`
      );
      assert.ok(
        !texto.includes("TEXTO RECOMPOSTO QUE NAO PODE APARECER"),
        "o PDF foi recomposto a partir da seção — a edição dela seria perdida"
      );

      // ── Canário da extração do timbrado (Fase 4.1) ─────────────────────
      // O cabeçalho e o rodapé saíram de `documentRenderService.js` para
      // `letterheadService.js`, para o recibo usar o mesmo papel. A extração
      // foi declarada refatoração pura, e este teste é o que a mantém honesta:
      // o timbrado tem de continuar saindo NO MESMO PDF que traz o texto
      // editado — se ele sumir, a extração quebrou o documento e não o recibo.
      const usuario = api.usuario;
      assert.ok(
        texto.includes(usuario.nomeCompleto),
        "o timbrado perdeu o nome da advogada depois da extração"
      );
      assert.ok(
        texto.includes(`OAB/${usuario.oab.estado} nº ${usuario.oab.numero}`),
        "o timbrado perdeu a inscrição na OAB depois da extração"
      );
      assert.ok(
        /página 1 de \d+/.test(texto),
        "o rodapé de paginação sumiu depois da extração do timbrado"
      );

      // Deixa o texto extraído na saída: a Parte 10.10 pede ele colado no
      // relatório, e vale mais vindo da execução do que copiado à mão.
      console.log(`\n  ── TEXTO EXTRAÍDO DO PDF (documento editado à mão) ──\n  ${texto.split("\n\n")[0]}\n`);
    });

    test("o DOCX do mesmo documento também traz o texto editado", async () => {
      const { modelo } = await montarModelo(TEXTO_QUALIFICACAO);
      const { cliente, processo } = await montarProcesso();
      const doc = esperado(
        await gerar(modelo._id, { processoId: processo._id, clienteId: cliente._id }),
        201,
        "geração"
      );
      esperado(
        await api.patch(`/documents/${doc._id}/texto`, {
          textoResolvido: `${doc.textoResolvido}\n\n${FRASE_A_MAO}`
        }),
        200,
        "edição"
      );

      const r = await api.get(`/documents/${doc._id}/download?formato=docx`);
      assert.equal(r.status, 200);
      // DOCX é ZIP: os dois primeiros bytes são "PK". O conteúdo em si está
      // deflacionado dentro de `word/document.xml`, e abrir o ZIP à mão não
      // acrescenta nada ao que o PDF já provou.
      assert.equal(r.bytes.subarray(0, 2).toString("latin1"), "PK");
      assert.match(
        r.headers.get("content-disposition") ?? "",
        /attachment/,
        "o download deveria vir como anexo"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5.5 — Variável desconhecida: rejeitada no CADASTRO da seção
  //
  // É no cadastro que a advogada ainda tem contexto para corrigir um
  // {{nomeDoCliente}} que ela quis escrever como {{nomeCliente}}. Descobrir
  // isso meses depois, na hora de gerar a procuração, é tarde.
  // ═════════════════════════════════════════════════════════════════════════

  describe("5.5 variável desconhecida", () => {
    test("é rejeitada ao cadastrar a seção, com 400", async () => {
      const r = await api.post("/secoes", {
        titulo: `Seção com variável inventada ${Date.now()}`,
        tipo: "clausula",
        texto: "O cliente {{nomeDoCliente}} declara que {{variavelQueNaoExiste}}."
      });

      assert.equal(r.status, 400, `esperado 400, veio ${r.status} — ${JSON.stringify(r.body)}`);
      const bruto = JSON.stringify(r.body);
      assert.match(bruto, /nomeDoCliente/, "o erro deveria nomear a variável inválida");
      assert.match(bruto, /variavelQueNaoExiste/, "o erro deveria nomear as duas");
    });

    test("também é rejeitada ao ALTERAR a seção", async () => {
      const secao = await criarSecao(api, { texto: "Texto sem variável." });
      const r = await api.patch(`/secoes/${secao._id}`, {
        texto: "Agora com {{variavelInventadaNoUpdate}}."
      });
      assert.equal(r.status, 400, `esperado 400, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.match(JSON.stringify(r.body), /variavelInventadaNoUpdate/);
    });

    test("as 48 chaves do catálogo são aceitas no cadastro", async () => {
      // Contraprova do teste acima, e guarda do catálogo: se uma chave for
      // renomeada em `templateVariables.js` sem que o parser acompanhe, cai
      // aqui. Também confirma a contagem de 48 em 5 origens — 47 até a Fase
      // 3.2, mais `percentualHonorario`, que a Fase 4.1 acrescentou quando o
      // campo `percentual` finalmente nasceu (DEC-027).
      const chaves = Object.keys(CATALOGO_VARIAVEIS);
      assert.equal(chaves.length, 48, "o catálogo deveria ter 48 chaves");
      assert.deepEqual(
        [...new Set(Object.values(CATALOGO_VARIAVEIS).map((d) => d.origem))].sort(),
        ["cliente", "honorario", "processo", "sistema", "usuario"]
      );

      const secao = await criarSecao(api, {
        texto: chaves.map((c) => `{{${c}}}`).join(" ")
      });

      // `Secao.variaveis` é derivado por hook a partir do texto, nunca entrada
      // do usuário — as 48 têm de aparecer lá.
      assert.equal(secao.variaveis.length, 48, "o hook não extraiu as 48 variáveis");
      assert.deepEqual([...secao.variaveis].sort(), [...chaves].sort());
    });

    test("GET /documents/variaveis publica as 48, com rótulo e descrição", async () => {
      // A guarda `assertCatalogoRotulado()` roda na CARGA do módulo e derruba o
      // processo se faltar rótulo — ou seja, se ela estivesse falhando, este
      // arquivo não teria nem subido. O que se afirma aqui é o contrato que a
      // tela consome: total, agrupamento e nenhum campo vazio.
      const r = esperado(await api.get("/documents/variaveis"), 200, "catálogo");

      assert.equal(r.total, 48, "o catálogo publicado deveria ter 48 chaves");
      assert.equal(
        r.grupos.reduce((soma, g) => soma + g.total, 0), 48,
        "a soma dos grupos não bate com o total"
      );

      const honorario = r.grupos.find((g) => g.origem === "honorario");
      assert.equal(honorario.total, 7, "a origem `honorario` foi de 6 para 7 na Fase 4.1");
      assert.ok(
        honorario.variaveis.some((v) => v.chave === "percentualHonorario"),
        "`percentualHonorario` não apareceu no grupo Honorário"
      );

      for (const grupo of r.grupos) {
        for (const v of grupo.variaveis) {
          assert.ok(v.rotulo?.trim(), `${v.chave} sem rótulo`);
          assert.ok(v.descricao?.trim(), `${v.chave} sem descrição`);
          // Rótulo derivado da chave é o que a Fase 2D.1 proibiu: funciona e
          // parece amador.
          assert.notEqual(v.rotulo, v.chave, `${v.chave} tem a chave crua como rótulo`);
        }
      }

      console.log(
        `\n  ── GRUPO HONORÁRIO (${honorario.total} de ${r.total}) ──\n` +
        honorario.variaveis.map((v) => `     ${v.chave} — ${v.rotulo}: ${v.descricao}`).join("\n") + "\n"
      );
    });
  });
});
