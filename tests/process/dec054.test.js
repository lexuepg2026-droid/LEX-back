// ═══════════════════════════════════════════════════════════════════════════
// DEC-054 — AS FASES DO PROCESSO, NO VOCABULÁRIO DA LAÍS (F-2d)
//
// ── O que este arquivo trava ─────────────────────────────────────────────
// Quase tudo aqui é uma AUSÊNCIA, e é por isso que os testes existem: as
// regras que a Laís **não** pediu são as que voltam sozinhas na próxima fase,
// sob o nome de "coerência".
//
//   • as quatro fases, e a transição em QUALQUER direção — inclusive
//     recursos → conhecimento. *"Sim, pode voltar."*
//   • motivo OPCIONAL. *"Não precisa anotar o porquê, só se ela quiser mesmo."*
//   • mas a TRANSIÇÃO é sempre registrada, com de → para, data e autor. Não é
//     o "porquê" que ela dispensou: é o substrato da linha do tempo que ela
//     pediu, e sem gravar agora a linha do tempo nasce sem passado.
//   • o encerramento é INDEPENDENTE da fase: transita em julgado a partir de
//     qualquer uma das quatro.
//   • liminar não altera fase e não é exigida por nada.
//
// ── As duas mutações obrigatórias da fase ────────────────────────────────
// (a) travar recursos → conhecimento;
// (b) tornar o motivo obrigatório.
// As duas precisam derrubar teste — são exatamente as regras que ela NÃO
// pediu. Os testes que caem estão marcados no corpo, um por mutação.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";
import { FASES_PROCESSO, FASE_PADRAO } from "../../src/config/fasesProcesso.js";

describe("DEC-054 — fase, encerramento e liminar", () => {
  let api;
  let cliente;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("dec054");
    cliente = await criarClientePF(api, { nomeCompleto: "Marina Duarte Silva" });
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const novoProcesso = (extra = {}) =>
    criarProcesso(api, [{ clienteId: cliente._id, papel: "autor", principal: true }], extra);

  const mudarFase = (id, corpo) => api.patch(`/processes/${id}/fase`, corpo);

  // ═══════════════════════════════════════════════════════════════════════
  // O VOCABULÁRIO
  // ═══════════════════════════════════════════════════════════════════════

  describe("as quatro fases", () => {
    test("são exatamente as quatro que ela citou, e nada mais", () => {
      // Uma quinta fase inventada — "liminar", "trânsito em julgado",
      // "arquivado" — cai aqui. Liminar é sinalizador e trânsito em julgado é
      // o outro eixo; nenhum dos dois compete com "execução" numa lista.
      assert.deepEqual(FASES_PROCESSO, [
        "conhecimento",
        "sentenca",
        "execucao",
        "recursos"
      ]);
    });

    test("o processo nasce na fase padrão quando ela não é informada", async () => {
      const processo = await novoProcesso();
      assert.equal(processo.fase, FASE_PADRAO);
      assert.equal(processo.fase, "conhecimento");
    });

    test("o processo pode NASCER em qualquer uma das quatro", async () => {
      // Um processo cadastrado quando já está em execução não deve ser
      // obrigado a nascer em conhecimento para depois ser movido — isso
      // registraria uma transição que nunca aconteceu.
      for (const fase of FASES_PROCESSO) {
        const processo = await novoProcesso({ fase });
        assert.equal(processo.fase, fase, `nascer em ${fase}`);
      }
    });

    test("fase fora do enum é recusada, e a mensagem lista as aceitas", async () => {
      const processo = await novoProcesso();
      const r = await mudarFase(processo._id, { fase: "arquivado" });
      assert.equal(r.status, 400);
      assert.match(r.body.message, /fase inválida/);
      for (const fase of FASES_PROCESSO) {
        assert.ok(r.body.message.includes(fase), `precisa listar ${fase}: ${r.body.message}`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // O MOVIMENTO — nos dois sentidos
  // ═══════════════════════════════════════════════════════════════════════

  describe("transição em qualquer direção", () => {
    test("TODA transição entre as quatro é aceita — as 16 combinações", async () => {
      // Não é uma amostra: são todos os pares, inclusive fase para ela mesma.
      // Uma máquina de estados parcial passaria num teste de amostra e cairia
      // aqui, que é o ponto.
      for (const de of FASES_PROCESSO) {
        for (const para of FASES_PROCESSO) {
          const processo = await novoProcesso({ fase: de });
          const corpo = esperado(
            await mudarFase(processo._id, { fase: para }),
            200,
            `${de} → ${para}`
          );
          assert.equal(corpo.fase, para, `${de} → ${para} devia gravar ${para}`);
        }
      }
    });

    test("recursos → conhecimento: a volta que ela pediu, nomeada", async () => {
      // ⚠️ MUTAÇÃO (a) DERRUBA ESTE TESTE.
      //
      // *"Sim, pode voltar."* Este é o par que mais parece errado para quem
      // pensa em fluxo processual, e é exatamente por isso que ele tem teste
      // próprio além da varredura das 16: quem for "consertar" a ordem vai
      // travar este par primeiro.
      const processo = await novoProcesso({ fase: "recursos" });

      const corpo = esperado(
        await mudarFase(processo._id, { fase: "conhecimento" }),
        200,
        "recursos → conhecimento"
      );

      assert.equal(corpo.fase, "conhecimento");
    });

    test("ida e volta e ida de novo: o histórico guarda as três", async () => {
      const processo = await novoProcesso({ fase: "conhecimento" });

      esperado(await mudarFase(processo._id, { fase: "recursos" }), 200, "ida");
      esperado(await mudarFase(processo._id, { fase: "conhecimento" }), 200, "volta");
      const corpo = esperado(
        await mudarFase(processo._id, { fase: "execucao" }),
        200,
        "ida de novo"
      );

      // 1 do nascimento + 3 transições.
      assert.equal(corpo.historicoFase.length, 4);
      assert.deepEqual(
        corpo.historicoFase.map((h) => h.para),
        ["conhecimento", "recursos", "conhecimento", "execucao"]
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // O MOTIVO — opcional, e a transição registrada de qualquer jeito
  // ═══════════════════════════════════════════════════════════════════════

  describe("motivo opcional", () => {
    test("transição SEM motivo funciona, e grava `motivo: null`", async () => {
      // ⚠️ MUTAÇÃO (b) DERRUBA ESTE TESTE.
      //
      // *"Não precisa anotar o porquê, só se ela quiser mesmo."* Exigir motivo
      // é a regra inventada mais provável desta fase — ela parece zelo.
      const processo = await novoProcesso();

      const corpo = esperado(
        await mudarFase(processo._id, { fase: "sentenca" }),
        200,
        "transição sem motivo"
      );

      const ultima = corpo.historicoFase.at(-1);
      assert.equal(ultima.para, "sentenca");
      assert.equal(ultima.motivo, null, "motivo ausente grava null, não string vazia");
    });

    test("as três formas do vazio passam igual", async () => {
      // A tela não deve ter de escolher qual vazio mandar. Ausente, `null` e
      // "" são todos "não quis anotar".
      for (const motivo of [undefined, null, ""]) {
        const processo = await novoProcesso();
        const corpo = esperado(
          await mudarFase(
            processo._id,
            motivo === undefined ? { fase: "execucao" } : { fase: "execucao", motivo }
          ),
          200,
          `motivo ${JSON.stringify(motivo)}`
        );
        assert.equal(corpo.historicoFase.at(-1).motivo, null);
      }
    });

    test("motivo informado é guardado como ela escreveu", async () => {
      const processo = await novoProcesso();
      const corpo = esperado(
        await mudarFase(processo._id, {
          fase: "execucao",
          motivo: "Sentença transitou, começou a cobrança"
        }),
        200,
        "com motivo"
      );
      assert.equal(
        corpo.historicoFase.at(-1).motivo,
        "Sentença transitou, começou a cobrança"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // O SUBSTRATO DA LINHA DO TEMPO
  // ═══════════════════════════════════════════════════════════════════════

  describe("toda transição gera entrada de histórico", () => {
    test("de → para, data e autor, em cada uma", async () => {
      const processo = await novoProcesso({ fase: "conhecimento" });
      const antes = new Date();

      const corpo = esperado(
        await mudarFase(processo._id, { fase: "sentenca" }),
        200,
        "transição"
      );

      const entrada = corpo.historicoFase.at(-1);
      assert.equal(entrada.de, "conhecimento", "de");
      assert.equal(entrada.para, "sentenca", "para");
      assert.ok(entrada.data, "data");
      assert.ok(new Date(entrada.data) >= new Date(antes.getTime() - 1000), "data é de agora");
      assert.equal(
        String(entrada.autorId),
        String(api.usuario._id ?? api.usuario.id),
        "autor é quem mudou"
      );
    });

    test("a PRIMEIRA entrada é o nascimento, com `de: null`", async () => {
      // Sem ela, um processo criado direto em "execução" apareceria na linha do
      // tempo como se sempre tivesse estado lá — e não haveria como distinguir
      // "nasceu assim" de "nunca mudou".
      const processo = await novoProcesso({ fase: "execucao" });

      assert.equal(processo.historicoFase.length, 1);
      assert.equal(processo.historicoFase[0].de, null);
      assert.equal(processo.historicoFase[0].para, "execucao");
      assert.equal(processo.historicoFase[0].motivo, null);
    });

    test("o histórico é APPEND-ONLY: nenhuma rota o aceita", async () => {
      const processo = await novoProcesso();

      const r = await api.patch(`/processes/${processo._id}`, {
        historicoFase: [{ de: null, para: "recursos", data: new Date(), autorId: "x" }]
      });

      assert.equal(r.status, 400, `esperado 400, veio ${r.status}`);
      assert.equal(r.body.campo, "historicoFase");
    });

    test("`fase` NÃO passa pelo PATCH comum — e a recusa diz por onde ir", async () => {
      // Aceitá-la lá gravaria a mudança SEM histórico, pelo `findOneAndUpdate`.
      // A mensagem genérica de campo desconhecido não bastaria: ela não diria
      // que existe um caminho certo para o que a pessoa quis fazer.
      const processo = await novoProcesso();

      const r = await api.patch(`/processes/${processo._id}`, { fase: "recursos" });

      assert.equal(r.status, 400);
      assert.equal(r.body.campo, "fase");
      assert.match(r.body.message, /PATCH \/api\/processes\/:id\/fase/);

      // E a fase NÃO mudou.
      const depois = esperado(await api.get(`/processes/${processo._id}`), 200, "releitura");
      assert.equal(depois.fase, FASE_PADRAO);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // O SEGUNDO EIXO — encerramento, independente da fase
  // ═══════════════════════════════════════════════════════════════════════

  describe("encerramento é independente da fase", () => {
    test("transita em julgado a partir de QUALQUER uma das quatro", async () => {
      // *"Acordo cumprido — aí o processo finalizado e muda para trânsito em
      // julgado."* Acordo se cumpre em conhecimento, em execução, em qualquer
      // lugar. Exigir `fase === "recursos"` inventaria um caminho único onde
      // ela descreveu vários.
      for (const fase of FASES_PROCESSO) {
        const processo = await novoProcesso({ fase });

        const corpo = esperado(
          await api.patch(`/processes/${processo._id}`, {
            transitoEmJulgadoEm: "2026-08-24",
            motivoEncerramento: "Acordo cumprido"
          }),
          200,
          `encerrar a partir de ${fase}`
        );

        assert.ok(corpo.transitoEmJulgadoEm, `carimbo em ${fase}`);
        assert.equal(corpo.motivoEncerramento, "Acordo cumprido");
        // E a fase continua sendo a que era: o encerramento não a apaga, senão
        // se perderia a informação de onde o processo parou.
        assert.equal(corpo.fase, fase, `a fase não muda ao encerrar (${fase})`);
      }
    });

    test("processo transitado em julgado AINDA muda de fase", async () => {
      // A advogada errou o registro e está corrigindo. Travar a fase depois do
      // trânsito faria a correção passar por desfazer o encerramento primeiro.
      const processo = await novoProcesso({ fase: "recursos" });
      esperado(
        await api.patch(`/processes/${processo._id}`, { transitoEmJulgadoEm: "2026-08-24" }),
        200,
        "encerrar"
      );

      const corpo = esperado(
        await mudarFase(processo._id, { fase: "execucao" }),
        200,
        "mudar fase depois do trânsito"
      );

      assert.equal(corpo.fase, "execucao");
      assert.ok(corpo.transitoEmJulgadoEm, "o encerramento continua lá");
    });

    test("`null` DESFAZ o encerramento — é como se corrige um carimbo errado", async () => {
      const processo = await novoProcesso();
      esperado(
        await api.patch(`/processes/${processo._id}`, {
          transitoEmJulgadoEm: "2026-08-24",
          motivoEncerramento: "Acordo cumprido"
        }),
        200,
        "encerrar"
      );

      const corpo = esperado(
        await api.patch(`/processes/${processo._id}`, {
          transitoEmJulgadoEm: null,
          motivoEncerramento: null
        }),
        200,
        "desfazer"
      );

      assert.equal(corpo.transitoEmJulgadoEm, null);
      assert.equal(corpo.motivoEncerramento, null);
    });

    test("nasce sem encerramento nenhum", async () => {
      const processo = await novoProcesso();
      assert.equal(processo.transitoEmJulgadoEm, null);
      assert.equal(processo.motivoEncerramento, null);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LIMINAR — sinalizador, não estado
  // ═══════════════════════════════════════════════════════════════════════

  describe("liminar é um sinalizador", () => {
    test("marcar liminar NÃO altera a fase", async () => {
      // *"Liminar é um plus dentro das fases (…) não é uma fase nova."*
      for (const fase of FASES_PROCESSO) {
        const processo = await novoProcesso({ fase });

        const corpo = esperado(
          await api.patch(`/processes/${processo._id}`, {
            liminar: true,
            liminarObservacao: "Tutela de urgência deferida",
            liminarEm: "2026-08-20"
          }),
          200,
          `marcar liminar em ${fase}`
        );

        assert.equal(corpo.liminar, true);
        assert.equal(corpo.fase, fase, `a fase não muda ao marcar liminar (${fase})`);
        // E não gera entrada de histórico: liminar não é "por onde o processo
        // andou".
        assert.equal(corpo.historicoFase.length, 1, "só a entrada do nascimento");
      }
    });

    test("a liminar não é exigida por nada — nem para mudar de fase, nem para encerrar", async () => {
      const processo = await novoProcesso();
      assert.equal(processo.liminar, false, "nasce sem liminar");

      esperado(await mudarFase(processo._id, { fase: "recursos" }), 200, "mudar fase sem liminar");
      esperado(
        await api.patch(`/processes/${processo._id}`, { transitoEmJulgadoEm: "2026-08-24" }),
        200,
        "encerrar sem liminar"
      );
    });

    test("a observação e a data são OPCIONAIS: a marca vale sozinha", async () => {
      const processo = await novoProcesso();

      const corpo = esperado(
        await api.patch(`/processes/${processo._id}`, { liminar: true }),
        200,
        "só a marca"
      );

      assert.equal(corpo.liminar, true);
      assert.equal(corpo.liminarObservacao, null);
      assert.equal(corpo.liminarEm, null);
    });

    test("mudar de fase NÃO apaga a liminar: ela atravessa as fases", async () => {
      const processo = await novoProcesso({ fase: "conhecimento" });
      esperado(
        await api.patch(`/processes/${processo._id}`, { liminar: true }),
        200,
        "marcar"
      );

      const corpo = esperado(
        await mudarFase(processo._id, { fase: "execucao" }),
        200,
        "mudar de fase"
      );

      assert.equal(corpo.liminar, true, "a liminar é um plus DENTRO das fases");
    });

    test("liminar não booleana é recusada", async () => {
      const processo = await novoProcesso();
      const r = await api.patch(`/processes/${processo._id}`, { liminar: "sim" });
      assert.equal(r.status, 400);
      assert.match(r.body.message, /liminar deve ser booleano/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // O FILTRO — recorta, e NÃO reordena
  // ═══════════════════════════════════════════════════════════════════════

  describe("filtros de fase e de liminar", () => {
    let apiFiltro;

    before(async () => {
      // Usuário próprio: os testes acima criaram dezenas de processos, e uma
      // contagem contra aquela base mediria o arranjo dos outros.
      apiFiltro = await registrarUsuario("dec054filtro");
      const c = await criarClientePF(apiFiltro, { nomeCompleto: "Rita Alencar" });
      const participantes = [{ clienteId: c._id, papel: "autor", principal: true }];

      const p1 = await criarProcesso(apiFiltro, participantes, { fase: "execucao" });
      await criarProcesso(apiFiltro, participantes, { fase: "recursos" });
      await criarProcesso(apiFiltro, participantes, { fase: "execucao" });

      esperado(
        await apiFiltro.patch(`/processes/${p1._id}`, { liminar: true }),
        200,
        "marcar liminar"
      );
    });

    test("`?fase=` recorta pela fase", async () => {
      const corpo = esperado(
        await apiFiltro.get("/processes?fase=execucao"),
        200,
        "filtrar por fase"
      );
      assert.equal(corpo.total, 2);
      assert.ok(corpo.data.every((p) => p.fase === "execucao"));
    });

    test("`?liminar=com` e `?liminar=sem` recortam", async () => {
      const com = esperado(await apiFiltro.get("/processes?liminar=com"), 200, "com");
      assert.equal(com.total, 1);
      assert.equal(com.data[0].liminar, true);

      const sem = esperado(await apiFiltro.get("/processes?liminar=sem"), 200, "sem");
      assert.equal(sem.total, 2);
      assert.ok(sem.data.every((p) => p.liminar !== true));
    });

    test("sem filtro de liminar, vêm todos", async () => {
      const todos = esperado(await apiFiltro.get("/processes"), 200, "todos");
      assert.equal(todos.total, 3);
    });

    test("a lista NÃO se reordena por liminar", async () => {
      // Ela pediu DESTAQUE ("liminar é um plus"), não PRIORIDADE. Reordenar
      // muda o que a advogada espera encontrar onde deixou — e o processo com
      // liminar aqui é o MAIS ANTIGO dos três, então uma ordenação que o
      // subisse ao topo cairia neste teste.
      const corpo = esperado(await apiFiltro.get("/processes"), 200, "listagem");

      const datas = corpo.data.map((p) => new Date(p.createdAt).getTime());
      const ordenado = [...datas].sort((a, b) => b - a);
      assert.deepEqual(datas, ordenado, "a ordem continua sendo por data de criação, decrescente");

      assert.equal(
        corpo.data[0].liminar,
        false,
        "o processo com liminar é o mais antigo e NÃO foi promovido ao topo"
      );
    });
  });
});
