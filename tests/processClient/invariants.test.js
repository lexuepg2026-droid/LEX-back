// ═══════════════════════════════════════════════════════════════════════════
// INVARIANTES DO VÍNCULO PROCESSO-CLIENTE
//
// A junção `processo_clientes` é a FONTE DA VERDADE; `Process.clientePrincipalId`
// é campo derivado que existe só para leitura rápida. Se os dois divergirem, a
// junção está certa — e é a divergência que este arquivo persegue, porque ela
// não aparece em tela nenhuma até o dia em que um documento é gerado
// qualificando o participante errado.
//
// A invariante central é "exatamente um principal, nunca zero". Zero principais
// é pior que dois: com dois, a resolução de variáveis escolhe um e a peça sai
// com o outorgante errado; com zero, ela não sabe a quem atribuir a peça.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar, acharEm, COLECOES } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, esperado
} from "../helpers/setup.js";
import { dadosProcesso } from "../helpers/factories.js";
import { PAPEIS_PROCESSO_CLIENTE as PAPEIS } from "../../src/models/ProcessoCliente.js";
import {
  ALFABETO_CROCKFORD, PREFIXO_CODIGO, TAMANHO_CODIGO, isCodigoAcessoValido
} from "../../src/utils/accessCode.js";

const { ObjectId } = Types;

describe("invariantes do vínculo processo-cliente", () => {
  let api;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("vínculos");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const novosClientes = async (quantos) => {
    const clientes = [];
    for (let i = 0; i < quantos; i += 1) clientes.push(await criarClientePF(api));
    return clientes;
  };

  const participantes = async (processoId) =>
    esperado(await api.get(`/processes/${processoId}/clientes`), 200, "participantes").data;

  // A conferência que importa: exatamente um principal na JUNÇÃO, e o campo
  // derivado do processo apontando para ele. Ler só a junção deixaria passar a
  // divergência; ler só o processo deixaria passar dois principais.
  const assertExatamenteUmPrincipal = async (processoId, contexto) => {
    const vinculos = await participantes(processoId);
    const principais = vinculos.filter((v) => v.principal === true);

    assert.equal(
      principais.length,
      1,
      `${contexto}: a junção tem ${principais.length} principais, deveria ter exatamente 1`
    );

    const processo = esperado(await api.get(`/processes/${processoId}`), 200, contexto);
    const derivado = String(processo.clientePrincipalId?._id ?? processo.clientePrincipalId);
    const naJuncao = String(principais[0].clienteId?._id ?? principais[0].clienteId);

    assert.equal(
      derivado,
      naJuncao,
      `${contexto}: clientePrincipalId (${derivado}) diverge da junção (${naJuncao})`
    );

    return { vinculos, principal: principais[0] };
  };

  // ═════════════════════════════════════════════════════════════════════════
  // Um e só um principal
  // ═════════════════════════════════════════════════════════════════════════

  describe("exatamente um principal, nunca zero", () => {
    test("processo com 1, 2, 3 e 4 participantes nasce com um único principal", async () => {
      for (const n of [1, 2, 3, 4]) {
        const clientes = await novosClientes(n);
        const processo = await criarProcesso(
          api,
          clientes.map((c, i) => ({
            clienteId: c._id,
            papel: i === 0 ? "autor" : "litisconsorte",
            principal: i === 0
          }))
        );

        const { vinculos } = await assertExatamenteUmPrincipal(processo._id, `processo com ${n}`);
        assert.equal(vinculos.length, n, `deveriam existir ${n} vínculos`);
      }
    });

    test("nenhum participante marcado principal: o processo ainda assim tem um", async () => {
      // O caso que produz zero principais se ninguém cuidar: o payload não
      // marca ninguém. O sistema não pode aceitar processo sem principal.
      const clientes = await novosClientes(3);
      const r = await api.post(
        "/processes",
        dadosProcesso(
          clientes.map((c) => ({ clienteId: c._id, papel: "autor", principal: false }))
        )
      );

      if (r.status === 201) {
        await assertExatamenteUmPrincipal(r.body._id, "sem principal no payload");
      } else {
        // Recusar também é resposta válida — o que não pode é gravar zero.
        assert.equal(r.status, 400, `esperado 201 (com principal atribuído) ou 400, veio ${r.status}`);
      }
    });

    test("dois participantes marcados principais não produzem dois principais", async () => {
      const clientes = await novosClientes(3);
      const r = await api.post(
        "/processes",
        dadosProcesso([
          { clienteId: clientes[0]._id, papel: "autor", principal: true },
          { clienteId: clientes[1]._id, papel: "litisconsorte", principal: true },
          { clienteId: clientes[2]._id, papel: "reu", principal: false }
        ])
      );

      if (r.status === 201) {
        await assertExatamenteUmPrincipal(r.body._id, "dois marcados principais");
      } else {
        assert.equal(r.status, 400, `esperado 201 (um só principal) ou 400, veio ${r.status}`);
      }
    });

    test("vincular participante avulso nunca cria um segundo principal", async () => {
      // `vincularCliente` grava `principal: false` sempre, de propósito:
      // promover é operação própria, que também rebaixa o anterior. Deixar a
      // criação marcar principal abriria a porta para dois.
      const [a, b] = await novosClientes(2);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true }
      ]);

      const novo = esperado(
        await api.post(`/processes/${processo._id}/clientes`, {
          clienteId: b._id,
          papel: "litisconsorte",
          principal: true // pedido explícito, que deve ser ignorado
        }),
        201,
        "vínculo avulso"
      );

      assert.equal(novo.principal, false, "vincular avulso não pode marcar principal");
      await assertExatamenteUmPrincipal(processo._id, "após vínculo avulso");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Promoção
  // ═════════════════════════════════════════════════════════════════════════

  describe("promoção a principal", () => {
    test("promover outro rebaixa o anterior, sem instante com dois nem com zero", async () => {
      const [a, b, c] = await novosClientes(3);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false },
        { clienteId: c._id, papel: "reu", principal: false }
      ]);

      const inicial = await assertExatamenteUmPrincipal(processo._id, "estado inicial");
      assert.equal(String(inicial.principal.clienteId._id), String(a._id));

      // Promove B.
      esperado(
        await api.patch(`/processes/${processo._id}/clientes/${b._id}/principal`, {}),
        200,
        "promoção de B"
      );
      const depoisDeB = await assertExatamenteUmPrincipal(processo._id, "após promover B");
      assert.equal(String(depoisDeB.principal.clienteId._id), String(b._id));

      // E de volta para A. A ida e a volta são casos diferentes: a volta pega
      // quem já foi principal uma vez e teve o campo rebaixado.
      esperado(
        await api.patch(`/processes/${processo._id}/clientes/${a._id}/principal`, {}),
        200,
        "promoção de A de volta"
      );
      const deVolta = await assertExatamenteUmPrincipal(processo._id, "após voltar para A");
      assert.equal(String(deVolta.principal.clienteId._id), String(a._id));
    });

    test("promover quem já é principal é idempotente", async () => {
      const [a, b] = await novosClientes(2);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false }
      ]);

      esperado(
        await api.patch(`/processes/${processo._id}/clientes/${a._id}/principal`, {}),
        200,
        "promoção de quem já é principal"
      );
      const { principal } = await assertExatamenteUmPrincipal(processo._id, "após promoção redundante");
      assert.equal(String(principal.clienteId._id), String(a._id));
    });

    test("promover cliente que não participa do processo → 404, e nada muda", async () => {
      const [a, b] = await novosClientes(2);
      const foraDoProcesso = await criarClientePF(api);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false }
      ]);

      const r = await api.patch(
        `/processes/${processo._id}/clientes/${foraDoProcesso._id}/principal`,
        {}
      );
      assert.equal(r.status, 404, `esperado 404, veio ${r.status}`);

      // A transação não pode ter rebaixado o principal antes de descobrir que
      // o alvo não existe.
      const { principal } = await assertExatamenteUmPrincipal(processo._id, "após promoção inválida");
      assert.equal(String(principal.clienteId._id), String(a._id));
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Remoção do principal — o comportamento REAL, reportado no relatório
  // ═════════════════════════════════════════════════════════════════════════

  describe("remoção de participante", () => {
    test("COMPORTAMENTO REAL: remover o principal é RECUSADO com 409", async () => {
      // O roteiro pedia para assertar o comportamento real e documentá-lo.
      // Ele é RECUSA, não promoção automática — e a recusa é a escolha certa:
      // quem decide o substituto é a advogada, não o sistema por ordem de
      // cadastro. `processoClienteService.js:332`.
      const [a, b] = await novosClientes(2);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false }
      ]);

      const r = await api.delete(`/processes/${processo._id}/clientes/${a._id}`);

      assert.equal(r.status, 409, `esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.match(r.body.message, /principal/i);
      assert.match(r.body.message, /Promova outro/i, "a mensagem deveria dizer como sair do impasse");

      // O que importa de verdade: o processo NÃO ficou sem principal.
      await assertExatamenteUmPrincipal(processo._id, "após recusa de remoção do principal");
      assert.equal((await participantes(processo._id)).length, 2, "nenhum vínculo foi removido");
    });

    test("promovendo o outro antes, a remoção do ex-principal passa", async () => {
      // O caminho que a mensagem do 409 indica precisa funcionar de verdade.
      const [a, b] = await novosClientes(2);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false }
      ]);

      esperado(
        await api.patch(`/processes/${processo._id}/clientes/${b._id}/principal`, {}),
        200,
        "promoção de B"
      );
      esperado(
        await api.delete(`/processes/${processo._id}/clientes/${a._id}`),
        200,
        "remoção do ex-principal"
      );

      const { vinculos, principal } = await assertExatamenteUmPrincipal(processo._id, "após remoção");
      assert.equal(vinculos.length, 1);
      assert.equal(String(principal.clienteId._id), String(b._id));
    });

    test("remover o ÚNICO participante é recusado com 409", async () => {
      // Processo sem cliente não faz sentido: não há a quem atribuir a peça
      // nem quem assina. A saída é excluir o processo, não esvaziá-lo.
      const [a] = await novosClientes(1);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true }
      ]);

      const r = await api.delete(`/processes/${processo._id}/clientes/${a._id}`);
      assert.equal(r.status, 409, `esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.match(r.body.message, /único participante/i);
      await assertExatamenteUmPrincipal(processo._id, "após recusa de esvaziar o processo");
    });

    test("remover participante secundário não mexe no principal", async () => {
      const [a, b, c] = await novosClientes(3);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false },
        { clienteId: c._id, papel: "reu", principal: false }
      ]);

      esperado(
        await api.delete(`/processes/${processo._id}/clientes/${c._id}`),
        200,
        "remoção do secundário"
      );

      const { vinculos, principal } = await assertExatamenteUmPrincipal(processo._id, "após remoção do secundário");
      assert.equal(vinculos.length, 2);
      assert.equal(String(principal.clienteId._id), String(a._id));
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Transação na criação
  // ═════════════════════════════════════════════════════════════════════════

  describe("criação em transação", () => {
    test("falha no meio da lista não deixa vínculo órfão nem processo pela metade", async () => {
      // O segundo participante é um id que não existe. `montarVinculos` cria em
      // ordem, então o primeiro chega a ser gravado ANTES de o segundo falhar —
      // sem transação, sobrariam um processo e um vínculo órfãos.
      const bom = await criarClientePF(api);
      const inexistente = new ObjectId();

      const antesProc = await acharEm(COLECOES.PROCESSES, {});
      const antesVinc = await acharEm(COLECOES.PROCESSO_CLIENTES, {});

      const r = await api.post(
        "/processes",
        dadosProcesso([
          { clienteId: bom._id, papel: "autor", principal: true },
          { clienteId: String(inexistente), papel: "reu", principal: false }
        ])
      );

      assert.ok(
        r.status === 400 || r.status === 404,
        `esperado 400/404, veio ${r.status} — ${JSON.stringify(r.body)}`
      );

      const depoisProc = await acharEm(COLECOES.PROCESSES, {});
      const depoisVinc = await acharEm(COLECOES.PROCESSO_CLIENTES, {});

      assert.equal(depoisProc.length, antesProc.length, "sobrou processo da criação que falhou");
      assert.equal(depoisVinc.length, antesVinc.length, "sobrou vínculo órfão da criação que falhou");
    });

    test("cliente repetido na mesma criação não grava nada pela metade", async () => {
      const cliente = await criarClientePF(api);
      const antesVinc = await acharEm(COLECOES.PROCESSO_CLIENTES, {});

      const r = await api.post(
        "/processes",
        dadosProcesso([
          { clienteId: cliente._id, papel: "autor", principal: true },
          { clienteId: cliente._id, papel: "reu", principal: false }
        ])
      );

      assert.ok(r.status >= 400 && r.status < 500, `esperado 4xx, veio ${r.status}`);

      const depoisVinc = await acharEm(COLECOES.PROCESSO_CLIENTES, {});
      assert.equal(depoisVinc.length, antesVinc.length, "sobrou vínculo da criação duplicada");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Código de acesso
  // ═════════════════════════════════════════════════════════════════════════

  describe("código de acesso", () => {
    test("formato LEX-XXXX-XXXX, 13 caracteres, alfabeto sem I, L, O e U", async () => {
      const [a, b] = await novosClientes(2);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "litisconsorte", principal: false }
      ]);

      for (const cliente of [a, b]) {
        const r = esperado(
          await api.get(`/processes/${processo._id}/clientes/${cliente._id}/codigo-acesso`),
          200,
          "código de acesso"
        );

        assert.equal(r.codigoAcesso.length, TAMANHO_CODIGO, "13 = LEX + - + 4 + - + 4");
        assert.equal(r.codigoAcesso.length, 13);
        assert.match(r.codigoAcesso, /^LEX-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
        assert.ok(isCodigoAcessoValido(r.codigoAcesso), "o validador do backend recusou o próprio código");
        assert.ok(r.codigoAcesso.startsWith(`${PREFIXO_CODIGO}-`));

        // I, L, O e U ficam de fora porque a advogada dita o código por
        // telefone: "I" vira "1" e "O" vira "0" na anotação de quem ouve.
        for (const proibido of ["I", "L", "O", "U"]) {
          assert.ok(
            !r.codigoAcesso.slice(4).includes(proibido),
            `o código sorteou "${proibido}", que o alfabeto Crockford exclui`
          );
        }
        for (const simbolo of r.codigoAcesso.slice(4).replace(/-/g, "")) {
          assert.ok(ALFABETO_CROCKFORD.includes(simbolo), `símbolo fora do alfabeto: ${simbolo}`);
        }
      }
    });

    test("o código NÃO vem na listagem de participantes — só no endpoint próprio", async () => {
      // Sai de toda leitura ampla para não vazar em log de resposta, em print
      // de tela nem em listagem que alguém cola num chamado de suporte.
      const [a] = await novosClientes(1);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true }
      ]);

      const lista = await participantes(processo._id);
      for (const vinculo of lista) {
        assert.equal(vinculo.codigoAcesso, undefined, "o código vazou na listagem de participantes");
      }
      assert.ok(
        !JSON.stringify(esperado(await api.get(`/processes/${processo._id}`), 200, "processo"))
          .includes("LEX-"),
        "o código vazou na leitura do processo"
      );
    });

    test("é único GLOBALMENTE, e vínculo desativado continua reservando o dele", async () => {
      // Global, não por usuário: o portal vai receber o código sem saber de
      // quem é. Dois códigos iguais em usuários diferentes seriam ambíguos
      // exatamente no momento em que ninguém está autenticado.
      const clientes = await novosClientes(6);
      const p1 = await criarProcesso(api, [
        { clienteId: clientes[0]._id, papel: "autor", principal: true },
        { clienteId: clientes[1]._id, papel: "litisconsorte", principal: false },
        { clienteId: clientes[2]._id, papel: "reu", principal: false }
      ]);
      const p2 = await criarProcesso(api, [
        { clienteId: clientes[3]._id, papel: "autor", principal: true },
        { clienteId: clientes[4]._id, papel: "litisconsorte", principal: false },
        { clienteId: clientes[5]._id, papel: "reu", principal: false }
      ]);

      // Um usuário DIFERENTE, para provar que a unicidade não é por tenant.
      const outro = await registrarUsuario("outro dono de códigos");
      const cliOutro = await criarClientePF(outro);
      const pOutro = await criarProcesso(outro, [
        { clienteId: cliOutro._id, papel: "autor", principal: true }
      ]);

      // Desativa um vínculo: o código dele tem de continuar reservado.
      esperado(
        await api.delete(`/processes/${p1._id}/clientes/${clientes[2]._id}`),
        200,
        "desativação de vínculo"
      );

      const todos = await acharEm(COLECOES.PROCESSO_CLIENTES, {});
      const codigos = todos.map((v) => v.codigoAcesso);
      const inativos = todos.filter((v) => v.ativo === false);

      assert.ok(inativos.length > 0, "o arranjo deveria ter deixado ao menos um vínculo inativo");
      for (const v of inativos) {
        assert.ok(v.codigoAcesso, "vínculo desativado perdeu o código — ele deve continuar reservado");
      }

      assert.equal(
        new Set(codigos).size,
        codigos.length,
        `há código repetido entre os ${codigos.length} vínculos (inclusive inativos e de outro usuário)`
      );
      assert.ok(
        todos.some((v) => String(v.usuarioId) !== String(todos[0].usuarioId)),
        "o teste precisa de vínculos de mais de um usuário para valer"
      );

      // E o índice único existe no banco, não só na intenção do código.
      void p2; void pOutro;
    });

    test("o índice único global de codigoAcesso existe no banco", async () => {
      const { default: ProcessoCliente } = await import("../../src/models/ProcessoCliente.js");
      const indices = await ProcessoCliente.collection.indexes();
      const doCodigo = indices.find((i) => i.key?.codigoAcesso === 1);

      assert.ok(doCodigo, "não há índice em codigoAcesso");
      assert.equal(doCodigo.unique, true, "o índice de codigoAcesso não é único");
      assert.equal(
        doCodigo.partialFilterExpression,
        undefined,
        "o índice é parcial — deixaria dois vínculos inativos compartilharem código"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Papel
  // ═════════════════════════════════════════════════════════════════════════

  describe("papel do participante", () => {
    test("os 4 valores do enum são aceitos", async () => {
      assert.deepEqual(
        [...PAPEIS].sort(),
        ["autor", "litisconsorte", "reu", "terceiro_interessado"]
      );

      const clientes = await novosClientes(PAPEIS.length);
      const processo = await criarProcesso(
        api,
        clientes.map((c, i) => ({ clienteId: c._id, papel: PAPEIS[i], principal: i === 0 }))
      );

      const lista = await participantes(processo._id);
      assert.deepEqual([...lista.map((v) => v.papel)].sort(), [...PAPEIS].sort());
    });

    test("papel fora do enum é recusado na criação e na alteração", async () => {
      const [a, b] = await novosClientes(2);

      const naCriacao = await api.post(
        "/processes",
        dadosProcesso([{ clienteId: a._id, papel: "advogado_da_parte", principal: true }])
      );
      assert.equal(naCriacao.status, 400, `esperado 400, veio ${naCriacao.status}`);

      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "reu", principal: false }
      ]);

      const naAlteracao = await api.patch(`/processes/${processo._id}/clientes/${b._id}`, {
        papel: "sindico"
      });
      assert.equal(naAlteracao.status, 400, `esperado 400, veio ${naAlteracao.status}`);

      // E o papel antigo continua lá.
      const lista = await participantes(processo._id);
      const vinculoB = lista.find((v) => String(v.clienteId._id) === String(b._id));
      assert.equal(vinculoB.papel, "reu");
    });

    test("alterar o papel não mexe em quem é o principal", async () => {
      const [a, b] = await novosClientes(2);
      const processo = await criarProcesso(api, [
        { clienteId: a._id, papel: "autor", principal: true },
        { clienteId: b._id, papel: "reu", principal: false }
      ]);

      esperado(
        await api.patch(`/processes/${processo._id}/clientes/${b._id}`, { papel: "litisconsorte" }),
        200,
        "alteração de papel"
      );

      const { principal } = await assertExatamenteUmPrincipal(processo._id, "após alterar papel");
      assert.equal(String(principal.clienteId._id), String(a._id));
    });
  });
});
