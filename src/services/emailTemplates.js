// ═══════════════════════════════════════════════════════════════════════════
// TEXTO DOS E-MAILS (A-2, DEC-064)
//
// Cada e-mail sai em duas versões — texto e HTML —, porque leitor de e-mail que
// bloqueia HTML é comum e o link precisa estar legível nos dois.
//
// O nome da advogada entra no HTML e vem de um campo que ELA digitou: é
// escapado. Sem isso, um nome como `<img src=x onerror=...>` viraria marcação
// dentro do e-mail de recuperação.
// ═══════════════════════════════════════════════════════════════════════════

export const PRAZO_CONFIRMACAO_HORAS = 24;
export const PRAZO_RECUPERACAO_MINUTOS = 60;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escaparHtml = (valor) =>
  String(valor ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

const primeiroNome = (nomeCompleto) => String(nomeCompleto ?? "").trim().split(/\s+/)[0] || "";

const saudacaoTexto = (nome) => (primeiroNome(nome) ? `Olá, ${primeiroNome(nome)}!` : "Olá!");

const moldura = ({ titulo, paragrafos, textoDoBotao, link, rodape }) => {
  const corpo = paragrafos
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">${p}</p>`)
    .join("");

  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:520px;margin:0 auto;padding:24px;">` +
    `<h2 style="margin:0 0 18px;font-size:20px;">${escaparHtml(titulo)}</h2>` +
    corpo +
    `<p style="margin:22px 0;">` +
    `<a href="${escaparHtml(link)}" style="background:#b89d4b;color:#111;text-decoration:none;` +
    `padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block;">${escaparHtml(textoDoBotao)}</a>` +
    `</p>` +
    `<p style="margin:0 0 14px;font-size:13px;color:#555;">Se o botão não funcionar, copie e cole este endereço no navegador:<br>` +
    `<span style="word-break:break-all;">${escaparHtml(link)}</span></p>` +
    `<p style="margin:18px 0 0;font-size:13px;color:#555;">${rodape}</p>` +
    `</div>`
  );
};

export const montarEmailConfirmacao = ({ nomeCompleto, link }) => {
  const assunto = "Confirme seu e-mail — LEX";

  const texto =
    `${saudacaoTexto(nomeCompleto)}\n\n` +
    `Sua conta no LEX foi criada. Para confirmar que este e-mail é seu, abra o link abaixo:\n\n` +
    `${link}\n\n` +
    `O link vale por ${PRAZO_CONFIRMACAO_HORAS} horas e só pode ser usado uma vez.\n\n` +
    `Se você não criou uma conta no LEX, ignore esta mensagem.`;

  const html = moldura({
    titulo: "Confirme seu e-mail",
    paragrafos: [
      `${escaparHtml(saudacaoTexto(nomeCompleto))}`,
      `Sua conta no LEX foi criada. Para confirmar que este e-mail é seu, clique no botão abaixo.`,
      `O link vale por ${PRAZO_CONFIRMACAO_HORAS} horas e só pode ser usado uma vez.`
    ],
    textoDoBotao: "Confirmar e-mail",
    link,
    rodape: "Se você não criou uma conta no LEX, ignore esta mensagem."
  });

  return { assunto, texto, html };
};

export const montarEmailRecuperacao = ({ nomeCompleto, link }) => {
  const assunto = "Redefinição de senha — LEX";

  const texto =
    `${saudacaoTexto(nomeCompleto)}\n\n` +
    `Recebemos um pedido para redefinir a senha da sua conta no LEX. ` +
    `Para escolher uma nova senha, abra o link abaixo:\n\n` +
    `${link}\n\n` +
    `O link vale por ${PRAZO_RECUPERACAO_MINUTOS} minutos e só pode ser usado uma vez. ` +
    `Ao trocar a senha, todos os aparelhos conectados à sua conta serão desconectados.\n\n` +
    `Se você não pediu isto, ignore esta mensagem: sua senha atual continua valendo.`;

  const html = moldura({
    titulo: "Redefinição de senha",
    paragrafos: [
      `${escaparHtml(saudacaoTexto(nomeCompleto))}`,
      `Recebemos um pedido para redefinir a senha da sua conta no LEX. Para escolher uma nova senha, clique no botão abaixo.`,
      `O link vale por ${PRAZO_RECUPERACAO_MINUTOS} minutos e só pode ser usado uma vez. ` +
        `Ao trocar a senha, todos os aparelhos conectados à sua conta serão desconectados.`
    ],
    textoDoBotao: "Escolher nova senha",
    link,
    rodape: "Se você não pediu isto, ignore esta mensagem: sua senha atual continua valendo."
  });

  return { assunto, texto, html };
};

export default { montarEmailConfirmacao, montarEmailRecuperacao, escaparHtml };
