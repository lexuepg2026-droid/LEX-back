// ═══════════════════════════════════════════════════════════════════════════
// ALLOWLIST DE PATCH — o contorno do `ativo` fechado (Fase 4.5)
//
// Achados #1, #2, #11 e 5.3 da Auditoria Geral nº 2.
//
// ── O que este arquivo trava, e por que importa ───────────────────────────
// Antes da Fase 4.5, `PATCH { "ativo": false }` desativava o registro em CINCO
// das sete entidades, pulando os 409 de integridade que só o DELETE aplica.
// Medido contra o seed, com o servidor de pé:
//
//   clients       200  → desativado        secoes    400 → bloqueado
//   processes     404  → desativado        documents 400 → bloqueado
//   fees          200  → desativado
//   installments  200  → desativado
//   payments      200  → desativado  (`ativo` estava na allowlist DE PROPÓSITO)
//
// ── O caso do processo, que não estava no relatório da auditoria ──────────
// É o pior dos sete e tem teste próprio abaixo. `updateProcess` gravava por
// `findOneAndUpdate({ ativo: true })` e depois relia por `getProcessById`, que
// também filtra `ativo: true`. A escrita ACONTECIA e a releitura não encontrava
// mais nada: a rota respondia **"Processo não encontrado"** para uma requisição
// que acabara de desativar o processo. Destruição relatada como erro de busca —
// e, para quem lesse só o status, uma operação que "não fez nada".
//
// Por isso a asserção não para no 400: cada caso confere que o registro
// CONTINUA ATIVO depois da tentativa. Um 400 com o registro desativado seria o
// mesmo defeito com outra roupa.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarProcesso, criarHonorario,
  criarParcela, criarPagamento, criarSecao, criarModelo, esperado
} from "../helpers/setup.js";
import { CAMPOS_UPDATE } from "../../src/validations/shared/camposPermitidos.js";
import { CAMPOS_PERMITIDOS_UPDATE_TESTE } from "../../src/validations/paymentValidation.js";

describe("allowlist de PATCH — `ativo` fora do corpo em todas as entidades", () => {
  let api;
  // { rota, id, rotuloDoRecurso }
  let alvos;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);

    api = await registrarUsuario("allowlist");

    const pf = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);
    const honorario = await criarHonorario(api, processo._id);
    const parcela = await criarParcela(api, honorario._id, 1);
    const { pagamento } = await criarPagamento(api, honorario._id);
    const secao = await criarSecao(api, { titulo: `Seção allowlist ${Date.now()}` });
    const modelo = await criarModelo(api);

    alvos = [
      { rota: "clients", id: pf._id },
      { rota: "processes", id: processo._id },
      { rota: "fees", id: honorario._id },
      { rota: "installments", id: parcela._id },
      { rota: "payments", id: pagamento._id },
      { rota: "secoes", id: secao._id },
      { rota: "documents", id: modelo._id }
    ];
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  const continuaAtivo = async (rota, id) => {
    const r = await api.get(`/${rota}/${id}`);
    assert.equal(
      r.status, 200,
      `${rota}: o registro deveria continuar legível (ativo) e veio ${r.status}`
    );
    assert.notEqual(
      r.body.ativo, false,
      `${rota}: o registro foi DESATIVADO por um PATCH que devia recusá-lo`
    );
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 1 — A matriz: `ativo` recusado nas SETE, e nada é desativado
  // ═════════════════════════════════════════════════════════════════════════
  test("PATCH { ativo: false } responde 400 com `campo` nas sete entidades", async () => {
    for (const { rota, id } of alvos) {
      const r = await api.patch(`/${rota}/${id}`, { ativo: false });

      assert.equal(r.status, 400, `${rota}: esperado 400 — veio ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.campo, "ativo", `${rota}: o 400 precisa trazer campo:"ativo" para a tela destacar`);
      assert.match(
        r.body.message, /DELETE/,
        `${rota}: a mensagem precisa apontar o DELETE — recusar sem dizer o caminho certo é beco sem saída`
      );

      await continuaAtivo(rota, id);
    }
  });

  test("PATCH { ativo: true } também é recusado", async () => {
    // O título dizia "reativar tem rota própria" até a F-0. As duas rotas de
    // reativação morreram na F-1a (DEC-034) e a recusa continua — agora sem
    // caminho alternativo nenhum, o que a torna mais importante e não menos:
    // é a única coisa entre a advogada e um registro desativado em silêncio.
    for (const { rota, id } of alvos) {
      const r = await api.patch(`/${rota}/${id}`, { ativo: true });
      assert.equal(r.status, 400, `${rota}: { ativo: true } também sai pela allowlist`);
      assert.equal(r.body.campo, "ativo", `${rota}: campo "ativo" no 400`);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2 — O processo: a destruição que respondia 404
  //
  // Teste dedicado porque o defeito não era o 400 ausente: era a ESCRITA
  // acontecendo. Um `assert` só no status passaria mesmo com o bug de volta,
  // já que 404 também não é 200.
  // ═════════════════════════════════════════════════════════════════════════
  test("processo: a tentativa não desativa e não responde 404", async () => {
    const pf = await criarClientePF(api);
    const processo = await criarProcesso(api, [
      { clienteId: pf._id, papel: "autor", principal: true }
    ]);

    const r = await api.patch(`/processes/${processo._id}`, { ativo: false });

    assert.equal(r.status, 400, "o processo precisa recusar com 400");
    assert.notEqual(
      r.status, 404,
      "404 aqui é o defeito original: significa que a escrita passou e a releitura não achou o registro"
    );

    const depois = await api.get(`/processes/${processo._id}`);
    assert.equal(depois.status, 200, "o processo tem de continuar existindo depois da tentativa");
    assert.equal(depois.body.ativo, true, "o processo NÃO pode ter sido desativado");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3 — 5.3: campo desconhecido → 400 uniforme
  // ═════════════════════════════════════════════════════════════════════════
  test("campo desconhecido responde 400 com `campo` nas SETE entidades", async () => {
    for (const { rota, id } of alvos) {
      const r = await api.patch(`/${rota}/${id}`, { campoInventado: "x" });

      assert.equal(r.status, 400, `${rota}: campo desconhecido precisa dar 400`);
      assert.equal(
        r.body.campo, "campoInventado",
        `${rota}: o 400 nomeia o campo recusado — "campo desconhecido" sem dizer qual é inútil num formulário grande`
      );
    }
  });

  test("campo desconhecido ao lado de campo válido também é recusado", async () => {
    // O buraco que a Seção tinha ANTES da 4.5: a checagem antiga só reclamava
    // quando NADA era reconhecido. `{ titulo: "x", ativo: false }` passava, e o
    // `ativo` era descartado em silêncio — sem erro e sem efeito, que é o pior
    // dos dois mundos para quem está tentando entender o que aconteceu.
    const secao = alvos.find((a) => a.rota === "secoes");
    const r = await api.patch(`/secoes/${secao.id}`, { titulo: "Título novo", ativo: false });

    assert.equal(r.status, 400, "campo válido não pode servir de carona para o desconhecido");
    assert.equal(r.body.campo, "ativo");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4 — Os updates LEGÍTIMOS continuam passando
  //
  // Sem este bloco, uma allowlist vazia passaria em tudo acima.
  // ═════════════════════════════════════════════════════════════════════════
  test("os updates legítimos de cada entidade continuam respondendo 200", async () => {
    const legitimos = [
      ["clients", { telefone: "42999998888" }],
      ["processes", { observacoes: "anotação de teste" }],
      ["fees", { descricao: "descrição nova" }],
      ["installments", { observacoes: "obs" }],
      // `formaPagamento` era o update legítimo até a F-0. A allowlist de
      // `payments` encolheu para UM campo (DEC-032): corrigir dinheiro
      // gravado deixou de ser edição e virou estorno.
      ["payments", { observacoes: "anotação sobre o pagamento" }],
      ["secoes", { titulo: `Título legítimo ${Date.now()}` }],
      ["documents", { descricao: "descrição do modelo" }]
    ];

    for (const [rota, corpo] of legitimos) {
      const { id } = alvos.find((a) => a.rota === rota);
      const r = await api.patch(`/${rota}/${id}`, corpo);
      esperado(r, 200, `PATCH legítimo em ${rota}`);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5 — `ativo` não pode voltar a nenhuma allowlist, por descuido
  // ═════════════════════════════════════════════════════════════════════════
  test("nenhuma allowlist declara `ativo`", () => {
    for (const [recurso, campos] of Object.entries(CAMPOS_UPDATE)) {
      assert.ok(
        !campos.includes("ativo"),
        `${recurso}: "ativo" voltou à allowlist — desativar é papel do DELETE, que é onde moram os 409 de integridade`
      );
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5b — O caminho de upload está DORMENTE também para escrita (Fase F-0)
  //
  // A decisão 16 diz que upload está fora do escopo e a interface não o
  // oferece. A allowlist, porém, deixava `urlArquivo`, `tamanho` e `dataUpload`
  // abertos no PATCH, e a auditoria de retomada mediu o resultado contra o
  // seed:
  //
  //     PATCH /documents/<gerado> { urlArquivo, tamanho, dataUpload } → 200
  //     GET   /documents/<gerado> → origem "gerado", urlArquivo "https://…"
  //
  // Um documento GERADO passava a declarar que veio de arquivo enviado — estado
  // incoerente aceito em silêncio, num módulo cuja tese é que documento gerado
  // é congelado e rastreável até a origem.
  // ═════════════════════════════════════════════════════════════════════════
  const docId = () => alvos.find((a) => a.rota === "documents").id;

  test("os três campos de upload são recusados no PATCH de documento", async () => {
    const casos = [
      ["urlArquivo", { urlArquivo: "https://arquivos.lex.test/injetado.pdf" }],
      ["tamanho", { tamanho: 123 }],
      ["dataUpload", { dataUpload: "2026-01-01" }]
    ];

    for (const [campo, corpo] of casos) {
      const r = await api.patch(`/documents/${docId()}`, corpo);

      assert.equal(
        r.status, 400,
        `PATCH /documents { ${campo} }: o caminho de upload está dormente e não se escreve por aqui`
      );
      assert.equal(r.body.campo, campo, `o 400 precisa nomear "${campo}"`);
    }

    // Os três juntos, que é a forma medida na auditoria.
    const juntos = await api.patch(`/documents/${docId()}`, {
      urlArquivo: "https://arquivos.lex.test/injetado.pdf",
      tamanho: 123,
      dataUpload: "2026-01-01"
    });
    assert.equal(juntos.status, 400, "os três juntos também são recusados");
  });

  test("o documento não foi contaminado pela tentativa", async () => {
    // A recusa precisa ser recusa, e não 400 depois de gravar.
    //
    // A comparação é ANTES × DEPOIS, e não contra `undefined`: `dataUpload` tem
    // `default: Date.now` no model (`Document.js:88`), então todo documento
    // nasce com ela preenchida. Afirmar "é undefined" passaria a descrever o
    // default, não a recusa — e continuaria passando se o PATCH voltasse a
    // gravar, desde que gravasse a mesma data.
    const antes = esperado(
      await api.get(`/documents/${docId()}`),
      200, "documento antes da tentativa"
    );

    const injetado = {
      urlArquivo: "https://arquivos.lex.test/contaminado.pdf",
      tamanho: 999,
      dataUpload: "2020-01-01"
    };
    assert.equal((await api.patch(`/documents/${docId()}`, injetado)).status, 400);

    const depois = esperado(
      await api.get(`/documents/${docId()}`),
      200, "documento depois da tentativa"
    );

    assert.equal(depois.urlArquivo, antes.urlArquivo, "`urlArquivo` não pode ter mudado");
    assert.equal(depois.tamanho, antes.tamanho, "`tamanho` não pode ter mudado");
    assert.equal(depois.dataUpload, antes.dataUpload, "`dataUpload` não pode ter mudado");

    // E, especificamente, nada do que foi enviado entrou.
    assert.notEqual(depois.urlArquivo, injetado.urlArquivo);
    assert.notEqual(depois.tamanho, injetado.tamanho);
  });

  test("nenhuma allowlist declara campo de upload", () => {
    for (const campo of ["urlArquivo", "tamanho", "dataUpload"]) {
      assert.ok(
        !CAMPOS_UPDATE.documents.includes(campo),
        `"${campo}" voltou à allowlist de documents — o upload continua dormente (decisão 16)`
      );
    }

    // `origem` FICA, de propósito: a validação já o recusa com mensagem
    // própria ("urlArquivo é obrigatório quando origem é upload"), que diz mais
    // do que a genérica de campo desconhecido.
    assert.ok(
      CAMPOS_UPDATE.documents.includes("origem"),
      "`origem` sai da allowlist só junto com a tela de upload — ver o comentário em camposPermitidos.js"
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6 — `validateUpdatePayment` mora no SERVICE (achado de passagem da 4.5)
  //
  // Rodando no controller, ela corria ANTES da allowlist e a engolia: com
  // `ativo` fora dos campos conhecidos, `camposValidosEnviados` ficava vazio e
  // a resposta virava "Informe ao menos um campo válido para atualização" —
  // sem `campo` e sem dizer o que estava errado. Era também o único módulo
  // financeiro fora da convenção "validação sempre no service, nunca no
  // controller" (sessão de 09/05).
  //
  // A varredura é estática porque o defeito é de LUGAR, não de resultado: as
  // duas montagens respondem 400, e só a ordem distingue uma da outra.
  // ═════════════════════════════════════════════════════════════════════════
  test("o controller de pagamento não valida payload — quem valida é o service", async () => {
    const { readFile } = await import("node:fs/promises");

    const controller = await readFile(
      new URL("../../src/controllers/paymentController.js", import.meta.url), "utf8"
    );
    const semComentarios = controller
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    assert.ok(
      !/validateUpdatePayment\s*\(/.test(semComentarios),
      "`validateUpdatePayment` voltou ao controller — de lá ela engole a recusa da allowlist"
    );

    const service = await readFile(
      new URL("../../src/services/paymentService.js", import.meta.url), "utf8"
    );
    assert.ok(
      /validateUpdatePayment\s*\(/.test(service),
      "o service precisa validar o payload — sem isso o PATCH de pagamento fica sem validação nenhuma"
    );
  });

  test("payload inválido em pagamento continua sendo recusado depois da mudança", async () => {
    // A contraprova do teste acima: mover a validação não pode tê-la perdido.
    const { id } = alvos.find((a) => a.rota === "payments");
    const r = await api.patch(`/payments/${id}`, { formaPagamento: "bitcoin" });
    assert.equal(r.status, 400, "forma de pagamento fora do enum continua 400");
  });

  test("a lista interna de paymentValidation não diverge da allowlist canônica", () => {
    // `paymentValidation` mantém a própria lista para governar as validações de
    // VALOR. Se as duas divergirem, um campo passa pela allowlist e chega sem
    // validação nenhuma — ou o contrário. Foi por listas paralelas que `ativo`
    // sobreviveu ali até a 4.5.
    assert.deepEqual(
      [...CAMPOS_PERMITIDOS_UPDATE_TESTE].sort(),
      [...CAMPOS_UPDATE.payments].sort(),
      "as duas listas de campos de pagamento precisam ser idênticas"
    );
  });
});
