// Extração de texto de PDF sem dependência nova.
//
// Por que isto existe: o teste mais importante do módulo de documentos é que o
// download de um documento editado à mão traz o TEXTO EDITADO, e não o
// recomposto das seções. Asserção sobre `textoResolvido` no banco não prova
// isso — o defeito que se quer pegar mora no renderizador, depois do banco. Só
// abrindo o arquivo entregue é que se sabe.
//
// A fase não instala `pdf-parse` nem nada parecido, e não precisa: o PDF é um
// formato documentado e o Node traz `zlib`.
//
// ── Como o texto está guardado ─────────────────────────────────────────────
// `documentRenderService.js` embute Roboto como TTF *subset* (linha 47). Isso
// significa que o content stream NÃO tem ASCII: tem índice de glifo do subset,
// `[<000100020003> 0] TJ`. O que traduz índice para caractere é o ToUnicode
// CMap, que o pdfkit embute junto — na forma
// `<0000> <0032> [<0000> <0046> <0052> …]`, um mapa explícito por código.
//
// Os passos são três:
//   1. inflar todo stream FlateDecode do arquivo;
//   2. dos que são CMap, montar o mapa código → caractere;
//   3. dos que são conteúdo, tirar os literais hexadecimais dos operadores de
//      texto e traduzir.
//
// ── A decisão que vale explicar ────────────────────────────────────────────
// Cada fonte tem o SEU espaço de códigos: o código 0x0003 é um caractere na
// Roboto-Regular e outro na Roboto-Medium. Amarrar cada `/Fn Tf` do conteúdo
// ao CMap certo exigiria resolver o dicionário de recursos da página e a
// cadeia de referências indiretas até o objeto da fonte — bastante parsing de
// PDF para um ganho que este teste não usa.
//
// Em vez disso, o conteúdo é decodificado UMA VEZ POR CMap e todas as leituras
// são devolvidas juntas. A leitura feita com o CMap certo sai correta; as
// outras saem como ruído. Para a pergunta que o teste faz — "a frase que ela
// digitou está no arquivo?" — isso basta, e não dá falso positivo: ruído de
// fonte errada não produz por acaso uma frase escolhida pelo teste. O que
// NÃO se pode fazer com esta função é afirmar que algo está ausente ou contar
// ocorrências; ela responde presença, e só.

import { inflateSync } from "node:zlib";

// Um literal hexadecimal do PDF (`<00410042>`) para os caracteres que ele
// representa em UTF-16BE. Valor de bfchar/bfrange pode ter mais de um code
// unit — `<00660069>` é a ligadura "fi" desmontada em dois caracteres.
const hexParaTexto = (hex) => {
  let saida = "";
  for (let i = 0; i + 3 < hex.length; i += 4) {
    saida += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  return saida;
};

// Monta código → caractere a partir de um ToUnicode CMap.
const lerCMap = (texto) => {
  const mapa = new Map();

  // ── bfchar: `<código> <unicode>`, um par por linha ────────────────────────
  for (const bloco of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const par of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      mapa.set(Number.parseInt(par[1], 16), hexParaTexto(par[2]));
    }
  }

  // ── bfrange: duas formas, e as duas aparecem em PDF real ─────────────────
  for (const bloco of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const corpo = bloco[1];

    // Forma 1 — array explícito: `<lo> <hi> [<u> <u> …]`. É a que o pdfkit usa.
    for (const faixa of corpo.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g)) {
      const inicio = Number.parseInt(faixa[1], 16);
      const valores = [...faixa[3].matchAll(/<([0-9a-fA-F]*)>/g)];
      valores.forEach((v, i) => mapa.set(inicio + i, hexParaTexto(v[1])));
    }

    // Forma 2 — incremental: `<lo> <hi> <uInicial>`, o unicode anda junto com o
    // código. O `[^[]` na frente evita reconsumir a forma 1.
    for (const faixa of corpo.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const inicio = Number.parseInt(faixa[1], 16);
      const fim = Number.parseInt(faixa[2], 16);
      const base = Number.parseInt(faixa[3].slice(-4), 16);
      for (let c = inicio; c <= fim && c - inicio < 65536; c += 1) {
        if (!mapa.has(c)) mapa.set(c, String.fromCharCode(base + (c - inicio)));
      }
    }
  }

  return mapa;
};

// Inflaciona todo stream do arquivo. O que não for Flate simplesmente não
// infla, e é descartado — não vale a pena ler o dicionário só para saber.
const inflarStreams = (buffer) => {
  const bruto = buffer.toString("latin1");
  const streams = [];
  const marcador = /stream\r?\n/g;
  let achado;

  while ((achado = marcador.exec(bruto)) !== null) {
    const inicio = achado.index + achado[0].length;
    const fim = bruto.indexOf("endstream", inicio);
    if (fim === -1) continue;
    try {
      streams.push(inflateSync(Buffer.from(bruto.slice(inicio, fim), "latin1")).toString("latin1"));
    } catch {
      // Não é FlateDecode (fonte embutida, imagem). Não interessa aqui.
    }
  }

  return streams;
};

// Os códigos que os operadores de texto mostram, na ordem em que aparecem.
// `Tj` recebe um literal só; `TJ` recebe um array de literais intercalado com
// números de kerning, que são posicionamento e não texto.
const codigosDoConteudo = (conteudo) => {
  const codigos = [];

  for (const op of conteudo.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F\s]+)>\s*Tj/g)) {
    const corpo = op[1] ?? op[2] ?? "";
    for (const literal of corpo.matchAll(/<([0-9a-fA-F\s]*)>/g)) {
      const hex = literal[1].replace(/\s+/g, "");
      for (let i = 0; i + 3 < hex.length; i += 4) {
        codigos.push(Number.parseInt(hex.slice(i, i + 4), 16));
      }
    }
  }

  return codigos;
};

export const extrairTextoDoPdf = (buffer) => {
  const streams = inflarStreams(buffer);

  const cmaps = streams
    .filter((s) => s.includes("beginbfchar") || s.includes("beginbfrange"))
    .map(lerCMap)
    .filter((m) => m.size > 0);

  const conteudos = streams.filter((s) => /\bTJ\b|\bTj\b/.test(s));

  if (cmaps.length === 0 || conteudos.length === 0) return "";

  const codigos = conteudos.flatMap(codigosDoConteudo);

  // Uma leitura por CMap. A do CMap certo é a legível; as outras são ruído
  // inofensivo — ver a nota do cabeçalho.
  return cmaps
    .map((mapa) => codigos.map((c) => mapa.get(c) ?? "").join(""))
    .join("\n\n");
};

export default extrairTextoDoPdf;
