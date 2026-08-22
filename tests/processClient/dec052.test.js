// ═══════════════════════════════════════════════════════════════════════════
// DEC-052 — A CASCATA REGISTRA O QUE DERRUBOU
//
// ── O achado que bloqueou a Parte 4 da F-2a ─────────────────────────────
// Desativar um processo derruba os vínculos dele junto. Até a F-2b essa cascata
// gravava **o mesmo `ativo: false`** que a remoção manual de um participante
// grava, e depois do fato os dois estados eram indistinguíveis.
//
// Na hora de reativar, o sistema via três vínculos desativados e não sabia qual
// caiu por cascata e qual a advogada tirou de propósito. As duas saídas
// possíveis eram erradas:
//
//   restaurar todos   → devolve gente que a advogada removeu de propósito
//   restaurar nenhum  → devolve um processo VAZIO, estado que o próprio sistema
//                       declara impossível
//
// ── A regra ──────────────────────────────────────────────────────────────
// **Estado passado não se infere, se registra.** Terceira vez que este projeto
// chega a essa conclusão — o estorno guarda que desfez, a linha do extrato que
// deixou de valer DIZ que deixou (DEC-044), e agora a cascata marca o que
// derrubou.
//
// ── O cenário que este arquivo usa ──────────────────────────────────────
// Três participantes: um principal e dois comuns. Um dos comuns é removido
// À MÃO antes da desativação. É esse participante que separa uma implementação
// correta de uma que "restaura tudo" — sem ele, os dois comportamentos são
// indistinguíveis, e o teste passaria em cima do defeito.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";
import ProcessoCliente from "../../src/models/ProcessoCliente.js";
import Process from "../../src/models/Process.js";

describe("DEC-052 — reativação restaura só o que a cascata derrubou", () => {
  let api;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("dec052");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  let contador = 0;
  const novosClientes = async (n) => {
    const criados = [];
    for (let i = 0; i < n; i += 1) {
      contador += 1;
      criados.push(await criarClientePF(api, { nomeCompleto: `Participante ${contador}` }));
    }
    return criados;
  };

  // Processo com 3 participantes: `principal`, `fica` e `removido`.
  const montarCenario = async () => {
    const [principal, fica, removido] = await novosClientes(3);
    const processo = await criarProcesso(api, [
      { clienteId: principal._id, papel: "autor", principal: true },
      { clienteId: fica._id, papel: "litisconsorte", principal: false },
      { clienteId: removido._id, papel: "reu", principal: false }
    ]);
    return { processo, principal, fica, removido };
  };

  const vinculoDe = (processoId, clienteId) =>
    ProcessoCliente.findOne({ processoId, clienteId });

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — A distinção existe
  // ═════════════════════════════════════════════════════════════════════════

  test("vínculo caído por cascata é distinguível do removido à mão", async () => {
    const { processo, fica, removido } = await montarCenario();

    esperado(
      await api.delete(`/processes/${processo._id}/clientes/${removido._id}`),
      200,
      "remoção manual do participante"
    );

    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação do processo");

    const manual = await vinculoDe(processo._id, removido._id);
    const cascata = await vinculoDe(processo._id, fica._id);

    // Os DOIS estão inativos — era exatamente isso que tornava o estado
    // ambíguo antes da DEC-052.
    assert.equal(manual.ativo, false);
    assert.equal(cascata.ativo, false);

    // E agora se distinguem.
    assert.equal(
      manual.desativadoPorCascataDe, null,
      "removido à mão NÃO leva marca de cascata"
    );
    assert.equal(
      String(cascata.desativadoPorCascataDe), String(processo._id),
      "caído por cascata leva o id do processo que o derrubou"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — A reativação usa a distinção
  // ═════════════════════════════════════════════════════════════════════════

  test("reativar restaura SÓ os da cascata; o removido à mão continua fora", async () => {
    const { processo, principal, fica, removido } = await montarCenario();

    esperado(
      await api.delete(`/processes/${processo._id}/clientes/${removido._id}`),
      200,
      "remoção manual"
    );
    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação");

    const corpo = esperado(
      await api.patch(`/processes/${processo._id}/reactivate`),
      200,
      "reativação"
    );

    assert.equal(corpo.processo.ativo, true, "o processo voltou");

    assert.equal((await vinculoDe(processo._id, principal._id)).ativo, true, "o principal voltou");
    assert.equal((await vinculoDe(processo._id, fica._id)).ativo, true, "o litisconsorte voltou");

    // A linha que separa o certo do "restaura tudo".
    assert.equal(
      (await vinculoDe(processo._id, removido._id)).ativo, false,
      "o removido À MÃO não pode ressuscitar — a advogada o tirou de propósito"
    );
  });

  test("a marca é LIMPA na reativação — vínculo restaurado volta a ser comum", async () => {
    const { processo, fica } = await montarCenario();

    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação");
    esperado(await api.patch(`/processes/${processo._id}/reactivate`), 200, "reativação");

    const vinculo = await vinculoDe(processo._id, fica._id);
    assert.equal(vinculo.ativo, true);
    assert.equal(
      vinculo.desativadoPorCascataDe, null,
      "marca não limpa faria este vínculo ressuscitar sozinho na próxima reativação"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — O ciclo, que é o que expõe marca não limpa
  // ═════════════════════════════════════════════════════════════════════════

  test("desativar → reativar → desativar → reativar", async () => {
    const { processo, principal, fica, removido } = await montarCenario();

    esperado(
      await api.delete(`/processes/${processo._id}/clientes/${removido._id}`),
      200,
      "remoção manual, antes de tudo"
    );

    for (const volta of [1, 2]) {
      esperado(await api.delete(`/processes/${processo._id}`), 200, `desativação ${volta}`);
      esperado(await api.patch(`/processes/${processo._id}/reactivate`), 200, `reativação ${volta}`);

      assert.equal(
        (await vinculoDe(processo._id, principal._id)).ativo, true,
        `ciclo ${volta}: o principal voltou`
      );
      assert.equal(
        (await vinculoDe(processo._id, fica._id)).ativo, true,
        `ciclo ${volta}: o litisconsorte voltou`
      );
      assert.equal(
        (await vinculoDe(processo._id, removido._id)).ativo, false,
        `ciclo ${volta}: o removido à mão CONTINUA fora`
      );
    }
  });

  test("remover à mão DEPOIS de um ciclo continua sendo remoção manual", async () => {
    // O caso que a marca não limpa estragaria: o vínculo passou por uma
    // cascata, voltou, e só então foi removido de propósito. Se ele tivesse
    // guardado a marca velha, voltaria sozinho na reativação seguinte.
    const { processo, fica } = await montarCenario();

    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação 1");
    esperado(await api.patch(`/processes/${processo._id}/reactivate`), 200, "reativação 1");

    esperado(
      await api.delete(`/processes/${processo._id}/clientes/${fica._id}`),
      200,
      "agora sim, remoção manual"
    );

    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação 2");
    esperado(await api.patch(`/processes/${processo._id}/reactivate`), 200, "reativação 2");

    assert.equal(
      (await vinculoDe(processo._id, fica._id)).ativo, false,
      "removido à mão depois do ciclo não pode voltar"
    );
  });

  test("INVARIANTE: nenhum vínculo ATIVO carrega marca de cascata", () => {
    // O que o campo SIGNIFICA: "estou fora por causa da cascata do processo X".
    // Um vínculo ativo carregando a marca é uma mentira sobre o estado atual —
    // ainda que hoje ela seja inofensiva, porque `desvincularCliente` também
    // zera a marca ao remover à mão (a rede de segurança).
    //
    // Este teste trava o SIGNIFICADO, e não uma consequência. É o que sobra de
    // guarda se alguém tirar a rede de `desvincularCliente` um dia.
    return (async () => {
      const { processo, fica } = await montarCenario();

      esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação");
      esperado(await api.patch(`/processes/${processo._id}/reactivate`), 200, "reativação");

      const mentirosos = await ProcessoCliente.find({
        ativo: true,
        desativadoPorCascataDe: { $ne: null }
      }).select("_id processoId clienteId");

      assert.deepEqual(
        mentirosos.map((v) => String(v._id)), [],
        "vínculo ativo com marca de cascata mente sobre o próprio estado"
      );
      assert.equal((await vinculoDe(processo._id, fica._id)).ativo, true);
    })();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4 — A cascata é transacional
  // ═════════════════════════════════════════════════════════════════════════

  test("cascata transacional: se os vínculos falharem, o processo NÃO fica desativado", async () => {
    const { processo, principal } = await montarCenario();

    // Faz a escrita dos vínculos explodir DENTRO da transação. É a única forma
    // de exercitar o rollback sem esperar uma falha real de rede.
    const original = ProcessoCliente.updateMany;
    ProcessoCliente.updateMany = () => {
      throw new Error("falha simulada na cascata");
    };

    let explodiu = false;
    try {
      await api.delete(`/processes/${processo._id}`);
    } catch {
      explodiu = true;
    } finally {
      ProcessoCliente.updateMany = original;
    }

    // A rota responde 500 (o erro sobe pelo errorHandler) OU a chamada estoura;
    // o que importa é o ESTADO depois.
    void explodiu;

    const depois = await Process.findById(processo._id).select("ativo historicoAtivacao");
    assert.equal(
      depois.ativo, true,
      "cascata pela metade é pior que cascata nenhuma: o processo tem de continuar ATIVO"
    );
    assert.equal(
      depois.historicoAtivacao.length, 0,
      "o histórico não pode registrar uma desativação que não aconteceu"
    );
    assert.equal(
      (await vinculoDe(processo._id, principal._id)).ativo, true,
      "nenhum vínculo caiu"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5 — O histórico
  // ═════════════════════════════════════════════════════════════════════════

  test("as duas operações ficam no histórico, com a contagem de vínculos", async () => {
    const { processo, removido } = await montarCenario();

    esperado(
      await api.delete(`/processes/${processo._id}/clientes/${removido._id}`),
      200,
      "remoção manual"
    );
    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação");
    esperado(await api.patch(`/processes/${processo._id}/reactivate`), 200, "reativação");

    const { historicoAtivacao } = await Process.findById(processo._id).select("historicoAtivacao");

    assert.equal(historicoAtivacao.length, 2);
    assert.equal(historicoAtivacao[0].acao, "desativacao");
    assert.equal(historicoAtivacao[1].acao, "reativacao");

    // 2, e não 3: o removido à mão já estava fora quando a cascata rodou.
    assert.equal(historicoAtivacao[0].vinculosAfetados, 2, "caíram 2, não 3");
    assert.equal(historicoAtivacao[1].vinculosAfetados, 2, "voltaram os mesmos 2");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6 — O preview que a tela mostra antes de confirmar
  // ═════════════════════════════════════════════════════════════════════════

  test("o preview diz quantos caem, e depois quantos voltam", async () => {
    const { processo, removido } = await montarCenario();

    esperado(
      await api.delete(`/processes/${processo._id}/clientes/${removido._id}`),
      200,
      "remoção manual"
    );

    const antes = esperado(
      await api.get(`/processes/${processo._id}/activation-preview`),
      200,
      "preview com processo ativo"
    );
    assert.equal(antes.ativo, true);
    assert.equal(antes.vinculosAfetados, 2, "vão cair 2");

    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação");

    const depois = esperado(
      await api.get(`/processes/${processo._id}/activation-preview`),
      200,
      "preview com processo desativado"
    );
    assert.equal(depois.ativo, false);
    assert.equal(depois.vinculosAfetados, 2, "voltam 2 — não os 3 desativados");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7 — Sem cascata para cima: cliente e processo se reativam por si
  // ═════════════════════════════════════════════════════════════════════════

  test("reativar cliente NÃO reativa os processos dele", async () => {
    const [cliente] = await novosClientes(1);
    const processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);

    // O processo precisa sair primeiro: `deleteClient` recusa desativar cliente
    // que participa de processo ativo.
    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação do processo");
    esperado(await api.delete(`/clients/${cliente._id}`), 200, "desativação do cliente");

    const corpo = esperado(
      await api.patch(`/clients/${cliente._id}/reactivate`),
      200,
      "reativação do cliente"
    );

    assert.equal(corpo.cliente.ativo, true, "o cliente voltou");
    assert.match(
      corpo.aviso, /processos/i,
      "a resposta precisa avisar que os processos NÃO voltaram — senão a tela não tem o que dizer"
    );

    const depois = await Process.findById(processo._id).select("ativo");
    assert.equal(
      depois.ativo, false,
      "o processo continua desativado: cada registro se reativa por si"
    );
  });

  test("reativar o que já está ativo é 404, não 200 silencioso", async () => {
    const { processo } = await montarCenario();

    // 200 aqui esconderia que a tela ofereceu uma ação que não existia.
    esperado(
      await api.patch(`/processes/${processo._id}/reactivate`),
      404,
      "reativar processo ativo"
    );

    const [cliente] = await novosClientes(1);
    esperado(
      await api.patch(`/clients/${cliente._id}/reactivate`),
      404,
      "reativar cliente ativo"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 8 — Os desativados precisam ser ALCANÇÁVEIS, senão nada disso tem tela
  // ═════════════════════════════════════════════════════════════════════════

  test("a listagem sabe mostrar os desativados, e o padrão não mudou", async () => {
    const { processo } = await montarCenario();
    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativação");

    const idsDe = (corpo) => (corpo.data ?? corpo).map((p) => String(p._id));

    const padrao = esperado(await api.get("/processes"), 200, "listagem padrão");
    assert.ok(
      !idsDe(padrao).includes(String(processo._id)),
      "o padrão continua escondendo desativado — nada mudou para quem não pede"
    );

    const inativos = esperado(
      await api.get("/processes?situacao=inativos"), 200, "listagem de inativos"
    );
    assert.ok(
      idsDe(inativos).includes(String(processo._id)),
      "sem isto, a reativação não teria linha onde acontecer"
    );

    const todos = esperado(await api.get("/processes?situacao=todos"), 200, "listagem completa");
    assert.ok(idsDe(todos).includes(String(processo._id)));
  });

  test("situação inválida é 400 com `campo`, não uma lista errada em silêncio", async () => {
    // `?situacao=ativas` (feminino, plural errado) devolveria os ativos e a
    // advogada concluiria que não há desativados.
    const r = await api.get("/processes?situacao=ativas");
    assert.equal(r.status, 400);
    assert.equal(r.body.campo, "situacao");

    const c = await api.get("/clients?situacao=qualquer");
    assert.equal(c.status, 400);
    assert.equal(c.body.campo, "situacao");
  });

  test("a listagem de clientes também sabe mostrar os desativados", async () => {
    const [cliente] = await novosClientes(1);
    esperado(await api.delete(`/clients/${cliente._id}`), 200, "desativação do cliente");

    const idsDe = (corpo) => (corpo.data ?? corpo).map((c) => String(c._id));

    const padrao = esperado(await api.get("/clients"), 200, "padrão");
    assert.ok(!idsDe(padrao).includes(String(cliente._id)));

    const inativos = esperado(await api.get("/clients?situacao=inativos"), 200, "inativos");
    assert.ok(idsDe(inativos).includes(String(cliente._id)));
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 9 — Os campos novos não entram por PATCH
  // ═════════════════════════════════════════════════════════════════════════

  test("`historicoAtivacao` e `ativo` continuam fora da allowlist de update", async () => {
    const { processo } = await montarCenario();

    for (const corpo of [
      { ativo: false },
      { historicoAtivacao: [{ acao: "desativacao", data: new Date() }] }
    ]) {
      const r = await api.patch(`/processes/${processo._id}`, corpo);
      assert.ok(
        r.status >= 400,
        `PATCH com ${Object.keys(corpo)[0]} precisa ser recusado — reabri-lo devolveria a porta que a Fase 4.5 fechou`
      );
    }

    const depois = await Process.findById(processo._id).select("ativo historicoAtivacao");
    assert.equal(depois.ativo, true);
    assert.equal(depois.historicoAtivacao.length, 0);
  });
});
