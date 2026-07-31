// ═══════════════════════════════════════════════════════════════════════════
// SEGREDO DO PORTAL DO CLIENTE (DEC-029, ponto 7)
//
// O portal assina os próprios tokens com `JWT_PORTAL_SECRET`, DISTINTO do
// `JWT_SECRET` da advogada.
//
// Por que segredo separado, e não só cookie separado: nome de cookie não é
// fronteira de segurança. Quem controla o navegador escolhe em qual cookie
// põe qual string. Se os dois domínios assinassem com o mesmo segredo, um
// token de portal renomeado para `lex-token` passaria na verificação de
// assinatura do `authMiddleware`, e a única coisa entre um cliente e o
// cadastro inteiro da advogada seria a checagem de `tipo` — uma condição de
// `if`, não criptografia. Com segredos distintos, a assinatura simplesmente
// não confere, e a defesa passa a ser matemática em vez de disciplina.
//
// A checagem de `tipo` continua existindo, nos dois middlewares. Ela é a
// segunda tranca, não a primeira.
//
// ── Por que derrubar o processo ────────────────────────────────────────────
// Mesmo padrão das guardas de banco da Fase 2E.2: falhar alto, na carga, com
// mensagem que diz o que fazer. A alternativa — subir e só quebrar no primeiro
// login de portal — significaria descobrir o problema em produção, no dia em
// que um cliente real tentasse entrar.
// ═══════════════════════════════════════════════════════════════════════════

const abortar = (mensagem) => {
  process.stderr.write(
    "\n" +
    "══════════════════════════════════════════════════════════════════\n" +
    "  APLICAÇÃO NÃO PODE SUBIR\n" +
    "══════════════════════════════════════════════════════════════════\n" +
    mensagem +
    "\n══════════════════════════════════════════════════════════════════\n\n"
  );
  process.exit(1);
};

export const MOTIVO = Object.freeze({
  AUSENTE: "ausente",
  IGUAL: "igual",
  OK: "ok"
});

// Separada do efeito colateral para poder ser testada sem derrubar o processo
// de teste. `assertSegredoDoPortal` é quem aborta.
export const conferirSegredoDoPortal = (portal, advogada) => {
  if (typeof portal !== "string" || portal.trim().length === 0) {
    return MOTIVO.AUSENTE;
  }
  // Comparação por igualdade simples: os dois valores vêm do ambiente do
  // próprio processo, não de entrada de rede — não há canal de tempo a
  // proteger aqui.
  if (typeof advogada === "string" && portal.trim() === advogada.trim()) {
    return MOTIVO.IGUAL;
  }
  return MOTIVO.OK;
};

export const assertSegredoDoPortal = () => {
  const resultado = conferirSegredoDoPortal(
    process.env.JWT_PORTAL_SECRET,
    process.env.JWT_SECRET
  );

  if (resultado === MOTIVO.AUSENTE) {
    abortar(
      "`JWT_PORTAL_SECRET` não está definido.\n\n" +
      "O portal do cliente assina os próprios tokens com um segredo próprio,\n" +
      "separado do `JWT_SECRET` da advogada. Sem ele, não há como emitir nem\n" +
      "verificar sessão de portal.\n\n" +
      "Defina no `.env` uma string longa e aleatória, DIFERENTE do\n" +
      "`JWT_SECRET`. Ver `.env.example`."
    );
  }

  if (resultado === MOTIVO.IGUAL) {
    abortar(
      "`JWT_PORTAL_SECRET` é IGUAL ao `JWT_SECRET`.\n\n" +
      "Segredo compartilhado entre os dois domínios anula a separação: um\n" +
      "token de portal passaria na verificação de assinatura do middleware da\n" +
      "advogada, e a única barreira restante seria a checagem do campo `tipo`.\n\n" +
      "Gere um segredo distinto para o portal. Ver `.env.example`."
    );
  }

  return process.env.JWT_PORTAL_SECRET;
};

export default assertSegredoDoPortal;
