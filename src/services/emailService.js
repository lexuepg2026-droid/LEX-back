// ═══════════════════════════════════════════════════════════════════════════
// ENVIO DE E-MAIL (A-2, DEC-064)
//
// Provedor por HTTP, chamado com o `fetch` do Node: **nenhuma dependência
// nova**. É a escolha do Daniel — a alternativa (SMTP com biblioteca) exigia
// dependência e o plano gratuito do Render costuma bloquear a saída SMTP.
//
// ── A costura, e por que ela tem dois adaptadores ─────────────────────────
// O provedor ainda não foi escolhido, e os dois candidatos diferem no que
// exigem para entregar a um endereço de TERCEIRO (o que a banca fará):
//
//   `brevo`   remetente único verificado (pode ser um Gmail); plano gratuito.
//   `resend`  domínio próprio verificado; sem ele só entrega para o dono da
//             conta, e a advogada da banca não receberia nada.
//
// Trocar de provedor é mudar `EMAIL_PROVIDER` no painel — nenhum código muda.
//
// ── O que NUNCA entra em log ──────────────────────────────────────────────
// O corpo da mensagem carrega o token do link. Um log de "e-mail enviado" que
// imprimisse o texto seria um log de credenciais. Só o status do provedor sai,
// e a resposta dele é cortada: ela vem do provedor e nunca contém o nosso token.
//
// ── Sem provedor configurado ──────────────────────────────────────────────
//   fora de produção → imprime o LINK no console (é assim que se desenvolve
//                      sem conta de provedor);
//   em produção      → lança. O chamador decide o que fazer com a falha; o que
//                      ele NÃO faz é fingir que enviou.
// ═══════════════════════════════════════════════════════════════════════════

const TEMPO_LIMITE_MS = 8000;
const LIMITE_DO_TRECHO_DE_ERRO = 200;

let transporteDeTeste = null;

// Só a suíte usa: troca o envio real por uma função que registra a mensagem.
// `null` restaura o comportamento normal.
export const definirTransporteDeEmail = (funcao) => {
  transporteDeTeste = typeof funcao === "function" ? funcao : null;
};

export const configuracaoDeEmail = () => ({
  provedor: String(process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase(),
  chave: process.env.EMAIL_API_KEY ?? "",
  remetente: String(process.env.EMAIL_FROM ?? "").trim(),
  remetenteNome: String(process.env.EMAIL_FROM_NAME ?? "").trim() || "LEX"
});

// Base dos links que vão no e-mail. **Vem de variável de ambiente, e nunca do
// cabeçalho `Host` da requisição**: com `Host` o atacante pede a recuperação de
// uma conta alheia com `Host: site-dele.com`, e o link com o token legítimo
// chegaria à vítima apontando para o site do atacante.
export const urlBaseDoApp = () => {
  const configurada = String(process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (configurada) return configurada;

  // Fora de produção há um padrão (o dev server do Vite); em produção, a falta
  // de `APP_URL` faria o link apontar para `localhost` e ninguém perceberia.
  if (process.env.NODE_ENV === "production") return "";
  return "http://localhost:5173";
};

// ── Adaptadores: a requisição que cada provedor espera ─────────────────────
// Funções puras, exportadas para serem conferidas sem rede.
export const montarRequisicao = (provedor, mensagem, configuracao) => {
  const { para, assunto, texto, html } = mensagem;
  const { chave, remetente, remetenteNome } = configuracao;

  if (provedor === "brevo") {
    return {
      url: "https://api.brevo.com/v3/smtp/email",
      opcoes: {
        method: "POST",
        headers: {
          "api-key": chave,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          sender: { name: remetenteNome, email: remetente },
          to: [{ email: para }],
          subject: assunto,
          htmlContent: html,
          textContent: texto
        })
      }
    };
  }

  if (provedor === "resend") {
    return {
      url: "https://api.resend.com/emails",
      opcoes: {
        method: "POST",
        headers: {
          authorization: `Bearer ${chave}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from: `${remetenteNome} <${remetente}>`,
          to: [para],
          subject: assunto,
          html,
          text: texto
        })
      }
    };
  }

  return null;
};

const erroDeEmail = (mensagem) => {
  const erro = new Error(mensagem);
  erro.statusCode = 502;
  return erro;
};

const enviarPorProvedor = async (mensagem, configuracao) => {
  const requisicao = montarRequisicao(configuracao.provedor, mensagem, configuracao);
  if (!requisicao) {
    throw erroDeEmail(`Provedor de e-mail desconhecido: "${configuracao.provedor}"`);
  }

  let resposta;
  try {
    resposta = await fetch(requisicao.url, {
      ...requisicao.opcoes,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS)
    });
  } catch (error) {
    // Rede fora do ar ou tempo esgotado. A mensagem do `fetch` não carrega o
    // corpo da requisição, então é seguro repassá-la.
    throw erroDeEmail(`Falha ao chamar o provedor de e-mail (${error?.name ?? "erro"})`);
  }

  if (!resposta.ok) {
    let trecho = "";
    try {
      trecho = (await resposta.text()).slice(0, LIMITE_DO_TRECHO_DE_ERRO);
    } catch {
      // sem corpo legível: fica só o status
    }
    throw erroDeEmail(`Provedor de e-mail respondeu ${resposta.status} ${trecho}`.trim());
  }
};

// `mensagem`: { para, assunto, texto, html }. Resolve quando o provedor aceitou
// a mensagem; lança quando não aceitou. **Aceitar não é entregar** — quem
// garante a entrega é o provedor, e a advogada confirma clicando no link.
export const enviarEmail = async (mensagem) => {
  if (transporteDeTeste) {
    await transporteDeTeste(mensagem);
    return;
  }

  const configuracao = configuracaoDeEmail();

  if (!configuracao.provedor) {
    if (process.env.NODE_ENV === "production") {
      throw erroDeEmail("Envio de e-mail não configurado (EMAIL_PROVIDER ausente)");
    }
    // Desenvolvimento: sem provedor, o link sai no console para ser clicado.
    console.log(`[lex:email] (sem provedor) para=${mensagem.para} assunto="${mensagem.assunto}"\n${mensagem.texto}`);
    return;
  }

  if (!configuracao.chave || !configuracao.remetente) {
    throw erroDeEmail("Envio de e-mail mal configurado (EMAIL_API_KEY ou EMAIL_FROM ausente)");
  }

  await enviarPorProvedor(mensagem, configuracao);
};

// Falha de envio numa operação que NÃO espera o resultado (cadastro,
// recuperação): registra e segue. Sem `mensagem.texto` no log, pelo motivo
// escrito no alto do arquivo.
export const registrarFalhaDeEmail = (contexto, error) => {
  console.error(`[lex:email] falha em ${contexto}: ${error?.message ?? error}`);
};

export default {
  enviarEmail,
  definirTransporteDeEmail,
  configuracaoDeEmail,
  urlBaseDoApp,
  montarRequisicao,
  registrarFalhaDeEmail
};
