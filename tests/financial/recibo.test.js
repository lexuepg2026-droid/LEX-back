// ═══════════════════════════════════════════════════════════════════════════
// RECIBO DE PAGAMENTO EM PDF
//
// `GET /api/payments/:id/recibo`. Emissão sob demanda: NÃO cria `Document`,
// não entra no portal, não tem `visivelPortal`.
//
// A asserção que importa é sobre o ARQUIVO ENTREGUE, e não sobre o que o
// service devolveu: o valor por extenso é extraído do PDF com `node:zlib`, pelo
// mesmo caminho que a Fase 2E.2 usa para provar que o documento editado à mão
// renderiza o texto editado. Num recibo, quando algarismo e extenso divergem, é
// o extenso que prevalece — então ele precisa ser conferido no papel.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import {
  registrarUsuario, criarClientePF, criarClientePJ, criarProcesso,
  criarHonorario, criarParcela, criarPagamento, criarEstorno, esperado
} from "../helpers/setup.js";
import { extrairTextoDoPdf } from "../helpers/pdfText.js";
import { frasePeDeQuitacao } from "../../src/services/receiptService.js";
import { valorPorExtenso } from "../../src/utils/numeroPorExtenso.js";

const AMANHA = "2099-12-31";

describe("recibo de pagamento", () => {
  let api, cliente, processo, honorario, parcela, pagamento;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    api = await registrarUsuario("recibo");

    // Acentuação de propósito, em cada campo que entra no PDF: é o caminho que
    // a Fase 2C teve de embutir Roboto como TTF para resolver, e um recibo com
    // "aÃ§Ã£o" no nome do cliente não é documento, é constrangimento.
    cliente = await criarClientePF(api, { nomeCompleto: "Conceição Assunção Gonçalves" });
    processo = await criarProcesso(api, [
      { clienteId: cliente._id, papel: "autor", principal: true }
    ], {
      titulo: "Inventário e partilha — ação do cônjuge sobrevivente",
      tipoAcao: "Inventário"
    });

    honorario = await criarHonorario(api, processo._id, {
      valor: 12345.67,
      descricao: "Honorários de inventário — ação do cônjuge"
    });
    parcela = await criarParcela(api, honorario._id, 1, { valor: 6172.83, dataVencimento: AMANHA });
    await criarParcela(api, honorario._id, 2, { valor: 6172.84, dataVencimento: AMANHA });

    ({ pagamento } = await criarPagamento(api, honorario._id, {
      valor: 6172.83,
      data: "2026-03-08",
      formaPagamento: "pix",
      observacoes: "Sinal da ação de inventário"
    }));
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("pagamento ativo → PDF válido, com os headers certos", async () => {
    const r = await api.get(`/payments/${pagamento._id}/recibo`);

    assert.equal(r.status, 200, `esperado 200 — ${JSON.stringify(r.body)}`);
    assert.match(r.tipo, /application\/pdf/);
    assert.ok(r.bytes.length > 1000, `PDF pequeno demais para ter conteúdo: ${r.bytes.length} bytes`);
    assert.equal(
      r.bytes.subarray(0, 5).toString("latin1"),
      "%PDF-",
      "o corpo não começa com a assinatura de PDF"
    );

    const disposition = r.headers.get("content-disposition");
    assert.match(disposition, /^attachment; filename="/, disposition);

    // Nome derivado do cliente e da data do pagamento, sem acento e sem espaço
    // — a mesma regra do download de documento, que é onde ela já existia.
    assert.match(disposition, /recibo-conceicao-assuncao-goncalves-2026-03-08\.pdf/, disposition);
    assert.ok(
      !/[^\x20-\x7e]/.test(disposition),
      `o nome do arquivo tem caractere fora de ASCII: ${disposition}`
    );

    assert.equal(
      r.headers.get("access-control-expose-headers"),
      "Content-Disposition",
      "sem isto o frontend não lê o nome do arquivo do fetch"
    );
  });

  test("o valor POR EXTENSO está no PDF entregue", async () => {
    const r = await api.get(`/payments/${pagamento._id}/recibo`);
    const texto = extrairTextoDoPdf(r.bytes);

    const extenso = valorPorExtenso(6172.83);
    assert.equal(extenso, "seis mil, cento e setenta e dois reais e oitenta e três centavos");

    assert.ok(
      texto.includes(extenso),
      `o extenso não saiu no PDF. Esperado "${extenso}".\nExtraído: ${texto.slice(0, 900)}`
    );

    // E os algarismos ao lado dele, que é como o recibo se lê.
    assert.ok(texto.includes("6.172,83"), "o valor em algarismos não saiu no PDF");
    assert.ok(texto.includes("RECIBO"), "o título não saiu no PDF");

    console.log(`\n  ── EXTENSO EXTRAÍDO DO RECIBO ──\n  ${extenso}\n`);
  });

  test("acentuação sai correta no PDF: ação, inventário, cônjuge", async () => {
    const r = await api.get(`/payments/${pagamento._id}/recibo`);
    const texto = extrairTextoDoPdf(r.bytes);

    for (const palavra of [
      "ação", "inventário", "cônjuge",
      "Conceição Assunção Gonçalves",
      "importância", "Observações"
    ]) {
      assert.ok(texto.includes(palavra), `"${palavra}" não saiu correto no PDF`);
    }
  });

  test("o recibo diz a que se refere: honorário, parcela e processo", async () => {
    const r = await api.get(`/payments/${pagamento._id}/recibo`);
    const texto = extrairTextoDoPdf(r.bytes);

    assert.ok(texto.includes(honorario.descricao), "a descrição do honorário não saiu");
    assert.ok(texto.includes("parcela 1 de 2"), "a identificação da parcela não saiu");
    assert.ok(texto.includes(processo.numeroProcesso), "o número do processo não saiu");
    assert.ok(texto.includes("08/03/2026"), "a data do pagamento não saiu");
    assert.ok(/página 1 de 1/.test(texto), "o rodapé do timbrado não saiu");
  });

  test("honorário SEM parcelamento é descrito como pagamento único", async () => {
    const unico = await criarHonorario(api, processo._id, { valor: 500, descricao: "Honorário único" });
    await criarParcela(api, unico._id, 1, { valor: 500, dataVencimento: AMANHA });
    const { pagamento: pg } = await criarPagamento(api, unico._id, {
      valor: 500, data: "2026-04-01"
    });

    const texto = extrairTextoDoPdf((await api.get(`/payments/${pg._id}/recibo`)).bytes);
    assert.ok(texto.includes("pagamento único"), "com uma parcela só, não se escreve 'parcela 1 de 1'");
  });

  test("cliente pessoa jurídica assina pela razão social e pelo CNPJ", async () => {
    const pj = await criarClientePJ(api, { razaoSocial: "Construções Ipê Ltda" });
    const procPj = await criarProcesso(api, [
      { clienteId: pj._id, papel: "autor", principal: true }
    ]);
    const fee = await criarHonorario(api, procPj._id, { valor: 1000000, descricao: "Honorários" });
    await criarParcela(api, fee._id, 1, { valor: 1000000, dataVencimento: AMANHA });
    const { pagamento: pg } = await criarPagamento(api, fee._id, {
      valor: 1000000, data: "2026-05-02"
    });

    const r = await api.get(`/payments/${pg._id}/recibo`);
    const texto = extrairTextoDoPdf(r.bytes);

    assert.ok(texto.includes("Construções Ipê Ltda"), "a razão social não saiu");
    assert.ok(texto.includes("CNPJ"), "o CNPJ não saiu");
    // "um milhão DE reais": a preposição que `exigeDeReais` resolve. É o caso
    // que quase toda implementação de extenso erra.
    assert.ok(texto.includes("um milhão de reais"), "a preposição do milhão não saiu");
    assert.match(
      r.headers.get("content-disposition"),
      /recibo-construcoes-ipe-ltda-2026-05-02\.pdf/
    );
  });

  test("pagamento integralmente ESTORNADO → 404", async () => {
    // Era "pagamento desativado" até a F-0, e o comentário já dizia "recibo de
    // pagamento estornado é o papel que não pode existir". Na F-1a o estorno
    // deixou de ser uma metáfora para o soft delete e virou registro próprio —
    // a asserção é a mesma, agora pelo caminho de verdade.
    const fee = await criarHonorario(api, processo._id, { valor: 300 });
    await criarParcela(api, fee._id, 1, { valor: 300, dataVencimento: AMANHA });
    const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 300 });

    esperado(await api.get(`/payments/${pg._id}/recibo`), 200, "recibo do pagamento íntegro");

    await criarEstorno(api, pg._id, { valor: 300, motivo: "Estorno integral" });

    const r = await api.get(`/payments/${pg._id}/recibo`);
    assert.equal(
      r.status, 404,
      `recibo de pagamento estornado é o papel que não pode existir — ${JSON.stringify(r.body)}`
    );
  });

  test("pagamento PARCIALMENTE estornado emite recibo do valor LÍQUIDO", async () => {
    // "Recebi de fulano a importância de X" precisa ser verdade no dia em que
    // o papel é lido. Imprimir o bruto no destaque daria ao cliente um
    // comprovante de um valor que ele não pagou — justamente o documento que
    // ele guardaria para provar o contrário.
    const fee = await criarHonorario(api, processo._id, { valor: 1000 });
    await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
    const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 1000 });

    await criarEstorno(api, pg._id, { valor: 400, motivo: "Devolução parcial acordada" });

    // `esperado` devolve o CORPO, que num PDF é null — aqui é a resposta
    // inteira que interessa, por causa de `bytes`.
    const r = await api.get(`/payments/${pg._id}/recibo`);
    assert.equal(r.status, 200, `recibo do líquido — ${JSON.stringify(r.body)}`);
    const texto = extrairTextoDoPdf(r.bytes);

    assert.ok(texto.includes("600,00"), "o recibo deveria trazer o valor líquido");
    assert.ok(texto.includes("seiscentos reais"), "e o extenso do líquido");

    // ── A-3 (F-1a.2): o bruto AGORA aparece, e é obrigatório ──────────────
    //
    // Até a F-1a.1 este teste exigia o contrário — `!texto.includes("1.000,00")`
    // — e o recibo saía pelo líquido EM SILÊNCIO. Para documento de prova isso
    // é lacuna: o cliente ficava com um papel de 600 e nenhum registro do que
    // houve com os 400. O destaque continua sendo o líquido; o que se
    // acrescenta é a conta que leva até ele.
    assert.ok(texto.includes("1.000,00"), "o valor recebido precisa ser declarado");
    assert.ok(texto.includes("400,00"), "e o valor estornado junto");
    assert.match(texto, /l[íi]quido/i, "o recibo precisa dizer que o valor acima é o líquido");
  });

  test("um pagamento que cobre DUAS parcelas as nomeia no recibo", async () => {
    const fee = await criarHonorario(api, processo._id, { valor: 900, descricao: "Honorário em duas" });
    await criarParcela(api, fee._id, 1, { valor: 400, dataVencimento: AMANHA });
    await criarParcela(api, fee._id, 2, { valor: 500, dataVencimento: AMANHA });
    const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 900 });

    const texto = extrairTextoDoPdf((await api.get(`/payments/${pg._id}/recibo`)).bytes);
    // ── FORMATO ATUALIZADO pela DEC-041 (F-1a.1) ─────────────────────────
    //
    // Era "parcelas 1 e 2 de 2". Passou a enumerar o VALOR que foi para cada
    // uma — sem isso, o total do recibo não descreve o que cada parcela
    // recebeu, que é o defeito que a DEC-041 fechou. A propriedade sob teste
    // é a mesma: um pagamento que cobre duas parcelas nomeia as duas.
    assert.ok(
      texto.includes("na parcela 1 de 2") && texto.includes("na parcela 2 de 2"),
      "o recibo precisa dizer as duas parcelas — a frase antiga só sabia falar de uma"
    );
  });

  test("id inexistente → 404; id malformado → 400", async () => {
    assert.equal((await api.get("/payments/000000000000000000000000/recibo")).status, 404);
    assert.equal((await api.get("/payments/nao-e-objectid/recibo")).status, 400);
  });

  test("o recibo NÃO cria `Document` nem aparece no portal", async () => {
    // Emissão sob demanda: o PDF é montado, entregue e esquecido. Se um dia
    // alguém "aproveitar" a coleção de documentos para guardar o recibo, ele
    // passaria a ter `visivelPortal` e viraria candidato a ir para o cliente.
    const antes = esperado(await api.get("/documents?page=1&limit=100"), 200, "documentos antes");

    esperado(await api.get(`/payments/${pagamento._id}/recibo`), 200, "emissão do recibo");
    esperado(await api.get(`/payments/${pagamento._id}/recibo`), 200, "segunda emissão");

    const depois = esperado(await api.get("/documents?page=1&limit=100"), 200, "documentos depois");

    assert.equal(
      depois.total, antes.total,
      "emitir recibo criou documento na coleção — ele não é um `Document`"
    );

    const bruto = JSON.stringify(depois.data);
    assert.ok(!/recibo/i.test(bruto), "apareceu algo chamado recibo na lista de documentos");
  });
  // ═════════════════════════════════════════════════════════════════════════
  // DEC-041 — O RECIBO DESCREVE A ALOCAÇÃO (F-1a.1)
  // DEC-042 — TRÊS ESTADOS DE QUITAÇÃO (F-1a.2)
  //
  // O defeito da F-1a.1 está no cabeçalho de `descreverDestino`: um recibo de
  // R$ 7.000,00 dizia "parcela 2 de 2" e dava plena e geral quitação, quando só
  // R$ 1.500,00 tinham ido para aquela parcela.
  //
  // O defeito da F-1a.2 (A-1, GRAVE) está no cabeçalho de `frasePeDeQuitacao`:
  // o recibo de R$ 3.500,00 do seed descrevia certo o corpo — 3.000 na parcela
  // e 500 em crédito — e o pé afirmava dívida INEXISTENTE contra o cliente que
  // pagou a mais.
  // ═════════════════════════════════════════════════════════════════════════

  describe("DEC-041/042 — o recibo descreve a alocação e a quitação certa", () => {
    // ── As asserções miram o trecho MINÚSCULO da frase, e há motivo ───────
    //
    // `extrairTextoDoPdf` (`tests/helpers/pdfText.js`) é o extrator escrito à
    // mão na Fase 2E.2 sobre `node:zlib` e o ToUnicode CMap, sem instalar
    // nada. Ele lê bem minúsculas, dígitos e pontuação, e EMBARALHA
    // maiúsculas em fonte com subconjunto: "PARCIAL" sai "PLRCILG" no texto
    // extraído.
    //
    // O PDF está certo — quem lê o arquivo vê "PARCIAL". A limitação é da
    // ferramenta de teste, e por isso a asserção usa o trecho que ela lê com
    // fidelidade. Mirar a palavra em caixa alta daria um teste que reprova
    // sozinho e empurraria a "correção" para dentro do documento jurídico.
    //
    // ── O embaralhamento é POR DOCUMENTO, e não só nas maiúsculas ────────
    //
    // Medido em 17/08/2026 sobre os cinco estados: cada PDF tem o SEU
    // subconjunto de glifos, então o mesmo índice cai em letras diferentes de
    // documento para documento. "quitação" saiu `quitaãào`, `çuitaãào`,
    // `quitaãAo` e `quitaãEo` em quatro recibos; "firmo" saiu `çrmo` e `qrmo`.
    //
    // Por isso as sentinelas abaixo são TRECHOS SEM ACENTO E SEM CEDILHA —
    // esses o extrator devolve intactos em todos os cinco. A redação exata é
    // travada à parte, sobre `frasePeDeQuitacao` (função pura), no teste 8.
    //
    // ── Por que ASSERÇÃO DE AUSÊNCIA é válida aqui ───────────────────────
    // O cabeçalho de `pdfText.js` avisa que a função "responde presença, e
    // só". Isso vale para CONTAR ocorrências e para atribuir texto a uma
    // fonte. Para ausência de uma frase escolhida, a direção é segura: a saída
    // é a UNIÃO das leituras por CMap, ou seja, um SUPERconjunto do texto real.
    // Se "devido" não está no superconjunto, não está no documento.
    //
    // A ausência nunca vai sozinha: cada caso exige também a sentinela
    // POSITIVA do seu estado, para o teste não passar por embaralhamento.
    const QUITACAO_PLENA = /plena e geral/i;
    const QUITACAO_PARCIAL = /saldo remanescente/i;
    const QUITACAO_ADIANTAMENTO = /parcela alguma/i;
    // A palavra que só pode existir quando há, de fato, saldo em aberto numa
    // parcela alcançada. É a asserção central da DEC-042.
    const PALAVRA_DEVIDO = /devido/i;

    const textoDoRecibo = async (pagamentoId) => {
      const r = await api.get(`/payments/${pagamentoId}/recibo`);
      assert.equal(r.status, 200, `recibo — ${JSON.stringify(r.body)}`);
      return extrairTextoDoPdf(r.bytes);
    };

    test("1. uma alocação que QUITA a parcela: texto preservado e quitação plena", async () => {
      // O caso comum, e o que a fase não podia mexer. A frase continua sendo
      // "parcela N de M", sem enumerar valor — um destino só não precisa.
      const fee = await criarHonorario(api, processo._id, { valor: 2000, descricao: "Duas parcelas iguais" });
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 1000, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 1000 });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("parcela 1 de 2"), "a referência simples se perdeu");
      assert.ok(!/na parcela 1 de 2/.test(texto), "não enumera valor quando há um destino só");
      assert.match(texto, QUITACAO_PLENA, "quitou a parcela inteira e não sobrou nada");
    });

    test("2. múltiplas alocações: enumera valor por parcela", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 3000, descricao: "Cobre duas de uma vez" });
      await criarParcela(api, fee._id, 1, { valor: 1500, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 1500, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 3000 });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(
        texto.includes("na parcela 1 de 2") && texto.includes("na parcela 2 de 2"),
        "as duas parcelas precisam ser nomeadas com o respectivo valor"
      );
      assert.ok(
        (texto.match(/1\.500,00/g) || []).length >= 2,
        "cada parcela precisa trazer o valor que foi para ela"
      );
      assert.match(texto, QUITACAO_PLENA, "as duas ficaram quitadas e não sobrou crédito");
    });

    // ═══════════════════════════════════════════════════════════════════════
    // A-1 (F-1a.2) — QUITAÇÃO PLENA COM CRÉDITO NÃO É DÍVIDA
    // ═══════════════════════════════════════════════════════════════════════

    test("3. A-1: sobra em crédito com a parcela QUITADA → plena, crédito nomeado, sem `devido`", async () => {
      // ── O DOCUMENTO REAL ─────────────────────────────────────────────────
      // É o recibo de R$ 3.500,00 do seed (Agro Campos, "Honorários
      // complementares — recurso administrativo"), reproduzido com os mesmos
      // números: cobrança de 3.000 em parcela única, depósito de 3.500.
      //
      // O corpo dizia certo — "R$ 3.000,00 na parcela 1 de 1 e R$ 500,00
      // mantidos como crédito para abatimento futuro" — e o pé dizia que a
      // quitação era PARCIAL e "não alcança o saldo remanescente da obrigação,
      // que permanece devido".
      //
      // **Não havia saldo remanescente.** A parcela valia 3.000 e foi paga
      // integralmente. O documento afirmava dívida inexistente contra o
      // cliente que pagou a mais, num papel assinado pela advogada.
      const fee = await criarHonorario(api, processo._id, { valor: 3000, descricao: "O caso do recibo de 3.500" });
      await criarParcela(api, fee._id, 1, { valor: 3000, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 3500 });

      const texto = await textoDoRecibo(pg._id);

      // O corpo, que já estava correto — regressão da DEC-041.
      assert.ok(texto.includes("3.000,00"), "o valor que encostou na parcela");
      assert.ok(texto.includes("500,00"), "e o valor mantido como crédito");
      assert.match(texto, /cr\u00e9dito|crédito/, "o crédito precisa ser NOMEADO");

      // O pé, que estava errado — a correção da DEC-042.
      assert.match(
        texto, QUITACAO_PLENA,
        "a parcela alcançada ficou integralmente quitada: a quitação é PLENA"
      );
      assert.ok(
        !QUITACAO_PARCIAL.test(texto),
        "não há saldo remanescente — a obrigação alcançada está quitada"
      );
      assert.ok(
        !PALAVRA_DEVIDO.test(texto),
        "\"devido\" num recibo de quem pagou A MAIS afirma dívida inexistente"
      );
    });

    test("3b. A-1: crédito que sobra sobre parcela quitada em pagamento anterior → plena", async () => {
      // O caso da F-1a.1, relido pela DEC-042: 7.000 numa cobrança de 3.000 em
      // duas parcelas, com a primeira já quitada por outro pagamento. 1.500 vão
      // para a parcela 2, quitando-a, e 5.500 viram crédito.
      //
      // A DEC-041 chamava isto de PARCIAL, por causa da sobra. Pela DEC-042 é
      // PLENA: a única parcela que este pagamento alcançou ficou integralmente
      // quitada, e a sobra é dita à parte, como crédito.
      const fee = await criarHonorario(api, processo._id, { valor: 3000, descricao: "O caso do smoke test" });
      await criarParcela(api, fee._id, 1, { valor: 1500, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 1500, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 1500 }); // quita a parcela 1
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 7000 });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("na parcela 2 de 2"), "precisa dizer QUANTO foi para a parcela");
      assert.ok(texto.includes("1.500,00"), "o valor que encostou na parcela");
      assert.ok(texto.includes("5.500,00"), "e o valor mantido como crédito");
      assert.match(texto, QUITACAO_PLENA, "a parcela alcançada ficou quitada");
      assert.ok(!PALAVRA_DEVIDO.test(texto), "a sobra não é dívida do cliente");
    });

    test("4. PARCIAL: parcela alcançada com saldo em aberto — redação preservada", async () => {
      // Regressão. Aqui "devido" é VERDADE, e precisa continuar aparecendo: a
      // parcela de 5.000 recebeu 2.000 e segue devendo 3.000. É o único estado
      // em que a palavra pode existir.
      const fee = await criarHonorario(api, processo._id, { valor: 5000, descricao: "Pagamento parcial" });
      await criarParcela(api, fee._id, 1, { valor: 5000, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 2000 });

      const texto = await textoDoRecibo(pg._id);

      assert.match(texto, QUITACAO_PARCIAL, "a parcela segue devendo 3.000");
      assert.match(texto, PALAVRA_DEVIDO, "aqui existe saldo em aberto: `devido` é verdade");
      assert.ok(!QUITACAO_PLENA.test(texto), "quitação plena aqui seria falsa");
    });

    test("4b. PARCIAL com duas parcelas, uma quitada e outra não — redação preservada", async () => {
      // O recibo de R$ 4.500,00 do seed (Carlos, divórcio litigioso): quita a
      // parcela 1 de 3.000 e abate 1.500 da parcela 2, que continua devendo.
      const fee = await criarHonorario(api, processo._id, { valor: 6000, descricao: "O caso do recibo de 4.500" });
      await criarParcela(api, fee._id, 1, { valor: 3000, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 3000, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 4500 });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(
        texto.includes("na parcela 1 de 2") && texto.includes("na parcela 2 de 2"),
        "as duas parcelas alcançadas precisam ser nomeadas com o valor"
      );
      assert.match(texto, QUITACAO_PARCIAL, "a parcela 2 continua com saldo em aberto");
      assert.match(texto, PALAVRA_DEVIDO, "e aqui `devido` é verdade");
    });

    // ═══════════════════════════════════════════════════════════════════════
    // A-2 (F-1a.2) — O ADIANTAMENTO NOMEIA A PARCELA ONDE O DINHEIRO ENTROU
    // ═══════════════════════════════════════════════════════════════════════

    test("5. A-2: adiantamento COM auto-alocação nomeia a parcela", async () => {
      // ── O DOCUMENTO REAL ─────────────────────────────────────────────────
      // É o recibo de R$ 5.000,00 do seed (Maria Aparecida, adiantamento do
      // inventário). O dinheiro entrou ANTES de existir parcela; quando a
      // parcela nasceu, o saldo se auto-alocou nela (DEC-036). O recibo dizia
      // apenas "pagamento único", e quem recebia o papel não conseguia ligar o
      // dinheiro à obrigação.
      //
      // "Pagamento único" passa a valer só quando a alocação QUITA a parcela.
      const fee = await criarHonorario(api, processo._id, { valor: 12000, descricao: "O caso do adiantamento de 5.000" });
      const { pagamento: pg } = await criarPagamento(api, fee._id, {
        valor: 5000, tipo: "adiantamento"
      });

      // A parcela nasce depois, e o saldo se auto-aloca nela.
      await criarParcela(api, fee._id, 1, { valor: 12000, dataVencimento: AMANHA });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(
        texto.includes("5.000,00") && texto.includes("na parcela 1 de 1"),
        "o recibo precisa dizer QUANTO foi para QUAL parcela"
      );
      assert.ok(
        !texto.includes("pagamento único"),
        "\"pagamento único\" é reservado à alocação que QUITA a parcela única"
      );
      // O tipo continua sendo adiantamento; o que decide o texto é a ALOCAÇÃO.
      assert.match(texto, QUITACAO_PARCIAL, "a parcela de 12.000 recebeu 5.000 e segue em aberto");
    });

    test("6. estado 3 da DEC-042: adiantamento SEM alocação, sem `devido`", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 4000, descricao: "Adiantado sem parcelar" });
      const { pagamento: pg } = await criarPagamento(api, fee._id, {
        valor: 2000, tipo: "adiantamento"
      });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("adiantamento"), "o recibo precisa dizer que é adiantamento");
      assert.ok(!/parcela \d/.test(texto), "não há parcela para nomear — e não se inventa uma");
      assert.match(
        texto, QUITACAO_ADIANTAMENTO,
        "o estado 3 tem texto próprio: não há obrigação vencida a quitar"
      );
      assert.ok(
        !PALAVRA_DEVIDO.test(texto),
        "não há obrigação alcançada — falar em saldo devido aqui é inventar dívida"
      );
      assert.ok(!QUITACAO_PARCIAL.test(texto), "não há saldo remanescente a mencionar");
    });

    test("7. honorário NÃO parcelado: sem `parcela 1 de 1` (regressão da F-1a)", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 700, descricao: "Cobrança única" });
      await criarParcela(api, fee._id, 1, { valor: 700, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 700 });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("pagamento único"), "o texto de pagamento único se perdeu");
      assert.ok(!/parcela 1 de 1/.test(texto), "\"parcela 1 de 1\" é ruído — corrigido na F-1a");
      assert.match(texto, QUITACAO_PLENA);
      assert.ok(!PALAVRA_DEVIDO.test(texto), "quitou tudo e não sobrou nada");
    });

    test("8. o recibo de R$ 800,00 do seed: quitação plena SEM crédito, redação intacta", async () => {
      // Contraprova do A-1. Este é o ramo que JÁ funcionava — custas de 800 em
      // parcela única, pagas integralmente, sem sobra —, e o teste existe para
      // provar que a DEC-042 não mexeu nele. Se esta redação mudar, mudou por
      // acidente.
      const fee = await criarHonorario(api, processo._id, {
        valor: 800, tipo: "custas", descricao: "Custas administrativas — taxas e emolumentos"
      });
      await criarParcela(api, fee._id, 1, { valor: 800, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 800 });

      const texto = await textoDoRecibo(pg._id);

      // No PDF, os trechos que o extrator devolve intactos.
      assert.match(texto, QUITACAO_PLENA, "a quitação plena se perdeu");
      assert.ok(texto.includes("do valor acima em rela"), "a frase mudou de forma");
      assert.ok(texto.includes("se refere"), "o fecho da frase se perdeu");
      assert.ok(texto.includes("pagamento único"));
      assert.ok(!PALAVRA_DEVIDO.test(texto));
      assert.ok(!QUITACAO_PARCIAL.test(texto), "não há saldo remanescente");

      // ── E a redação EXATA, sobre a função pura ────────────────────────────
      // O extrator embaralha acento e cedilha, então o PDF não consegue provar
      // a vírgula. `frasePeDeQuitacao` consegue, e é a mesma função que monta o
      // documento. Se alguém reescrever este pé, cai aqui.
      assert.equal(
        frasePeDeQuitacao({
          destinos: [{ numeroParcela: 1, valor: 800, quitaAParcela: true }],
          creditoMantido: 0
        }),
        "Para clareza e como prova, firmo o presente recibo, dando plena e geral " +
        "quitação do valor acima em relação à obrigação a que se refere.",
        "a redação plena sem crédito é a da 4.1 e não pode ter mudado"
      );
    });

    // ═══════════════════════════════════════════════════════════════════════
    // A-3 (F-1a.2) — O RECIBO DO ESTORNADO NÃO PODE SER SILENCIOSO
    // ═══════════════════════════════════════════════════════════════════════

    test("9. A-3: estorno declarado — recebido, estornado com data, e o líquido", async () => {
      // ── O DOCUMENTO REAL ─────────────────────────────────────────────────
      // É o recibo de R$ 2.500,00 do seed (Beatriz, usucapião urbano): entrada
      // de 4.000 no cartão, estorno de 1.500 em 18/05/2026 por contestação
      // parcial da operadora. O recibo saía pelo líquido — correto — mas em
      // silêncio, e o cliente ficava com um papel de 2.500 sem registro nenhum
      // do que houve com a diferença.
      const fee = await criarHonorario(api, processo._id, { valor: 8000, descricao: "O caso do usucapião" });
      await criarParcela(api, fee._id, 1, { valor: 4000, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 4000, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, {
        valor: 4000, data: "2026-04-25", formaPagamento: "cartao_credito"
      });
      await criarEstorno(api, pg._id, {
        valor: 1500, data: "2026-05-18", motivo: "Contestação parcial da operadora do cartão"
      });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("2.500,00"), "o destaque continua sendo o LÍQUIDO");
      assert.ok(texto.includes("4.000,00"), "o valor recebido precisa ser declarado");
      assert.ok(texto.includes("1.500,00"), "o valor estornado também");
      assert.ok(texto.includes("18/05/2026"), "e a data do estorno");
      assert.match(texto, /l[íi]quido/i, "o documento precisa dizer que o valor acima é o líquido");

      // O motivo NÃO entra: o campo pode estar vazio, e inventar motivo em
      // documento assinado é pior que omiti-lo.
      assert.ok(
        !/contesta/i.test(texto),
        "o motivo do estorno não vai para o recibo — ver `fraseDeEstorno`"
      );
    });

    test("o crédito do recibo é do PAGAMENTO, e sobrevive a estorno", async () => {
      // A sobra sai da diferença entre o líquido e o alocado, e não de
      // `Fee.saldoAdiantado` — aquele campo é do honorário e pode ter
      // contribuição de outros pagamentos.
      const fee = await criarHonorario(api, processo._id, { valor: 1000, descricao: "Com estorno depois" });
      await criarParcela(api, fee._id, 1, { valor: 1000, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 3000 });

      // Líquido 3000, alocado 1000, crédito 2000. Estorna 500: a desalocação
      // come o crédito primeiro, então o alocado não se move.
      await criarEstorno(api, pg._id, { valor: 500, motivo: "Devolução parcial" });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("2.500,00"), "o recibo é do líquido: 3.000 − 500");
      assert.ok(texto.includes("1.500,00"), "o crédito caiu de 2.000 para 1.500");
      assert.ok(texto.includes("na parcela 1"), "e a parcela continua com os 1.000");

      // A parcela ficou quitada e sobrou crédito → PLENA, pela DEC-042.
      assert.match(texto, QUITACAO_PLENA, "a parcela de 1.000 foi integralmente quitada");
      assert.ok(!PALAVRA_DEVIDO.test(texto), "o crédito remanescente não é dívida do cliente");
    });
  });
});
