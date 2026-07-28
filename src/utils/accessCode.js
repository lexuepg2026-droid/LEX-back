import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// CÓDIGO DE ACESSO DO PAR CLIENTE/PROCESSO (Fase 3 — portal do cliente)
//
// Formato: LEX-XXXX-XXXX (12 caracteres com os hífens).
//
// Alfabeto Crockford Base32 — 32 símbolos, sem I, L, O e U. A advogada dita
// esse código por telefone e WhatsApp: "I" vira "1", "O" vira "0", "L" vira
// "1" na leitura de quem anota, e "U" é retirado porque forma palavrão em
// combinação com outras letras. Retirar os quatro elimina a classe inteira de
// erro de transcrição.
//
// Sorteio por crypto.randomBytes, nunca Math.random: Math.random é previsível
// a partir de amostras do mesmo processo, e código previsível permite enumerar
// processos de terceiros no portal — que é exatamente o que este código
// protege. Também nunca derivar de _id, número do processo ou CPF: qualquer
// derivação transforma dado conhecido do cliente em chave de acesso.
// ═══════════════════════════════════════════════════════════════════════════

export const ALFABETO_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const PREFIXO_CODIGO = "LEX";
export const TAMANHO_SORTEADO = 8;
export const TAMANHO_CODIGO = 12; // "LEX-" + 4 + "-" + 4

// 256 é múltiplo exato de 32, então o mascaramento dos 5 bits baixos distribui
// os 32 símbolos uniformemente — não há viés de módulo a corrigir.
const MASCARA_5_BITS = 0x1f;

export const gerarCodigoAcesso = () => {
  const bytes = crypto.randomBytes(TAMANHO_SORTEADO);

  let sorteado = "";
  for (let i = 0; i < TAMANHO_SORTEADO; i += 1) {
    sorteado += ALFABETO_CROCKFORD[bytes[i] & MASCARA_5_BITS];
  }

  return `${PREFIXO_CODIGO}-${sorteado.slice(0, 4)}-${sorteado.slice(4)}`;
};

const REGEX_CODIGO = new RegExp(
  `^${PREFIXO_CODIGO}-[${ALFABETO_CROCKFORD}]{4}-[${ALFABETO_CROCKFORD}]{4}$`
);

export const isCodigoAcessoValido = (valor) =>
  typeof valor === "string" && REGEX_CODIGO.test(valor);

export const TENTATIVAS_PADRAO = 5;

// Gera um código ainda não usado. `jaExiste` é injetado (async, recebe o
// candidato e devolve boolean) para o utilitário não conhecer o model — quem
// chama decide o escopo da consulta.
//
// A verificação prévia não substitui o índice único: entre o SELECT e o INSERT
// existe janela de corrida. Ela só evita gastar uma tentativa de escrita no
// caso comum. A garantia real é o índice `{ codigoAcesso: 1 }` único global, e
// quem grava deve tratar o 11000 correspondente repetindo a geração.
export const gerarCodigoAcessoUnico = async (jaExiste, tentativas = TENTATIVAS_PADRAO) => {
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    const candidato = gerarCodigoAcesso();

    if (!(await jaExiste(candidato))) {
      return candidato;
    }
  }

  // Estourar isso com 32^8 (~1,1 trilhão) de combinações não é colisão de
  // sorte: é sinal de que a consulta de existência está errada ou o gerador
  // travou. Falhar alto é melhor que gravar código duplicado.
  const error = new Error(
    `Não foi possível gerar um código de acesso único após ${tentativas} tentativas`
  );
  error.statusCode = 500;
  throw error;
};

export default {
  ALFABETO_CROCKFORD,
  PREFIXO_CODIGO,
  TAMANHO_CODIGO,
  gerarCodigoAcesso,
  isCodigoAcessoValido,
  gerarCodigoAcessoUnico
};
