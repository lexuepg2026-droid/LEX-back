// ═══════════════════════════════════════════════════════════════════════════
// A RIGIDEZ DE `deleteClient` É INTENCIONAL — levantamento da F-2d
//
// ── O relato (passo 201, 24/08/2026) ─────────────────────────────────────
// *"Tive que desativar todos os processos que o cliente estava vinculado,
// mesmo o que ele não é o principal, para poder desativar."*
//
// A suspeita: a guarda olha QUALQUER vínculo, e por isso um cliente que é
// litisconsorte no processo de outra pessoa bloqueia a desativação —
// obrigando a advogada a mexer no processo de um terceiro.
//
// ── O veredito ───────────────────────────────────────────────────────────
// A guarda olha qualquer vínculo, SIM. E **fica como está**, porque afrouxá-la
// para o principal criaria órfão:
//
//   `ProcessoCliente` tem DOIS pais — Processo e Cliente. Um cliente
//   desativado com vínculo de litisconsorte ainda ATIVO é registro ativo sob
//   pai inativo, exatamente o que a DEC-053 existe para impedir. O
//   `auditarOrfaos.js` o reportaria como `Vínculo processo-cliente → Cliente`.
//
// A rigidez não é efeito colateral de olhar a junção: é o que a invariante da
// DEC-053 EXIGE de quem olha a junção.
//
// ── O que ERA defeito ────────────────────────────────────────────────────
// A saída correta nunca foi desativar o processo do terceiro — é DESVINCULAR
// o cliente dele. A mensagem já mandava desvincular, mas não dizia de QUAIS
// processos, e por isso o caminho mais curto pareceu ser desativar tudo. Agora
// ela nomeia os processos e o papel do cliente em cada um.
//
// E dizia **"excluir"**, palavra que a F-2b aposentou em Clientes (achado do
// passo 184).
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, criarClientePF, criarProcesso, esperado } from "../helpers/setup.js";
import { DEPENDENCIA } from "../../src/config/integrityConflicts.js";

describe("desativar cliente — a rigidez, e a frase que ela precisa dizer", () => {
  let api;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("rigidez");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // O cenário do relato: a Ana é dona do processo dela, e é LITISCONSORTE no
  // processo do Bruno. Desativar a Ana esbarra nos dois.
  const cenarioLitisconsorcio = async (sufixo) => {
    const ana = await criarClientePF(api, { nomeCompleto: `Ana Prado ${sufixo}` });
    const bruno = await criarClientePF(api, { nomeCompleto: `Bruno Salgado ${sufixo}` });

    const doBruno = await criarProcesso(api, [
      { clienteId: bruno._id, papel: "autor", principal: true },
      { clienteId: ana._id, papel: "litisconsorte", principal: false }
    ], { titulo: `Ação do Bruno ${sufixo}` });

    return { ana, bruno, doBruno };
  };

  describe("o veredito: a rigidez fica", () => {
    test("ser LITISCONSORTE no processo de outro já bloqueia — e é assim de propósito", async () => {
      const { ana, doBruno } = await cenarioLitisconsorcio("A");

      const r = await api.delete(`/clients/${ana._id}`);

      assert.equal(r.status, 409, `esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.dependencia, DEPENDENCIA.PROCESSOS);
      assert.equal(r.body.quantidade, 1);
      assert.ok(doBruno._id, "o processo do Bruno existe e é dele");
    });

    test("afrouxar para o principal criaria ÓRFÃO — o vínculo é filho do cliente", async () => {
      // Esta é a razão inteira do veredito, e ela é medível: o vínculo de
      // litisconsorte é um registro ATIVO cujo pai (o cliente) ficaria INATIVO.
      //
      // O teste prova o antecedente — que o vínculo existe e está ativo
      // enquanto o cliente está ativo. Se a guarda fosse afrouxada para
      // `principal`, este mesmo vínculo sobreviveria à desativação do cliente,
      // e o `auditarOrfaos.js` o listaria.
      const { ana, doBruno } = await cenarioLitisconsorcio("B");

      const participantes = esperado(
        await api.get(`/processes/${doBruno._id}/clientes`),
        200,
        "participantes"
      );
      const lista = participantes.data ?? participantes;

      const vinculoDaAna = lista.find(
        (v) => String(v.clienteId?._id ?? v.clienteId) === String(ana._id)
      );

      assert.ok(vinculoDaAna, "a Ana participa do processo do Bruno");
      assert.equal(vinculoDaAna.papel, "litisconsorte");
      assert.equal(vinculoDaAna.principal, false, "ela NÃO é a principal — e mesmo assim bloqueia");
    });

    test("a saída é DESVINCULAR, não desativar o processo do terceiro", async () => {
      // O caminho correto, exercido inteiro: a advogada tira a Ana do processo
      // do Bruno, desativa o processo DELA, e então desativa a Ana. O processo
      // do Bruno nunca é tocado.
      const { ana, bruno, doBruno } = await cenarioLitisconsorcio("C");

      const daAna = await criarProcesso(api, [
        { clienteId: ana._id, papel: "autor", principal: true }
      ], { titulo: "Ação da Ana C" });

      esperado(
        await api.delete(`/processes/${doBruno._id}/clientes/${ana._id}`),
        200,
        "desvincular a Ana do processo do Bruno"
      );
      esperado(await api.delete(`/processes/${daAna._id}`), 200, "desativar o processo dela");
      esperado(await api.delete(`/clients/${ana._id}`), 200, "desativar a Ana");

      // E o processo do Bruno continua ATIVO e intacto — que é o ponto do
      // relato: ela não precisou mexer nele.
      const dele = esperado(
        await api.get(`/processes/${doBruno._id}`),
        200,
        "o processo do Bruno continua alcançável"
      );
      assert.equal(dele.ativo, true, "o processo do terceiro NÃO foi desativado");
      assert.equal(
        String(dele.clientePrincipalId?._id ?? dele.clientePrincipalId),
        String(bruno._id)
      );
    });
  });

  describe("a frase: nomeia os processos, e não diz mais `excluir`", () => {
    test("a recusa NOMEIA os processos que bloqueiam", async () => {
      // Mesma razão da DEC-053: recusa que não nomeia manda a advogada
      // procurar, num cadastro inteiro, o que está no caminho.
      const { ana } = await cenarioLitisconsorcio("D");

      const r = await api.delete(`/clients/${ana._id}`);

      assert.equal(r.status, 409);
      assert.ok(
        r.body.message.includes("Ação do Bruno D"),
        `a recusa precisa nomear o processo — ${r.body.message}`
      );
    });

    test("o PAPEL aparece quando o cliente não é o principal", async () => {
      // É ali que mora a surpresa do relato: a advogada não espera que o
      // processo de um terceiro apareça na lista, e "(litisconsorte)" explica
      // por que ele está.
      const { ana } = await cenarioLitisconsorcio("E");

      const r = await api.delete(`/clients/${ana._id}`);

      assert.match(
        r.body.message,
        /litisconsorte/,
        `o papel precisa aparecer — ${r.body.message}`
      );
    });

    test("os processos vêm estruturados em `errors.processosBloqueando`", async () => {
      // A tela não deve extrair nada por regex da prosa — foi assim que a Fase
      // 1.3 quebrou. Mesma escolha que a DEC-053 fez com `paisInativos`.
      const { ana, doBruno } = await cenarioLitisconsorcio("F");

      const r = await api.delete(`/clients/${ana._id}`);

      const bloqueando = r.body.errors?.processosBloqueando;
      assert.ok(Array.isArray(bloqueando), `esperado vetor — ${JSON.stringify(r.body)}`);
      assert.equal(bloqueando.length, 1);
      assert.equal(bloqueando[0].id, String(doBruno._id));
      assert.equal(bloqueando[0].papel, "litisconsorte");
      assert.equal(bloqueando[0].principal, false);
      assert.equal(bloqueando[0].titulo, "Ação do Bruno F");
    });

    test("a palavra `excluir` SAIU: a ação é `desativar` desde a F-2b", async () => {
      // Achado do passo 184. A mensagem prometia uma destruição que não
      // acontece — e mandava procurar um botão que a tela já não tem.
      const { ana } = await cenarioLitisconsorcio("G");

      const r = await api.delete(`/clients/${ana._id}`);

      assert.doesNotMatch(
        r.body.message,
        /exclu/i,
        `a mensagem ainda diz "excluir" — ${r.body.message}`
      );
      assert.match(r.body.message, /desativar/i);
    });

    test("a frase diz que NÃO é preciso desativar o processo", async () => {
      // O relato inteiro nasceu de a advogada não saber disso.
      const { ana } = await cenarioLitisconsorcio("H");

      const r = await api.delete(`/clients/${ana._id}`);

      assert.match(r.body.message, /Desvincule-o/);
      assert.match(r.body.message, /não é preciso desativar o processo/);
    });

    test("com muitos processos a frase corta, e o vetor continua inteiro", async () => {
      // Uma frase de toast com trinta títulos não é frase. O corte é da
      // MENSAGEM; `errors.processosBloqueando` traz todos, e é dele que a tela
      // monta a lista completa.
      const zeca = await criarClientePF(api, { nomeCompleto: "Zeca Moura" });
      for (let i = 1; i <= 5; i += 1) {
        await criarProcesso(api, [
          { clienteId: zeca._id, papel: "autor", principal: true }
        ], { titulo: `Ação Zeca ${i}` });
      }

      const r = await api.delete(`/clients/${zeca._id}`);

      assert.equal(r.status, 409);
      assert.equal(r.body.quantidade, 5);
      assert.match(r.body.message, /e mais 2/, `esperado corte — ${r.body.message}`);
      assert.equal(r.body.errors.processosBloqueando.length, 5, "o vetor vem inteiro");
    });
  });

  describe("o outro `excluir` que sobrou (passo 184)", () => {
    test("remover o único participante manda DESATIVAR o processo, não excluí-lo", async () => {
      const solo = await criarClientePF(api, { nomeCompleto: "Solange Vieira" });
      const processo = await criarProcesso(api, [
        { clienteId: solo._id, papel: "autor", principal: true }
      ]);

      const r = await api.delete(`/processes/${processo._id}/clientes/${solo._id}`);

      assert.equal(r.status, 409, `esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.doesNotMatch(
        r.body.message,
        /exclu/i,
        `a mensagem ainda diz "excluir" — ${r.body.message}`
      );
      assert.match(r.body.message, /desative o processo/i);
    });
  });
});
