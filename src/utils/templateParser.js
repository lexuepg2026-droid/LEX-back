import { CATALOGO_VARIAVEIS } from "../config/templateVariables.js";

// Marcador de variável: {{nomeVariavel}}. Espaços internos são tolerados
// ({{ nomeCliente }}) porque quem escreve o template é a advogada, não um
// programador — exigir formatação exata só produziria erro silencioso.
const REGEX_VARIAVEL = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// Nomes únicos e ordenados encontrados no texto.
export const extrairVariaveis = (texto) => {
  if (typeof texto !== "string" || texto.length === 0) {
    return [];
  }

  const encontradas = new Set();
  for (const match of texto.matchAll(REGEX_VARIAVEL)) {
    encontradas.add(match[1]);
  }

  return [...encontradas].sort();
};

// Nomes usados no texto que NÃO existem no catálogo. Array vazio = texto válido.
export const validarVariaveis = (texto) => {
  return extrairVariaveis(texto).filter((nome) => !CATALOGO_VARIAVEIS[nome]);
};


// ═══════════════════════════════════════════════════════════════════════════
// SUGESTÃO POR DISTÂNCIA DE EDIÇÃO (Fase 4.6, item 2.4)
//
// `{{nomeAdvogado}}` foi o nome REAL da chave até a Fase 2D.2, quando as duas
// variáveis com gênero passaram ao feminino **sem alias de compatibilidade**.
// Quem colar texto de uma anotação anterior — ou digitar de memória — recebe
// "Variáveis inválidas no texto: {{nomeAdvogado}}" e fica olhando para uma
// chave que difere da correta por UMA letra.
//
// Levenshtein escrito à mão: são vinte linhas, e a fase não instala nada.
// Iterativo com duas linhas de matriz, porque a versão recursiva estoura a
// pilha em texto longo e a matriz cheia não é necessária para saber a distância.
const distancia = (a, b) => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  let atual = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    atual[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
    }
    [anterior, atual] = [atual, anterior];
  }

  return anterior[b.length];
};

// Teto de 1/3 do tamanho do nome, no mínimo 2 e no máximo 4. Sem teto,
// `{{xpto}}` sugeriria `{{sexoCliente}}` e a "ajuda" viraria ruído — sugestão
// errada com cara de certeza é pior que nenhuma sugestão.
const tetoDeDistancia = (nome) => Math.min(4, Math.max(2, Math.floor(nome.length / 3)));

// A chave válida mais próxima, ou null. A comparação é insensível a caixa: quem
// escreve `{{NomeCliente}}` errou a caixa, não o nome.
export const sugerirVariavel = (nome) => {
  const alvo = String(nome ?? "").toLowerCase();
  if (alvo.length === 0) return null;

  const teto = tetoDeDistancia(alvo);
  let melhor = null;
  let menor = Infinity;

  for (const candidata of Object.keys(CATALOGO_VARIAVEIS)) {
    const d = distancia(alvo, candidata.toLowerCase());
    if (d < menor) { menor = d; melhor = candidata; }
  }

  return menor <= teto ? melhor : null;
};

// Grupo de origem provável, para quando não há candidata próxima. Sufixos são
// o único sinal disponível num nome que não se parece com nada do catálogo.
const SUFIXO_DA_ORIGEM = [
  [/cliente$/i, "cliente"],
  [/(advogad[ao]|advocacia|escritorio|oab|pix)/i, "usuario"],
  [/processo$/i, "processo"],
  [/honorario$/i, "honorario"]
];

export const origemProvavel = (nome) => {
  for (const [regex, origem] of SUFIXO_DA_ORIGEM) {
    if (regex.test(String(nome ?? ""))) return origem;
  }
  return null;
};

const vazio = (valor) =>
  valor === undefined || valor === null || String(valor).trim() === "";

// Substitui cada ocorrência pelo valor correspondente.
//
// Valor ausente ou vazio NÃO vira string vazia: o marcador permanece no texto e
// o nome entra em `pendencias`. Documento jurídico com lacuna silenciosa é pior
// que documento que se recusa a ser gerado — "declaro que RG nº  é meu" passa
// despercebido numa revisão rápida, "{{rgCliente}}" não passa.
export const substituir = (texto, valores = {}) => {
  if (typeof texto !== "string" || texto.length === 0) {
    return { texto: "", pendencias: [] };
  }

  const pendencias = new Set();

  const resolvido = texto.replace(REGEX_VARIAVEL, (marcador, nome) => {
    const valor = valores[nome];
    if (vazio(valor)) {
      pendencias.add(nome);
      return marcador;
    }
    return String(valor);
  });

  return { texto: resolvido, pendencias: [...pendencias].sort() };
};
