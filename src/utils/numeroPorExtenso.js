// ═══════════════════════════════════════════════════════════════════════════
// VALOR MONETÁRIO POR EXTENSO, EM PORTUGUÊS
//
// Contrato de honorários traz o valor em algarismos E por extenso — quando os
// dois divergem, o extenso é que prevalece (art. 12 do Decreto 22.626/33 é o
// costume forense; na prática, é o que o cartório aceita). Por isso a
// concordância importa: "um real" e não "um reais", "cem" e não "cento".
//
// Sem biblioteca: a regra do português é fechada e cabe em um arquivo, e uma
// dependência a mais para isto seria pior de auditar do que o próprio código.
// ═══════════════════════════════════════════════════════════════════════════

const UNIDADES = [
  "", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"
];

// 10 a 19 não seguem padrão: são nomes próprios, não "dez e um".
const DEZ_A_DEZENOVE = [
  "dez", "onze", "doze", "treze", "quatorze", "quinze",
  "dezesseis", "dezessete", "dezoito", "dezenove"
];

const DEZENAS = [
  "", "", "vinte", "trinta", "quarenta", "cinquenta",
  "sessenta", "setenta", "oitenta", "noventa"
];

// Índice 1 é "cento": "cem" é forma exclusiva do 100 exato, tratada à parte.
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos"
];

// Escalas em pares [singular, plural]. Uma escala a mais aqui estende o
// alcance sem tocar no resto.
const ESCALAS = [
  ["", ""],
  ["mil", "mil"],
  ["milhão", "milhões"],
  ["bilhão", "bilhões"],
  ["trilhão", "trilhões"]
];

// Converte um grupo de 1 a 999 por extenso.
const grupoPorExtenso = (n) => {
  if (n === 100) return "cem";

  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];

  if (centena > 0) partes.push(CENTENAS[centena]);

  if (resto >= 10 && resto <= 19) {
    partes.push(DEZ_A_DEZENOVE[resto - 10]);
  } else {
    const dezena = Math.floor(resto / 10);
    const unidade = resto % 10;

    if (dezena > 0) partes.push(DEZENAS[dezena]);
    if (unidade > 0) partes.push(UNIDADES[unidade]);
  }

  // Dentro do grupo o conectivo é sempre "e": "cento e vinte e três".
  return partes.join(" e ");
};

// Quebra o inteiro em grupos de três, do menos significativo para o mais.
const emGrupos = (n) => {
  const grupos = [];
  let restante = n;

  while (restante > 0) {
    grupos.push(restante % 1000);
    restante = Math.floor(restante / 1000);
  }

  return grupos;
};

// Regra do "e" ENTRE grupos, que é onde quase toda implementação erra:
// liga-se o último grupo ao anterior com "e" quando ele é menor que 100
// ("mil e cinquenta") ou é centena redonda ("mil e quinhentos"); caso
// contrário separa-se por vírgula ("mil duzentos e trinta e quatro" —
// sem "e" antes de "duzentos").
const ligaComE = (grupo) => grupo < 100 || grupo % 100 === 0;

// Verdadeiro quando o número TERMINA numa escala de milhão para cima sem nada
// depois — é o caso que pede a preposição: "um milhão DE reais". "Mil" não
// entra ("mil reais", nunca "mil de reais"), e 1.500.000 também não, porque
// termina em "mil": "um milhão e quinhentos mil reais".
export const exigeDeReais = (n) => {
  if (!Number.isFinite(n) || n < 1000000) return false;

  const grupos = emGrupos(n);
  // Índice 0 = unidades, 1 = milhares. Ambos zerados ⇒ termina em milhão+.
  return grupos[0] === 0 && grupos[1] === 0;
};

const inteiroPorExtenso = (n) => {
  if (n === 0) return "zero";

  const grupos = emGrupos(n);
  const partes = [];

  // Do grupo mais significativo para o menos.
  for (let i = grupos.length - 1; i >= 0; i -= 1) {
    const grupo = grupos[i];
    if (grupo === 0) continue;

    const [singular, plural] = ESCALAS[i];

    let texto;
    if (i === 1 && grupo === 1) {
      // "mil", nunca "um mil".
      texto = "mil";
    } else {
      texto = grupoPorExtenso(grupo);
      if (singular) texto += ` ${grupo === 1 ? singular : plural}`;
    }

    partes.push({ texto, grupo, escala: i });
  }

  let resultado = "";
  for (let i = 0; i < partes.length; i += 1) {
    if (i === 0) {
      resultado = partes[i].texto;
      continue;
    }

    const ehUltimo = i === partes.length - 1;
    const separador = ehUltimo && ligaComE(partes[i].grupo) ? " e " : ", ";
    resultado += separador + partes[i].texto;
  }

  return resultado;
};

/**
 * Valor monetário por extenso, em reais.
 *
 * Aceita número (5000.5) ou string ("5000,50" / "5000.50"). Devolve string
 * vazia para entrada inválida — quem chama trata como variável não resolvida,
 * que é o comportamento do catálogo de templates.
 */
export const valorPorExtenso = (valor) => {
  let numero;

  if (typeof valor === "number") {
    numero = valor;
  } else if (typeof valor === "string") {
    // Aceita "1.500,50" (pt-BR) e "1500.50" (padrão de banco).
    const limpo = valor.trim().replace(/\s/g, "");
    const normalizado = limpo.includes(",")
      ? limpo.replace(/\./g, "").replace(",", ".")
      : limpo;
    numero = Number(normalizado);
  } else {
    return "";
  }

  if (!Number.isFinite(numero) || numero < 0) return "";

  // Arredonda em centavos ANTES de separar: sem isso, 0.1+0.2 vira 29 centavos.
  const totalCentavos = Math.round(numero * 100);
  const inteiro = Math.floor(totalCentavos / 100);
  const centavos = totalCentavos % 100;

  const partes = [];

  if (inteiro > 0) {
    const moeda = inteiro === 1 ? "real" : "reais";
    const preposicao = exigeDeReais(inteiro) ? "de " : "";
    partes.push(`${inteiroPorExtenso(inteiro)} ${preposicao}${moeda}`);
  }

  if (centavos > 0) {
    partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }

  // Zero não é "nada": contrato com valor zerado precisa dizer isso por extenso.
  if (partes.length === 0) return "zero reais";

  return partes.join(" e ");
};

export default { valorPorExtenso, inteiroPorExtenso };
