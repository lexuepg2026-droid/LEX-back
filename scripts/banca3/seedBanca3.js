// scripts/banca3/seedBanca3.js
//
// ═══════════════════════════════════════════════════════════════════════════
// SEED DA 3ª BANCA (DEC-065)
//
//   LEX_BANCO=lex_test npm run seed:banca3 -- --banco lex_test --confirmar-reset
//
// 1. Confere o alvo: `--confirmar-reset` é obrigatório, e o nome REAL do banco
//    conectado precisa ser igual a `--banco` (ver `ambiente.js`).
// 2. Limpa as 16 coleções com `deleteMany`, uma por uma. NÃO usa
//    `dropDatabase` nem `dropCollection`, e não toca em índice: `deleteMany`
//    apaga documentos e deixa a coleção e os índices de pé.
// 3. Recria o cenário inteiro PELA API, com o `app` do Express rodando neste
//    mesmo processo: cada registro atravessa rota → controller → validação →
//    service, o mesmo caminho do clique na tela. Nada de `Model.create`.
//
// ── As DUAS escritas diretas, e por que existem ─────────────────────────
//   • o código de acesso PESSOAL da Mariana (Fase 2.5, DEC-089) é fixado em
//     `PORTAL_CODIGO`. Ele nasce sorteado, e a credencial precisa ser fixa
//     para ir ao README. Nenhuma rota escreve esse campo — é a mesma situação
//     do `historicoAtivacao`;
//   • o `createdAt` dos honorários é retrodatado para o mês do contrato, para
//     o gráfico "Honorários por mês" mostrar seis meses e não uma barra só. O
//     seed antigo fazia o mesmo, pelo mesmo motivo.
//
// IDEMPOTENTE: rodar duas vezes deixa o mesmo cenário (mesmas contagens e os
// mesmos dados; mudam só `_id`, carimbos de criação e os códigos de acesso
// sorteados dos demais vínculos).
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

import {
  abortar, conectar, subirApi, Sessao, COLECOES, contarColecoes, temFlag, lerArgumento
} from "./ambiente.js";
import {
  ANCORA_PADRAO, ADVOGADA, PORTAL_CODIGO, PORTAL_SENHA, PORTAL_SENHA_PROVISORIA,
  ADVOGADA_EMAIL, ADVOGADA_SENHA, PORTAL_EMAIL,
  CLIENTES, PROCESSOS, HONORARIOS, EVENTOS, SECOES, MODELOS, DOCUMENTOS, CONTRATOS_VISIVEIS
} from "./dados.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// ── Datas relativas à âncora ───────────────────────────────────────────────
const ANCORA = lerArgumento("--hoje") ?? ANCORA_PADRAO;
if (!/^\d{4}-\d{2}-\d{2}$/.test(ANCORA)) abortar(`--hoje inválido: "${ANCORA}" (use AAAA-MM-DD).`);
const [AA, AM, AD] = ANCORA.split("-").map(Number);
const iso = (dt) => dt.toISOString().slice(0, 10);
const emDias = (n) => iso(new Date(Date.UTC(AA, AM - 1, AD + n)));
// O dia é limitado ao fim do mês: { m: -1, d: 30 } numa âncora de março
// seria "30 de fevereiro", que o `Date.UTC` empurra para março — uma parcela
// do mês anterior nasceria no futuro. Fase 3.2: { dias } conta da âncora.
const emMes = ({ m, d, dias }) => {
  if (dias !== undefined) return emDias(dias);
  const ultimoDia = new Date(Date.UTC(AA, AM + m, 0)).getUTCDate();
  return iso(new Date(Date.UTC(AA, AM - 1 + m, Math.min(d, ultimoDia))));
};

// ── Número CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO, dígito módulo 97 ───────────────
const cnjValido = (n) => {
  const m = /^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/.exec(n);
  if (!m) return false;
  const s = m[1] + m[3] + m[4] + m[5] + m[6] + m[2];
  let r = 0;
  for (const c of s) r = (r * 10 + Number(c)) % 97;
  return r === 1;
};

const log = (...a) => console.log(...a);

// ── Pré-voo das datas ──────────────────────────────────────────────────────
// O status "vencido" de parcela é gravado no recálculo, não lido na hora. Se
// uma parcela vencer ENTRE o dia em que o seed roda e a âncora, ela fica com o
// status errado no dia da banca. Recusar é melhor que deixar o painel mentir.
const preVooDeDatas = () => {
  const hojeReal = iso(new Date());
  const problemas = [];
  for (const [chave, h] of Object.entries(HONORARIOS)) {
    const vencs = [...h.parcelas, ...(h.reparcelamento?.parcelas ?? [])].map((p) => emMes(p.venc));
    for (const v of vencs) {
      if ((v <= hojeReal) !== (v <= ANCORA)) problemas.push(`${chave}: parcela de ${v}`);
    }
  }
  if (problemas.length > 0) {
    abortar(
      `hoje é ${hojeReal} e a âncora é ${ANCORA}: estas parcelas venceriam entre as duas datas e ` +
      `ficariam com o status errado no dia da âncora:\n       ${problemas.join("\n       ")}\n` +
      `       Rode o seed no próprio dia (--hoje ${hojeReal}) ou ajuste a âncora.`
    );
  }
  if (hojeReal > ANCORA) {
    console.warn(`[aviso] hoje (${hojeReal}) é depois da âncora (${ANCORA}). Os eventos "de hoje" ficarão no passado.`);
  }
  return hojeReal;
};

const main = async () => {
  if (!temFlag("--confirmar-reset")) {
    abortar('este seed APAGA as 16 coleções do banco alvo. Repita com "--confirmar-reset".');
  }
  const hojeReal = preVooDeDatas();

  for (const p of Object.values(PROCESSOS)) {
    if (!cnjValido(p.numeroProcesso)) abortar(`número CNJ inválido no cenário: ${p.numeroProcesso}`);
  }

  const banco = await conectar();
  log(`Âncora do cenário: ${ANCORA}   (hoje: ${hojeReal})`);

  // A API sobe ANTES do reset: a importação compila os models, e o `init()`
  // de cada um garante os índices do schema. Nenhum índice é apagado.
  const api = await subirApi();
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));

  // ── O e-mail de confirmação do cadastro NÃO sai ─────────────────────────
  // A conta nasce não confirmada (DEC-064), e o seed não manda e-mail para
  // ninguém: o transporte é trocado por um que só conta. O link que iria no
  // e-mail não é impresso — ele confirmaria a conta.
  const { definirTransporteDeEmail } = await import("../../src/services/emailService.js");
  let emailsSuprimidos = 0;
  definirTransporteDeEmail(async () => { emailsSuprimidos += 1; });

  // ── RESET ───────────────────────────────────────────────────────────────
  const antes = await contarColecoes();
  log("\nLimpando as 16 coleções (deleteMany, coleção por coleção):");
  const db = mongoose.connection.db;
  for (const nome of COLECOES) {
    const r = await db.collection(nome).deleteMany({});
    log(`  ${nome.padEnd(27)} ${String(r.deletedCount).padStart(6)} apagados`);
  }
  if (antes.extras.length > 0) {
    log(`  (coleções fora do schema, NÃO tocadas: ${antes.extras.join(", ")})`);
  }

  const adv = new Sessao(api.base, "advogada");
  const ids = { clientes: {}, processos: {}, honorarios: {}, secoes: {}, modelos: {}, documentos: [] };

  // ── 1. A advogada ───────────────────────────────────────────────────────
  const { dados: cadastro } = await adv.post("/auth/register", ADVOGADA, { esperado: 201 });
  const logo = fs.readFileSync(path.join(AQUI, "logo.png")).toString("base64");
  await adv.patch("/auth/me", { advocacia: { logoBase64: `data:image/png;base64,${logo}` } });
  log(`\nAdvogada: ${cadastro.usuario.nomeCompleto} — OAB/${ADVOGADA.oab.estado} ${ADVOGADA.oab.numero}`);

  // ── 2. Clientes ─────────────────────────────────────────────────────────
  for (const [chave, payload] of Object.entries(CLIENTES)) {
    const { dados } = await adv.post("/clients", payload, { esperado: 201 });
    ids.clientes[chave] = dados._id;
  }
  log(`Clientes: ${Object.keys(ids.clientes).length}`);

  // ── 3. Processos ────────────────────────────────────────────────────────
  for (const [chave, p] of Object.entries(PROCESSOS)) {
    const { clientes, desativar, ...campos } = p;
    const { dados } = await adv.post("/processes", {
      ...campos,
      clientes: clientes.map((c) => ({ clienteId: ids.clientes[c.c], papel: c.papel, principal: c.principal }))
    }, { esperado: 201 });
    ids.processos[chave] = dados._id;
  }
  log(`Processos: ${Object.keys(ids.processos).length}`);

  // ── 4. Seções e modelos (a biblioteca de documentos) ───────────────────
  for (const [chave, s] of Object.entries(SECOES)) {
    const { dados } = await adv.post("/secoes", s, { esperado: 201 });
    ids.secoes[chave] = dados._id;
  }
  for (const [chave, m] of Object.entries(MODELOS)) {
    const { secoes, ...campos } = m;
    const { dados } = await adv.post("/documents/modelos", campos, { esperado: 201 });
    ids.modelos[chave] = dados._id;
    for (const s of secoes) {
      await adv.post(`/documents/${dados._id}/secoes`, { secaoId: ids.secoes[s] }, { esperado: 201 });
    }
  }
  log(`Seções: ${Object.keys(ids.secoes).length}   Modelos: ${Object.keys(ids.modelos).length}`);

  const principalDe = (chaveProcesso) =>
    ids.clientes[PROCESSOS[chaveProcesso].clientes.find((c) => c.principal).c];

  const gerar = async (modelo, processo, clienteId, honorarioId, rotulo) => {
    const { dados } = await adv.post(`/documents/modelos/${ids.modelos[modelo]}/gerar`, {
      processoId: ids.processos[processo],
      clienteId,
      ...(honorarioId ? { honorarioId } : {})
    }, { esperado: 201 });
    ids.documentos.push({ id: dados._id, nome: dados.nome, processo, rotulo });
    return dados;
  };

  const pagar = (feeId, p) => adv.post("/payments", {
    honorarioId: feeId, valor: p.valor, data: emMes(p.data), tipo: "comum",
    formaPagamento: p.formaPagamento, observacoes: p.observacoes ?? ""
  }, { esperado: 201 });

  // ── 5. Honorários, parcelas, contratos, pagamentos, reparcelamento ─────
  const contratosPorHonorario = {};
  for (const [chave, h] of Object.entries(HONORARIOS)) {
    const ultimoVenc = emMes(h.parcelas[h.parcelas.length - 1].venc);
    const { dados: fee } = await adv.post("/fees", {
      processoId: ids.processos[h.processo],
      ...h.fee,
      dataVencimento: ultimoVenc
    }, { esperado: 201 });
    ids.honorarios[chave] = fee._id;

    // Uma parcela por vez, como a tela de parcelas faz.
    for (const [i, p] of h.parcelas.entries()) {
      await adv.post("/installments", {
        feeId: fee._id, numeroParcela: i + 1, valor: p.valor, dataVencimento: emMes(p.venc)
      }, { esperado: 201 });
    }

    // O contrato nasce com o plano original — é quando ele é assinado.
    if (h.contrato) {
      const doc = await gerar(h.contrato, h.processo, principalDe(h.processo), fee._id, `contrato ${chave}`);
      contratosPorHonorario[chave] = doc._id;
    }

    for (const p of h.pagamentos ?? []) await pagar(fee._id, p);

    if (h.reparcelamento) {
      await adv.post(`/fees/${fee._id}/renegotiations`, {
        data: emMes(h.reparcelamento.data),
        motivo: h.reparcelamento.motivo,
        parcelas: h.reparcelamento.parcelas.map((p) => ({ valor: p.valor, dataVencimento: emMes(p.venc) }))
      }, { esperado: 201 });
    }

    for (const p of h.pagamentosDepois ?? []) await pagar(fee._id, p);

    // Escrita direta nº 2 — o mês do contrato no gráfico (ver o cabeçalho).
    await db.collection("fees").updateOne(
      { _id: new mongoose.Types.ObjectId(fee._id) },
      { $set: { createdAt: new Date(`${emMes(h.criadoEm)}T13:00:00.000Z`) } }
    );
  }
  log(`Honorários: ${Object.keys(ids.honorarios).length}`);

  // ── 6. Os demais documentos ─────────────────────────────────────────────
  const visiveis = [];
  for (const d of DOCUMENTOS) {
    const doc = await gerar(d.modelo, d.processo, ids.clientes[d.cliente], null, `${d.modelo} ${d.cliente}`);
    if (d.visivel) visiveis.push(doc._id);
  }
  for (const chave of CONTRATOS_VISIVEIS) visiveis.push(contratosPorHonorario[chave]);
  for (const id of visiveis) {
    await adv.patch(`/documents/${id}/visibilidade-portal`, { visivelPortal: true });
  }
  log(`Documentos gerados: ${ids.documentos.length}   (visíveis no portal: ${visiveis.length})`);

  // ── 7. Agenda ───────────────────────────────────────────────────────────
  for (const e of EVENTOS) {
    const { dados: ev } = await adv.post("/events", {
      tipo: e.tipo, titulo: e.titulo, data: emDias(e.dia),
      hora: e.hora ?? null, local: e.local ?? null, descricao: e.descricao ?? null,
      processoId: e.processo ? ids.processos[e.processo] : null
    }, { esperado: 201 });
    if (e.concluido) await adv.patch(`/events/${ev._id}/concluir`, { concluido: true });
  }
  log(`Eventos: ${EVENTOS.length}`);

  // ── 8. O portal: código fixo, liberação, troca de senha e confirmação ──
  // Escrita direta nº 1 — o código pessoal (ver o cabeçalho). Antes de fixar,
  // a conferência de que nenhum vínculo sorteou este valor: os dois espaços
  // de código são únicos ENTRE SI (DEC-089), e o seed não pode quebrar isso.
  if (await db.collection("processo_clientes").countDocuments({ codigoAcesso: PORTAL_CODIGO }) > 0) {
    throw new Error("um vínculo sorteou o código fixo do portal — rode o seed de novo");
  }
  const fixou = await db.collection("clients").updateOne(
    { _id: new mongoose.Types.ObjectId(ids.clientes.mariana) },
    { $set: { codigoAcessoPessoal: PORTAL_CODIGO } }
  );
  if (fixou.modifiedCount !== 1) throw new Error("não foi possível fixar o código de acesso do portal");

  // Vínculo novo nasce NÃO liberado (DEC-091). P1 é liberado pela rota, como
  // a advogada faria; P3 fica de fora de propósito (ver `dados.js`).
  await adv.patch(`/processes/${ids.processos.p1}/clientes/${ids.clientes.mariana}/liberacao`, { liberadoNoPortal: true });

  const portal = new Sessao(api.base, "portal");
  await portal.post("/portal/login", { codigoAcesso: PORTAL_CODIGO, senha: PORTAL_SENHA_PROVISORIA });
  await portal.patch("/portal/senha", { senhaAtual: PORTAL_SENHA_PROVISORIA, novaSenha: PORTAL_SENHA });
  const { dados: listaPortal } = await portal.get("/portal/processos");
  if (listaPortal.total !== 1 || listaPortal.data[0].id !== String(ids.processos.p1)) {
    throw new Error(`o portal deveria listar só P1 e listou ${listaPortal.total} processo(s)`);
  }
  await portal.get(`/portal/processos/${ids.processos.p1}`);
  const { dados: docsPortal } = await portal.get(`/portal/processos/${ids.processos.p1}/documentos`);
  if (docsPortal.total !== visiveis.length) {
    throw new Error(`o portal deveria listar ${visiveis.length} documentos e listou ${docsPortal.total}`);
  }
  await portal.post(`/portal/processos/${ids.processos.p1}/confirmacoes`, {}, { esperado: 201 });
  await portal.post("/portal/logout");
  log(`Portal: senha própria definida pelo cliente, 1 de 2 processos liberado, ${docsPortal.total} documentos vistos, 1 confirmação de leitura`);

  // ── 9. O processo desativado (reativável) ───────────────────────────────
  for (const [chave, p] of Object.entries(PROCESSOS)) {
    if (p.desativar) await adv.del(`/processes/${ids.processos[chave]}`);
  }

  // ── 10. Conferência do que a demonstração depende ──────────────────────
  const { dados: resumo } = await adv.get("/dashboard");
  const { dados: financeiro } = await adv.get("/financeiro/resumo");
  await adv.post("/auth/logout");

  const conf = {
    advogadaNaoConfirmada: (await db.collection("users").findOne({ email: ADVOGADA_EMAIL })).emailConfirmadoEm === null,
    parcelasVencidas: await db.collection("installments").countDocuments({ status: "vencido", ativo: true }),
    codigoPortal: (await db.collection("clients").countDocuments({ codigoAcessoPessoal: PORTAL_CODIGO })) === 1,
    processoNaoLiberado: await db.collection("processo_clientes").countDocuments({
      clienteId: new mongoose.Types.ObjectId(ids.clientes.mariana), ativo: true, liberadoNoPortal: false
    }),
    senhaPortalPropria: (await db.collection("clients").findOne({ email: PORTAL_EMAIL })).senhaPortalProvisoria === false,
    confirmacoesNaoVistas: await db.collection("confirmacoes_visualizacao").countDocuments({ vistaPelaAdvogada: false }),
    processoDesativado: await db.collection("processes").countDocuments({ ativo: false }),
    reparcelamentos: await db.collection("reparcelamentos").countDocuments({})
  };
  const esperado = {
    advogadaNaoConfirmada: true, parcelasVencidas: 1, codigoPortal: true, processoNaoLiberado: 1, senhaPortalPropria: true,
    confirmacoesNaoVistas: 1, processoDesativado: 1, reparcelamentos: 1
  };
  const divergencias = Object.keys(esperado).filter((k) => conf[k] !== esperado[k]);
  if (divergencias.length > 0) {
    throw new Error(`conferência final falhou: ${divergencias.map((k) => `${k}=${conf[k]} (esperado ${esperado[k]})`).join(", ")}`);
  }

  const depois = await contarColecoes();
  await api.fechar();
  await mongoose.connection.close();

  const L = "═".repeat(70);
  log(`\n${L}\n  SEED DA 3ª BANCA CONCLUÍDO — banco ${banco}, âncora ${ANCORA}\n${L}`);
  log("  Contagens por coleção:");
  for (const [nome, n] of Object.entries(depois.contagens)) log(`    ${nome.padEnd(27)} ${String(n).padStart(5)}`);
  log("  Conferência: " + Object.entries(conf).map(([k, v]) => `${k}=${v}`).join("  "));
  log(`  Painel hoje (${hojeReal}): processosAtivos=${resumo.processosAtivos} clientes=${resumo.clientesCadastrados} ` +
      `honorariosAReceber=${resumo.honorariosAReceber} documentos=${resumo.documentosCadastrados} ` +
      `confirmacoesNovas=${resumo.confirmacoesNaoVistas}`);
  log(`  Financeiro hoje: contratado=${financeiro.valorContratado} recebido=${financeiro.recebido} ` +
      `vencidas=${financeiro.vencidas} recebidoNoMes=${financeiro.recebidoNoMes} aReceberNoMes=${financeiro.aReceberNoMes}`);
  log(`  E-mails suprimidos (confirmação de cadastro): ${emailsSuprimidos}`);
  log("  " + "─".repeat(68));
  log(`  Advogada : ${ADVOGADA_EMAIL} / ${ADVOGADA_SENHA}   (e-mail NÃO confirmado — DEC-064)`);
  log(`  Portal   : código ${PORTAL_CODIGO} / ${PORTAL_SENHA}   (cliente ${PORTAL_EMAIL})`);
  log(L);
};

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(`\nERRO no seed: ${e.message}`);
    try { await mongoose.connection.close(); } catch { /* fechando no caminho de erro */ }
    process.exit(1);
  });
