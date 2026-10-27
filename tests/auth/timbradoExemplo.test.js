// ═══════════════════════════════════════════════════════════════════════════
// FASE 3.6 — `GET /auth/me/timbrado-exemplo` (DEC-126)
//
// A folha de exemplo do perfil sai pelo MESMO renderizador dos documentos
// (`renderizarPdf` → `letterheadService`). O que se trava aqui:
//   - é PDF, de UMA página, e só para quem tem sessão;
//   - o timbrado traz os dados SALVOS, com telefone e CEP formatados (DEC-072);
//   - os três desenhos do cabeçalho: com logo, sem logo, sem endereço;
//   - isolamento: nenhum parâmetro faz a rota devolver o timbrado de outra conta.
//
// O extrator de texto (`helpers/pdfText.js`) responde PRESENÇA. Onde o teste
// afirma uma ausência, ele afirma antes uma presença no mesmo arquivo — prova
// de que a extração funcionou e de que a ausência não é extração vazia.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { subirApp, derrubarApp } from "../helpers/server.js";
import { limparColecoes, TODAS_AS_COLECOES, desconectar } from "../helpers/db.js";
import { registrarUsuario, esperado } from "../helpers/setup.js";
import { ClienteApi } from "../helpers/client.js";
import { extrairTextoDoPdf } from "../helpers/pdfText.js";

const ROTA = "/auth/me/timbrado-exemplo";

// PNG real de 2×2 (o pdfmake decodifica a imagem; um recheio falso derrubaria
// a renderização). CRC-32 escrito à mão: `zlib.crc32` não existe no Node 20.
const crc32 = (buf) => {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const bloco = (tipo, dados) => {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
};
const pngPequeno = () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 2; // RGB
  const linha = Buffer.from([0, 0x17, 0x40, 0x34, 0x17, 0x40, 0x34]);
  const bruto = Buffer.concat([linha, linha]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(bruto)),
    bloco("IEND", Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
};

const paginas = (bytes) => (bytes.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
const temImagem = (bytes) => /\/Subtype\s*\/Image\b/.test(bytes.toString("latin1"));

const baixar = async (api, rota = ROTA) => {
  const r = await api.get(rota);
  assert.equal(r.status, 200, `${rota}: status ${r.status}`);
  assert.match(r.tipo, /^application\/pdf/);
  return r;
};

describe("GET /auth/me/timbrado-exemplo", () => {
  let ana;
  let bia;

  before(async () => {
    await subirApp();
    await limparColecoes(TODAS_AS_COLECOES);
    ana = await registrarUsuario("ana", {
      nomeCompleto: "Ana Timbrado",
      advocacia: { nome: "Escritório Ana Exemplo" }
    });
    bia = await registrarUsuario("bia", {
      nomeCompleto: "Bia Timbrado",
      advocacia: { nome: "Escritório Bia Exemplo" }
    });
    // Telefone e CEP só com dígitos — é como a tela grava (DEC-072).
    esperado(
      await ana.patch("/auth/me", {
        telefone: "42999991234",
        endereco: { logradouro: "Rua Sete de Setembro", numero: "800", cep: "84010200" }
      }),
      200,
      "PATCH da Ana"
    );
  });

  after(async () => {
    await limparColecoes(TODAS_AS_COLECOES);
    await derrubarApp();
    await desconectar();
  });

  test("sem sessão: 401, e nenhum PDF", async () => {
    const r = await new ClienteApi("anônimo").get(ROTA);
    assert.equal(r.status, 401);
    assert.doesNotMatch(r.tipo, /pdf/);
  });

  test("a dona recebe um PDF de UMA página, como anexo com nome seguro", async () => {
    const r = await baixar(ana);
    assert.equal(paginas(r.bytes), 1);
    assert.match(
      r.headers.get("content-disposition"),
      /attachment; filename="exemplo-timbrado-escritorio-ana-exemplo\.pdf"/
    );
    assert.match(r.headers.get("access-control-expose-headers"), /Content-Disposition/);
  });

  test("o timbrado traz os dados salvos e o parágrafo de exemplo", async () => {
    const texto = extrairTextoDoPdf((await baixar(ana)).bytes);
    assert.ok(texto.includes("Escritório Ana Exemplo"), "nome do escritório");
    assert.ok(texto.includes("Ana Timbrado"), "nome da advogada");
    assert.ok(texto.includes("Rua Sete de Setembro, 800"), "endereço");
    assert.ok(texto.includes("exemplo de como o seu timbrado aparece"), "parágrafo de exemplo");
  });

  test("telefone e CEP saem formatados (DEC-072)", async () => {
    const texto = extrairTextoDoPdf((await baixar(ana)).bytes);
    assert.ok(texto.includes("(42) 99999-1234"), "telefone formatado");
    assert.ok(texto.includes("84010-200"), "CEP formatado");
  });

  test("sem logo: nenhuma imagem no arquivo; com logo: a imagem entra", async () => {
    assert.equal(temImagem((await baixar(ana)).bytes), false);

    esperado(await ana.patch("/auth/me", { advocacia: { logoBase64: pngPequeno() } }), 200, "logo");
    const comLogo = await baixar(ana);
    assert.equal(temImagem(comLogo.bytes), true);
    assert.equal(paginas(comLogo.bytes), 1);
    assert.ok(extrairTextoDoPdf(comLogo.bytes).includes("Escritório Ana Exemplo"));

    esperado(await ana.patch("/auth/me", { advocacia: { logoBase64: null } }), 200, "remove logo");
    assert.equal(temImagem((await baixar(ana)).bytes), false);
  });

  test("sem endereço: a linha some, e o resto do timbrado continua", async () => {
    esperado(
      await bia.patch("/auth/me", {
        endereco: {
          logradouro: null, numero: null, complemento: null, bairro: null,
          cidade: null, estado: null, cep: null
        }
      }),
      200,
      "apaga o endereço da Bia"
    );
    const r = await baixar(bia);
    const texto = extrairTextoDoPdf(r.bytes);
    assert.equal(paginas(r.bytes), 1);
    assert.ok(texto.includes("Escritório Bia Exemplo"), "a extração funcionou");
    assert.ok(!texto.includes("Rua do Escritório"), "o logradouro antigo não pode sair");
    assert.ok(!texto.includes("Ponta Grossa"), "a cidade antiga não pode sair");
  });

  test("isolamento: nenhum parâmetro devolve o timbrado de outra conta", async () => {
    const idAna = String(ana.usuario.id ?? ana.usuario._id);
    for (const rota of [
      `${ROTA}?usuarioId=${idAna}`,
      `${ROTA}?id=${idAna}`,
      `${ROTA}?_id=${idAna}`,
      `${ROTA}?usuario=${idAna}`
    ]) {
      const texto = extrairTextoDoPdf((await baixar(bia, rota)).bytes);
      assert.ok(texto.includes("Escritório Bia Exemplo"), `${rota}: o da sessão`);
      assert.ok(!texto.includes("Escritório Ana Exemplo"), `${rota}: vazou o da Ana`);
    }

    // Id no caminho não é rota: 404, nunca o PDF da outra.
    const r = await bia.get(`${ROTA}/${idAna}`);
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.tipo, /pdf/);
  });

  test("emitir não grava nada (não vira documento)", async () => {
    const antes = esperado(await ana.get("/documents"), 200, "documentos").total;
    await baixar(ana);
    const depois = esperado(await ana.get("/documents"), 200, "documentos").total;
    assert.equal(depois, antes);
  });
});
