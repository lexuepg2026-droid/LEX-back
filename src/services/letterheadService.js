import path from "path";
import { createRequire } from "module";
import {
  AlignmentType,
  Footer,
  Header,
  ImageRun,
  PageNumber,
  Paragraph,
  TextRun
} from "docx";

// pdfmake 0.3 é CommonJS e exporta uma instância única; `createRequire` é o que
// permite carregá-la de um módulo ESM sem transpilar nada.
//
// Versão: 0.3.11, conferida na Fase 2D.1 contra o registro. A linha 0.3.x já
// não é pré-lançamento — `npm view pdfmake dist-tags` devolve
// `{ beta: '0.3.0', latest: '0.3.11' }`, ou seja, a tag `latest` aponta para a
// própria 0.3.11 e a `beta` ficou para trás, em versão mais antiga. Não há
// 0.2.x estável mais recente para a qual voltar; a API usada aqui é a da 0.3.
const require = createRequire(import.meta.url);
const pdfmake = require("pdfmake");

// ═══════════════════════════════════════════════════════════════════════════
// TIMBRADO — MÓDULO COMPARTILHADO (extraído na Fase 4.1)
//
// Cabeçalho com logo quando houver, nome da advocacia, nome da advogada,
// `OAB/UF nº`, endereço em linha, telefone e e-mail; rodapé com "página X de
// Y"; e o comportamento sem logo, que usa só texto e continua bem diagramado.
//
// ── Por que isto saiu de `documentRenderService.js` ──────────────────────
// O recibo de pagamento da Fase 4.1 sai sobre o mesmo papel do documento.
// Duplicar a montagem garantiria divergência: em seis meses o cabeçalho do
// documento e o do recibo não seriam mais o mesmo, e ninguém notaria até a
// advogada colocar os dois lado a lado.
//
// A extração foi REFATORAÇÃO PURA — nenhuma mudança de saída. O canário é o
// teste de que documento editado à mão renderiza o texto editado, e o texto
// extraído do PDF antes e depois é idêntico.
//
// `documentRenderService.js` continua sendo a fonte da verdade do VISUAL DO
// DOCUMENTO — corpo, parágrafos, justificação, o que é peça. Este módulo é a
// fonte da verdade do PAPEL, que é o que documento e recibo têm em comum.
//
// Nenhum acesso a banco aqui, de propósito: sem Mongoose, o layout é testável
// com objetos literais e pode ser conferido sem subir base.
// ═══════════════════════════════════════════════════════════════════════════

// ── Fontes ──────────────────────────────────────────────────────────────────
// Roboto embutido como TTF, não as fontes padrão do PDF (Helvetica/Times).
// As padrão dependem de encoding WinAnsi do leitor; a TTF embutida carrega os
// glifos dentro do arquivo, então "ação", "inventário" e "cônjuge" saem certos
// em qualquer visualizador, inclusive nos de celular.
const DIR_FONTES = path.resolve(
  path.dirname(require.resolve("pdfmake/package.json")),
  "build/fonts/Roboto"
);

let fontesRegistradas = false;

export const registrarFontes = () => {
  if (fontesRegistradas) return;

  // Só leitura de arquivo local, e apenas o que este módulo pede. Sem isso o
  // pdfmake emite aviso de política de acesso indefinida.
  pdfmake.setLocalAccessPolicy((caminho) => caminho.startsWith(DIR_FONTES));

  pdfmake.addFonts({
    Roboto: {
      normal: path.join(DIR_FONTES, "Roboto-Regular.ttf"),
      bold: path.join(DIR_FONTES, "Roboto-Medium.ttf"),
      italics: path.join(DIR_FONTES, "Roboto-Italic.ttf"),
      bolditalics: path.join(DIR_FONTES, "Roboto-MediumItalic.ttf")
    }
  });

  fontesRegistradas = true;
};

export const criarPdf = (docDefinition) => pdfmake.createPdf(docDefinition);

// ── Medidas ─────────────────────────────────────────────────────────────────

const MM_POR_POLEGADA = 25.4;
const PONTOS_POR_POLEGADA = 72;
const mmParaPontos = (mm) => (mm / MM_POR_POLEGADA) * PONTOS_POR_POLEGADA;

export const MARGEM_MM = 25; // 2,5 cm
export const MARGEM_PT = mmParaPontos(MARGEM_MM);

// O timbrado ocupa a faixa acima do corpo. A margem superior é a margem de
// 2,5 cm MAIS a altura do timbrado MAIS um respiro — sem o respiro a primeira
// linha do texto encosta na régua do cabeçalho e o documento parece cortado.
// Esquerda, direita e inferior ficam nos 2,5 cm exatos.
const ALTURA_TIMBRADO_PT = 74;
const ESPACO_APOS_TIMBRADO_PT = 26;
export const MARGEM_SUPERIOR_PT = MARGEM_PT + ALTURA_TIMBRADO_PT + ESPACO_APOS_TIMBRADO_PT;

const LOGO_LARGURA_PT = 64;

// Largura útil = A4 (595,28 pt) menos as duas margens laterais.
export const LARGURA_UTIL_PT = 595.28 - MARGEM_PT * 2;

// ── Dados do timbrado ───────────────────────────────────────────────────────

const textoOuVazio = (v) => (v === undefined || v === null ? "" : String(v).trim());

const formatarEnderecoLinha = (endereco) => {
  if (!endereco || typeof endereco !== "object") return "";

  const logradouro = textoOuVazio(endereco.logradouro);
  const numero = textoOuVazio(endereco.numero);
  const complemento = textoOuVazio(endereco.complemento);
  const bairro = textoOuVazio(endereco.bairro);
  const cidade = textoOuVazio(endereco.cidade);
  const estado = textoOuVazio(endereco.estado);
  const cep = textoOuVazio(endereco.cep);

  const partes = [];
  if (logradouro) partes.push(numero ? `${logradouro}, ${numero}` : logradouro);
  else if (numero) partes.push(`nº ${numero}`);
  if (complemento) partes.push(complemento);
  if (bairro) partes.push(bairro);
  if (cidade && estado) partes.push(`${cidade}/${estado}`);
  else if (cidade) partes.push(cidade);
  if (cep) partes.push(`CEP ${cep}`);

  return partes.join(" · ");
};

// Reduz o usuário às linhas que o timbrado imprime. Linhas vazias são
// descartadas por quem monta o cabeçalho — é isso que evita buraco no layout
// quando falta telefone, e-mail ou logo.
export const montarTimbrado = (usuario) => {
  const advocacia = usuario?.advocacia ?? {};
  const oab = usuario?.oab ?? {};

  const contato = [textoOuVazio(usuario?.telefone), textoOuVazio(usuario?.email)]
    .filter(Boolean)
    .join(" · ");

  const identificacao = [
    textoOuVazio(usuario?.nomeCompleto),
    oab.numero && oab.estado ? `OAB/${oab.estado} nº ${oab.numero}` : ""
  ]
    .filter(Boolean)
    .join(" — ");

  return {
    logoBase64: textoOuVazio(advocacia.logoBase64) || null,
    nomeAdvocacia: textoOuVazio(advocacia.nome),
    identificacao,
    endereco: formatarEnderecoLinha(usuario?.endereco),
    contato
  };
};

// ── Nome do arquivo ─────────────────────────────────────────────────────────

const semAcento = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// Sem acento e sem espaço: o nome viaja em header HTTP, em sistema de arquivos
// alheio e em anexo de e-mail. Acento em `Content-Disposition` vira mojibake em
// parte dos clientes, e espaço quebra o parsing em outra parte.
//
// Compartilhado com o recibo pela mesma razão do timbrado: o cliente que baixa
// uma procuração e um recibo no mesmo dia recebe dois arquivos nomeados pela
// mesma regra.
export const nomeArquivoSeguro = (partes, extensao) => {
  const base = partes
    .map(semAcento)
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  return `${base || "documento"}.${extensao}`;
};

// ── Cabeçalho e rodapé — PDF ────────────────────────────────────────────────

export const cabecalhoPdf = (timbrado) => () => {
  const linhas = [
    timbrado.nomeAdvocacia
      ? { text: timbrado.nomeAdvocacia, style: "timbradoTitulo" }
      : null,
    timbrado.identificacao ? { text: timbrado.identificacao, style: "timbradoLinha" } : null,
    timbrado.endereco ? { text: timbrado.endereco, style: "timbradoLinha" } : null,
    timbrado.contato ? { text: timbrado.contato, style: "timbradoLinha" } : null
  ].filter(Boolean);

  const bloco = { stack: linhas, width: "*" };

  // Sem logo o bloco de texto ocupa a largura inteira. Reservar a coluna da
  // imagem "para o caso de" deixaria um vão à esquerda em todo documento de
  // quem não subiu logo.
  const colunas = timbrado.logoBase64
    ? [{ image: timbrado.logoBase64, width: LOGO_LARGURA_PT, fit: [LOGO_LARGURA_PT, LOGO_LARGURA_PT] }, bloco]
    : [bloco];

  return {
    margin: [MARGEM_PT, MARGEM_PT, MARGEM_PT, 0],
    stack: [
      { columns: colunas, columnGap: 12 },
      // Régua separando timbrado e corpo — é o que faz o cabeçalho ser lido
      // como papel timbrado e não como o primeiro parágrafo do documento.
      {
        margin: [0, 8, 0, 0],
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: LARGURA_UTIL_PT,
            y2: 0,
            lineWidth: 0.7,
            lineColor: "#999999"
          }
        ]
      }
    ]
  };
};

export const rodapePdf = () => (paginaAtual, totalPaginas) => ({
  margin: [MARGEM_PT, 8, MARGEM_PT, 0],
  text: `página ${paginaAtual} de ${totalPaginas}`,
  style: "rodape"
});

// Estilos do timbrado no PDF. Ficam aqui com o cabeçalho que os usa: um estilo
// declarado num arquivo e consumido em outro é exatamente o tipo de laço que a
// extração existe para não criar.
export const ESTILOS_TIMBRADO_PDF = {
  timbradoTitulo: { fontSize: 12, bold: true, margin: [0, 0, 0, 2] },
  timbradoLinha: { fontSize: 8, color: "#444444", margin: [0, 0, 0, 1] },
  rodape: { fontSize: 8, color: "#666666", alignment: "center" }
};

// ── Cabeçalho e rodapé — DOCX ───────────────────────────────────────────────

// "data:image/png;base64,AAAA" → { buffer, tipo }. O docx precisa do binário e
// do tipo declarado; o pdfmake aceita o data URI direto.
const decodificarDataUri = (dataUri) => {
  const match = /^data:(image\/(png|jpeg));base64,(.+)$/i.exec(String(dataUri ?? "").trim());
  if (!match) return null;

  const tipo = match[2].toLowerCase() === "jpeg" ? "jpg" : "png";
  return { buffer: Buffer.from(match[3], "base64"), tipo };
};

const paragrafoTimbrado = (texto, { negrito = false, tamanho = 16 } = {}) =>
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 20 },
    children: [new TextRun({ text: texto, bold: negrito, size: tamanho, color: "444444" })]
  });

export const cabecalhoDocx = (timbrado) => {
  const filhos = [];

  const logo = timbrado.logoBase64 ? decodificarDataUri(timbrado.logoBase64) : null;
  if (logo) {
    filhos.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 40 },
        children: [
          new ImageRun({
            data: logo.buffer,
            type: logo.tipo,
            transformation: { width: LOGO_LARGURA_PT, height: LOGO_LARGURA_PT }
          })
        ]
      })
    );
  }

  if (timbrado.nomeAdvocacia) {
    filhos.push(paragrafoTimbrado(timbrado.nomeAdvocacia, { negrito: true, tamanho: 24 }));
  }
  if (timbrado.identificacao) filhos.push(paragrafoTimbrado(timbrado.identificacao));
  if (timbrado.endereco) filhos.push(paragrafoTimbrado(timbrado.endereco));
  if (timbrado.contato) filhos.push(paragrafoTimbrado(timbrado.contato));

  // Um Header vazio produz arquivo inválido em alguns leitores; um parágrafo
  // em branco é o mínimo seguro.
  if (filhos.length === 0) filhos.push(new Paragraph({ children: [] }));

  // Mesma régua do PDF, aqui como borda inferior de um parágrafo vazio — é
  // como o OOXML representa linha horizontal. Mantém os dois formatos
  // visualmente equivalentes, que é o ponto de gerar os dois.
  filhos.push(
    new Paragraph({
      spacing: { before: 60, after: 240 },
      border: { bottom: { style: "single", size: 6, color: "999999", space: 1 } },
      children: []
    })
  );

  return new Header({ children: filhos });
};

export const rodapeDocx = () =>
  new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "página ", size: 16, color: "666666" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "666666" }),
          new TextRun({ text: " de ", size: 16, color: "666666" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "666666" })
        ]
      })
    ]
  });

export default {
  montarTimbrado,
  nomeArquivoSeguro,
  registrarFontes,
  criarPdf,
  cabecalhoPdf,
  rodapePdf,
  cabecalhoDocx,
  rodapeDocx,
  ESTILOS_TIMBRADO_PDF,
  MARGEM_MM,
  MARGEM_PT,
  MARGEM_SUPERIOR_PT,
  LARGURA_UTIL_PT
};
