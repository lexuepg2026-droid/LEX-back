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
