// ═══════════════════════════════════════════════════════════════════════════
// MENSAGENS QUE ORIENTAM — e a prova de que a orientação é EXECUTÁVEL
//
// Fase 4.6. O princípio da fase: toda pendência responde três perguntas — o que
// falta, por quê, e onde/como resolver — e **a ação sugerida tem de funcionar
// de verdade**.
//
// ── Por que "prova anti-beco" e não só "a mensagem mudou" ─────────────────
// Uma asserção de texto prova que a frase existe. Não prova que seguir a frase
// leva a algum lugar — e era exatamente esse o defeito: as mensagens antigas
// estavam gramaticalmente corretas e mandavam a advogada a lugares onde a ação
// era impossível.
//
//   "Preencha 'CNPJ' no cadastro do cliente"        → cliente PF não tem CNPJ,
//                                                     e o hook o apagaria
//   "Preencha 'Percentual' no honorário"            → o hook do Fee responde 400
//   "Preencha 'Valor da parcela' no honorário"      → esse campo não existe
//
// Por isso cada bloco abaixo termina SEGUINDO a orientação nova até o **201**.
// Se a orientação deixar de ser executável, o teste cai no passo final, e não
// numa comparação de string.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarClientePJ, criarProcesso,
  criarHonorario, criarParcela, criarSecao, criarModelo, vincularSecao, esperado
} from "../helpers/setup.js";
import { MOTIVO_PENDENCIA } from "../../src/config/templateVariables.js";

const unico = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

describe("mensagens do módulo de documentos — cada orientação é executável", () => {
  let api;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("mensagens");
    // Perfil completo: nenhuma pendência de origem `usuario` deve poluir os
    // casos abaixo, que são todos sobre cliente e honorário.
    esperado(
      await api.patch("/auth/me", {
        telefone: "42999990000",
        advocacia: { nome: "Advocacia Teste", chavePix: "pix@lex.dev" },
        endereco: { cep: "84010330", estado: "PR", cidade: "Ponta Grossa", logradouro: "Rua A", numero: "1" }
      }),
      200, "perfil completo"
    );
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const modeloComTexto = async (texto, tipo = "procuracao") => {
    const secao = await criarSecao(api, {
      titulo: `Seção ${unico()}`, tipo: "qualificacao", texto
    });
    const modelo = await criarModelo(api, { nome: `Modelo ${unico()}`, tipo });
    await vincularSecao(api, modelo._id, secao._id);
    return modelo;
  };

  const gerar = (modeloId, corpo) =>
    api.post(`/documents/modelos/${modeloId}/gerar`, corpo);

  const pendenciasDe = (r) => r.body?.errors?.pendencias ?? [];

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — MODELO PJ × CLIENTE PF (o caso que abriu a fase)
  // ═════════════════════════════════════════════════════════════════════════
  describe("conflito de tipo de pessoa", () => {
    test("modelo PJ gerado para cliente PF: a pendência diz a CAUSA, não 'preencha'", async () => {
      const pf = await criarClientePF(api);
      const processo = await criarProcesso(api, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);
      const modelo = await modeloComTexto(
        "A empresa {{razaoSocialCliente}}, CNPJ {{cnpjCliente}}, neste ato representada " +
        "por {{representanteLegalNome}}, outorga poderes."
      );

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: pf._id });
      assert.equal(r.status, 422, `esperado 422 — veio ${r.status} ${JSON.stringify(r.body)}`);

      const pendencias = pendenciasDe(r);
      assert.ok(pendencias.length >= 3, "as três variáveis de PJ precisam aparecer");

      for (const p of pendencias) {
        assert.equal(
          p.motivo, MOTIVO_PENDENCIA.TIPO_INCOMPATIVEL,
          `${p.variavel}: o motivo precisa ser tipoIncompativel, e não campoVazio`
        );
        assert.equal(p.tipoVariavel, "pj");
        assert.equal(p.tipoCliente, "fisica");

        // A frase NÃO pode mandar preencher: o campo não existe naquele
        // cadastro, e o hook do Client o apagaria se existisse.
        assert.ok(
          !/^Preencha/.test(p.orientacao),
          `${p.variavel}: a orientação ainda manda "preencher" um campo impossível — "${p.orientacao}"`
        );
        assert.match(p.orientacao, /pessoa jurídica/i, "diz de que tipo é a variável");
        assert.match(p.orientacao, /pessoa física/i, "diz de que tipo é o cliente");
        assert.match(p.orientacao, /[Vv]incule|modelo/, "propõe uma ação de verdade");
      }
    });

    test("o espelho: modelo PF gerado para cliente PJ", async () => {
      const pj = await criarClientePJ(api);
      const processo = await criarProcesso(api, [
        { clienteId: pj._id, papel: "autor", principal: true }
      ]);
      const modelo = await modeloComTexto(
        "{{nomeCliente}}, {{estadoCivilCliente}}, portador do CPF {{cpfCliente}}."
      );

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: pj._id });
      assert.equal(r.status, 422);

      const pendencias = pendenciasDe(r);
      for (const p of pendencias) {
        assert.equal(p.motivo, MOTIVO_PENDENCIA.TIPO_INCOMPATIVEL);
        assert.equal(p.tipoVariavel, "pf");
        assert.equal(p.tipoCliente, "juridica");
      }
    });

    test("a pendência nomeia o cliente escolhido, não 'o cliente'", async () => {
      const pf = await criarClientePF(api, { nomeCompleto: "Joana Ribeiro Alves" });
      const processo = await criarProcesso(api, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);
      const modelo = await modeloComTexto("CNPJ {{cnpjCliente}}.");

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: pf._id });
      const [p] = pendenciasDe(r);
      assert.match(
        p.orientacao, /Joana Ribeiro Alves/,
        "num litisconsórcio a advogada precisa saber DE QUAL participante se fala"
      );
    });

    // ── PROVA ANTI-BECO ───────────────────────────────────────────────────
    test("ANTI-BECO: seguir a orientação (vincular um cliente PJ e gerar) chega ao 201", async () => {
      const pf = await criarClientePF(api);
      const processo = await criarProcesso(api, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);
      const modelo = await modeloComTexto(
        "A empresa {{razaoSocialCliente}}, CNPJ {{cnpjCliente}}, outorga poderes."
      );

      const recusado = await gerar(modelo._id, { processoId: processo._id, clienteId: pf._id });
      assert.equal(recusado.status, 422, "o arranjo precisa começar recusado");

      // A orientação diz: "Vincule um cliente pessoa jurídica a este processo e
      // gere para ele". É exatamente isto, e nada além disto:
      const pj = await criarClientePJ(api);
      esperado(
        await api.post(`/processes/${processo._id}/clientes`, {
          clienteId: pj._id, papel: "litisconsorte", principal: false
        }),
        201, "vínculo do cliente PJ"
      );

      const r = await gerar(modelo._id, { processoId: processo._id, clienteId: pj._id });
      esperado(r, 201, "geração para o cliente PJ — a orientação tem de levar ao sucesso");
      assert.match(r.body.textoResolvido, /CNPJ \d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — `percentualHonorario` num honorário que não admite percentual
  // ═════════════════════════════════════════════════════════════════════════
  describe("percentual em honorário fixo", () => {
    const arranjo = async () => {
      const pf = await criarClientePF(api);
      const processo = await criarProcesso(api, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);
      const honorario = await criarHonorario(api, processo._id, {
        valor: 5000, tipo: "fixo", descricao: `Fixo ${unico()}`
      });
      const modelo = await modeloComTexto(
        "Honorários de {{percentualHonorario}} sobre o proveito.",
        "contrato_prestacao_servicos"
      );
      return { pf, processo, honorario, modelo };
    };

    test("a orientação diz o tipo atual e a saída real", async () => {
      const { processo, modelo } = await arranjo();

      const r = await gerar(modelo._id, { processoId: processo._id });
      assert.equal(r.status, 422);

      const [p] = pendenciasDe(r);
      assert.equal(p.motivo, MOTIVO_PENDENCIA.TIPO_HONORARIO_INCOMPATIVEL);
      assert.equal(p.tipoHonorario, "fixo");
      assert.ok(
        !/^Preencha/.test(p.orientacao),
        `a orientação antiga mandava preencher, e preencher devolve 400 — "${p.orientacao}"`
      );
      assert.match(p.orientacao, /tipo fixo/i);
      assert.match(p.orientacao, /valor base/i, "a troca de tipo exige valorBase — a frase precisa avisar");
    });

    test("a orientação ANTIGA levava a 400 — a contraprova do beco", async () => {
      const { honorario } = await arranjo();
      // "Preencha o percentual no honorário", ao pé da letra:
      const r = await api.patch(`/fees/${honorario._id}`, { percentual: 20 });
      assert.equal(
        r.status, 400,
        "se isto passasse a funcionar, a orientação antiga deixaria de ser um beco e este teste perde o sentido"
      );
    });

    // ── PROVA ANTI-BECO ───────────────────────────────────────────────────
    test("ANTI-BECO: seguir a orientação (mudar o tipo com percentual e valorBase) chega ao 201", async () => {
      const { processo, honorario, modelo } = await arranjo();

      const recusado = await gerar(modelo._id, { processoId: processo._id });
      assert.equal(recusado.status, 422, "o arranjo precisa começar recusado");

      // A orientação diz: "Mude o tipo para percentual (informando percentual e
      // valor base) em Honorários".
      esperado(
        await api.patch(`/fees/${honorario._id}`, {
          tipo: "percentual", percentual: 12.5, valorBase: 40000
        }),
        200, "troca de tipo com percentual e valor base"
      );

      const r = await gerar(modelo._id, { processoId: processo._id });
      esperado(r, 201, "a orientação tem de levar ao sucesso");
      assert.match(r.body.textoResolvido, /12,5%/);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — `valorParcela` com parcelas desiguais
  // ═════════════════════════════════════════════════════════════════════════
  describe("valor da parcela com parcelas desiguais", () => {
    test("a mensagem dá a causa real e NÃO cita um campo inexistente", async () => {
      const pf = await criarClientePF(api);
      const processo = await criarProcesso(api, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);
      const honorario = await criarHonorario(api, processo._id, {
        valor: 5000, tipo: "fixo", descricao: `Desiguais ${unico()}`
      });
      await criarParcela(api, honorario._id, 1, { valor: 3000 });
      await criarParcela(api, honorario._id, 2, { valor: 2000 });

      const modelo = await modeloComTexto(
        "Pagamento em {{numeroParcelas}} parcelas de {{valorParcela}}.",
        "contrato_prestacao_servicos"
      );

      const r = await gerar(modelo._id, { processoId: processo._id });
      assert.equal(r.status, 422);

      const [p] = pendenciasDe(r);
      assert.equal(p.motivo, MOTIVO_PENDENCIA.PARCELAS_DESIGUAIS);
      assert.match(p.orientacao, /valores diferentes/i, "a causa real");
      assert.ok(
        !/Preencha "Valor da parcela"/.test(p.orientacao),
        'a orientação antiga mandava preencher "Valor da parcela", campo que não existe no honorário'
      );
    });

    // ── PROVA ANTI-BECO ───────────────────────────────────────────────────
    test("ANTI-BECO: igualar os valores das parcelas chega ao 201", async () => {
      const pf = await criarClientePF(api);
      const processo = await criarProcesso(api, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);
      const honorario = await criarHonorario(api, processo._id, {
        valor: 6000, tipo: "fixo", descricao: `Igualar ${unico()}`
      });
      const p1 = await criarParcela(api, honorario._id, 1, { valor: 4000 });
      await criarParcela(api, honorario._id, 2, { valor: 2000 });

      const modelo = await modeloComTexto(
        "Pagamento em {{numeroParcelas}} parcelas de {{valorParcela}}.",
        "contrato_prestacao_servicos"
      );

      const recusado = await gerar(modelo._id, { processoId: processo._id });
      assert.equal(recusado.status, 422, "o arranjo precisa começar recusado");

      // A orientação diz: "Deixe as parcelas com o mesmo valor em Parcelas".
      esperado(
        await api.patch(`/installments/${p1._id}`, { valor: 2000 }),
        200, "igualar o valor da parcela 1"
      );

      const r = await gerar(modelo._id, { processoId: processo._id });
      esperado(r, 201, "a orientação tem de levar ao sucesso");
      assert.match(r.body.textoResolvido, /2 parcelas de R\$/);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4 — Variável fora do catálogo sugere a próxima (item 2.4)
  // ═════════════════════════════════════════════════════════════════════════
  describe("variável fora do catálogo", () => {
    test("sugere a chave certa quando há candidata próxima", async () => {
      const r = await api.post("/secoes", {
        titulo: `Erro de digitação ${unico()}`,
        tipo: "outro",
        texto: "Assinado por {{nomeAdvogado}}."
      });

      assert.equal(r.status, 400);
      assert.match(
        r.body.message, /você quis dizer \{\{nomeAdvogada\}\}\?/i,
        `a sugestão não veio — "${r.body.message}"`
      );
    });

    test("sem candidata próxima, aponta o grupo provável", async () => {
      const r = await api.post("/secoes", {
        titulo: `Sem candidata ${unico()}`,
        tipo: "outro",
        texto: "Valor {{xyzInexistenteCliente}}."
      });

      assert.equal(r.status, 400);
      assert.match(r.body.message, /cadastro do cliente/i, "aponta o grupo pelo sufixo");
    });

    // ── PROVA ANTI-BECO ───────────────────────────────────────────────────
    test("ANTI-BECO: usar a chave sugerida cria a seção", async () => {
      const errado = await api.post("/secoes", {
        titulo: `Anti-beco ${unico()}`,
        tipo: "outro",
        texto: "Assinado por {{nomeAdvogado}}."
      });
      assert.equal(errado.status, 400);

      const sugerida = errado.body.message.match(/\{\{(\w+)\}\}\?/)?.[1];
      assert.equal(sugerida, "nomeAdvogada", "a mensagem precisa conter a chave sugerida, legível por quem lê");

      esperado(
        await api.post("/secoes", {
          titulo: `Anti-beco corrigido ${unico()}`,
          tipo: "outro",
          texto: `Assinado por {{${sugerida}}}.`
        }),
        201, "a chave sugerida tem de ser aceita"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5 — 422 de modelo sem seções, com corpo padronizado (item 2.5)
  // ═════════════════════════════════════════════════════════════════════════
  test("modelo sem seções responde 422 com `errors.pendencias`, como os demais", async () => {
    const pf = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
    const modelo = await criarModelo(api, { nome: `Vazio ${unico()}`, tipo: "procuracao" });

    const r = await gerar(modelo._id, { processoId: processo._id });
    assert.equal(r.status, 422);

    const pendencias = pendenciasDe(r);
    assert.equal(pendencias.length, 1, "o 422 precisa trazer `errors.pendencias`, como todos os outros do módulo");
    assert.match(pendencias[0].orientacao, /seção/i);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6 — `POST /fees` respeita o default de `status` (item 2.6)
  // ═════════════════════════════════════════════════════════════════════════
  test("criar honorário sem `status` funciona e nasce `pendente`", async () => {
    const pf = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);

    const r = await api.post("/fees", {
      processoId: processo._id,
      descricao: `Sem status ${unico()}`,
      valor: 1000,
      tipo: "fixo",
      dataVencimento: "2099-12-31"
    });

    const fee = esperado(r, 201, "criação sem `status` — o schema tem default");
    assert.equal(fee.status, "pendente", "honorário sem parcela é `pendente`, nunca `pago`");
  });

  test("`status` inválido continua sendo recusado", async () => {
    const pf = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);

    const r = await api.post("/fees", {
      processoId: processo._id,
      descricao: `Status inválido ${unico()}`,
      valor: 1000,
      tipo: "fixo",
      status: "quitadissimo",
      dataVencimento: "2099-12-31"
    });

    assert.equal(r.status, 400, "mudou a obrigatoriedade, não a validação");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7 — Tela E campo em TODA orientação de cadastro (item 2.7)
  // ═════════════════════════════════════════════════════════════════════════
  test("orientação de campo vazio nomeia a tela e o campo", async () => {
    // Perfil VAZIO de propósito: a fábrica preenche endereço e PIX para que a
    // geração não caia em 422 por acidente, e aqui é justamente o 422 que se
    // quer. Sobrescreve só o que a origem `usuario` consome nesta seção.
    const outro = await registrarUsuario("perfil-vazio", {
      endereco: {},
      advocacia: { nome: "Advocacia Sem Pix" }
    });
    const pf = await criarClientePF(outro);
    const processo = await criarProcesso(outro, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);

    const secao = await criarSecao(outro, {
      titulo: `Escritório ${unico()}`,
      tipo: "qualificacao",
      texto: "Escritório em {{enderecoEscritorio}}, cidade de {{cidadeEscritorio}}, PIX {{chavePix}}."
    });
    const modelo = await criarModelo(outro, { nome: `Perfil ${unico()}`, tipo: "procuracao" });
    await vincularSecao(outro, modelo._id, secao._id);

    const r = await outro.post(`/documents/modelos/${modelo._id}/gerar`, {
      processoId: processo._id
    });
    assert.equal(r.status, 422);

    for (const p of pendenciasDe(r)) {
      assert.equal(p.motivo, MOTIVO_PENDENCIA.CAMPO_VAZIO);
      assert.match(
        p.orientacao, /Perfil →/,
        `${p.variavel}: a orientação precisa dar o caminho até o campo — "${p.orientacao}"`
      );
    }
  });
});
