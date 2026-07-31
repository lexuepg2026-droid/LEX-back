// ═══════════════════════════════════════════════════════════════════════════
// CÓDIGOS DE ERRO ESTÁVEIS DO PORTAL DO CLIENTE
//
// Vocabulário FECHADO, no mesmo espírito de `integrityConflicts.js`. O portal
// da Fase 3.2 precisa ROTEAR por estes valores — mandar o cliente para a tela
// de troca de senha, explicar por que a confirmação está bloqueada —, e
// roteamento não pode depender do texto da mensagem.
//
// Foi assim que a Fase 1.3 quebrou: o roteamento de etapa do cadastro dependia
// de `/mail/i` bater na mensagem, e um ajuste de redação derrubou a tela. A
// mensagem é o que a pessoa lê; o código é o que o programa lê. São coisas
// diferentes e mudam por motivos diferentes.
//
// O `errorHandler` repassa `codigo` ao cliente por estar na allowlist de
// `CHAVES_ESTRUTURADAS` (`middleware/errorMiddleware.js`).
// ═══════════════════════════════════════════════════════════════════════════

export const ERRO_PORTAL = Object.freeze({
  // 403 — a sessão é VÁLIDA; o que falta é o cliente trocar a senha provisória.
  // Não é 401 de propósito: 401 mandaria o portal apagar a sessão e voltar ao
  // login, e o cliente entraria em laço, porque logar de novo devolve o mesmo
  // estado. O que falta é um passo, não uma credencial.
  SENHA_PROVISORIA: "senhaPortalProvisoria",

  // 403 — específico da confirmação de visualização, distinto do de cima
  // mesmo ocorrendo na mesma condição. A tela precisa dizer coisas diferentes:
  // "troque a senha para continuar" e "a confirmação só vale depois que você
  // definir uma senha que só você conhece". O segundo explica o PORQUÊ, e é o
  // que sustenta o valor jurídico do recibo.
  CONFIRMACAO_EXIGE_SENHA_PROPRIA: "confirmacaoExigeSenhaPropria",

  // 401 — resposta ÚNICA do login do portal. Um código só, para todos os casos
  // (código inexistente, vínculo inativo, cliente sem senha, senha errada,
  // cliente ou processo inativo). Distinguir aqui entregaria a enumeração de
  // códigos de acesso válidos a quem tem só o formato.
  CREDENCIAIS_INVALIDAS: "credenciaisInvalidas",

  // 401 — sessão de portal ausente, expirada ou com assinatura que não confere.
  SESSAO_INVALIDA: "sessaoPortalInvalida"
});

export const CODIGOS_ERRO_PORTAL = Object.freeze(Object.values(ERRO_PORTAL));

// ── A resposta única do 401 de login ───────────────────────────────────────
// Corpo e status idênticos em todos os casos. Fica como constante congelada e
// num ponto único para que seja impossível divergirem por engano: dois `throw`
// com a mesma intenção e uma vírgula de diferença já seriam oráculo suficiente
// para separar "código não existe" de "senha errada".
export const MENSAGEM_CREDENCIAIS_INVALIDAS =
  "Código de acesso ou senha inválidos.";

export default ERRO_PORTAL;
