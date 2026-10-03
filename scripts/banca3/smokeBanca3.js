// scripts/banca3/smokeBanca3.js
//
// ═══════════════════════════════════════════════════════════════════════════
// SMOKE TEST DA 3ª BANCA (DEC-065)
//
//   LEX_BANCO=lex_test npm run smoke:banca3 -- --banco lex_test [--salvar <pasta>]
//
// Percorre pela API o fluxo que a banca vai ver, sobre o cenário do
// `seed:banca3`. ELE ESCREVE (edita um cliente, cria outro, muda uma fase, gera
// uma procuração) — por isso recusa `lex_prod` e `lex`, e por isso o roteiro
// manda rodar o seed DE NOVO depois dele.
//
// `--salvar <pasta>` grava o PDF e o DOCX baixados, para conferir o timbrado.
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

import { abortar, conectar, subirApi, Sessao, lerArgumento } from "./ambiente.js";
import {
  ADVOGADA_EMAIL, ADVOGADA_SENHA, PORTAL_CODIGO, PORTAL_SENHA, PROCESSOS, CLIENTES, MODELOS
} from "./dados.js";
import { validarCPF } from "../../src/utils/documentos.js";

const PROIBIDOS = new Set(["lex_prod", "lex"]);
const pedido = lerArgumento("--banco");
if (pedido && PROIBIDOS.has(pedido)) {
  abortar(`o smoke test ESCREVE no banco e não roda em "${pedido}". Use lex_test e rode o seed de novo depois.`);
}

const resultados = [];
const passo = async (nome, fn) => {
  try {
    const detalhe = await fn();
    resultados.push({ nome, ok: true, detalhe });
    console.log(`  ✔ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    resultados.push({ nome, ok: false, detalhe: e.message });
    console.log(`  ✘ ${nome} — ${e.message}`);
  }
};
const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };

// CPF de dígito válido sorteado a cada execução: rodar o smoke duas vezes não
// esbarra no índice único de CPF.
const cpfAleatorio = () => {
  for (;;) {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    for (const n of [9, 10]) {
      const s = d.slice(0, n).reduce((a, x, i) => a + x * (n + 1 - i), 0);
      const r = (s * 10) % 11;
      d.push(r === 10 ? 0 : r);
    }
    const cpf = d.join("");
    if (validarCPF(cpf)) return cpf;
  }
};

// O payload de EDIÇÃO que `ClientFormPage.jsx` monta: todos os campos de PF,
// opcional vazio como `null`. É o caminho em que a nacionalidade já se perdeu.
const payloadDeEdicaoDaTela = (c, mudancas) => {
  const opcional = (v) => {
    const t = typeof v === "string" ? v.trim() : v;
    return t ? t : null;
  };
  const e = c.endereco ?? {};
  return {
    tipoPessoa: c.tipoPessoa,
    email: opcional(c.email),
    telefone: opcional(c.telefone),
    observacoes: opcional(c.observacoes),
    endereco: {
      cep: opcional(e.cep), logradouro: opcional(e.logradouro), numero: opcional(e.numero),
      complemento: opcional(e.complemento), bairro: opcional(e.bairro), cidade: opcional(e.cidade),
      estado: opcional(e.estado), pais: opcional(e.pais)
    },
    nomeCompleto: c.nomeCompleto,
    cpf: c.cpf,
    rg: opcional(c.rg),
    dataNascimento: opcional(c.dataNascimento ? String(c.dataNascimento).slice(0, 10) : ""),
    sexo: opcional(c.sexo),
    estadoCivil: opcional(c.estadoCivil),
    profissao: opcional(c.profissao),
    nacionalidade: opcional(c.nacionalidade),
    ...mudancas
  };
};

const main = async () => {
  const banco = await conectar();
  if (PROIBIDOS.has(banco)) abortar(`banco conectado "${banco}" é proibido para o smoke test.`);
  const salvar = lerArgumento("--salvar");
  if (salvar) fs.mkdirSync(salvar, { recursive: true });

  const api = await subirApi();
  const adv = new Sessao(api.base, "advogada");
  const portal = new Sessao(api.base, "portal");
  const ctx = {};

  console.log(`\nSmoke test da 3ª banca — banco ${banco}\n`);

  // 1 ─────────────────────────────────────────────────────────────────────
  await passo("1. login da advogada", async () => {
    const { dados } = await adv.post("/auth/login", { email: ADVOGADA_EMAIL, senha: ADVOGADA_SENHA }, { esperado: 200 });
    exigir(dados.usuario.email === ADVOGADA_EMAIL, "e-mail da sessão diferente");
    const { dados: me } = await adv.get("/auth/me");
    exigir(me.usuario.emailConfirmadoEm === null, "a conta deveria estar com o e-mail NÃO confirmado");
    return `${dados.usuario.nomeCompleto}, e-mail não confirmado (aviso visível)`;
  });

  // 2 ─────────────────────────────────────────────────────────────────────
  await passo("2. listagens de clientes e processos", async () => {
    const { dados: cl } = await adv.get("/clients?limit=100");
    exigir(cl.total === Object.keys(CLIENTES).length, `clientes: ${cl.total}`);
    const nomes = cl.data.map((c) => c.nomeExibicao);
    exigir(nomes[0] === "Ana Paula Gomes Ferreira", `ordem alfabética: primeiro é "${nomes[0]}"`);
    ctx.clientes = Object.fromEntries(cl.data.map((c) => [c.cpf ?? c.cnpj, c]));

    const { dados: pr } = await adv.get("/processes?limit=100");
    const ativos = Object.values(PROCESSOS).filter((p) => !p.desativar).length;
    exigir(pr.total === ativos, `processos ativos: ${pr.total}, esperado ${ativos}`);
    const { dados: inat } = await adv.get("/processes?limit=100&situacao=inativos");
    exigir(inat.total === 1, `desativados: ${inat.total}`);
    exigir(!inat.data[0].impedimentosDeReativacao?.length, "o processo desativado deveria ser reativável");
    ctx.processos = Object.fromEntries([...pr.data, ...inat.data].map((p) => [p.numeroProcesso, p]));
    return `${cl.total} clientes (A→Z), ${pr.total} processos ativos + 1 desativado reativável`;
  });

  // 3 ─────────────────────────────────────────────────────────────────────
  await passo("3. editar um PF e manter a nacionalidade", async () => {
    const alvo = ctx.clientes[CLIENTES.joaquim.cpf];
    const { dados: atual } = await adv.get(`/clients/${alvo._id}`);
    exigir(atual.nacionalidade === "português", `nacionalidade antes: ${atual.nacionalidade}`);

    await adv.patch(`/clients/${alvo._id}`, payloadDeEdicaoDaTela(atual, { telefone: "42999015799" }));
    const { dados: d1 } = await adv.get(`/clients/${alvo._id}`);
    exigir(d1.telefone === "42999015799", "o telefone não mudou");
    exigir(d1.nacionalidade === "português", `nacionalidade depois do formulário: ${d1.nacionalidade}`);

    await adv.patch(`/clients/${alvo._id}`, { observacoes: "Atualizado pelo smoke test." });
    const { dados: d2 } = await adv.get(`/clients/${alvo._id}`);
    exigir(d2.nacionalidade === "português", `nacionalidade depois do PATCH parcial: ${d2.nacionalidade}`);
    return `${d2.nomeCompleto}: telefone alterado, nacionalidade "${d2.nacionalidade}" mantida (formulário completo e PATCH parcial)`;
  });

  // 4 ─────────────────────────────────────────────────────────────────────
  await passo("4. criar um PF (o fluxo que já quebrou)", async () => {
    const cpf = cpfAleatorio();
    // Exatamente o que a tela manda na CRIAÇÃO: opcional vazio é `undefined`
    // (some do JSON), para o schema aplicar o default da nacionalidade.
    const { dados: criado } = await adv.post("/clients", {
      tipoPessoa: "fisica", email: "denise.lacerda@example.com", telefone: "42998765012",
      endereco: { cep: "84010050", logradouro: "Rua Balduíno Taques", numero: "301", bairro: "Centro",
        cidade: "Ponta Grossa", estado: "PR", pais: "Brasil" },
      nomeCompleto: "Denise Prado Lacerda", cpf, rg: "11.203.884-6", dataNascimento: "1990-07-21",
      sexo: "feminino", estadoCivil: "solteiro", profissao: "Arquiteta", nacionalidade: "brasileira"
    }, { esperado: 201 });
    exigir(criado.nacionalidade === "brasileira", `nacionalidade gravada: ${criado.nacionalidade}`);

    const { dados: semNac } = await adv.post("/clients", {
      tipoPessoa: "fisica", nomeCompleto: "Otávio Rocha Batista", cpf: cpfAleatorio()
    }, { esperado: 201 });
    exigir(semNac.nacionalidade === "brasileira", `default da nacionalidade: ${semNac.nacionalidade}`);
    return `criados 2 PF (completo e mínimo), nacionalidade "brasileira" nos dois`;
  });

  // 5 ─────────────────────────────────────────────────────────────────────
  await passo("5. mudar a fase de um processo", async () => {
    const p2 = ctx.processos[PROCESSOS.p2.numeroProcesso];
    const { dados } = await adv.patch(`/processes/${p2._id}/fase`, {
      fase: "execucao", motivo: "Recurso ordinário não conhecido; início do cumprimento."
    });
    exigir(dados.fase === "execucao", `fase: ${dados.fase}`);
    exigir(dados.historicoFase.length === 2, `historicoFase: ${dados.historicoFase.length}`);
    await adv.patch(`/processes/${p2._id}`, { fase: "sentenca" }, { esperado: 400 });
    return `recursos → execução, histórico com 2 entradas; PATCH comum com "fase" recusado (400)`;
  });

  // 6 ─────────────────────────────────────────────────────────────────────
  await passo("6. gerar uma procuração em PDF e em DOCX", async () => {
    const { dados: modelos } = await adv.get("/documents/modelos?limit=100");
    const modelo = modelos.data.find((m) => m.nome === MODELOS.procuracaoPf.nome);
    exigir(modelo, "modelo de procuração PF não encontrado");
    const p2 = ctx.processos[PROCESSOS.p2.numeroProcesso];
    const cliente = ctx.clientes[CLIENTES.rogerio.cpf];
    const { dados: doc } = await adv.post(`/documents/modelos/${modelo._id}/gerar`, {
      processoId: p2._id, clienteId: cliente._id
    }, { esperado: 201 });

    const pdf = await adv.get(`/documents/${doc._id}/download?formato=pdf`, { binario: true });
    exigir(pdf.headers.get("content-type")?.includes("application/pdf"), "content-type do PDF");
    exigir(pdf.dados.subarray(0, 4).toString() === "%PDF", "o arquivo não começa com %PDF");
    const docx = await adv.get(`/documents/${doc._id}/download?formato=docx`, { binario: true });
    exigir(docx.dados.subarray(0, 2).toString() === "PK", "o DOCX não é um zip");
    if (salvar) {
      fs.writeFileSync(path.join(salvar, "procuracao-smoke.pdf"), pdf.dados);
      fs.writeFileSync(path.join(salvar, "procuracao-smoke.docx"), docx.dados);
    }
    return `PDF ${Math.round(pdf.dados.length / 1024)} KB, DOCX ${Math.round(docx.dados.length / 1024)} KB`;
  });

  // Antes de sair da advogada: o id da peça OCULTA do processo do portal.
  const p1 = ctx.processos[PROCESSOS.p1.numeroProcesso];
  const { dados: docsP1 } = await adv.get(`/documents?processoId=${p1._id}&limit=100`);
  const oculto = docsP1.data.find((d) => d.ehModelo !== true && d.visivelPortal !== true);
  await adv.post("/auth/logout");

  // 7 ─────────────────────────────────────────────────────────────────────
  await passo("7. login do cliente no portal", async () => {
    const { dados } = await portal.post("/portal/login", { codigoAcesso: PORTAL_CODIGO, senha: PORTAL_SENHA }, { esperado: 200 });
    exigir(dados.senhaPortalProvisoria === false, "a senha deveria ser a PRÓPRIA do cliente");
    return `código ${PORTAL_CODIGO}, senha própria (sem tela de troca)`;
  });

  // 8 ─────────────────────────────────────────────────────────────────────
  await passo("8. o cliente vê processo, fase, trânsito e só os documentos liberados", async () => {
    const { dados: pr } = await portal.get("/portal/processo");
    exigir(pr.processo.numeroProcesso === PROCESSOS.p1.numeroProcesso, "processo errado");
    exigir(pr.processo.fase === PROCESSOS.p1.fase, `fase: ${pr.processo.fase}`);
    exigir(pr.processo.transitoEmJulgadoEm?.startsWith(PROCESSOS.p1.transitoEmJulgadoEm), `trânsito: ${pr.processo.transitoEmJulgadoEm}`);

    const { dados: docs } = await portal.get("/portal/documentos");
    const nomes = docs.data.map((d) => d.nome).sort();
    exigir(docs.total === 2, `documentos visíveis: ${docs.total}`);
    exigir(nomes.some((n) => n.startsWith("Procuração")) && nomes.some((n) => n.startsWith("Contrato")),
      `documentos: ${nomes.join(", ")}`);
    exigir(oculto, "documento oculto do processo do portal não encontrado");
    exigir(!docs.data.some((d) => d.id === String(oculto._id)), "o documento oculto aparece no portal");
    await portal.get(`/portal/documentos/${oculto._id}/download?formato=pdf`, { esperado: 404 });
    const pdf = await portal.get(`/portal/documentos/${docs.data[0].id}/download?formato=pdf`, { binario: true });
    exigir(pdf.dados.subarray(0, 4).toString() === "%PDF", "PDF do portal inválido");
    if (salvar) fs.writeFileSync(path.join(salvar, "portal-documento.pdf"), pdf.dados);
    await portal.post("/portal/logout");
    return `fase "${pr.processo.fase}", trânsito em ${pr.processo.transitoEmJulgadoEm.slice(0, 10)}, ` +
      `vê: ${nomes.join(" + ")}; "${oculto.nome}" fica de fora (404 no download)`;
  });

  await api.fechar();
  await mongoose.connection.close();

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} passos OK${falhas.length ? " — FALHOU" : ""}`);
  return falhas.length === 0 ? 0 : 1;
};

main()
  .then((codigo) => process.exit(codigo))
  .catch(async (e) => {
    console.error(`\nERRO no smoke test: ${e.message}`);
    try { await mongoose.connection.close(); } catch { /* caminho de erro */ }
    process.exit(1);
  });
