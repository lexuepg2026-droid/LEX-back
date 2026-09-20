// ═══════════════════════════════════════════════════════════════════════════
// F-6.2 — TROCA DE `tipoPessoa` (PF ↔ PJ) NUM CLIENTE JÁ CADASTRADO
//
// ── O que já existia, e o que este arquivo passa a provar ────────────────
// O backend sempre aceitou a troca por `PATCH /clients/:id` (`tipoPessoa` está
// na allowlist e `updateClient` a trata), mas NENHUM teste a exercitava — a
// única coisa que a impedia era o frontend. Abrir o seletor da tela sem antes
// travar o comportamento do servidor seria confiar em código que ninguém
// nunca rodou.
//
// ── Onde a limpeza dos campos do tipo antigo mora: DUAS camadas ───────────
//   1. `normalizeClientData`, em `clientService.js`, que zera os campos do
//      tipo oposto ANTES de gravar;
//   2. o `pre("validate")` de `models/Client.js`, que faz o mesmo em todo
//      `save()`, inclusive de quem não passa pelo serviço.
//
// As duas são redundantes entre si DE PROPÓSITO, e é por isso que a suíte tem
// dois níveis: os testes HTTP (1–5) provam o comportamento de ponta a ponta e
// só caem se as DUAS camadas quebrarem; os testes do hook (6) exercitam o
// model SEM o serviço, e são os que caem quando só o hook é neutralizado.
// Sem o nível 6, apagar a limpeza do hook passaria despercebido — o serviço
// a cobriria em silêncio.
//
// ── O que se confere no banco, e não na resposta ──────────────────────────
// A resposta JSON omite `undefined` e `null` da mesma forma aparente. O que
// libera o índice único parcial é o campo NÃO EXISTIR (ou não ser string) —
// por isso os testes leem o documento cru da coleção.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, desconectar, acharEm, TODAS_AS_COLECOES } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarClientePJ, criarProcesso, esperado
} from "../helpers/setup.js";
import { cpfValido, cnpjValido } from "../helpers/factories.js";
import Client from "../../src/models/Client.js";

const CAMPOS_PF = [
  "nomeCompleto", "cpf", "rg", "dataNascimento", "sexo", "estadoCivil",
  "profissao", "nacionalidade"
];
const CAMPOS_PJ = ["razaoSocial", "nomeFantasia", "cnpj", "representanteLegal"];

const cru = async (id) => {
  const [doc] = await acharEm("clients", { _id: new mongoose.Types.ObjectId(id) });
  return doc;
};

// "Ausente" no documento cru: a chave nem existe. `null` não serve — passaria
// no índice parcial, mas deixaria lixo que a listagem e o portal leriam.
const assertAusentes = (doc, campos, contexto) => {
  for (const campo of campos) {
    assert.ok(
      !(campo in doc),
      `${contexto}: o campo "${campo}" continua no documento (${JSON.stringify(doc[campo])}) — ` +
      `esperado que o $unset o removesse`
    );
  }
};

const dadosPJ = (extra = {}) => ({
  tipoPessoa: "juridica",
  razaoSocial: "Empresa Nascida de PF Ltda",
  nomeFantasia: "Nascida de PF",
  cnpj: cnpjValido(),
  ...extra
});

const dadosPF = (extra = {}) => ({
  tipoPessoa: "fisica",
  nomeCompleto: "Pessoa Nascida de PJ",
  cpf: cpfValido(),
  nacionalidade: "brasileira",
  ...extra
});

describe("F-6.2 — troca de tipoPessoa (PF ↔ PJ)", () => {
  let adv;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    adv = await registrarUsuario("troca-de-tipo");
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("1. PF → PJ", () => {
    test("troca o tipo, mantém o _id e os dados comuns, e REMOVE os campos de PF", async () => {
      const pf = await criarClientePF(adv, {
        nomeCompleto: "Fulana de Tal",
        observacoes: "observação que sobrevive à troca"
      });
      assert.ok(pf.cpf && pf.rg && pf.nomeCompleto, "arranjo: PF completo");

      const corpo = dadosPJ();
      const r = esperado(await adv.patch(`/clients/${pf._id}`, corpo), 200, "PF → PJ");

      assert.equal(r._id, pf._id, "o _id NÃO muda — é o que mantém processos e documentos ligados");
      assert.equal(r.tipoPessoa, "juridica");
      assert.equal(r.razaoSocial, corpo.razaoSocial);
      assert.equal(r.cnpj, corpo.cnpj);

      // Dados comuns preservados.
      assert.equal(r.email, pf.email);
      assert.equal(r.telefone, pf.telefone);
      assert.equal(r.observacoes, "observação que sobrevive à troca");
      assert.equal(r.endereco.cidade, pf.endereco.cidade);

      // Na RESPOSTA e no BANCO: nenhum campo de PF.
      assertAusentes(r, CAMPOS_PF, "resposta do PATCH");
      const doc = await cru(pf._id);
      assertAusentes(doc, CAMPOS_PF, "documento no banco");
      assert.equal(doc.tipoPessoa, "juridica");
    });

    test("nomeExibicao passa a ser a razão social — a ordem alfabética acompanha a troca", async () => {
      const pf = await criarClientePF(adv, { nomeCompleto: "Zzz Nome Antigo de Pessoa" });
      assert.equal(pf.nomeExibicao, "Zzz Nome Antigo de Pessoa");

      const r = esperado(
        await adv.patch(`/clients/${pf._id}`, dadosPJ({ razaoSocial: "Aaa Empresa Nova" })),
        200, "PF → PJ"
      );

      // O defeito que o comentário do hook (Client.js) descreve: derivar antes
      // da limpeza deixaria o cliente ordenado para sempre pelo nome que perdeu.
      assert.equal(r.nomeExibicao, "Aaa Empresa Nova");
      assert.equal((await cru(pf._id)).nomeExibicao, "Aaa Empresa Nova");
    });

    test("representanteLegal pode ser enviado na troca e é gravado", async () => {
      const pf = await criarClientePF(adv);
      const r = esperado(
        await adv.patch(`/clients/${pf._id}`, dadosPJ({
          representanteLegal: { nome: "Sócio Administrador", cpf: cpfValido(), cargo: "sócio" }
        })),
        200, "PF → PJ com representante"
      );
      assert.equal(r.representanteLegal.nome, "Sócio Administrador");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("2. PJ → PF", () => {
    test("troca o tipo, mantém o _id e os dados comuns, e REMOVE os campos de PJ", async () => {
      const pj = await criarClientePJ(adv, { razaoSocial: "Empresa Que Vira Pessoa Ltda" });
      assert.ok(pj.cnpj && pj.razaoSocial && pj.nomeFantasia && pj.representanteLegal, "arranjo: PJ completo");

      const corpo = dadosPF();
      const r = esperado(await adv.patch(`/clients/${pj._id}`, corpo), 200, "PJ → PF");

      assert.equal(r._id, pj._id);
      assert.equal(r.tipoPessoa, "fisica");
      assert.equal(r.nomeCompleto, corpo.nomeCompleto);
      assert.equal(r.cpf, corpo.cpf);
      assert.equal(r.email, pj.email);
      assert.equal(r.telefone, pj.telefone);

      assertAusentes(r, CAMPOS_PJ, "resposta do PATCH");
      const doc = await cru(pj._id);
      assertAusentes(doc, CAMPOS_PJ, "documento no banco");
      assert.equal(doc.nomeExibicao, corpo.nomeCompleto);
    });

    test("ida e volta (PF → PJ → PF) termina como PF válido, sem resíduo da passagem por PJ", async () => {
      const pf = await criarClientePF(adv, { nomeCompleto: "Ida e Volta" });

      esperado(await adv.patch(`/clients/${pf._id}`, dadosPJ()), 200, "ida");
      const cpfNovo = cpfValido();
      esperado(
        await adv.patch(`/clients/${pf._id}`, dadosPF({ nomeCompleto: "Ida e Volta Depois", cpf: cpfNovo })),
        200, "volta"
      );

      const doc = await cru(pf._id);
      assert.equal(doc.tipoPessoa, "fisica");
      assert.equal(doc.cpf, cpfNovo);
      assertAusentes(doc, CAMPOS_PJ, "depois da volta");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("3. o índice ANTIGO é liberado (o $unset)", () => {
    test("depois de PF → PJ, o CPF que o cliente tinha pode ser cadastrado de novo", async () => {
      const pf = await criarClientePF(adv);
      const cpfLiberado = pf.cpf;

      esperado(await adv.patch(`/clients/${pf._id}`, dadosPJ()), 200, "PF → PJ");

      // Se o `cpf` tivesse ficado no documento, o índice único
      // {usuarioId, cpf} recusaria este cadastro com 409.
      const novo = await adv.post("/clients", {
        tipoPessoa: "fisica", nomeCompleto: "Novo Dono do CPF", cpf: cpfLiberado
      });
      esperado(novo, 201, "recadastrar o CPF liberado");
      assert.equal(novo.body.cpf, cpfLiberado);
    });

    test("depois de PJ → PF, o CNPJ que o cliente tinha pode ser cadastrado de novo", async () => {
      const pj = await criarClientePJ(adv);
      const cnpjLiberado = pj.cnpj;

      esperado(await adv.patch(`/clients/${pj._id}`, dadosPF()), 200, "PJ → PF");

      const novo = await adv.post("/clients", {
        tipoPessoa: "juridica", razaoSocial: "Novo Dono do CNPJ Ltda",
        nomeFantasia: "Novo Dono", cnpj: cnpjLiberado
      });
      esperado(novo, 201, "recadastrar o CNPJ liberado");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("4. o índice NOVO barra duplicidade (409)", () => {
    test("PF → PJ com CNPJ que outro cliente do mesmo usuário já tem → 409 em `cnpj`, e nada muda", async () => {
      const dono = await criarClientePJ(adv);
      const pf = await criarClientePF(adv, { nomeCompleto: "Tentando CNPJ Alheio" });

      const r = await adv.patch(`/clients/${pf._id}`, dadosPJ({ cnpj: dono.cnpj }));
      assert.equal(r.status, 409, `esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.campo, "cnpj", "a tela precisa saber qual input destacar");

      // A troca NÃO pode ter pegado pela metade.
      const doc = await cru(pf._id);
      assert.equal(doc.tipoPessoa, "fisica", "o cliente continua PF");
      assert.equal(doc.cpf, pf.cpf, "e continua com o CPF");
      assert.equal(doc.nomeCompleto, "Tentando CNPJ Alheio");
      assertAusentes(doc, CAMPOS_PJ, "após o 409");
    });

    test("PJ → PF com CPF que outro cliente do mesmo usuário já tem → 409 em `cpf`, e nada muda", async () => {
      const dono = await criarClientePF(adv);
      const pj = await criarClientePJ(adv, { razaoSocial: "Tentando CPF Alheio Ltda" });

      const r = await adv.patch(`/clients/${pj._id}`, dadosPF({ cpf: dono.cpf }));
      assert.equal(r.status, 409, `esperado 409, veio ${r.status} — ${JSON.stringify(r.body)}`);
      assert.equal(r.body.campo, "cpf");

      const doc = await cru(pj._id);
      assert.equal(doc.tipoPessoa, "juridica");
      assert.equal(doc.cnpj, pj.cnpj);
      assertAusentes(doc, CAMPOS_PF, "após o 409");
    });

    test("o índice é POR USUÁRIO: o mesmo CNPJ em outra conta não conflita", async () => {
      const outra = await registrarUsuario("outra-conta");
      const dela = await criarClientePJ(outra);
      const pf = await criarClientePF(adv);

      esperado(
        await adv.patch(`/clients/${pf._id}`, dadosPJ({ cnpj: dela.cnpj })),
        200, "mesmo CNPJ em outro tenant"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("5. troca incompleta ou incoerente é recusada, sem gravar nada", () => {
    test("PF → PJ sem os campos de PJ → 400 nomeando o que falta; o cliente segue PF", async () => {
      const pf = await criarClientePF(adv);

      const r = await adv.patch(`/clients/${pf._id}`, { tipoPessoa: "juridica" });
      assert.equal(r.status, 400, `${JSON.stringify(r.body)}`);
      assert.match(r.body.message, /razão social/i);

      const doc = await cru(pf._id);
      assert.equal(doc.tipoPessoa, "fisica");
      assert.equal(doc.cpf, pf.cpf, "nenhum campo de PF foi perdido");
    });

    test("PJ → PF sem os campos de PF → 400; o cliente segue PJ", async () => {
      const pj = await criarClientePJ(adv);

      const r = await adv.patch(`/clients/${pj._id}`, { tipoPessoa: "fisica" });
      assert.equal(r.status, 400, `${JSON.stringify(r.body)}`);
      assert.match(r.body.message, /nome completo|CPF/i);

      const doc = await cru(pj._id);
      assert.equal(doc.tipoPessoa, "juridica");
      assert.equal(doc.cnpj, pj.cnpj);
    });

    test("campo do tipo ANTIGO no corpo da troca → 400 (a exclusividade não vira descarte silencioso)", async () => {
      const pf = await criarClientePF(adv);

      const r = await adv.patch(`/clients/${pf._id}`, dadosPJ({ cpf: pf.cpf }));
      assert.equal(r.status, 400, `${JSON.stringify(r.body)}`);
      assert.match(r.body.message, /cpf/i);
      assert.equal((await cru(pf._id)).tipoPessoa, "fisica");
    });

    test("tipoPessoa inválido → 400", async () => {
      const pf = await criarClientePF(adv);
      const r = await adv.patch(`/clients/${pf._id}`, { tipoPessoa: "mista" });
      assert.equal(r.status, 400);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe("5b. o vínculo com o processo sobrevive à troca (o _id não muda)", () => {
    test("o processo continua ligado ao cliente e passa a exibi-lo como PJ", async () => {
      const pf = await criarClientePF(adv, { nomeCompleto: "Cliente Com Processo" });
      const processo = await criarProcesso(adv, [
        { clienteId: pf._id, papel: "autor", principal: true }
      ]);

      esperado(
        await adv.patch(`/clients/${pf._id}`, dadosPJ({ razaoSocial: "Cliente Com Processo S/A" })),
        200, "PF → PJ de cliente com processo"
      );

      const lido = esperado(await adv.get(`/processes/${processo._id}`), 200, "processo depois da troca");
      const cliente = lido.clientePrincipalId;
      assert.equal(String(cliente._id ?? cliente), pf._id, "o vínculo aponta para o mesmo _id");
      assert.equal(cliente.tipoPessoa, "juridica");
      assert.equal(cliente.razaoSocial, "Cliente Com Processo S/A");
      assert.ok(!("nomeCompleto" in cliente), "o nome de PF não pode aparecer na ficha do processo");

      const participantes = esperado(
        await adv.get(`/processes/${processo._id}/clientes`), 200, "participantes"
      );
      assert.equal(participantes.total, 1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // O HOOK SOZINHO — sem `normalizeClientData` por perto.
  //
  // `hydrate` monta um documento como se tivesse vindo do banco (`isNew`
  // falso), que é o estado em que `updateClient` o recebe. Trocar o tipo e
  // chamar `validate()` exercita exatamente o `pre("validate")`, e é o único
  // nível em que neutralizar a limpeza do hook derruba um teste — o serviço
  // cobre a mesma limpeza nos testes HTTP acima.
  describe("6. o hook pre(validate) do model, isolado do serviço", () => {
    const base = () => ({
      _id: new mongoose.Types.ObjectId(),
      usuarioId: new mongoose.Types.ObjectId()
    });

    test("PF → PJ: o hook apaga os campos de PF e recalcula nomeExibicao", async () => {
      const doc = Client.hydrate({
        ...base(),
        tipoPessoa: "fisica",
        nomeCompleto: "Pessoa Antiga",
        cpf: cpfValido(), rg: "1234567", sexo: "feminino", estadoCivil: "solteiro",
        profissao: "engenheira", nacionalidade: "brasileira",
        dataNascimento: new Date("1985-03-14"),
        nomeExibicao: "Pessoa Antiga"
      });

      // Só troca o tipo e preenche o novo — SEM limpar nada à mão.
      doc.tipoPessoa = "juridica";
      doc.razaoSocial = "Empresa Nova Ltda";
      doc.nomeFantasia = "Nova";
      doc.cnpj = cnpjValido();

      await doc.validate();

      for (const campo of CAMPOS_PF) {
        assert.equal(doc[campo], undefined, `o hook deixou "${campo}" no documento PJ`);
      }
      assert.equal(doc.nomeExibicao, "Empresa Nova Ltda");
    });

    test("PJ → PF: o hook apaga os campos de PJ (inclusive o subdocumento) e recalcula nomeExibicao", async () => {
      const doc = Client.hydrate({
        ...base(),
        tipoPessoa: "juridica",
        razaoSocial: "Empresa Antiga Ltda", nomeFantasia: "Antiga", cnpj: cnpjValido(),
        representanteLegal: { nome: "Sócio", cpf: cpfValido(), cargo: "sócio" },
        nomeExibicao: "Empresa Antiga Ltda"
      });

      doc.tipoPessoa = "fisica";
      doc.nomeCompleto = "Pessoa Nova";
      doc.cpf = cpfValido();

      await doc.validate();

      for (const campo of CAMPOS_PJ) {
        assert.equal(doc[campo], undefined, `o hook deixou "${campo}" no documento PF`);
      }
      assert.equal(doc.nomeExibicao, "Pessoa Nova");
    });

    test("o hook recusa a troca sem os campos obrigatórios do tipo novo", async () => {
      const doc = Client.hydrate({
        ...base(), tipoPessoa: "fisica", nomeCompleto: "X", cpf: cpfValido()
      });
      doc.tipoPessoa = "juridica";

      await assert.rejects(() => doc.validate(), /razão social/i);
    });
  });
});
