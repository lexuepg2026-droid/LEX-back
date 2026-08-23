// ═══════════════════════════════════════════════════════════════════════════
// DEC-053 — NADA FICA ATIVO DEBAIXO DE COISA INATIVA
//
// ── O achado (validação da F-2b, 22/08/2026) ──────────────────────────────
// Foi possível REATIVAR um processo cujo cliente estava desativado. O estado
// resultante é um órfão VISÍVEL: o processo volta às listagens, o cliente não,
// e clicar no nome do cliente cai num registro arquivado.
//
// ── Por que a F-2b não pegou ──────────────────────────────────────────────
// A DEC-052 fechou a DESCIDA (reativar o pai não reativa os filhos). Ninguém
// tinha dito nada sobre a SUBIDA, e nada impedia um filho de subir sozinho.
//
// ── O que este arquivo trava ──────────────────────────────────────────────
// As DUAS bocas da regra, uma relação por vez — e não um teste genérico. Um
// teste que iterasse a árvore provaria "existe uma guarda em algum lugar";
// estes provam que CADA porta está fechada, e é a porta aberta que este
// arquivo existe para achar.
//
// ── O caminho correto continua aberto ─────────────────────────────────────
// Reativar o PAI e depois o FILHO funciona. Isso é tão importante quanto a
// recusa: uma guarda que fechasse a reativação legítima transformaria um órfão
// em dois registros mortos.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarClientePJ, criarProcesso,
  criarHonorario, criarParcela, esperado
} from "../helpers/setup.js";
import { REGRA_CONFLITO } from "../../src/config/integrityConflicts.js";
import { reactivateProcess } from "../../src/services/processService.js";

describe("DEC-053 — nenhum registro ativo sob pai inativo", () => {
  let api;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("dec053");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  let contador = 0;
  const nomeUnico = (prefixo) => {
    contador += 1;
    return `${prefixo} ${contador}`;
  };

  // Cliente + processo dele, os dois ativos.
  const cenario = async (nomeCliente) => {
    const cliente = await criarClientePF(api, { nomeCompleto: nomeCliente });
    const processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ]);
    return { cliente, processo };
  };

  // O caminho que produz o órfão: desativa o processo (a cascata derruba os
  // vínculos), e só então o cliente — que agora não participa de processo
  // ativo nenhum e por isso PODE ser desativado.
  const desativarOsDois = async (cliente, processo) => {
    esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");
    esperado(await api.delete(`/clients/${cliente._id}`), 200, "desativar cliente");
  };

  // ═══════════════════════════════════════════════════════════════════════
  // BOCA 1 — REATIVAR
  // ═══════════════════════════════════════════════════════════════════════

  describe("boca 1: reativar filho com pai inativo", () => {
    test("Processo → Cliente: recusado, e a mensagem NOMEIA o cliente", async () => {
      const nome = nomeUnico("Beatriz Ramos Pereira");
      const { cliente, processo } = await cenario(nome);
      await desativarOsDois(cliente, processo);

      const r = await api.patch(`/processes/${processo._id}/reactivate`);
      const corpo = esperado(r, 409, "reativação de processo com cliente inativo");

      // ── O NOME é o ponto do teste ────────────────────────────────────────
      // É esta asserção que a mutação (b) da fase derruba. Uma mensagem
      // genérica ("não é possível reativar") manda a advogada procurar, num
      // cadastro inteiro, qual cliente está fora — e a recusa em silêncio é
      // pior que ter permitido.
      assert.ok(
        corpo.message.includes(nome),
        `a recusa precisa nomear o cliente. Veio: ${corpo.message}`
      );
      assert.match(corpo.message, /desativad/i);
      assert.match(corpo.message, /Reative o cliente primeiro/);
      assert.equal(corpo.regra, REGRA_CONFLITO.PAI_INATIVO);
      assert.equal(corpo.errors.paisInativos.length, 1);
      assert.equal(corpo.errors.paisInativos[0].tipo, "Client");
      assert.equal(corpo.errors.paisInativos[0].nome, nome);

      // E o processo CONTINUA desativado — a recusa não pode ter efeito
      // colateral nenhum. A leitura é pela LISTAGEM com `situacao=inativos`:
      // `GET /processes/:id` filtra `ativo: true` e responderia 404 para um
      // desativado, que é comportamento de antes desta fase e não muda aqui.
      const lista = esperado(
        await api.get("/processes?situacao=inativos&limit=100"),
        200,
        "listagem de desativados"
      );
      const linha = lista.data.find((p) => String(p._id) === String(processo._id));
      assert.ok(linha, "o processo recusado continua entre os desativados");
      assert.equal(linha.ativo, false);
    });

    test("a autoridade é do SERVIÇO, não da tela — chamada direta também recusa", async () => {
      const nome = nomeUnico("Cliente Chamada Direta");
      const { cliente, processo } = await cenario(nome);
      await desativarOsDois(cliente, processo);

      // Sem HTTP, sem controller, sem frontend. A tela é conveniência; se a
      // regra morasse lá, `curl` a contornaria.
      await assert.rejects(
        () => reactivateProcess(api.usuario._id ?? api.usuario.id, processo._id),
        (erro) => {
          assert.equal(erro.statusCode, 409);
          assert.ok(erro.message.includes(nome), `serviço deve nomear: ${erro.message}`);
          return true;
        }
      );
    });

    test("litisconsórcio: o pai inativo pode ser um participante SECUNDÁRIO", async () => {
      // Olhar só `clientePrincipalId` deixaria esta porta aberta — e o vínculo
      // do secundário VOLTA na reativação, criando o mesmo órfão uma camada
      // abaixo, onde ninguém procura.
      const principal = await criarClientePF(api, { nomeCompleto: nomeUnico("Principal Ativo") });
      const nomeSecundario = nomeUnico("Litisconsorte Desativado");
      const secundario = await criarClientePF(api, { nomeCompleto: nomeSecundario });

      const processo = await criarProcesso(api, [
        { clienteId: principal._id, papel: "autor", principal: true },
        { clienteId: secundario._id, papel: "autor", principal: false }
      ]);

      esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");
      esperado(await api.delete(`/clients/${secundario._id}`), 200, "desativar secundário");

      const corpo = esperado(
        await api.patch(`/processes/${processo._id}/reactivate`),
        409,
        "reativação com litisconsorte inativo"
      );
      assert.ok(
        corpo.message.includes(nomeSecundario),
        `precisa nomear o litisconsorte: ${corpo.message}`
      );
    });

    test("participante removido À MÃO não bloqueia — ele não volta na reativação", async () => {
      // A fronteira exata da DEC-052: vínculo removido à mão continua fora
      // depois da reativação. Se ele não volta, o estado do cliente dele não
      // pode impedir nada — recusar aqui seria travar a reativação por causa
      // de alguém que continuaria desvinculado.
      const principal = await criarClientePF(api, { nomeCompleto: nomeUnico("Principal") });
      const removido = await criarClientePF(api, { nomeCompleto: nomeUnico("Removido À Mão") });

      const processo = await criarProcesso(api, [
        { clienteId: principal._id, papel: "autor", principal: true },
        { clienteId: removido._id, papel: "autor", principal: false }
      ]);

      esperado(
        await api.delete(`/processes/${processo._id}/clientes/${removido._id}`),
        200,
        "remover participante à mão"
      );
      esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");
      esperado(await api.delete(`/clients/${removido._id}`), 200, "desativar o removido");

      // O principal está ativo e o removido não volta: a reativação PASSA.
      esperado(
        await api.patch(`/processes/${processo._id}/reactivate`),
        200,
        "reativação com removido-à-mão inativo"
      );
    });

    test("reativar o PAI e depois o filho funciona — o caminho correto segue aberto", async () => {
      const nome = nomeUnico("Cliente Que Volta");
      const { cliente, processo } = await cenario(nome);
      await desativarOsDois(cliente, processo);

      // Recusa enquanto o pai está fora...
      esperado(
        await api.patch(`/processes/${processo._id}/reactivate`),
        409,
        "recusa antes de reativar o cliente"
      );

      // ...reativa o pai...
      esperado(
        await api.patch(`/clients/${cliente._id}/reactivate`),
        200,
        "reativação do cliente"
      );

      // ...e agora o filho sobe.
      const reativado = esperado(
        await api.patch(`/processes/${processo._id}/reactivate`),
        200,
        "reativação do processo depois do cliente"
      );
      assert.equal(reativado.processo?.ativo ?? reativado.ativo, true);
    });

    test("pai ATIVO: reativar o filho funciona direto", async () => {
      const { processo } = await cenario(nomeUnico("Cliente Sempre Ativo"));
      esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar só o processo");

      esperado(
        await api.patch(`/processes/${processo._id}/reactivate`),
        200,
        "reativação com pai ativo"
      );
    });

    test("cliente PJ é nomeado pela RAZÃO SOCIAL, não por um campo vazio", async () => {
      // PF guarda o nome em `nomeCompleto`, PJ em `razaoSocial`. Sem o ponto
      // único de nome, metade das recusas sairia nomeando "(sem nome)" —
      // justamente no caso em que o nome mais importa para achar o cadastro.
      const razao = nomeUnico("Construtora Horizonte LTDA");
      const cliente = await criarClientePJ(api, { razaoSocial: razao });
      const processo = await criarProcesso(api, [
        { clienteId: cliente._id, papel: "autor", principal: true }
      ]);
      await desativarOsDois(cliente, processo);

      const corpo = esperado(
        await api.patch(`/processes/${processo._id}/reactivate`),
        409,
        "reativação com PJ inativa"
      );
      assert.ok(corpo.message.includes(razao), `precisa nomear a PJ: ${corpo.message}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BOCA 2 — CRIAR
  //
  // Estas recusas JÁ EXISTIAM antes da F-2c: todo `findOne` de pai no projeto
  // filtra `ativo: true`. O levantamento da fase confirmou isso em
  // `createProcess`, `createFee`, `createInstallment`, `createPayment`,
  // `vincularCliente` e `vincularSecao` — e os testes abaixo travam o
  // comportamento para que nenhuma refatoração futura o afrouxe em silêncio.
  //
  // O que a F-2c MUDOU foi a mensagem: "não encontrado" virou "está
  // desativado", com o nome.
  // ═══════════════════════════════════════════════════════════════════════

  describe("boca 2: criar filho sob pai inativo", () => {
    test("Processo → Cliente: criar processo com cliente desativado é recusado, nomeando", async () => {
      const nome = nomeUnico("Cliente Arquivado");
      const cliente = await criarClientePF(api, { nomeCompleto: nome });
      esperado(await api.delete(`/clients/${cliente._id}`), 200, "desativar cliente");

      const r = await api.post("/processes", {
        titulo: "Processo sob cliente morto",
        clientes: [{ clienteId: cliente._id, papel: "autor", principal: true }]
      });

      assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.message.includes(nome), `precisa nomear: ${r.body.message}`);
      assert.equal(r.body.regra, REGRA_CONFLITO.PAI_INATIVO);
    });

    test("Vínculo → Cliente: vincular cliente desativado a processo ativo é recusado", async () => {
      const { processo } = await cenario(nomeUnico("Principal Vivo"));
      const nome = nomeUnico("Litisconsorte Arquivado");
      const outro = await criarClientePF(api, { nomeCompleto: nome });
      esperado(await api.delete(`/clients/${outro._id}`), 200, "desativar o outro");

      const r = await api.post(`/processes/${processo._id}/clientes`, {
        clienteId: outro._id,
        papel: "reu"
      });

      assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.message.includes(nome), `precisa nomear: ${r.body.message}`);
    });

    test("Vínculo → Processo: vincular cliente a processo desativado é recusado", async () => {
      const { processo } = await cenario(nomeUnico("Cliente A"));
      const outro = await criarClientePF(api, { nomeCompleto: nomeUnico("Cliente B") });
      esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");

      const r = await api.post(`/processes/${processo._id}/clientes`, {
        clienteId: outro._id,
        papel: "reu"
      });
      // Processo desativado é inalcançável por esta rota inteira (leitura
      // inclusive), e por isso responde 404 e não 409 — a rota não distingue
      // "existe e está fora" de "não é seu". Documentado, não corrigido: mudar
      // isso mudaria o 404 de toda leitura de participante.
      assert.equal(r.status, 404, `esperado 404, veio ${r.status}: ${JSON.stringify(r.body)}`);
    });

    test("Honorário → Processo: criar honorário em processo desativado é recusado, nomeando", async () => {
      const titulo = nomeUnico("Processo Arquivado");
      const cliente = await criarClientePF(api, { nomeCompleto: nomeUnico("Cliente") });
      const processo = await criarProcesso(
        api,
        [{ clienteId: cliente._id, papel: "autor", principal: true }],
        { titulo }
      );
      esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");

      const r = await api.post("/fees", {
        processoId: processo._id,
        tipo: "fixo",
        valor: 1000,
        descricao: "Honorário órfão",
        dataVencimento: "2026-12-01"
      });

      assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.message.includes(titulo), `precisa nomear o processo: ${r.body.message}`);
      assert.equal(r.body.regra, REGRA_CONFLITO.PAI_INATIVO);
    });

    test("Parcela → Honorário: criar parcela em honorário desativado é recusado, nomeando", async () => {
      const { processo } = await cenario(nomeUnico("Cliente Parcela"));
      const descricao = nomeUnico("Honorário Arquivado");
      const honorario = await criarHonorario(api, processo._id, {
        descricao,
        valor: 900
      });
      esperado(await api.delete(`/fees/${honorario._id}`), 200, "desativar honorário");

      const r = await api.post("/installments", {
        feeId: honorario._id,
        numeroParcela: 1,
        valor: 300,
        dataVencimento: "2026-12-01"
      });

      assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.message.includes(descricao), `precisa nomear: ${r.body.message}`);
    });

    test("Pagamento → Honorário: pagar honorário desativado é recusado, nomeando", async () => {
      const { processo } = await cenario(nomeUnico("Cliente Pagamento"));
      const descricao = nomeUnico("Honorário Pago Morto");
      const honorario = await criarHonorario(api, processo._id, {
        descricao,
        valor: 500
      });
      // A parcela sai primeiro: o 409 de integridade recusa desativar
      // honorário com parcela ativa, e é regra anterior a esta fase.
      const parcela = await criarParcela(api, honorario._id, 1, { valor: 500 });
      esperado(await api.delete(`/installments/${parcela._id}`), 200, "desativar parcela");
      esperado(await api.delete(`/fees/${honorario._id}`), 200, "desativar honorário");

      const r = await api.post("/payments", {
        honorarioId: honorario._id,
        valor: 100,
        formaPagamento: "pix",
        tipo: "comum",
        data: "2026-09-01"
      });

      assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.message.includes(descricao), `precisa nomear: ${r.body.message}`);
    });

    test("mover honorário PARA processo desativado é recusado — a terceira porta", async () => {
      const { processo: vivo } = await cenario(nomeUnico("Cliente Vivo"));
      const honorario = await criarHonorario(api, vivo._id, {
        descricao: nomeUnico("Honorário Móvel"),
        valor: 700
      });

      const tituloMorto = nomeUnico("Destino Arquivado");
      const outroCliente = await criarClientePF(api, { nomeCompleto: nomeUnico("Cliente C") });
      const morto = await criarProcesso(
        api,
        [{ clienteId: outroCliente._id, papel: "autor", principal: true }],
        { titulo: tituloMorto }
      );
      esperado(await api.delete(`/processes/${morto._id}`), 200, "desativar destino");

      const r = await api.patch(`/fees/${honorario._id}`, { processoId: morto._id });
      assert.equal(r.status, 409, `esperado 409, veio ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.message.includes(tituloMorto), `precisa nomear: ${r.body.message}`);
    });

    test("cliente INEXISTENTE continua 400, e não vira 409 nomeando o nada", async () => {
      // A separação entre "não existe" e "está desativado" tem de valer nos
      // dois sentidos. Um id inexistente não tem nome para nomear, e tratá-lo
      // como pai inativo confirmaria a existência de cadastro alheio.
      const r = await api.post("/processes", {
        titulo: "Processo sem cliente",
        clientes: [
          { clienteId: "507f1f77bcf86cd799439011", papel: "autor", principal: true }
        ]
      });
      assert.equal(r.status, 400, `esperado 400, veio ${r.status}: ${JSON.stringify(r.body)}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // A TELA NÃO OFERECE O QUE O SERVIÇO RECUSARIA
  // ═══════════════════════════════════════════════════════════════════════

  describe("a listagem carrega o impedimento, para a tela não oferecer a ação", () => {
    test("processo desativado sob cliente inativo traz `impedimentosDeReativacao` nomeado", async () => {
      const nome = nomeUnico("Cliente Da Listagem");
      const { cliente, processo } = await cenario(nome);
      await desativarOsDois(cliente, processo);

      const corpo = esperado(
        await api.get("/processes?situacao=inativos&limit=100"),
        200,
        "listagem de desativados"
      );
      const linha = corpo.data.find((p) => String(p._id) === String(processo._id));
      assert.ok(linha, "o processo desativado precisa aparecer no filtro de inativos");
      assert.ok(
        Array.isArray(linha.impedimentosDeReativacao),
        "a linha precisa trazer o impedimento"
      );
      assert.equal(linha.impedimentosDeReativacao[0].nome, nome);
    });

    test("processo desativado sob cliente ATIVO não traz impedimento nenhum", async () => {
      const { processo } = await cenario(nomeUnico("Cliente Ativo Listagem"));
      esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");

      const corpo = esperado(
        await api.get("/processes?situacao=inativos&limit=100"),
        200,
        "listagem de desativados"
      );
      const linha = corpo.data.find((p) => String(p._id) === String(processo._id));
      assert.ok(linha, "o processo precisa aparecer");
      assert.equal(
        linha.impedimentosDeReativacao,
        undefined,
        "sem impedimento, a chave não existe — vetor vazio por linha seria peso por nada"
      );
    });

    test("o preview responde se a reativação é possível, e nomeia quem impede", async () => {
      const nome = nomeUnico("Cliente Do Preview");
      const { cliente, processo } = await cenario(nome);
      await desativarOsDois(cliente, processo);

      const corpo = esperado(
        await api.get(`/processes/${processo._id}/activation-preview`),
        200,
        "preview de ativação"
      );
      assert.equal(corpo.ativo, false);
      assert.equal(corpo.impedimentosDeReativacao.length, 1);
      assert.equal(corpo.impedimentosDeReativacao[0].nome, nome);
    });

    test("preview de processo desativado SEM impedimento traz vetor vazio, não ausência", async () => {
      // A tela PERGUNTOU se pode reativar. Vetor vazio é a resposta "pode";
      // omitir a chave obrigaria o frontend a distinguir "não perguntei" de
      // "perguntei e não há".
      const { processo } = await cenario(nomeUnico("Cliente Preview Ativo"));
      esperado(await api.delete(`/processes/${processo._id}`), 200, "desativar processo");

      const corpo = esperado(
        await api.get(`/processes/${processo._id}/activation-preview`),
        200,
        "preview sem impedimento"
      );
      assert.deepEqual(corpo.impedimentosDeReativacao, []);
    });
  });
});
