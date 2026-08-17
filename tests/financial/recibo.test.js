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
    // o papel é lido. Imprimir o bruto daria ao cliente um comprovante de um
    // valor que ele não pagou — justamente o documento que ele guardaria para
    // provar o contrário.
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
    assert.ok(!texto.includes("1.000,00"), "o valor bruto não pode aparecer");
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
  //
  // Os cinco casos, com o texto extraído do PDF de verdade. O defeito que os
  // originou está no cabeçalho de `descreverDestino`: um recibo de R$ 7.000,00
  // dizia "parcela 2 de 2" e dava plena e geral quitação, quando só R$ 1.500,00
  // tinham ido para aquela parcela.
  // ═════════════════════════════════════════════════════════════════════════

  describe("DEC-041 — o recibo descreve a alocação", () => {
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
    const QUITACAO_PLENA = /plena e geral/i;
    const QUITACAO_PARCIAL = /efetivamente recebido/i;

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

    test("3. O CASO OBSERVADO: sobra em crédito → valor por parcela + crédito + quitação PARCIAL", async () => {
      // 7.000 numa cobrança de 3.000 em duas parcelas, com a primeira já
      // quitada por outro pagamento: 1.500 vão para a parcela 2 e 5.500 viram
      // crédito. Era este recibo que dava plena e geral quitação.
      const fee = await criarHonorario(api, processo._id, { valor: 3000, descricao: "O caso do smoke test" });
      await criarParcela(api, fee._id, 1, { valor: 1500, dataVencimento: AMANHA });
      await criarParcela(api, fee._id, 2, { valor: 1500, dataVencimento: AMANHA });
      await criarPagamento(api, fee._id, { valor: 1500 }); // quita a parcela 1
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 7000 });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("na parcela 2 de 2"), "precisa dizer QUANTO foi para a parcela");
      assert.ok(texto.includes("1.500,00"), "o valor que encostou na parcela");
      assert.ok(texto.includes("5.500,00"), "e o valor mantido como crédito");
      assert.match(texto, /cr\u00e9dito|crédito/, "a palavra crédito precisa aparecer");
      assert.match(
        texto, QUITACAO_PARCIAL,
        "dar plena e geral quitação aqui quitaria mais do que a obrigação alcançada"
      );
      assert.ok(!QUITACAO_PLENA.test(texto), "a frase de quitação plena não pode sobreviver");
    });

    test("4. adiantamento sem parcelas: sem número de parcela, texto de crédito", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 4000, descricao: "Adiantado sem parcelar" });
      const { pagamento: pg } = await criarPagamento(api, fee._id, {
        valor: 2000, tipo: "adiantamento"
      });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("adiantamento"), "o recibo precisa dizer que é adiantamento");
      assert.ok(!/parcela \d/.test(texto), "não há parcela para nomear — e não se inventa uma");
      assert.match(texto, QUITACAO_PARCIAL, "nada foi quitado: não há quitação plena a dar");
    });

    test("5. honorário NÃO parcelado: sem `parcela 1 de 1` (regressão da F-1a)", async () => {
      const fee = await criarHonorario(api, processo._id, { valor: 700, descricao: "Cobrança única" });
      await criarParcela(api, fee._id, 1, { valor: 700, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 700 });

      const texto = await textoDoRecibo(pg._id);

      assert.ok(texto.includes("pagamento único"), "o texto de pagamento único se perdeu");
      assert.ok(!/parcela 1 de 1/.test(texto), "\"parcela 1 de 1\" é ruído — corrigido na F-1a");
      assert.match(texto, QUITACAO_PLENA);
    });

    test("parcela que continua PARCIAL não recebe quitação plena", async () => {
      // Sem crédito sobrando, mas com a obrigação em aberto: a quitação
      // continua sendo do valor recebido, não da obrigação.
      const fee = await criarHonorario(api, processo._id, { valor: 5000, descricao: "Pagamento parcial" });
      await criarParcela(api, fee._id, 1, { valor: 5000, dataVencimento: AMANHA });
      const { pagamento: pg } = await criarPagamento(api, fee._id, { valor: 2000 });

      const texto = await textoDoRecibo(pg._id);

      assert.match(
        texto, QUITACAO_PARCIAL,
        "a parcela segue devendo 3.000 — quitação plena aqui seria falsa"
      );
      assert.ok(!QUITACAO_PLENA.test(texto));
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
    });
  });
});
