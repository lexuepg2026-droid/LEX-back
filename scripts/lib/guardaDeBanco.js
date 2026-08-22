// ═══════════════════════════════════════════════════════════════════════════
// GUARDA DOS COMANDOS DESTRUTIVOS (F-2b)
//
// ── O defeito ────────────────────────────────────────────────────────────
// `npm run seed:fresh` derruba treze coleções e `migrarTotalParcelas.js`
// reescreve parcelas e troca um índice único. Os dois rodam contra o banco de
// DESENVOLVIMENTO, que neste projeto é **Atlas remoto e compartilhado** — não
// um Mongo local descartável.
//
// Só o banco de TESTE tinha guarda (`tests/helpers/env.js` recusa subir se a
// URI não apontar para algo com "test" no nome). O de desenvolvimento não tinha
// nenhuma, e **já aconteceu de um `seed:fresh` apagar dados no meio de uma
// validação**.
//
// ── Por que aviso não basta ──────────────────────────────────────────────
// **Aviso que não interrompe é aviso que ninguém lê.** Os scripts já imprimiam
// o banco em que estavam mexendo, e isso não impediu o acidente: a saída rola,
// o comando já está rodando, e quando a linha aparece o dano está feito.
//
// A guarda INTERROMPE e exige uma resposta.
//
// ── Por que digitar o NOME DO BANCO, e não "s/n" ────────────────────────
// "y" é memória muscular: quem roda `seed:fresh` seis vezes num dia responde
// "y" sem ler. Digitar `lex` obriga a olhar QUAL banco está no alvo — e é
// exatamente esse o erro que a guarda existe para pegar: rodar contra `lex`
// achando que era o local.
//
// ── O que NUNCA aparece na saída ─────────────────────────────────────────
// **A URI, nem mascarada.** Ela carrega usuário e senha do cluster. O que se
// imprime é o NOME DO BANCO, que é o que a pessoa precisa para decidir. A
// classificação local/remoto é devolvida como booleano — o host nunca é
// impresso, pelo mesmo motivo.
// ═══════════════════════════════════════════════════════════════════════════

import { createInterface } from "node:readline/promises";

// Hosts que caracterizam um banco descartável na própria máquina.
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"]);

// Extrai host e banco SEM devolver credencial. `URL` resolve os casos comuns;
// o fallback existe para a forma com vários hosts
// (`mongodb://a:1,b:2/banco`), que `URL` recusa.
const partesDaUri = (uri) => {
  if (typeof uri !== "string" || uri.length === 0) return { hosts: [], banco: null };

  try {
    const u = new URL(uri);
    return {
      hosts: [u.hostname.toLowerCase()],
      banco: decodeURIComponent(u.pathname.replace(/^\//, "")) || null
    };
  } catch {
    // `esquema://[credencial@]hosts/banco[?query]`
    const m = /^[a-z+]+:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i.exec(uri);
    if (!m) return { hosts: [], banco: null };
    const hosts = m[1]
      .split(",")
      .map((h) => h.replace(/:\d+$/, "").trim().toLowerCase())
      .filter(Boolean);
    return { hosts, banco: m[2] ? decodeURIComponent(m[2]) : null };
  }
};

export const nomeDoBanco = (uri) => partesDaUri(uri).banco;

// Local só quando TODOS os hosts são locais. Um conjunto misto é remoto: basta
// um nó fora da máquina para o dano sair dela.
export const ehBancoLocal = (uri) => {
  const { hosts } = partesDaUri(uri);
  if (hosts.length === 0) return false;
  return hosts.every((h) => HOSTS_LOCAIS.has(h));
};

// Como pular a pergunta em automação. O padrão é PERGUNTAR — a variável existe
// para CI e scripts encadeados, e precisa ser dita de propósito.
export const VARIAVEL_PULAR = "LEX_CONFIRMA_BANCO";
const FLAGS_PULAR = ["--sim", "--yes", "-y"];

export const confirmacaoDispensada = (argv = process.argv) =>
  process.env[VARIAVEL_PULAR] === "sim" || argv.some((a) => FLAGS_PULAR.includes(a));

/**
 * Interrompe até a pessoa confirmar, quando o alvo NÃO é local.
 *
 * Banco local → segue direto, sem perguntar nada: é o caso descartável, e
 * perguntar toda vez treinaria a pessoa a responder no automático.
 *
 * Não devolve nada; aborta o processo se a confirmação não vier.
 */
export const exigirConfirmacaoDeBanco = async ({
  uri,
  acao,
  argv = process.argv,
  entrada = process.stdin,
  saida = process.stdout
} = {}) => {
  const banco = nomeDoBanco(uri);

  if (!banco) {
    console.error("ABORT: não foi possível identificar o banco na MONGO_URI.");
    process.exit(1);
  }

  if (ehBancoLocal(uri)) return { confirmado: true, banco, local: true, perguntou: false };

  if (confirmacaoDispensada(argv)) {
    console.log(`[${VARIAVEL_PULAR}] confirmação dispensada — alvo: ${banco}`);
    return { confirmado: true, banco, local: false, perguntou: false };
  }

  // Sem terminal interativo não há como perguntar. RECUSAR, e não seguir: um
  // script encadeado que caísse aqui rodaria a operação destrutiva sem que
  // ninguém tivesse visto a pergunta. Quem quer automação diz isso de propósito.
  if (!entrada.isTTY) {
    console.error(
      `\nABORT: ${acao} contra o banco REMOTO "${banco}" precisa de confirmação, ` +
      `e não há terminal interativo.\n` +
      `Para rodar assim, declare de propósito: ${VARIAVEL_PULAR}=sim <comando>\n`
    );
    process.exit(1);
  }

  saida.write(
    `\n${"═".repeat(70)}\n` +
    `  ATENÇÃO — ${acao}\n` +
    `${"═".repeat(70)}\n` +
    `  Banco alvo: ${banco}\n` +
    `  Este banco NÃO é local. É remoto e pode ser compartilhado.\n` +
    `  A operação é DESTRUTIVA e não tem desfazer.\n\n` +
    `  Para continuar, digite o nome do banco exatamente como acima.\n` +
    `  Qualquer outra coisa cancela.\n${"═".repeat(70)}\n`
  );

  const rl = createInterface({ input: entrada, output: saida });
  let resposta;
  try {
    resposta = (await rl.question(`  banco> `)).trim();
  } finally {
    rl.close();
  }

  if (resposta !== banco) {
    console.error(`\nCANCELADO: a resposta não confere com "${banco}". Nada foi alterado.\n`);
    process.exit(1);
  }

  saida.write(`\n  confirmado: ${banco}\n\n`);
  return { confirmado: true, banco, local: false, perguntou: true };
};

export default { ehBancoLocal, nomeDoBanco, exigirConfirmacaoDeBanco, confirmacaoDispensada, VARIAVEL_PULAR };
