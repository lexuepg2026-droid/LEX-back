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
    assert.ok(
      texto.includes("parcelas 1 e 2 de 2"),
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
});
