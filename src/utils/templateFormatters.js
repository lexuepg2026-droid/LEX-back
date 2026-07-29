import { somenteDigitos, formatarCPF, formatarCNPJ } from "./documentos.js";
import { valorPorExtenso } from "./numeroPorExtenso.js";

// Formatadores aplicados aos valores antes de entrarem no texto do documento.
// Todos devolvem "" para entrada vazia — quem decide o que fazer com a lacuna é
// o templateParser, que mantém o marcador e reporta a pendência.

const vazio = (valor) =>
  valor === undefined || valor === null || String(valor).trim() === "";

export const texto = (valor) => (vazio(valor) ? "" : String(valor).trim());

export const data = (valor) => {
  if (vazio(valor)) return "";
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  // UTC: as datas são gravadas como meia-noite UTC; sem isso um fuso negativo
  // exibiria o dia anterior.
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

// "12 de março de 1988" — forma usada no corpo de procurações e contratos.
export const dataExtenso = (valor) => {
  if (vazio(valor)) return "";
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
};

export const cpf = (valor) => {
  if (vazio(valor)) return "";
  const digitos = somenteDigitos(valor);
  return digitos.length === 11 ? formatarCPF(digitos) : String(valor).trim();
};

export const cnpj = (valor) => {
  if (vazio(valor)) return "";
  const digitos = somenteDigitos(valor);
  return digitos.length === 14 ? formatarCNPJ(digitos) : String(valor).trim();
};

export const cep = (valor) => {
  if (vazio(valor)) return "";
  const digitos = somenteDigitos(valor);
  return digitos.length === 8 ? digitos.replace(/(\d{5})(\d{3})/, "$1-$2") : String(valor).trim();
};

export const telefone = (valor) => {
  if (vazio(valor)) return "";
  const d = somenteDigitos(valor);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return String(valor).trim();
};

// "Rua XV de Novembro, nº 100, Apto 12, Centro, Curitiba/PR, CEP 80010-000"
// Partes ausentes somem sem deixar vírgula solta.
export const endereco = (valor) => {
  if (!valor || typeof valor !== "object") return "";

  const logradouro = texto(valor.logradouro);
  const numero = texto(valor.numero);
  const complemento = texto(valor.complemento);
  const bairro = texto(valor.bairro);
  const cidade = texto(valor.cidade);
  const estado = texto(valor.estado);
  const cepFormatado = cep(valor.cep);

  const partes = [];
  if (logradouro) partes.push(numero ? `${logradouro}, nº ${numero}` : logradouro);
  else if (numero) partes.push(`nº ${numero}`);
  if (complemento) partes.push(complemento);
  if (bairro) partes.push(bairro);
  if (cidade && estado) partes.push(`${cidade}/${estado}`);
  else if (cidade) partes.push(cidade);
  else if (estado) partes.push(estado);
  if (cepFormatado) partes.push(`CEP ${cepFormatado}`);

  return partes.join(", ");
};

const ROTULOS_SEXO = {
  feminino: "Feminino",
  masculino: "Masculino"
};

// "União estável (amasiado)" acompanha o rótulo do frontend: "uniao_estavel" é
// o termo do Código Civil e o valor persistido; "amasiado" atende ao
// apontamento da banca e descreve a mesma situação jurídica.
const ROTULOS_ESTADO_CIVIL = {
  solteiro: "Solteiro(a)",
  casado: "Casado(a)",
  separado_judicialmente: "Separado(a) judicialmente",
  divorciado: "Divorciado(a)",
  viuvo: "Viúvo(a)",
  uniao_estavel: "União estável (amasiado)"
};

export const sexo = (valor) => (vazio(valor) ? "" : ROTULOS_SEXO[valor] || "");

export const estadoCivil = (valor) =>
  vazio(valor) ? "" : ROTULOS_ESTADO_CIVIL[valor] || "";

// ── Honorário ───────────────────────────────────────────────────────────────

// "R$ 5.000,00". Zero é valor legítimo num contrato (honorário pro bono, custas
// isentas), então não cai no `vazio` — só null/undefined/"" caem.
//
// O separador entre "R$" e o número é ESPAÇO NÃO-SEPARÁVEL (U+00A0), vindo do
// toLocaleString do Node. É intencional: impede que a quebra de linha do PDF
// deixe o "R$" no fim de uma linha e o valor no começo da outra, no meio de
// uma cláusula de honorários. Não trocar por espaço comum.
//
// Quem for COMPARAR essa saída com string digitada à mão precisa normalizar
// antes — ver README, seção 5.2.
export const moeda = (valor) => {
  if (valor === undefined || valor === null || valor === "") return "";
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero)) return "";
  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2
  });
};

// "cinco mil reais" — o extenso que o contrato exige ao lado dos algarismos.
export const extenso = (valor) => {
  if (valor === undefined || valor === null || valor === "") return "";
  return valorPorExtenso(valor);
};

const ROTULOS_TIPO_HONORARIO = {
  fixo: "fixo",
  percentual: "percentual",
  custas: "custas processuais"
};

export const tipoHonorario = (valor) =>
  vazio(valor) ? "" : ROTULOS_TIPO_HONORARIO[valor] || "";

// Contagem simples. Zero devolve "" de propósito: "em 0 parcelas" não é frase
// que se escreva em contrato — vira pendência, e a advogada corrige.
export const inteiro = (valor) => {
  if (valor === undefined || valor === null || valor === "") return "";
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return "";
  return String(Math.trunc(numero));
};

export default {
  texto,
  data,
  dataExtenso,
  cpf,
  cnpj,
  cep,
  telefone,
  endereco,
  sexo,
  estadoCivil,
  moeda,
  extenso,
  tipoHonorario,
  inteiro
};
