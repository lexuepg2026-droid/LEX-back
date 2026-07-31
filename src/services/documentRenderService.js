import {
  AlignmentType,
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  convertMillimetersToTwip
} from "docx";

import {
  registrarFontes,
  criarPdf,
  montarTimbrado,
  nomeArquivoSeguro,
  cabecalhoPdf,
  rodapePdf,
  cabecalhoDocx,
  rodapeDocx,
  ESTILOS_TIMBRADO_PDF,
  MARGEM_MM,
  MARGEM_PT,
  MARGEM_SUPERIOR_PT
} from "./letterheadService.js";

// ═══════════════════════════════════════════════════════════════════════════
// RENDERIZAÇÃO DO DOCUMENTO GERADO — PDF E DOCX
//
// REGRA CENTRAL: renderiza a partir de `textoResolvido`, NUNCA recompondo as
// seções. Depois da geração, `textoResolvido` é a única fonte da verdade — e
// se a advogada editou o texto à mão, recompor descartaria a edição dela sem
// aviso nenhum, produzindo um PDF diferente do que ela leu na tela.
//
// Os dois formatos compartilham a mesma estrutura de timbrado para saírem
// visualmente equivalentes: quem recebe o DOCX e quem recebe o PDF precisa
// estar olhando para o mesmo documento.
//
// ── O timbrado saiu daqui na Fase 4.1 ────────────────────────────────────
// Cabeçalho, rodapé, fontes e medidas moraram neste arquivo da Fase 2C até a
// 4.1, quando nasceu o recibo de pagamento — que sai sobre o mesmo papel.
// Foram para `letterheadService.js`, um módulo só, usado pelos dois. Duplicar
// garantiria que em seis meses o cabeçalho do documento e o do recibo não
// fossem mais o mesmo.
//
// A extração foi refatoração pura: o texto extraído do PDF antes e depois é
// idêntico, com o canário do documento editado à mão travando.
//
// Este arquivo continua sendo a fonte da verdade do visual do DOCUMENTO — o
// corpo, os parágrafos, a justificação. `letterheadService.js` é a do PAPEL.
// ═══════════════════════════════════════════════════════════════════════════

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// ── Corpo ───────────────────────────────────────────────────────────────────

// Preserva as quebras do texto gerado: linha em branco separa parágrafos, e
// quebra simples é quebra dentro do mesmo parágrafo. Perder isso transformaria
// a procuração num bloco único ilegível.
export const separarParagrafos = (texto) =>
  String(texto ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

// ── Nome do arquivo ─────────────────────────────────────────────────────────

// A regra de normalização (sem acento, sem espaço) mora em
// `letterheadService.nomeArquivoSeguro` e é compartilhada com o recibo. Aqui
// fica só QUAIS partes compõem o nome de um documento.
export const montarNomeArquivo = (documento, cliente, formato) =>
  nomeArquivoSeguro(
    [
      documento?.tipo || "documento",
      cliente?.tipoPessoa === "juridica" ? cliente?.razaoSocial : cliente?.nomeCompleto,
      new Date(documento?.dataGeracao ?? Date.now()).toISOString().slice(0, 10)
    ],
    formato
  );

// ═══════════════════════════════════════════════════════════════════════════
// PDF
// ═══════════════════════════════════════════════════════════════════════════

export const renderizarPdf = async ({ textoResolvido, usuario }) => {
  registrarFontes();

  const timbrado = montarTimbrado(usuario);
  const paragrafos = separarParagrafos(textoResolvido);

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [MARGEM_PT, MARGEM_SUPERIOR_PT, MARGEM_PT, MARGEM_PT],
    header: cabecalhoPdf(timbrado),
    footer: rodapePdf(),
    defaultStyle: {
      font: "Roboto",
      fontSize: 11,
      lineHeight: 1.4
    },
    styles: {
      ...ESTILOS_TIMBRADO_PDF,
      corpo: { alignment: "justify", margin: [0, 0, 0, 10] }
    },
    content: paragrafos.map((p) => ({ text: p, style: "corpo" })),
    info: {
      title: "Documento LEX",
      creator: timbrado.nomeAdvocacia || "LEX"
    }
  };

  return criarPdf(docDefinition).getBuffer();
};

// ═══════════════════════════════════════════════════════════════════════════
// DOCX
// ═══════════════════════════════════════════════════════════════════════════

export const renderizarDocx = async ({ textoResolvido, usuario }) => {
  const timbrado = montarTimbrado(usuario);
  const paragrafos = separarParagrafos(textoResolvido);

  const doc = new DocxDocument({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 }, // 11 pt (half-points)
          paragraph: { spacing: { line: 336 } } // ~1,4 de entrelinha
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(MARGEM_MM),
              right: convertMillimetersToTwip(MARGEM_MM),
              bottom: convertMillimetersToTwip(MARGEM_MM),
              left: convertMillimetersToTwip(MARGEM_MM)
            }
          }
        },
        headers: { default: cabecalhoDocx(timbrado) },
        footers: { default: rodapeDocx() },
        children: paragrafos.map(
          (p) =>
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 200 },
              children: [new TextRun({ text: p })]
            })
        )
      }
    ]
  });

  return Packer.toBuffer(doc);
};

// ═══════════════════════════════════════════════════════════════════════════

export const FORMATOS = ["pdf", "docx"];

export const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

export const renderizarDocumento = async ({ documento, usuario, cliente, formato }) => {
  if (!FORMATOS.includes(formato)) {
    throw createError(`Formato inválido: use ${FORMATOS.join(" ou ")}`, 400);
  }

  if (!documento?.textoResolvido) {
    throw createError("Documento não possui texto para renderizar", 400);
  }

  const buffer =
    formato === "pdf"
      ? await renderizarPdf({ textoResolvido: documento.textoResolvido, usuario })
      : await renderizarDocx({ textoResolvido: documento.textoResolvido, usuario });

  return {
    buffer,
    contentType: CONTENT_TYPES[formato],
    nomeArquivo: montarNomeArquivo(documento, cliente, formato)
  };
};

// `montarTimbrado` continua exportado daqui por compatibilidade: era importado
// deste módulo desde a Fase 2C. A implementação mora em `letterheadService.js`.
export { montarTimbrado };

export default {
  renderizarDocumento,
  renderizarPdf,
  renderizarDocx,
  montarTimbrado,
  montarNomeArquivo,
  separarParagrafos,
  FORMATOS,
  CONTENT_TYPES
};
