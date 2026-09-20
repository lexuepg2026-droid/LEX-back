// ═══════════════════════════════════════════════════════════════════════════
// CPF, CNPJ E NÚMERO DE PROCESSO (CNJ) FICTÍCIOS — COM DÍGITO VERIFICADOR VÁLIDO
//
// "Fictício" quer dizer que ninguém escolheu estes números para ninguém: saem do
// sorteio. "Válido" quer dizer que o dígito verificador fecha, porque o sistema
// recusa CPF/CNPJ que não fecha (`clientValidation`) — e um seed com documento
// inválido não passaria pelo serviço que ele existe para exercitar.
//
// Nada aqui toca banco ou rede: são funções puras, e por isso têm teste.
// ═══════════════════════════════════════════════════════════════════════════

const digitoVerificador = (digitos, pesoInicial) => {
  const soma = digitos.reduce((acc, d, i) => acc + d * (pesoInicial - i), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
};

// CPF: 9 dígitos sorteados + 2 verificadores. Sequência de dígitos iguais
// (111.111.111-11) tem verificador "válido" e é recusada por qualquer validador
// sério — fica de fora.
export const gerarCPF = (sorteio) => {
  let base;
  do {
    base = Array.from({ length: 9 }, () => sorteio.inteiro(0, 9));
  } while (base.every((d) => d === base[0]));

  const d1 = digitoVerificador(base, 10);
  const d2 = digitoVerificador([...base, d1], 11);
  return [...base, d1, d2].join("");
};

// CNPJ: 8 dígitos sorteados + filial 0001 + 2 verificadores.
const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

const verificadorCNPJ = (digitos, pesos) => {
  const soma = digitos.reduce((acc, d, i) => acc + d * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
};

export const gerarCNPJ = (sorteio) => {
  let raiz;
  do {
    raiz = Array.from({ length: 8 }, () => sorteio.inteiro(0, 9));
  } while (raiz.every((d) => d === raiz[0]));

  const base = [...raiz, 0, 0, 0, 1];
  const d1 = verificadorCNPJ(base, PESOS_CNPJ_1);
  const d2 = verificadorCNPJ([...base, d1], PESOS_CNPJ_2);
  return [...base, d1, d2].join("");
};

// ── Número único do processo (Resolução CNJ 65/2008) ───────────────────────
//
//   NNNNNNN-DD.AAAA.J.TR.OOOO      (20 dígitos)
//
//   N  sequencial no ano      DD dígito verificador (módulo 97)
//   A  ano do ajuizamento     J  segmento da Justiça (8 = Estadual)
//   TR tribunal (16 = TJPR)   O  unidade de origem (o foro)
//
// O DD é calculado de verdade: `98 − (NNNNNNN AAAA J TR OOOO 00 mod 97)`. Um
// número que passa na conferência do CNJ é o que a advogada encontra no dia a
// dia — e é o formato "usado hoje" pela tela de processos.
const zeros = (valor, tamanho) => String(valor).padStart(tamanho, "0");

export const calcularDigitoCNJ = ({ sequencial, ano, foro }) => {
  const corpo = `${zeros(sequencial, 7)}${zeros(ano, 4)}816${zeros(foro, 4)}00`;
  return zeros(98n - (BigInt(corpo) % 97n), 2);
};

export const montarNumeroCNJ = ({ sequencial, ano, foro }) => {
  const n = zeros(sequencial, 7);
  const dd = calcularDigitoCNJ({ sequencial, ano, foro });
  return `${n}-${dd}.${zeros(ano, 4)}.8.16.${zeros(foro, 4)}`;
};

// Conferência independente da geração: o resto de (N A J TR O DD) por 97 é 1.
export const numeroCNJValido = (numero) => {
  const partes = /^(\d{7})-(\d{2})\.(\d{4})\.8\.16\.(\d{4})$/.exec(String(numero));
  if (!partes) return false;
  const [, n, dd, ano, foro] = partes;
  return BigInt(`${n}${ano}816${foro}${dd}`) % 97n === 1n;
};

export default { gerarCPF, gerarCNPJ, montarNumeroCNJ, numeroCNJValido, calcularDigitoCNJ };
