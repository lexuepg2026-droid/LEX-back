// ═══════════════════════════════════════════════════════════════════════════
// TETOS DO RATE LIMIT, POR AMBIENTE — fonte única (F-2b)
//
// ── O que já existia, e estava certo ─────────────────────────────────────
// O teto por ambiente NÃO nasceu nesta fase. `authRoutes.js` e `portalRoutes.js`
// já multiplicavam o limite por 20 fora de produção desde a auditoria, e o
// passo 85 do roteiro — validado em 17/08/2026 — confere justamente isso.
// **O passo 85 nunca foi "código a escrever": ele é pré-voo**, a conferência
// de que a demonstração não está rodando com `NODE_ENV=production`.
//
// ── O que esta fase mudou, e por quê ─────────────────────────────────────
//
// **1. Uma cópia só.** O bloco inteiro — multiplicador, `ehProducao`,
// `inteiroPositivo`, a janela — estava DUPLICADO nos dois arquivos de rota,
// linha por linha. Duas cópias da mesma decisão divergem: bastaria alguém
// ajustar o multiplicador de um lado para o portal e a área da advogada
// passarem a se comportar diferente sem ninguém notar. É o mesmo motivo pelo
// qual `api/baseURL.js` foi extraído no frontend.
//
// **2. `test` deixou de ser tratado como `development`.** Os dois recebiam o
// mesmo multiplicador 20×, o que dá um teto de **100 cadastros por janela de 15
// minutos** — e a suíte já faz mais de 60 cadastros numa execução que dura
// ~6 minutos, ou seja, DENTRO de uma única janela.
//
// A margem estava em torno de um terço, e ela encolhe a cada fase: a suíte
// passou de 486 para 523 testes entre a F-1c.2 e a F-2b. No dia em que
// estourar, a falha não vai dizer "rate limit" — vai aparecer como um cadastro
// recusado no meio de um teste que não tem nada a ver com autenticação, e o
// tempo perdido procurando a causa é o custo real.
//
// Um limite de requisições não é o que a suíte existe para exercitar. Quem
// quiser testá-lo faz isso explicitamente, com uma janela própria.
//
// ── Os defaults de PRODUÇÃO não mudaram ──────────────────────────────────
// 5 cadastros, 10 logins, 5 trocas de senha e 5 acessos ao portal por 15
// minutos. São a proteção real contra força bruta e **não devem ser baixados**.
// O portal é mais apertado que o login da advogada de propósito: o código de
// acesso circula por WhatsApp e por papel, e a senha é o único fator.
// ═══════════════════════════════════════════════════════════════════════════

const inteiroPositivo = (valor, padrao) => {
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) && n > 0 ? n : padrao;
};

// Lido a cada chamada, e não capturado numa constante de módulo: a suíte define
// `NODE_ENV` em `tests/helpers/env.js`, e a ordem de importação não é garantida.
export const ambiente = () => process.env.NODE_ENV ?? "development";

export const ehProducao = () => ambiente() === "production";

// ── O multiplicador, por ambiente ────────────────────────────────────────
//
//   production    →   1×  o limite de verdade
//   development   →  20×  testar o cadastro seis vezes seguidas é rotina, e
//                         travar por 15 minutos no meio de uma sessão de
//                         trabalho custa mais do que protege numa base local
//   test          → 500×  a suíte não pode esbarrar num limite que ela não
//                         está testando (ver a nota acima)
//
// 500 e não `Infinity`: um número mantém o limitador montado e exercitando o
// mesmo caminho de código que roda em produção. Desligá-lo faria a suíte deixar
// de cobrir o middleware inteiro, e um erro de configuração nele só apareceria
// em produção.
export const MULTIPLICADOR = Object.freeze({
  production: 1,
  development: 20,
  test: 500
});

// `RATE_LIMIT_MULTIPLICADOR` sobrepõe o fator do ambiente.
//
// Existe para quem precisa de um teto EXERCITÁVEL sem fingir estar em produção:
// a sonda de `tests/portal/fixtures/rateLimitProbe.mjs` estoura o balde do
// portal de propósito, para provar que ele é independente dos baldes da
// advogada. Com o fator de teste (500×) ela precisaria de 500 requisições para
// medir o que mede em 40.
//
// Sem esta saída, a alternativa seria a sonda declarar `NODE_ENV=production` —
// e aí ela passaria a exercitar TODO o resto do sistema no modo de produção,
// inclusive o `errorHandler`, que muda de comportamento. Um teste de rate limit
// não deve arrastar o ambiente inteiro junto.
export const multiplicadorDoAmbiente = () => {
  const explicito = Number.parseInt(process.env.RATE_LIMIT_MULTIPLICADOR, 10);
  if (Number.isInteger(explicito) && explicito > 0) return explicito;
  return MULTIPLICADOR[ambiente()] ?? MULTIPLICADOR.development;
};

export const JANELA_MINUTOS = () =>
  inteiroPositivo(process.env.RATE_LIMIT_JANELA_MINUTOS, 15);

export const janelaMs = () => JANELA_MINUTOS() * 60 * 1000;

// Teto efetivo de um balde: o default de produção (ou o que a variável de
// ambiente disser), multiplicado pelo fator do ambiente.
export const teto = (variavel, padraoDeProducao) =>
  inteiroPositivo(process.env[variavel], padraoDeProducao) * multiplicadorDoAmbiente();

export default { ambiente, ehProducao, MULTIPLICADOR, multiplicadorDoAmbiente, janelaMs, teto };
