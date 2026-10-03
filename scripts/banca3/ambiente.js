// scripts/banca3/ambiente.js
//
// ═══════════════════════════════════════════════════════════════════════════
// O QUE O SEED, O SMOKE E A CONFERÊNCIA DA 3ª BANCA TÊM EM COMUM (DEC-065)
//
// Três coisas, e as três existem para que o alvo seja escolhido DE PROPÓSITO:
//
//   1. qual banco — `LEX_BANCO` na linha de comando SOBRESCREVE o nome do banco
//      da `MONGO_URI` do `.env`, sem editar o `.env`. Sem a variável, vale o
//      nome que está na URI (no `.env` local de hoje, `lex_prod`);
//   2. a confirmação — `--banco <nome>` é OBRIGATÓRIO e é conferido contra o
//      nome REAL do banco depois de conectar. Duas entradas independentes
//      precisam concordar: quem esquecer `LEX_BANCO=lex_test` e digitar
//      `--banco lex_test` é recusado, porque a conexão caiu no banco do `.env`;
//   3. a API em processo — o seed e o smoke sobem o `app` do Express numa porta
//      efêmera da própria máquina e falam com ele por HTTP. Tudo passa por
//      rota → controller → validação → service, exatamente o caminho da tela.
//
// A URI NUNCA é impressa, nem mascarada: ela carrega usuário e senha do
// cluster. O que sai no terminal é o NOME do banco — a mesma regra de
// `scripts/lib/guardaDeBanco.js`.
// ═══════════════════════════════════════════════════════════════════════════

import "dotenv/config";
import mongoose from "mongoose";

export const lerArgumento = (nome, argv = process.argv) => {
  const i = argv.indexOf(nome);
  if (i === -1) return null;
  const valor = argv[i + 1];
  return valor && !valor.startsWith("--") ? valor : null;
};

export const temFlag = (nome, argv = process.argv) => argv.includes(nome);

export const abortar = (mensagem) => {
  console.error(`\nABORT: ${mensagem}\n`);
  process.exit(1);
};

// Conecta no banco escolhido e confere o nome REAL contra `--banco`.
// `autoIndex` fica ligado: com coleção nova (ou recém-limpa por deleteMany,
// que preserva índices) o Mongoose garante os índices do schema — e nunca
// derruba nenhum. `syncIndexes`, que derruba índice fora do schema, NÃO é
// chamado aqui.
export const conectar = async ({ exigirBanco = true } = {}) => {
  const bancoPedido = lerArgumento("--banco");
  if (exigirBanco && !bancoPedido) {
    abortar('informe o banco alvo: "--banco <nome>". Ele é conferido contra o banco conectado.');
  }
  if (!process.env.MONGO_URI) abortar("MONGO_URI ausente no ambiente (.env).");

  const sobrescrito = (process.env.LEX_BANCO ?? "").trim();
  const opcoes = sobrescrito ? { dbName: sobrescrito } : {};

  await mongoose.connect(process.env.MONGO_URI, opcoes);
  const real = mongoose.connection.db.databaseName;

  if (exigirBanco && real !== bancoPedido) {
    await mongoose.connection.close();
    abortar(
      `o banco conectado é "${real}" e o pedido em --banco é "${bancoPedido}". Nada foi alterado.\n` +
      `       Para escolher o banco sem editar o .env: LEX_BANCO=${bancoPedido} npm run ... -- --banco ${bancoPedido}`
    );
  }

  console.log(`Banco conectado: ${real}${sobrescrito ? "  (LEX_BANCO)" : "  (nome da MONGO_URI)"}`);
  return real;
};

// ── A API em processo ──────────────────────────────────────────────────────
// Importada DEPOIS de o dotenv carregar: `app.js` confere `JWT_PORTAL_SECRET`
// na carga e derruba o processo se faltar.
export const subirApi = async () => {
  const { default: app } = await import("../../src/app.js");
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = servidor.address();
  return {
    base: `http://127.0.0.1:${port}/api`,
    fechar: () => new Promise((resolve) => servidor.close(resolve))
  };
};

// ── Sessão HTTP com pote de cookies ────────────────────────────────────────
// O `fetch` nativo não guarda cookie, e a autenticação do LEX é cookie
// httpOnly (`lex-token` da advogada, `lex-portal-token` do cliente). Cada
// instância é um navegador.
export class Sessao {
  constructor(base, rotulo) {
    this.base = base;
    this.rotulo = rotulo;
    this.cookies = new Map();
  }

  async req(metodo, rota, corpo, { esperado, cabecalhos = {}, binario = false } = {}) {
    const headers = { ...cabecalhos };
    if (corpo !== undefined) headers["Content-Type"] = "application/json";
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;

    const resposta = await fetch(`${this.base}${rota}`, {
      method: metodo,
      headers,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });

    for (const bruto of resposta.headers.getSetCookie?.() ?? []) {
      const [par] = bruto.split(";");
      const igual = par.indexOf("=");
      const nome = par.slice(0, igual).trim();
      const valor = par.slice(igual + 1).trim();
      if (/max-age=0/i.test(bruto) || /expires=Thu, 01 Jan 1970/i.test(bruto) || valor === "") {
        this.cookies.delete(nome);
      } else {
        this.cookies.set(nome, valor);
      }
    }

    let dados;
    if (binario) {
      dados = Buffer.from(await resposta.arrayBuffer());
    } else {
      const texto = await resposta.text();
      try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    }

    const esperados = esperado === undefined ? null : [].concat(esperado);
    const ok = esperados ? esperados.includes(resposta.status) : resposta.status < 400;
    if (!ok) {
      const msg = binario ? "" : JSON.stringify(dados)?.slice(0, 600);
      throw new Error(`[${this.rotulo}] ${metodo} ${rota} → ${resposta.status} ${msg}`);
    }
    return { status: resposta.status, dados, headers: resposta.headers };
  }

  get(rota, op) { return this.req("GET", rota, undefined, op); }
  post(rota, corpo, op) { return this.req("POST", rota, corpo ?? {}, op); }
  patch(rota, corpo, op) { return this.req("PATCH", rota, corpo ?? {}, op); }
  del(rota, op) { return this.req("DELETE", rota, undefined, op); }
}

// As 16 coleções do schema atual — conferidas contra `mongoose.model(...)` e
// as opções `collection:` dos 16 models em `src/models/`. A ordem espelha a
// dependência (filho antes do pai), como em `resetDev.js`; com deleteMany
// independentes ela não muda o resultado, mas mantém a lista legível.
export const COLECOES = Object.freeze([
  "idempotency_keys",
  "confirmacoes_visualizacao",
  "events",
  "alocacoes",
  "estornos",
  "reparcelamentos",
  "payments",
  "installments",
  "fees",
  "documento_secao",
  "secoes",
  "documents",
  "processo_clientes",
  "processes",
  "clients",
  "users"
]);

export const contarColecoes = async () => {
  const db = mongoose.connection.db;
  const existentes = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const contagens = {};
  for (const nome of [...COLECOES].sort()) {
    contagens[nome] = existentes.has(nome) ? await db.collection(nome).countDocuments() : 0;
  }
  const extras = [...existentes].filter((n) => !COLECOES.includes(n) && !n.startsWith("system."));
  return { contagens, extras };
};
