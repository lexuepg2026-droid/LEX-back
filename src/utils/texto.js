// Utilitários de texto para busca.
//
// Duplicam de propósito o `semAcento` privado de documentRenderService.js: a
// Fase 2D.1 não pode alterar aquele arquivo, e extrair o helper de lá mexeria
// nele. Unificar os dois é limpeza para quando o render service voltar a ficar
// disponível para edição.

export const semAcento = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// Escapa os metacaracteres de regex de um termo digitado pela advogada.
//
// Vivia em QUATRO cópias idênticas (`feeService`, `clientService`,
// `processService` e aqui), todas com o mesmo corpo e três com o mesmo nome em
// inglês. Unificada na Fase F-0: quatro cópias da mesma regra é o formato de
// dívida em que uma delas fica para trás, e a que ficar para trás transforma
// um termo de busca em padrão de regex — `.*` num campo de busca varreria a
// coleção inteira.
export const escaparRegex = (valor) => String(valor ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Cada letra que admite acento vira a classe com todas as suas formas. O termo
// entra sem acento e o padrão aceita as duas grafias, nos dois sentidos:
// "qualificacao" acha "Qualificação", e "qualificação" também.
const CLASSES_ACENTO = {
  a: "aáàãâä",
  e: "eéèêë",
  i: "iíìîï",
  o: "oóòõôö",
  u: "uúùûü",
  c: "cç",
  n: "nñ"
};

// Regex que ignora acento e caixa, para busca por título.
//
// Não dá para resolver isso com collation do MongoDB: o $regex ignora
// collation não-simples, então a insensibilidade a acento precisa estar no
// próprio padrão. A alternativa seria um campo sombra normalizado no schema —
// mais caro, e a coleção de seções é pequena.
const padraoSemAcento = (limpo) =>
  escaparRegex(semAcento(limpo).toLowerCase())
    .split("")
    .map((ch) => (CLASSES_ACENTO[ch] ? `[${CLASSES_ACENTO[ch]}]` : ch))
    .join("");

export const regexBuscaTexto = (termo, { limite = 80 } = {}) => {
  const limpo = String(termo ?? "").slice(0, limite).trim();
  if (!limpo) return null;
  return new RegExp(padraoSemAcento(limpo), "i");
};

// IGUALDADE sem acento e sem caixa (Fase 3.4, DEC-115): o filtro de tipo de
// ação da lista de processos. É o mesmo padrão da busca, ancorado nas duas
// pontas — "inventario" casa "Inventário" e não casa "Inventário extrajudicial".
export const regexIgualSemAcento = (termo, { limite = 200 } = {}) => {
  const limpo = String(termo ?? "").slice(0, limite).trim();
  if (!limpo) return null;
  return new RegExp(`^${padraoSemAcento(limpo)}$`, "i");
};

// Regex de busca simples (sem tratamento de acento), para os campos em que o
// termo é comparado como digitado — descrição de honorário, nome de cliente,
// título/número de processo. Devolve `null` quando não há termo utilizável,
// para o chamador simplesmente não aplicar o filtro.
export const regexTermoSimples = (termo, { limite = 80 } = {}) => {
  if (typeof termo !== "string") return null;
  const limpo = termo.slice(0, limite).trim();
  if (!limpo) return null;
  return new RegExp(escaparRegex(limpo), "i");
};

// Regex insensível a acento e caixa para um `?busca=` vindo da query (Fase
// 3.2, DEC-101). É `regexBuscaTexto` com a guarda de tipo de
// `regexTermoSimples`: o parâmetro repetido chega como array, e
// `String(["a","b"])` viraria a busca literal por "a,b".
export const regexBuscaDaQuery = (termo, opcoes) =>
  typeof termo === "string" ? regexBuscaTexto(termo, opcoes) : null;

export default { semAcento, escaparRegex, regexBuscaTexto, regexIgualSemAcento, regexTermoSimples, regexBuscaDaQuery };
