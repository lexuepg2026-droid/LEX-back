// scripts/banca3/conferirBanca3.js
//
// ═══════════════════════════════════════════════════════════════════════════
// CONFERÊNCIA DA 3ª BANCA (DEC-065) — SÓ LEITURA no banco
//
//   LEX_BANCO=lex_prod npm run conferir:banca3 -- --banco lex_prod
//   LEX_BANCO=lex_prod npm run conferir:banca3 -- --banco lex_prod \
//       --url https://lex-uepg-app.onrender.com [--portal]
//
// No banco: só `find`/`countDocuments`. Imprime, por coleção, a contagem e uma
// ASSINATURA do conteúdo — um hash dos dados de negócio com `_id`, carimbos de
// criação, hashes de senha e códigos sorteados retirados. Dois bancos semeados
// pelo mesmo cenário no mesmo dia têm as mesmas assinaturas; é assim que se
// prova "exatamente o mesmo cenário" sem comparar documento por documento.
//
// `--url`: faz UM login da advogada na API publicada e lê o painel.
// `--portal`: faz UM login no portal (o limite é 5 por IP a cada 15 minutos —
// por isso a flag é separada e o login é um só).
//
// Os logins não criam registro: o da advogada atualiza `ultimoLogin`, e a
// leitura do processo no portal atualiza o carimbo de acesso do vínculo.
// ═══════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import mongoose from "mongoose";

import { conectar, contarColecoes, lerArgumento, temFlag, COLECOES } from "./ambiente.js";
import { ADVOGADA_EMAIL, ADVOGADA_SENHA, PORTAL_CODIGO, PORTAL_EMAIL, PORTAL_SENHA } from "./dados.js";

// Campos que mudam a cada semeadura sem mudar o cenário.
const VOLATEIS = new Set([
  "_id", "__v", "createdAt", "updatedAt", "ultimoLogin", "senhaHash", "senhaPortalHash",
  "confirmacaoEmail", "recuperacaoSenha", "primeiroAcessoPortal", "ultimoAcessoPortal",
  "ultimaConfirmacaoEm", "senhaPortalDefinidaEm", "concluidoEm", "dataHora", "desalocadoEm",
  "dataGeracao", "dataUpload"
]);

const agora = Date.now();
const TRES_DIAS = 3 * 24 * 60 * 60 * 1000;

const normalizar = (valor, chave) => {
  if (valor instanceof mongoose.Types.ObjectId || valor?._bsontype === "ObjectId") return "id";
  if (valor instanceof Date) {
    const meiaNoite = valor.getUTCHours() === 0 && valor.getUTCMinutes() === 0 && valor.getUTCSeconds() === 0;
    // Carimbo de "agora" (histórico de fase, de status, de ativação): volátil.
    if (!meiaNoite && Math.abs(valor.getTime() - agora) < TRES_DIAS) return "agora";
    return valor.toISOString();
  }
  if (Array.isArray(valor)) return valor.map((v) => normalizar(v));
  if (valor && typeof valor === "object") {
    const saida = {};
    for (const k of Object.keys(valor).sort()) {
      if (VOLATEIS.has(k)) continue;
      // Os códigos sorteados mudam a cada semeadura; o fixo do portal não.
      if ((k === "codigoAcesso" || k === "codigoAcessoPessoal") && valor[k] !== PORTAL_CODIGO) continue;
      saida[k] = normalizar(valor[k], k);
    }
    return saida;
  }
  return valor;
};

const assinatura = async (nome) => {
  const docs = await mongoose.connection.db.collection(nome).find({}).toArray();
  const linhas = docs.map((d) => JSON.stringify(normalizar(d))).sort();
  return crypto.createHash("sha256").update(linhas.join("\n")).digest("hex").slice(0, 12);
};

const chamar = async (base, metodo, rota, corpo, cookie) => {
  const r = await fetch(`${base}/api${rota}`, {
    method: metodo,
    headers: { ...(corpo ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    // Primeira requisição pode acordar o serviço gratuito do Render (~1 min).
    signal: AbortSignal.timeout(120000)
  });
  const set = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  let dados = null;
  try { dados = await r.json(); } catch { /* corpo vazio */ }
  return { status: r.status, dados, cookie: set || cookie };
};

const main = async () => {
  const banco = await conectar();

  const { contagens, extras } = await contarColecoes();
  console.log(`\nColeção                      Qtde  Assinatura`);
  for (const nome of [...COLECOES].sort()) {
    console.log(`  ${nome.padEnd(26)} ${String(contagens[nome]).padStart(5)}  ${await assinatura(nome)}`);
  }
  if (extras.length) console.log(`  (fora do schema: ${extras.join(", ")})`);
  await mongoose.connection.close();

  const url = lerArgumento("--url");
  if (url) {
    const base = url.replace(/\/+$/, "");
    console.log(`\nAPI publicada: ${base}  (banco conferido acima: ${banco})`);
    const t0 = Date.now();
    const login = await chamar(base, "POST", "/auth/login", { email: ADVOGADA_EMAIL, senha: ADVOGADA_SENHA });
    console.log(`  login da advogada: ${login.status} (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (login.status === 200) {
      const me = await chamar(base, "GET", "/auth/me", null, login.cookie);
      const painel = await chamar(base, "GET", "/dashboard", null, login.cookie);
      console.log(`  conta: ${me.dados?.usuario?.nomeCompleto} — e-mail confirmado: ${me.dados?.usuario?.emailConfirmadoEm ? "sim" : "não"}`);
      console.log(`  painel: ${JSON.stringify(painel.dados)}`);
      await chamar(base, "POST", "/auth/logout", null, login.cookie);
    }

    if (temFlag("--portal")) {
      // Fase 2.5: o código é o PESSOAL da Mariana. Num banco semeado pela
      // banca3 é o `PORTAL_CODIGO`; num banco MIGRADO (o `lex_prod` de antes
      // da 2.5) é o que a migração sorteou. Por isso ele é LIDO pela API da
      // advogada, e não suposto — e não é impresso, porque é metade da
      // credencial.
      const adv = await chamar(base, "POST", "/auth/login", { email: ADVOGADA_EMAIL, senha: ADVOGADA_SENHA });
      const busca = await chamar(base, "GET", `/clients?busca=${encodeURIComponent("Mariana")}&limit=5`, null, adv.cookie);
      const mariana = (busca.dados?.data ?? []).find((c) => c.email === PORTAL_EMAIL);
      const acesso = mariana
        ? await chamar(base, "GET", `/clients/${mariana._id}/acesso-portal`, null, adv.cookie)
        : { dados: null };
      await chamar(base, "POST", "/auth/logout", null, adv.cookie);
      const codigo = acesso.dados?.codigoAcessoPessoal ?? null;
      console.log(`  código pessoal da Mariana: ${codigo ? (codigo === PORTAL_CODIGO ? "o do README" : "sorteado pela migração (ver a tela da advogada)") : "AUSENTE"}` +
        ` — ${acesso.dados?.processosLiberados ?? "?"} de ${acesso.dados?.processosAtivos ?? "?"} processos liberados`);

      if (codigo) {
        const p = await chamar(base, "POST", "/portal/login", { codigoAcesso: codigo, senha: PORTAL_SENHA });
        console.log(`  login no portal (1 tentativa): ${p.status}`);
        if (p.status === 200) {
          const lista = await chamar(base, "GET", "/portal/processos", null, p.cookie);
          for (const item of lista.dados?.data ?? []) {
            const docs = await chamar(base, "GET", `/portal/processos/${item.id}/documentos`, null, p.cookie);
            console.log(`  portal: ${item.numeroProcesso} — fase ${item.fase}, trânsito ${item.transitoEmJulgadoEm?.slice(0, 10)}, ` +
              `${docs.dados?.total} documentos: ${(docs.dados?.data ?? []).map((d) => d.nome).join(" + ")}`);
          }
          await chamar(base, "POST", "/portal/logout", null, p.cookie);
        }
      }
    }
  }
};

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(`\nERRO na conferência: ${e.message}`);
    try { await mongoose.connection.close(); } catch { /* caminho de erro */ }
    process.exit(1);
  });
