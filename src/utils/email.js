// ═══════════════════════════════════════════════════════════════════════════
// FORMATO DE E-MAIL — deliberadamente simples (DEC-063)
//
// ── O que esta regra se propõe a fazer ────────────────────────────────────
// **Pegar erro de digitação.** Nada além disso. Ela não certifica que o
// endereço existe, não confere o domínio, não faz consulta de DNS e não tenta
// implementar a gramática de endereço do RFC 5322.
//
// ── Por que NÃO uma expressão regular "completa" ──────────────────────────
// A gramática real de endereço de e-mail admite coisas que quase nenhum
// sistema aceita — aspas no nome local, comentários entre parênteses,
// endereço IP literal entre colchetes no domínio. Toda tentativa de cobri-la
// produz uma expressão de centenas de caracteres que ninguém consegue ler,
// revisar ou corrigir.
//
// E o custo do erro é assimétrico:
//
//   • aceitar um endereço inválido  → a advogada recebe "não foi entregue" e
//                                      corrige o cadastro;
//   • recusar um endereço VÁLIDO    → a pessoa não consegue se cadastrar, não
//                                      entende por quê, e não tem a quem
//                                      recorrer.
//
// **O segundo é muito pior**, e é exatamente o que as expressões "completas"
// produzem na prática. Entre errar para o lado permissivo e errar para o lado
// restritivo, esta regra erra para o permissivo — e é a mesma decisão que a
// F-3.2 registrou como regra geral do projeto ("a tela nunca é mais rígida que
// a API", nascida do código de acesso do portal).
//
// ── As regras, por extenso ────────────────────────────────────────────────
//   1. exatamente UM `@`;
//   2. algo antes dele;
//   3. depois dele, ao menos um ponto, com algo antes e depois;
//   4. sem espaços (de qualquer tipo, inclusive tab e quebra de linha);
//   5. sem dois pontos seguidos.
//
// O sinal de mais é **aceito de propósito**: `daniel+banca@lex.dev` é endereço
// válido e é usado de verdade para separar remetentes. Uma regra que o
// recusasse cairia no erro caro do parágrafo acima.
// ═══════════════════════════════════════════════════════════════════════════

// `trim` e caixa baixa. É o que faz `Daniel@X.com ` e `daniel@x.com` serem o
// MESMO e-mail — sem isto o índice único não os vê como iguais, e o sistema
// aceitaria duas contas que qualquer humano leria como uma.
//
// Devolve string sempre, inclusive para entrada não-string: quem chama isto
// está prestes a comparar ou gravar, e `undefined` vazando para um `findOne`
// devolveria um documento arbitrário.
export const normalizarEmail = (valor) =>
  typeof valor === "string" ? valor.trim().toLowerCase() : "";

// A regra 5 fica FORA da expressão, de propósito: `[^\s@]+\.[^\s@]+` aceita
// `lex..dev` porque o primeiro grupo engole o primeiro ponto. Foi exatamente
// esse o furo da expressão que o projeto usava antes da A-1 — ela reprovava os
// dez outros casos e deixava passar só este. Escrever a proibição de ponto
// duplo como um teste separado é o que a torna legível e verificável.
const FORMA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailValido = (valor) => {
  const email = normalizarEmail(valor);
  if (email === "") return false;
  if (email.includes("..")) return false;
  return FORMA.test(email);
};

// A frase é UMA, e sai daqui. A tela valida para poupar uma viagem e o servidor
// valida porque é a autoridade (passo 102) — e quando as duas recusam o mesmo
// endereço, elas precisam dizer a mesma coisa. Duas redações para a mesma regra
// fariam a advogada achar que são dois problemas diferentes.
export const MENSAGEM_EMAIL_INVALIDO = "E-mail inválido";

export default { emailValido, normalizarEmail, MENSAGEM_EMAIL_INVALIDO };
