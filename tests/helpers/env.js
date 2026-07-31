// ═══════════════════════════════════════════════════════════════════════════
// AMBIENTE DA SUÍTE — carregado ANTES de qualquer outra coisa.
//
// Este módulo faz três coisas, nesta ordem, e a ordem importa:
//   1. carrega o `.env.test`;
//   2. GUARDA contra rodar a suíte no banco de demonstração;
//   3. afrouxa o rate limit, porque os limitadores são construídos na carga
//      de `authRoutes.js` e não dá para mudá-los depois.
//
// Todo arquivo de teste importa `tests/helpers/server.js`, que importa este
// aqui e só então carrega `src/app.js` por import dinâmico. Import estático
// não serviria: a ordem de avaliação teria de ser adivinhada.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");

// ── 1. `.env.test` ─────────────────────────────────────────────────────────
// Parser próprio em vez de `dotenv.config({ path })`: o `dotenv` já foi
// carregado por outro caminho em alguns fluxos e não sobrescreve o que já
// existe, o que faria a suíte cair no `MONGO_URI` de desenvolvimento sem
// avisar. Aqui a sobrescrita é explícita.
const carregarEnvTest = () => {
  let bruto;
  try {
    bruto = readFileSync(resolve(RAIZ, ".env.test"), "utf8");
  } catch {
    abortar(
      "`.env.test` não encontrado na raiz do backend.\n" +
      "Copie `.env.test.example` para `.env.test` e aponte o `MONGO_URI_TEST`\n" +
      "para um banco DE TESTE (sugestão de nome: `lex_test`)."
    );
  }

  for (const linha of bruto.split("\n")) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const igual = limpa.indexOf("=");
    if (igual === -1) continue;
    const chave = limpa.slice(0, igual).trim();
    let valor = limpa.slice(igual + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    process.env[chave] = valor;
  }
};

export const abortar = (mensagem) => {
  process.stderr.write(
    "\n" +
    "══════════════════════════════════════════════════════════════════\n" +
    "  SUÍTE ABORTADA\n" +
    "══════════════════════════════════════════════════════════════════\n" +
    mensagem +
    "\n══════════════════════════════════════════════════════════════════\n\n"
  );
  process.exit(1);
};

// Nome do banco numa URI do Mongo: o segmento de caminho depois do host e
// antes da query. Vale para `mongodb://` e para `mongodb+srv://`.
export const nomeDoBanco = (uri) => {
  if (typeof uri !== "string" || uri.length === 0) return null;
  const semEsquema = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const semCredencial = semEsquema.slice(semEsquema.indexOf("@") + 1);
  const barra = semCredencial.indexOf("/");
  if (barra === -1) return null;
  const depoisDaBarra = semCredencial.slice(barra + 1);
  const nome = depoisDaBarra.split("?")[0].trim();
  return nome.length > 0 ? nome : null;
};

// ── 2. A guarda ────────────────────────────────────────────────────────────
// `lex` é o banco da demonstração da banca. Um `deleteMany` acidental contra
// ele apaga a base que vai ser apresentada. A suíte limpa coleções em todo
// `before`/`after`, então esta guarda é a diferença entre teste e acidente.
export const BANCO_PROIBIDO = "lex";

export const assertBancoDeTeste = (uri) => {
  const nome = nomeDoBanco(uri);

  if (!nome) {
    abortar(
      "O `MONGO_URI_TEST` não nomeia um banco.\n" +
      "Esperado algo como `mongodb+srv://.../lex_test?...` — sem o nome do\n" +
      "banco no caminho, o driver usaria o default e a suíte não teria como\n" +
      "saber onde está escrevendo."
    );
  }

  if (nome === BANCO_PROIBIDO) {
    abortar(
      `O \`MONGO_URI_TEST\` aponta para o banco \`${nome}\`, que é a BASE DE\n` +
      "DEMONSTRAÇÃO da banca. A suíte apaga coleções em todo `before` e\n" +
      "`after`: rodar aqui destruiria os dados do seed.\n\n" +
      "Aponte para um banco de teste (sugestão de nome: `lex_test`)."
    );
  }

  // Cinto e suspensório. Um banco chamado `producao` ou `lex_real` passaria na
  // checagem de cima e seria apagado do mesmo jeito. Exigir `test` no nome faz
  // o engano ter de ser deliberado.
  if (!/test/i.test(nome)) {
    abortar(
      `O banco \`${nome}\` não tem "test" no nome.\n` +
      "A suíte só roda contra banco descartável. Renomeie o banco de teste\n" +
      "para conter `test` (sugestão: `lex_test`) — a checagem existe para que\n" +
      "apontar a suíte para um banco com dado real precise ser deliberado."
    );
  }

  return nome;
};

// ── 3. Rate limit ──────────────────────────────────────────────────────────
// `authRoutes.js` constrói os três limitadores na CARGA DO MÓDULO, lendo
// `process.env` uma vez. Definir isto depois de `src/app.js` ser importado não
// teria efeito nenhum.
//
// Fora de produção o teto ainda é multiplicado por 20 lá dentro; o valor aqui
// já é folgado o bastante para a suíte inteira, que faz dezenas de logins e
// cadastros contra o mesmo IP (127.0.0.1 partilha o balde).
const afrouxarRateLimit = () => {
  process.env.RATE_LIMIT_CADASTRO = "100000";
  process.env.RATE_LIMIT_LOGIN = "100000";
  process.env.RATE_LIMIT_SENHA = "100000";
  // O balde do portal é o quarto, criado na Fase 3.1, e precisa do mesmo
  // afrouxamento: a suíte do portal faz dezenas de logins contra 127.0.0.1,
  // que partilha o balde. O teste que verifica o limite de VERDADE sobe um app
  // próprio com o teto baixo, em vez de depender deste valor.
  process.env.RATE_LIMIT_PORTAL_LOGIN = "100000";
  process.env.RATE_LIMIT_JANELA_MINUTOS = "1";
};

// ── Execução ───────────────────────────────────────────────────────────────
carregarEnvTest();

// `NODE_ENV=test` mantém o `errorHandler` no modo verboso (o console.error do
// não-produção), que é o que se quer quando um teste falha.
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

const URI_TESTE = process.env.MONGO_URI_TEST;
export const NOME_DO_BANCO = assertBancoDeTeste(URI_TESTE);

// A partir daqui `MONGO_URI` é o de teste: `src/config/db.js` e os models leem
// essa variável, e não devem enxergar o de desenvolvimento.
process.env.MONGO_URI = URI_TESTE;

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-de-teste-nao-usar-em-producao";

// Segredo do portal, obrigatoriamente distinto do da advogada:
// `src/app.js` chama `assertSegredoDoPortal()` na carga e derruba o processo
// se faltar ou se for igual. O fallback aqui carrega o sufixo `-portal` para
// que os dois nunca colidam por acidente quando só um dos dois é definido no
// `.env.test`.
process.env.JWT_PORTAL_SECRET =
  process.env.JWT_PORTAL_SECRET || "segredo-de-teste-do-portal-nao-usar-em-producao";

if (process.env.JWT_PORTAL_SECRET === process.env.JWT_SECRET) {
  abortar(
    "`JWT_PORTAL_SECRET` e `JWT_SECRET` estão iguais no `.env.test`.\n" +
    "Os testes de isolamento do portal dependem de que token de um domínio\n" +
    "NÃO valha no outro — com segredos iguais eles passariam por engano."
  );
}

afrouxarRateLimit();

export const MONGO_URI_TESTE = URI_TESTE;
