// ═══════════════════════════════════════════════════════════════════════════
// O VOLUME DA DEMONSTRAÇÃO (`seed:demo:volume`)
//
// Popula a base com o tamanho e a variedade de um escritório de verdade — o de
// uma advogada autônoma de Ponta Grossa, em Direito de Família, Cível e do
// Consumidor, com cerca de 260 clientes —, para a paginação, os filtros, a
// ordenação e as telas do financeiro terem o que mostrar.
//
// ── A REGRA: tudo passa pelos SERVIÇOS ────────────────────────────────────
// Cliente, processo, mudança de fase, honorário, parcelas, pagamento, estorno,
// reparcelamento, evento, documento gerado e desativação entram pelo mesmo
// caminho da API. Um seed que escreve direto no banco produz estado que a
// aplicação talvez nunca aceite — e este roda até o fim como teste de fumaça do
// sistema inteiro.
//
// **As escritas DIRETAS que existem, e por quê** (a lista é curta e está aqui de
// propósito; o relatório da fase a repete):
//   • `createdAt` de honorário e de processo, e a `data` de cada entrada do
//     `historicoFase` — o serviço carimba "agora", e uma base inteira criada
//     hoje tiraria o sentido do gráfico por mês e da linha do tempo;
//   • o hash e o estado da senha do portal — quem define é a advogada ou o
//     cliente, por rotas que exigem sessão;
//   • acesso e confirmação de leitura do portal — o serviço exige sessão de
//     portal, e o seed não simula navegador.
//
// ── Determinístico ────────────────────────────────────────────────────────
// Mesma semente, mesma base: dev e produção recebem o MESMO volume. As datas
// são ancoradas no "hoje" da semeadura, então a agenda e o sino nunca abrem
// vazios (a mesma razão do seed curado).
// ═══════════════════════════════════════════════════════════════════════════

import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import Client from "../../../src/models/Client.js";
import Process from "../../../src/models/Process.js";
import ProcessoCliente from "../../../src/models/ProcessoCliente.js";
import Document from "../../../src/models/Document.js";
import Fee from "../../../src/models/Fee.js";
import Installment from "../../../src/models/Installment.js";
import Payment from "../../../src/models/Payment.js";
import Allocation from "../../../src/models/Allocation.js";
import Reversal from "../../../src/models/Reversal.js";
import Renegotiation from "../../../src/models/Renegotiation.js";
import Event from "../../../src/models/Event.js";
import ConfirmacaoVisualizacao from "../../../src/models/ConfirmacaoVisualizacao.js";

import clientService from "../../../src/services/clientService.js";
import { createProcess, updateProcess, mudarFase, deleteProcess, reactivateProcess }
  from "../../../src/services/processService.js";
import feeService from "../../../src/services/feeService.js";
import { criarPlanoDeParcelas } from "../../../src/services/installmentService.js";
import { create as criarPayment, recalcularParcelas } from "../../../src/services/paymentService.js";
import { criarEstorno } from "../../../src/services/reversalService.js";
import { criarReparcelamento, saldoEmAberto } from "../../../src/services/renegotiationService.js";
import { criarEvento, concluirEvento } from "../../../src/services/eventService.js";
import {
  gerarDocumentoService, atualizarTextoService, alternarVisibilidadePortalService
} from "../../../src/services/documentGenerationService.js";
import { TEXTO_CONFIRMACAO } from "../../../src/config/textoConfirmacao.js";
import {
  lerDataDeCalendario, escreverDataDeCalendario
} from "../../../src/utils/dataDeCalendario.js";

import { criarSorteio } from "./sorteio.js";
import { gerarCPF, gerarCNPJ, montarNumeroCNJ } from "./documentosBR.js";
import * as BR from "./dadosBR.js";

// ── Tamanho ────────────────────────────────────────────────────────────────
// 252 do volume + 8 do seed curado = 260 clientes, o porte da advogada. Com 20
// por página, são 13 páginas na listagem.
export const TAMANHO = Object.freeze({
  clientesPF: 222,
  clientesPJ: 30,
  eventos: 120,
  atrasadosNaoConcluidos: 10,
  procuracoes: 60,
  contratos: 32,
  editadosAMao: 3,
  clientesInativosSemProcesso: 10,
  clientesInativadosComProcesso: 4,
  processosInativosAvulsos: 12,
  processosReativados: 2,
  portalProvisoria: 9,
  portalPropria: 15,
  portalComConfirmacao: 8
});

export const SEMENTE_PADRAO = 20260919;

const SENHA_PROVISORIA = "Portal2026";
const SENHA_PROPRIA = "MinhaSenha2026";

// ── Datas de calendário ('AAAA-MM-DD', meia-noite UTC — a decisão de fuso) ──
const MS_DIA = 24 * 60 * 60 * 1000;
const dataDe = (texto) => lerDataDeCalendario(texto);
export const somarDias = (texto, dias) =>
  escreverDataDeCalendario(new Date(dataDe(texto).getTime() + dias * MS_DIA));

export const somarMeses = (texto, meses) => {
  const d = dataDe(texto);
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d.getUTCDate(), ultimoDia));
  return escreverDataDeCalendario(alvo);
};

const diasEntre = (de, ate) => Math.round((dataDe(ate).getTime() - dataDe(de).getTime()) / MS_DIA);
const antes = (a, b) => dataDe(a).getTime() < dataDe(b).getTime();
const limitar = (data, minimo, maximo) => (antes(data, minimo) ? minimo : antes(maximo, data) ? maximo : data);

// ── Dinheiro em centavos, para a soma das parcelas fechar EXATAMENTE ───────
const emCentavos = (reais) => Math.round(Number(reais) * 100);
const emReais = (centavos) => centavos / 100;

// Divide `totalCentavos` em `n` partes; a sobra vai para a PRIMEIRA (a decisão
// de negócio registrada na DEC-049 — o cliente paga o valor quebrado agora).
export const dividirEmParcelas = (totalCentavos, n) => {
  const base = Math.floor(totalCentavos / n);
  const partes = Array(n).fill(base);
  partes[0] += totalCentavos - base * n;
  return partes;
};

const primeiroNome = (nomeCompleto) => String(nomeCompleto).split(" ")[0];

const ate = (texto, limite) => (texto.length <= limite ? texto : `${texto.slice(0, limite - 1)}…`);

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 1 — CLIENTES
// ═══════════════════════════════════════════════════════════════════════════

const montarPessoaFisica = (ctx, indice) => {
  const { sorteio, tabelas } = ctx;
  const sexo = sorteio.chance(0.52) ? "feminino" : "masculino";
  const prenome = sorteio.escolher(sexo === "feminino" ? BR.PRENOMES_FEMININOS : BR.PRENOMES_MASCULINOS);

  let nome;
  do {
    const sobrenomes = sorteio.chance(0.7)
      ? `${sorteio.escolher(BR.SOBRENOMES)} ${sorteio.escolher(BR.SOBRENOMES)}`
      : sorteio.escolher(BR.SOBRENOMES);
    nome = `${prenome} ${sobrenomes}`;
  } while (ctx.nomesUsados.has(nome));
  ctx.nomesUsados.add(nome);

  let cpf;
  do { cpf = gerarCPF(sorteio); } while (ctx.cpfsUsados.has(cpf));
  ctx.cpfsUsados.add(cpf);

  const ano = sorteio.inteiro(1955, 2003);
  const dataNascimento =
    `${ano}-${String(sorteio.inteiro(1, 12)).padStart(2, "0")}-${String(sorteio.inteiro(1, 28)).padStart(2, "0")}`;

  const nacionalidadeBrasileira = sorteio.chance(0.95);
  const nacionalidade =
    (nacionalidadeBrasileira
      ? null
      : tabelas.gentilico(sorteio.escolher(["Paraguai", "Argentina", "Itália", "Alemanha", "Portugal", "Venezuela"]), sexo)) ??
    tabelas.gentilico("Brasil", sexo);

  const semProfissao = sorteio.chance(0.05);
  const temEmail = sorteio.chance(0.88);

  return {
    tipoPessoa: "fisica",
    nomeCompleto: nome,
    cpf,
    rg: BR.montarRG(sorteio),
    dataNascimento,
    sexo,
    estadoCivil: sorteio.ponderado(BR.ESTADOS_CIVIS),
    ...(semProfissao ? {} : { profissao: sorteio.escolher(ctx.profissoes) }),
    nacionalidade,
    ...(temEmail ? { email: BR.montarEmail(nome, indice, sorteio) } : {}),
    telefone: BR.montarTelefone(sorteio),
    endereco: BR.montarEndereco(sorteio),
    ...(sorteio.chance(0.28) ? { observacoes: sorteio.escolher(BR.NOTAS_INTERNAS) } : {})
  };
};

const montarPessoaJuridica = (ctx, indice) => {
  const { sorteio } = ctx;
  const [curto, longo] = sorteio.escolher(BR.RAMOS_PJ);
  const fantasia = sorteio.escolher(BR.NOMES_FANTASIA_PJ);

  let razaoSocial;
  let nomeFantasia;
  do {
    nomeFantasia = `${curto} ${fantasia}`;
    razaoSocial = sorteio.chance(0.6)
      ? `${sorteio.escolher(BR.SOBRENOMES)} ${longo} Ltda`
      : `${fantasia} ${longo} ${sorteio.chance(0.5) ? "Ltda" : "ME"}`;
  } while (ctx.nomesUsados.has(razaoSocial));
  ctx.nomesUsados.add(razaoSocial);

  let cnpj;
  do { cnpj = gerarCNPJ(sorteio); } while (ctx.cnpjsUsados.has(cnpj));
  ctx.cnpjsUsados.add(cnpj);

  const representante = sorteio.chance(0.9);
  let representanteLegal;
  if (representante) {
    const rSexo = sorteio.chance(0.5) ? "feminino" : "masculino";
    const nome = `${sorteio.escolher(rSexo === "feminino" ? BR.PRENOMES_FEMININOS : BR.PRENOMES_MASCULINOS)} ` +
      `${sorteio.escolher(BR.SOBRENOMES)} ${sorteio.escolher(BR.SOBRENOMES)}`;
    let cpfRep;
    do { cpfRep = gerarCPF(sorteio); } while (ctx.cpfsUsados.has(cpfRep));
    ctx.cpfsUsados.add(cpfRep);
    representanteLegal = { nome, cpf: cpfRep, cargo: sorteio.escolher(BR.CARGOS_REPRESENTANTE) };
  }

  return {
    tipoPessoa: "juridica",
    razaoSocial,
    nomeFantasia,
    cnpj,
    ...(representanteLegal ? { representanteLegal } : {}),
    email: `contato.${nomeFantasia.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "")}${indice}@${sorteio.escolher(["exemplo.test", "correio.test"])}`,
    telefone: BR.montarTelefone(sorteio, { fixo: true }),
    endereco: BR.montarEndereco(sorteio),
    ...(sorteio.chance(0.3) ? { observacoes: sorteio.escolher(BR.NOTAS_INTERNAS) } : {})
  };
};

const criarClientes = async (ctx) => {
  const { uid, log } = ctx;
  const total = TAMANHO.clientesPF + TAMANHO.clientesPJ;
  const lista = [];

  for (let i = 0; i < total; i += 1) {
    const ehPJ = i >= TAMANHO.clientesPF;
    const payload = ehPJ ? montarPessoaJuridica(ctx, i) : montarPessoaFisica(ctx, i);

    try {
      const doc = await clientService.createClient(uid, payload);
      lista.push({
        doc,
        id: String(doc._id),
        ehPJ,
        nome: ehPJ ? payload.razaoSocial : payload.nomeCompleto,
        // Pronto para gerar documento? As variáveis do modelo exigem estes dados.
        completo: ehPJ
          ? Boolean(payload.representanteLegal)
          : Boolean(payload.profissao && payload.email && payload.telefone),
        processos: [],
        situacao: "ativo",
        portal: null
      });
    } catch (erro) {
      ctx.falhas.push({ etapa: "cliente", detalhe: `${payload.nomeCompleto ?? payload.razaoSocial}: ${erro.message}` });
    }
  }

  log(`  ${lista.length} clientes criados (${TAMANHO.clientesPF} PF + ${TAMANHO.clientesPJ} PJ)`);
  return lista;
};

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 2 — O PLANO DOS PROCESSOS (só decide; nada é gravado)
// ═══════════════════════════════════════════════════════════════════════════

const COMARCAS_PESOS = Object.freeze([
  ["Ponta Grossa", 74], ["Castro", 5], ["Palmeira", 4], ["Telêmaco Borba", 3], ["Tibagi", 2], ["Curitiba", 3],
  ["Guarapuava", 2], ["Irati", 2], ["Jaguariaíva", 1.5], ["Piraí do Sul", 1.5], ["Prudentópolis", 1], ["Arapoti", 1]
]);

const FOROS = Object.freeze({ "Ponta Grossa": 19, Curitiba: 1 });

const codigoDoForo = (comarca, tabelas) => {
  if (FOROS[comarca]) return FOROS[comarca];
  // O foro das demais é fictício (só Ponta Grossa e Curitiba são plausíveis):
  // estável por comarca, para o mesmo nome dar sempre o mesmo código.
  const posicao = tabelas.comarcas.findIndex((c) => c.nome === comarca);
  return 100 + Math.max(posicao, 0);
};

const FASES_PESOS = Object.freeze([["conhecimento", 42], ["sentenca", 20], ["execucao", 22], ["recursos", 16]]);
const STATUS_PESOS = Object.freeze([["ativo", 80], ["suspenso", 6], ["encerrado", 14]]);

const MOTIVOS_FASE = Object.freeze({
  sentenca: ["Sentença publicada", "Julgamento antecipado do mérito", null, null],
  recursos: ["Apelação interposta", "Recurso inominado interposto", null, null],
  execucao: ["Início do cumprimento", "Trânsito da fase de conhecimento", null, null],
  conhecimento: ["Sentença anulada — retorno à instrução", "Retorno para produção de prova", null]
});

const caminhoDeFases = (sorteio, final) => {
  if (final === "conhecimento") return sorteio.chance(0.1) ? ["sentenca", "conhecimento"] : [];
  if (final === "sentenca") return ["sentenca"];
  if (final === "recursos") return ["sentenca", "recursos"];
  return sorteio.chance(0.7) ? ["sentenca", "execucao"] : ["sentenca", "recursos", "execucao"];
};

const contraparteDe = (caso, sorteio) =>
  caso.area === "DIREITO DO CONSUMIDOR" || ["cobranca", "indenizacao", "busca_apreensao", "revisao_bancaria"].includes(caso.chave)
    ? sorteio.escolher(BR.CONTRAPARTES)
    : null;

const planejarProcessos = (ctx, clientes) => {
  const { sorteio, hoje, tabelas } = ctx;

  const embaralhados = sorteio.embaralhar(clientes);
  const nSemProcesso = Math.round(clientes.length * 0.22);
  const semProcesso = embaralhados.slice(0, nSemProcesso);
  const comProcesso = embaralhados.slice(nSemProcesso);

  const specs = [];
  const casosPF = BR.CASOS.filter((c) => c.pf).map((c) => [c, c.peso]);
  const casosPJ = BR.CASOS.filter((c) => c.pj).map((c) => [c, c.peso]);

  // "Alguns clientes com vários processos": quatro carregam de 6 a 8, de
  // preferência PJ (é onde o escritório costuma ter carteira).
  const pesados = new Set(
    [...comProcesso].sort((a, b) => Number(b.ehPJ) - Number(a.ehPJ)).slice(0, 4).map((c) => c.id)
  );

  for (const cliente of comProcesso) {
    const quantidade = pesados.has(cliente.id)
      ? sorteio.inteiro(6, 8)
      : sorteio.ponderado([[1, 70], [2, 22], [3, 6], [4, 2]]);

    for (let k = 0; k < quantidade; k += 1) {
      const caso = sorteio.ponderado(cliente.ehPJ ? casosPJ : casosPF);
      const comarca = sorteio.ponderado(COMARCAS_PESOS);

      const fase = sorteio.ponderado(FASES_PESOS);
      const status = sorteio.ponderado(STATUS_PESOS);
      const distribuicao = somarDias(hoje, -sorteio.inteiro(25, 1000));
      const vao = Math.max(diasEntre(distribuicao, hoje), 10);

      const encerrado = status === "encerrado";
      const transito =
        (encerrado && sorteio.chance(0.75)) ||
        (!encerrado && ["execucao", "recursos"].includes(fase) && sorteio.chance(0.04));

      const foro = codigoDoForo(comarca, tabelas);
      const ehVara = caso.vara.startsWith("Vara");
      const ordinal = sorteio.inteiro(1, 4);

      const contraparte = contraparteDe(caso, sorteio);
      const reu = caso.reu === true || (cliente.ehPJ && ["cobranca", "exec_titulo"].includes(caso.chave) && sorteio.chance(0.12));

      specs.push({
        principal: cliente,
        participantes: [],
        caso,
        comarca,
        foro,
        fase,
        status,
        distribuicao,
        vao,
        transito,
        liminar: !encerrado && ["conhecimento", "sentenca"].includes(fase) && sorteio.chance(0.14),
        contraparte,
        papelPrincipal: reu ? "reu" : "autor",
        vara: `${ordinal}${ehVara ? "ª" : "º"} ${caso.vara}`,
        // Flags decididas mais abaixo.
        semDependentes: false,
        inativar: false,
        reativar: false,
        inativarCliente: false
      });
    }
  }

  // ── Litisconsórcio ──────────────────────────────────────────────────────
  // Todo inventário e arrolamento reúne herdeiros; e um em cada 16 dos demais
  // leva um segundo participante. Sempre UM principal (o cliente da linha).
  const candidatosParticipante = comProcesso.filter((c) => !c.ehPJ);
  for (const spec of specs) {
    const quantos = spec.caso.herdeiros
      ? sorteio.inteiro(1, 3)
      : sorteio.chance(0.0625) ? 1 : 0;

    const escolhidos = new Set();
    let tentativas = 0;
    while (escolhidos.size < quantos && tentativas < 20) {
      tentativas += 1;
      const outro = sorteio.escolher(candidatosParticipante);
      if (outro.id !== spec.principal.id) escolhidos.add(outro);
    }

    for (const outro of escolhidos) {
      spec.participantes.push({
        cliente: outro,
        papel: spec.caso.herdeiros || sorteio.chance(0.75) ? "litisconsorte" : "terceiro_interessado"
      });
    }
  }

  // ── Numeração ───────────────────────────────────────────────────────────
  // Sequencial por ano com um passo primo, para os números não parecerem uma
  // contagem; a unicidade é conferida contra tudo o que já foi gerado.
  const usados = new Set();
  specs.forEach((spec, i) => {
    let sequencial = 1500 + i * 173 + sorteio.inteiro(0, 60);
    const ano = Number(spec.distribuicao.slice(0, 4));
    let numero = montarNumeroCNJ({ sequencial, ano, foro: spec.foro });
    while (usados.has(numero)) {
      sequencial += 1;
      numero = montarNumeroCNJ({ sequencial, ano, foro: spec.foro });
    }
    usados.add(numero);
    spec.numeroProcesso = numero;
  });

  // ── Quem será desativado ────────────────────────────────────────────────
  // Só processo SEM dependentes (sem honorário, evento nem documento). A
  // desativação de processo não cascateia para eles (DEC-052/053), e o
  // relatório de órfãos (`auditar:orfaos`) apontaria cada um como registro
  // ativo sob pai inativo. Um seed que já nasce com órfão mascararia o dia em
  // que a auditoria achar um de verdade.
  const soloPF = specs.filter(
    (s) => !s.principal.ehPJ && s.participantes.length === 0 &&
      specs.filter((o) => o.principal.id === s.principal.id).length === 1 &&
      !specs.some((o) => o.participantes.some((p) => p.cliente.id === s.principal.id))
  );
  const paraInativarComCliente = soloPF.slice(0, TAMANHO.clientesInativadosComProcesso);
  for (const spec of paraInativarComCliente) {
    spec.semDependentes = true;
    spec.inativar = true;
    spec.inativarCliente = true;
    spec.principal.situacao = "inativar";
  }

  const outros = specs.filter((s) => !s.semDependentes && s.participantes.length === 0);
  const avulsos = outros.slice(0, TAMANHO.processosInativosAvulsos);
  for (const spec of avulsos) {
    spec.semDependentes = true;
    spec.inativar = true;
  }
  avulsos.slice(0, TAMANHO.processosReativados).forEach((s) => { s.reativar = true; });

  // ── Clientes que serão desativados por não terem processo ───────────────
  semProcesso.slice(0, TAMANHO.clientesInativosSemProcesso).forEach((c) => { c.situacao = "inativar"; });

  return { specs, comProcesso, semProcesso };
};

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 3 — PROCESSOS (createProcess, fases, trânsito, liminar)
// ═══════════════════════════════════════════════════════════════════════════

const criarProcessos = async (ctx, specs) => {
  const { uid, sorteio, log, tabelas } = ctx;
  const processos = mongoose.connection.collection("processes");
  let criados = 0;
  let vinculos = 0;
  let transicoes = 0;

  for (const [i, spec] of specs.entries()) {
    const { caso } = spec;

    const titulo = ate(
      spec.contraparte ? `${caso.titulo} — ${spec.contraparte}` : caso.titulo,
      190
    );
    const descricao = spec.contraparte
      ? `${caso.desc} Contraparte: ${spec.contraparte}.`
      : caso.desc;

    try {
      const participantes = [
        { clienteId: spec.principal.id, papel: spec.papelPrincipal, principal: true },
        ...spec.participantes.map((p) => ({ clienteId: p.cliente.id, papel: p.papel, principal: false }))
      ];

      const processo = await createProcess(uid, {
        clientes: participantes,
        titulo,
        numeroProcesso: spec.numeroProcesso,
        tipoAcao: caso.classe,
        area: caso.area,
        orgao: "Tribunal de Justiça do Paraná",
        vara: spec.vara,
        comarca: spec.comarca,
        status: spec.status,
        fase: "conhecimento",
        dataDistribuicao: spec.distribuicao,
        descricao,
        ...(sorteio.chance(0.35) ? { observacoes: sorteio.escolher(BR.NOTAS_INTERNAS) } : {})
      });

      spec.processo = processo;
      spec.id = String(processo._id);
      spec.principal.processos.push(spec);
      spec.participantes.forEach((p) => p.cliente.processos.push(spec));
      criados += 1;
      vinculos += participantes.length;

      // ── O caminho até a fase final, pelo serviço (grava o histórico) ─────
      const rota = caminhoDeFases(sorteio, spec.fase);
      for (const [passo, fase] of rota.entries()) {
        const motivos = MOTIVOS_FASE[fase] ?? [null];
        await mudarFase(uid, spec.id, { fase, motivo: sorteio.escolher(motivos) });
        transicoes += 1;
        if (passo > 8) break;
      }

      // ── Trânsito em julgado e liminar (campos comuns do PATCH) ───────────
      const datas = {
        transito: limitar(somarDias(spec.distribuicao, Math.floor(spec.vao * 0.9)), spec.distribuicao, somarDias(ctx.hoje, -1)),
        liminar: somarDias(spec.distribuicao, Math.max(1, Math.floor(spec.vao * 0.05)))
      };
      const alteracoes = {};
      if (spec.transito) {
        alteracoes.transitoEmJulgadoEm = datas.transito;
        alteracoes.motivoEncerramento = sorteio.escolher(BR.MOTIVOS_TRANSITO);
      }
      if (spec.liminar) {
        alteracoes.liminar = true;
        alteracoes.liminarEm = datas.liminar;
        if (sorteio.chance(0.6)) alteracoes.liminarObservacao = sorteio.escolher(BR.OBSERVACOES_LIMINAR);
      }
      if (Object.keys(alteracoes).length > 0) {
        await updateProcess(uid, spec.id, alteracoes);
      }

      // ── Retrodata (escrita direta — ver o cabeçalho) ─────────────────────
      const bruto = await processos.findOne({ _id: processo._id }, { projection: { historicoFase: 1 } });
      const entradas = bruto?.historicoFase ?? [];
      const definir = { createdAt: dataDe(spec.distribuicao) };
      entradas.forEach((_, posicao) => {
        const fracao = entradas.length > 1 ? (posicao / entradas.length) * 0.8 : 0;
        definir[`historicoFase.${posicao}.data`] = dataDe(somarDias(spec.distribuicao, Math.floor(spec.vao * fracao)));
      });
      await processos.updateOne({ _id: processo._id }, { $set: definir });
    } catch (erro) {
      ctx.falhas.push({ etapa: "processo", detalhe: `${spec.numeroProcesso}: ${erro.message}` });
    }

    if ((i + 1) % 50 === 0) log(`    … ${i + 1}/${specs.length} processos`);
  }

  log(`  ${criados} processos criados (${vinculos} vínculos processo-cliente, ${transicoes} mudanças de fase)`);
  return specs.filter((s) => s.processo);
};

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 4 — FINANCEIRO (honorário → parcelas → pagamentos → estornos →
//           reparcelamento → cancelamento, na ordem que as regras exigem)
// ═══════════════════════════════════════════════════════════════════════════

const FORMAS = Object.freeze([
  ["pix", 45], ["transferencia", 20], ["boleto", 12], ["dinheiro", 11], ["cartao_credito", 8], ["cartao_debito", 4]
]);

const MOTIVOS_ESTORNO = Object.freeze([
  "Boleto devolvido pelo banco", "Estorno de cartão solicitado pelo cliente", "Pagamento lançado em duplicidade",
  "Devolução acordada com o cliente", "Cheque devolvido por falta de fundos"
]);

const MOTIVOS_REPARCELAMENTO = Object.freeze([
  "Renegociação a pedido do cliente — fluxo de caixa", "Acordo para quitação em novas parcelas",
  "Cliente desempregado — novo prazo", "Reparcelamento após período de inadimplência"
]);

const PERFIS = Object.freeze([["bom", 62], ["atrasado", 16], ["parcial", 8], ["inadimplente", 14]]);

const descricaoDoHonorario = (tipo, spec, percentual) => {
  const acao = spec.caso.titulo.toLowerCase();
  if (tipo === "percentual") {
    return spec.caso.herdeiros
      ? `Honorários sobre o monte-mor (${percentual}%)`
      : `Honorários de êxito — ${percentual}% sobre o proveito econômico`;
  }
  if (tipo === "custas") {
    return ["Custas processuais iniciais", "Taxa judiciária e custas de distribuição", "Diligências e cópias", "Honorários do perito (repasse)"][
      Math.abs(spec.numeroProcesso.charCodeAt(3)) % 4
    ];
  }
  return ["Honorários advocatícios", "Honorários — entrada e parcelas", "Honorários — fase de conhecimento"][
    Math.abs(spec.numeroProcesso.charCodeAt(4)) % 3
  ] + ` — ${acao}`;
};

const planejarHonorarios = (ctx, spec) => {
  const { sorteio, hoje } = ctx;
  const quantidade = sorteio.ponderado([[0, 20], [1, 46], [2, 24], [3, 10]]);
  const fees = [];

  for (let k = 0; k < quantidade; k += 1) {
    const tipo = sorteio.ponderado([
      ["fixo", 72 - (spec.caso.percentual ? 15 : 0)],
      ["percentual", 20 + (spec.caso.percentual ? 15 : 0)],
      ["custas", 8]
    ]);
    const [faixaMin, faixaMax] = spec.caso.faixa;
    const criadoEm = limitar(
      somarDias(hoje, -sorteio.inteiro(15, 440)),
      somarDias(spec.distribuicao, 2),
      somarDias(hoje, -12)
    );

    const fee = {
      tipo, criadoEm, perfil: sorteio.ponderado(PERFIS), papel: null,
      // "Antigo" = as primeiras parcelas já venceram e houve tempo de pagar.
      antigo: diasEntre(criadoEm, hoje) > 150
    };

    if (tipo === "percentual") {
      fee.percentual = sorteio.escolher([10, 15, 20, 25, 30]);
      fee.valorBase = sorteio.inteiro(120, 3500) * 100;
    } else if (tipo === "custas") {
      fee.valor = sorteio.inteiro(180, 2400);
    } else {
      fee.valor = Math.round(sorteio.inteiro(faixaMin, faixaMax) / 50) * 50;
    }

    fee.descricao = descricaoDoHonorario(tipo, spec, fee.percentual);
    fee.parcelas = tipo === "custas"
      ? sorteio.ponderado([[0, 25], [1, 75]])
      : tipo === "percentual"
        ? sorteio.ponderado([[0, 40], [1, 40], [2, 15], [3, 5]])
        : sorteio.ponderado([[0, 6], [1, 22], [2, 15], [3, 18], [4, 10], [6, 14], [8, 6], [10, 5], [12, 4]]);
    fees.push(fee);
  }

  return fees;
};

// Atribui a cada honorário o "papel" especial que a base precisa ter. Sorteio
// SEM reposição sobre o conjunto elegível, e a contagem sai do relatório.
const atribuirPapeis = (ctx, todos) => {
  const { sorteio } = ctx;
  const livres = (predicado) => todos.filter((f) => f.papel === null && predicado(f));
  const marcar = (papel, quantidade, predicado) => {
    const candidatos = sorteio.embaralhar(livres(predicado)).slice(0, quantidade);
    candidatos.forEach((f) => { f.papel = papel; });
    return candidatos.length;
  };

  const resultado = {};
  // Reparcelamento: só onde SOBRA saldo em aberto garantido — plano de 3+
  // parcelas de honorário fixo, de quem parou de pagar nas primeiras.
  resultado.reparcelamento = marcar("reparcelamento", 7, (f) => f.tipo === "fixo" && f.parcelas >= 3 && f.perfil === "inadimplente");
  resultado.saldoSemParcelas = marcar("saldoSemParcelas", 2, (f) => f.tipo === "fixo" && f.parcelas === 0);
  resultado.adiantamento = marcar("adiantamento", 5, (f) => f.tipo === "fixo" && f.parcelas >= 2);
  resultado.sobra = marcar("sobra", 4, (f) => f.tipo === "fixo" && f.parcelas >= 2 && f.perfil === "inadimplente");
  // Estorno só onde já houve pagamento: honorário fixo, de valor que comporte um
  // pagamento de 300+, criado há tempo suficiente para as parcelas terem vencido.
  const comHistorico = (f) => f.tipo === "fixo" && f.valor >= 1500 && f.parcelas >= 2 && f.antigo && f.perfil === "bom";
  resultado.anulacao = marcar("anulacao", 2, comHistorico);
  resultado.estornoTotal = marcar("estornoTotal", 3, comHistorico);
  resultado.estornoParcial = marcar("estornoParcial", 6, (f) => f.tipo === "fixo" && f.valor >= 1500 && f.parcelas >= 2 && f.antigo && ["bom", "atrasado"].includes(f.perfil));
  resultado.cancelar = marcar("cancelar", 8, (f) => f.parcelas >= 1 && f.perfil !== "inadimplente");
  return resultado;
};

// Pagamentos históricos de uma parcela, de acordo com o perfil de quem paga.
const planejarPagamentos = (ctx, fee, parcelas) => {
  const { sorteio, hoje } = ctx;
  const pagamentos = [];
  const limitePago = (data) => limitar(data, fee.criadoEm, hoje);

  const nInadimplente = fee.perfil === "inadimplente" ? sorteio.inteiro(0, 2) : Infinity;
  const parcialEm = fee.perfil === "parcial"
    ? sorteio.inteiro(0, Math.max(parcelas.filter((p) => !antes(hoje, p.vencimento)).length - 1, 0))
    : -1;

  parcelas.forEach((p, posicao) => {
    if (antes(hoje, p.vencimento)) return;   // ainda não venceu: nada a pagar

    let dataPagamento = null;
    let valor = p.valor;

    if (fee.perfil === "bom") dataPagamento = somarDias(p.vencimento, sorteio.inteiro(-3, 5));
    else if (fee.perfil === "atrasado") dataPagamento = somarDias(p.vencimento, sorteio.inteiro(15, 75));
    else if (fee.perfil === "parcial") {
      dataPagamento = somarDias(p.vencimento, sorteio.inteiro(-2, 8));
      if (posicao === parcialEm) valor = Math.max(1, Math.round(p.valor * sorteio.escolher([0.4, 0.5, 0.6, 0.7])));
    } else if (fee.perfil === "inadimplente" && posicao < nInadimplente) {
      dataPagamento = somarDias(p.vencimento, sorteio.inteiro(-2, 6));
    }

    if (!dataPagamento || antes(hoje, dataPagamento)) return;   // atrasou além de hoje: continua vencida
    pagamentos.push({ data: limitePago(dataPagamento), valor });
  });

  // Às vezes o cliente paga duas parcelas de uma vez — o caso que a DEC-035
  // existe para tratar (um pagamento, duas alocações).
  const fundidos = [];
  for (let i = 0; i < pagamentos.length; i += 1) {
    const atual = pagamentos[i];
    const proximo = pagamentos[i + 1];
    if (proximo && sorteio.chance(0.12)) {
      fundidos.push({ data: proximo.data, valor: emReais(emCentavos(atual.valor) + emCentavos(proximo.valor)) });
      i += 1;
    } else {
      fundidos.push(atual);
    }
  }

  return fundidos
    .sort((a, b) => dataDe(a.data).getTime() - dataDe(b.data).getTime())
    .map((p) => ({ ...p, forma: sorteio.ponderado(FORMAS) }));
};

const financeiroDoProcesso = async (ctx, spec) => {
  const { uid, sorteio, hoje } = ctx;
  const fees = spec.honorarios;
  const dados = { fees: 0, parcelas: 0, pagamentos: 0, estornos: 0, anulacoes: 0, reparcelamentos: 0, cancelados: 0 };
  spec.feesCriados = [];

  for (const fee of fees) {
    try {
      // 1. O honorário
      const parcelasPrevistas = fee.parcelas;
      const primeiroVencimento = somarDias(fee.criadoEm, sorteio.inteiro(10, 45));
      const vencimentoDoHonorario = parcelasPrevistas > 0
        ? somarMeses(primeiroVencimento, parcelasPrevistas - 1)
        : somarDias(fee.criadoEm, sorteio.inteiro(30, 90));

      const criado = await feeService.createFee(uid, {
        processoId: spec.id,
        descricao: fee.descricao,
        tipo: fee.tipo,
        ...(fee.tipo === "percentual" ? { percentual: fee.percentual, valorBase: fee.valorBase } : { valor: fee.valor }),
        dataVencimento: vencimentoDoHonorario
      });
      dados.fees += 1;

      await mongoose.connection.collection("fees").updateOne(
        { _id: criado._id },
        { $set: { createdAt: dataDe(fee.criadoEm) } }
      );

      const feeId = String(criado._id);
      const valorEmCentavos = emCentavos(criado.valor);
      const registrados = [];

      const pagar = async (pagamento) => {
        const { pagamento: gravado } = await criarPayment({
          honorarioId: feeId,
          valor: pagamento.valor,
          data: pagamento.data,
          tipo: pagamento.tipo ?? "comum",
          formaPagamento: pagamento.forma ?? sorteio.ponderado(FORMAS),
          observacoes: pagamento.observacoes ?? ""
        }, uid);
        dados.pagamentos += 1;
        registrados.push(gravado);
        return gravado;
      };

      // 2. Adiantamento ANTES das parcelas (DEC-036): vira saldo adiantado e, se
      //    houver plano, é auto-alocado quando as parcelas nascem.
      if (["adiantamento", "saldoSemParcelas"].includes(fee.papel)) {
        const parte = emReais(Math.round(valorEmCentavos * sorteio.escolher([0.2, 0.25, 0.3, 0.4]) / 100) * 100);
        await pagar({
          valor: parte, data: limitar(somarDias(fee.criadoEm, 2), fee.criadoEm, hoje), tipo: "adiantamento",
          forma: "pix", observacoes: "Adiantamento por conta dos honorários"
        });
      }

      // 3. Parcelas
      const parcelas = [];
      if (parcelasPrevistas > 0) {
        const partes = dividirEmParcelas(valorEmCentavos, parcelasPrevistas);
        partes.forEach((centavos, k) => {
          parcelas.push({ numeroParcela: k + 1, valor: emReais(centavos), vencimento: somarMeses(primeiroVencimento, k) });
        });
        await criarPlanoDeParcelas(uid, feeId, parcelas.map((p) => ({
          numeroParcela: p.numeroParcela, valor: p.valor, dataVencimento: p.vencimento
        })));
        dados.parcelas += parcelas.length;
      }

      // 4. Pagamentos históricos, em ordem cronológica (o motor aloca do
      //    vencimento mais antigo em diante).
      const historicos = planejarPagamentos(ctx, fee, parcelas);
      if (fee.papel === "adiantamento" && historicos.length > 0) {
        // O adiantamento já cobriu parte da primeira parcela: o primeiro
        // pagamento é o que RESTA. Sem isso a base ganharia crédito indevido em
        // toda linha que tem adiantamento, e o "saldo adiantado" — que existe
        // em poucos casos de propósito — deixaria de ser exceção.
        const jaAdiantado = registrados.reduce((soma, p) => soma + emCentavos(p.valor), 0);
        const restante = emCentavos(historicos[0].valor) - jaAdiantado;
        if (restante > 0) historicos[0].valor = emReais(restante);
        else historicos.shift();
      }
      for (const pagamento of historicos) {
        await pagar({ ...pagamento, observacoes: sorteio.chance(0.25) ? "Comprovante enviado por WhatsApp" : "" });
      }

      // 4b. A SOBRA: quita o que resta e ainda passa 300–800 — vira crédito.
      if (fee.papel === "sobra") {
        // O que falta para quitar o honorário inteiro, contado do que foi gravado.
        const emAbertoCentavos = Math.max(
          valorEmCentavos - registrados.reduce((soma, p) => soma + emCentavos(p.valor), 0),
          0
        );
        if (emAbertoCentavos > 0) {
          await pagar({
            valor: emReais(emAbertoCentavos + sorteio.inteiro(3, 8) * 100),
            data: somarDias(hoje, -sorteio.inteiro(2, 9)), forma: "transferencia",
            observacoes: "Quitação antecipada — valor acima do devido"
          });
        }
      }

      // 5. Estornos (desalocam em ordem espelhada) e a anulação
      const comValor = registrados.filter((p) => p.valor >= 300 && p.tipo !== "adiantamento");
      const alvo = comValor.length > 0 ? sorteio.escolher(comValor) : null;
      if (alvo && ["estornoTotal", "estornoParcial", "anulacao"].includes(fee.papel)) {
        const total = fee.papel !== "estornoParcial";
        const valorDoEstorno = total ? alvo.valor : emReais(Math.floor(emCentavos(alvo.valor) * sorteio.escolher([0.3, 0.4, 0.5, 0.6]) / 100) * 100);
        const dataDoEstorno = limitar(somarDias(escreverDataDeCalendario(alvo.data), sorteio.inteiro(3, 20)), fee.criadoEm, hoje);

        const { estorno, desalocacao } = await criarEstorno(String(alvo._id), {
          valor: valorDoEstorno, motivo: sorteio.escolher(MOTIVOS_ESTORNO), data: dataDoEstorno
        }, uid);
        await recalcularParcelas(desalocacao?.parcelasAfetadas ?? [], uid);
        dados.estornos += 1;

        if (fee.papel === "anulacao") {
          const { desalocacao: realocacao } = await criarEstorno(String(alvo._id), {
            estornoAnuladoId: String(estorno._id),
            motivo: "Estorno lançado por engano — valor mantido",
            data: limitar(somarDias(dataDoEstorno, sorteio.inteiro(2, 8)), fee.criadoEm, hoje)
          }, uid);
          await recalcularParcelas(realocacao?.parcelasAfetadas ?? [], uid);
          dados.anulacoes += 1;
        }
      }

      // 6. Reparcelamento — o plano novo soma EXATAMENTE o saldo em aberto
      if (fee.papel === "reparcelamento") {
        const doc = await Fee.findById(criado._id);
        const saldo = await saldoEmAberto(doc, uid);
        if (saldo > 0) {
          const n = sorteio.inteiro(2, 5);
          const partes = dividirEmParcelas(emCentavos(saldo), n);
          const inicio = somarDias(hoje, sorteio.inteiro(10, 30));
          await criarReparcelamento(feeId, {
            data: somarDias(hoje, -sorteio.inteiro(3, 25)),
            motivo: sorteio.escolher(MOTIVOS_REPARCELAMENTO),
            parcelas: partes.map((c, k) => ({ valor: emReais(c), dataVencimento: somarMeses(inicio, k) }))
          }, uid);
          dados.reparcelamentos += 1;
        }
      }

      // 7. Cancelamento explícito — sempre por último (honorário cancelado
      //    recusa pagamento com 409).
      if (fee.papel === "cancelar") {
        await feeService.updateFee(feeId, uid, { status: "cancelado" });
        dados.cancelados += 1;
      }

      spec.feesCriados.push({ id: feeId, tipo: fee.tipo, cancelado: fee.papel === "cancelar" });
    } catch (erro) {
      ctx.falhas.push({ etapa: "financeiro", detalhe: `${spec.numeroProcesso} / ${fee.descricao}: ${erro.message}` });
    }
  }

  return dados;
};

const criarFinanceiro = async (ctx, especificacoes) => {
  const { log, sorteio } = ctx;

  // Planeja TODOS os honorários antes de gravar qualquer um, para poder
  // distribuir os papéis especiais (estorno, reparcelamento, saldo…) pela base.
  const elegiveis = especificacoes.filter((s) => !s.semDependentes);
  const todos = [];
  for (const spec of elegiveis) {
    spec.honorarios = planejarHonorarios(ctx, spec);
    todos.push(...spec.honorarios);
  }
  const papeis = atribuirPapeis(ctx, todos);

  const total = { fees: 0, parcelas: 0, pagamentos: 0, estornos: 0, anulacoes: 0, reparcelamentos: 0, cancelados: 0 };
  for (const [i, spec] of elegiveis.entries()) {
    const dados = await financeiroDoProcesso(ctx, spec);
    for (const chave of Object.keys(total)) total[chave] += dados[chave];
    if ((i + 1) % 50 === 0) log(`    … ${i + 1}/${elegiveis.length} processos com financeiro`);
  }

  void sorteio;
  log(`  ${total.fees} honorários, ${total.parcelas} parcelas, ${total.pagamentos} pagamentos`);
  log(`  ${total.estornos} estornos (${total.anulacoes} anulados), ${total.reparcelamentos} reparcelamentos, ${total.cancelados} honorários cancelados`);
  log(`  papéis especiais distribuídos: ${Object.entries(papeis).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  return { ...total, papeis };
};

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 5 — EVENTOS DA AGENDA (todos os tipos, passado e futuro)
// ═══════════════════════════════════════════════════════════════════════════

const criarEventos = async (ctx, especificacoes) => {
  const { uid, sorteio, hoje, log } = ctx;
  const ativos = especificacoes.filter((s) => !s.semDependentes && s.processo);
  let criados = 0;
  let concluidos = 0;
  let atrasados = 0;
  let soltos = 0;
  const porTipo = { audiencia: 0, prazo: 0, reuniao: 0, outro: 0 };

  const dias = [];
  for (let i = 0; i < TAMANHO.eventos; i += 1) {
    dias.push(sorteio.ponderado([
      [() => -sorteio.inteiro(1, 200), 45],
      [() => 0, 4],
      [() => sorteio.inteiro(1, 200), 51]
    ])());
  }

  // Quais eventos do passado ficam SEM concluir (o sino conta como atrasados).
  const passados = dias.map((d, i) => [d, i]).filter(([d]) => d < 0).map(([, i]) => i);
  const atrasadosIndices = new Set(sorteio.embaralhar(passados).slice(0, TAMANHO.atrasadosNaoConcluidos));

  const HORAS = ["09:00", "09:30", "10:00", "13:30", "14:00", "15:00", "16:30"];

  for (let i = 0; i < dias.length; i += 1) {
    const tipo = sorteio.ponderado([["audiencia", 35], ["prazo", 30], ["reuniao", 22], ["outro", 13]]);
    const spec = sorteio.chance(0.72) ? sorteio.escolher(ativos) : null;
    const nome = spec ? primeiroNome(spec.principal.nome) : null;

    let titulo;
    let local = null;
    let hora = null;
    if (tipo === "audiencia") {
      titulo = `Audiência ${sorteio.escolher(["de conciliação", "de instrução e julgamento", "de mediação", "preliminar"])}`;
      hora = sorteio.escolher(HORAS);
      local = spec ? `${spec.vara} de ${spec.comarca}` : "Fórum";
    } else if (tipo === "prazo") {
      titulo = `Prazo para ${sorteio.escolher(["manifestação", "contestação", "réplica", "recurso de apelação", "contrarrazões", "juntada de documentos", "cumprimento de sentença"])}`;
    } else if (tipo === "reuniao") {
      titulo = nome ? `Reunião com ${nome}` : `Reunião de captação — ${sorteio.escolher(["indicação", "atendimento inicial", "orçamento"])}`;
      hora = sorteio.escolher(HORAS);
      local = sorteio.escolher(["Escritório", "Videoconferência", "Café do centro"]);
    } else {
      titulo = sorteio.escolher(["Protocolar petição", "Retirar certidão no cartório", "Diligência no fórum", "Pagar custas", "Enviar documentos ao perito"]);
      if (sorteio.chance(0.3)) hora = sorteio.escolher(HORAS);
    }

    const soloOk = tipo === "reuniao" || tipo === "outro";
    const processoDoEvento = spec ?? (soloOk ? null : sorteio.escolher(ativos));

    try {
      const evento = await criarEvento(uid, {
        tipo,
        titulo: ate(processoDoEvento && tipo !== "reuniao" ? `${titulo} — ${processoDoEvento.caso.titulo}` : titulo, 190),
        data: somarDias(hoje, dias[i]),
        hora,
        local,
        descricao: sorteio.chance(0.25) ? "Anotação da advogada." : null,
        processoId: processoDoEvento ? processoDoEvento.id : null
      });
      criados += 1;
      porTipo[tipo] += 1;
      if (!processoDoEvento) soltos += 1;

      if (dias[i] < 0 && !atrasadosIndices.has(i)) {
        await concluirEvento(uid, evento._id, { concluido: true });
        concluidos += 1;
      } else if (dias[i] < 0) {
        atrasados += 1;
      }
    } catch (erro) {
      ctx.falhas.push({ etapa: "evento", detalhe: `${titulo}: ${erro.message}` });
    }
  }

  log(`  ${criados} eventos (${Object.entries(porTipo).map(([k, v]) => `${k}=${v}`).join(", ")}); ` +
      `${concluidos} concluídos, ${atrasados} atrasados, ${soltos} soltos`);
  return { criados, porTipo, concluidos, atrasados, soltos };
};

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 6 — DOCUMENTOS GERADOS (procurações e contratos, pelo serviço real)
// ═══════════════════════════════════════════════════════════════════════════

const criarDocumentos = async (ctx, especificacoes, modelos) => {
  const { uid, sorteio, log } = ctx;
  const gerados = [];
  let recusados = 0;
  const elegiveis = sorteio.embaralhar(especificacoes.filter((s) => !s.semDependentes && s.processo));

  const gerar = async (modelo, spec, extras = {}) => {
    try {
      const doc = await gerarDocumentoService(modelo._id, uid, { processoId: spec.id, ...extras });
      gerados.push({ doc, spec });
      return doc;
    } catch (erro) {
      // 422 = cadastro incompleto do cliente (uma lacuna intencional, como a da
      // Beatriz no seed curado). Não é falha do seed: é o estado que a tela
      // "pendência" existe para mostrar.
      if (erro?.statusCode === 422 || erro?.statusCode === 409) { recusados += 1; return null; }
      throw erro;
    }
  };

  let feitasProcuracao = 0;
  for (const spec of elegiveis) {
    if (feitasProcuracao >= TAMANHO.procuracoes) break;
    if (!spec.principal.completo) continue;
    const modelo = spec.principal.ehPJ ? modelos.procuracao_pj : modelos.procuracao;
    if (await gerar(modelo, spec)) feitasProcuracao += 1;
  }

  let feitosContrato = 0;
  for (const spec of elegiveis) {
    if (feitosContrato >= TAMANHO.contratos) break;
    const vigentes = spec.feesCriados?.filter((f) => !f.cancelado) ?? [];
    if (vigentes.length !== 1 || !spec.principal.completo || spec.principal.ehPJ) continue;

    const fee = vigentes[0];
    const modelo = fee.tipo === "percentual" && sorteio.chance(0.6) ? modelos.contrato_exito : modelos.contrato;
    if (await gerar(modelo, spec, { honorarioId: fee.id })) feitosContrato += 1;
  }

  // Alguns documentos editados à mão (a advogada ajusta o texto final).
  const editaveis = sorteio.embaralhar(gerados).slice(0, TAMANHO.editadosAMao);
  for (const { doc } of editaveis) {
    await atualizarTextoService(doc._id, uid, `${doc.textoResolvido}\n\nObservação incluída pela advogada após conferência com o cliente.`);
  }

  log(`  ${gerados.length} documentos gerados (${feitasProcuracao} procurações, ${feitosContrato} contratos), ` +
      `${editaveis.length} editados à mão, ${recusados} recusados por cadastro incompleto`);
  return { gerados, editados: editaveis.length, recusados };
};

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 7 — PORTAL (acesso, senha e confirmações de leitura)
// ═══════════════════════════════════════════════════════════════════════════

const configurarPortal = async (ctx, clientes, documentos) => {
  const { uid, sorteio, hoje, log } = ctx;

  const elegiveis = sorteio.embaralhar(
    clientes.filter((c) => c.situacao === "ativo" && c.processos.some((p) => !p.inativar))
  );
  // Quem tem procuração gerada aparece primeiro entre os de senha própria: é o
  // que faz o portal ter documento para mostrar.
  const comDocumento = new Set(documentos.gerados.map(({ spec }) => spec.principal.id));
  const ordenados = [
    ...elegiveis.filter((c) => comDocumento.has(c.id)),
    ...elegiveis.filter((c) => !comDocumento.has(c.id))
  ];

  const propria = ordenados.slice(0, TAMANHO.portalPropria);
  const provisoria = ordenados.slice(TAMANHO.portalPropria, TAMANHO.portalPropria + TAMANHO.portalProvisoria);

  const hashPropria = await bcrypt.hash(SENHA_PROPRIA, 10);
  const hashProvisoria = await bcrypt.hash(SENHA_PROVISORIA, 10);

  for (const cliente of provisoria) {
    await Client.updateOne({ _id: cliente.doc._id }, {
      $set: { senhaPortalHash: hashProvisoria, senhaPortalProvisoria: true, senhaPortalDefinidaEm: null }
    });
    cliente.portal = "provisoria";
  }

  let confirmacoes = 0;
  const comConfirmacao = new Set(propria.slice(0, TAMANHO.portalComConfirmacao).map((c) => c.id));

  for (const cliente of propria) {
    const definidaEm = dataDe(somarDias(hoje, -sorteio.inteiro(5, 120)));
    await Client.updateOne({ _id: cliente.doc._id }, {
      $set: { senhaPortalHash: hashPropria, senhaPortalProvisoria: false, senhaPortalDefinidaEm: definidaEm }
    });
    cliente.portal = "propria";

    // Cada procuração do cliente passa a valer no portal (visibilidade pelo serviço).
    const docsDoCliente = documentos.gerados.filter(({ doc }) => String(doc.clienteId) === cliente.id);
    for (const { doc } of docsDoCliente) {
      await alternarVisibilidadePortalService(doc._id, uid, true);
    }

    const vinculos = await ProcessoCliente.find({ usuarioId: uid, clienteId: cliente.doc._id, ativo: true });
    for (const vinculo of vinculos) {
      const primeiro = new Date(definidaEm.getTime() + sorteio.inteiro(1, 20) * MS_DIA);
      const ultimo = new Date(Math.min(primeiro.getTime() + sorteio.inteiro(0, 40) * MS_DIA, Date.now() - MS_DIA));
      const set = { primeiroAcessoPortal: primeiro, ultimoAcessoPortal: ultimo };

      if (comConfirmacao.has(cliente.id)) {
        const visiveis = await Document.find({
          usuarioId: uid, processoId: vinculo.processoId, clienteId: cliente.doc._id,
          origem: "gerado", visivelPortal: true, ativo: true
        }).select("_id");
        const processo = await Process.findById(vinculo.processoId).select("status");

        await ConfirmacaoVisualizacao.create({
          usuarioId: uid,
          processoClienteId: vinculo._id,
          processoId: vinculo.processoId,
          clienteId: cliente.doc._id,
          dataHora: ultimo,
          textoConfirmado: TEXTO_CONFIRMACAO,
          instantaneo: {
            statusProcesso: processo?.status ?? "ativo",
            documentosVisiveis: visiveis.map((d) => d._id),
            quantidadeDocumentos: visiveis.length
          },
          vistaPelaAdvogada: sorteio.chance(0.6),
          ativo: true
        });
        set.ultimaConfirmacaoEm = ultimo;
        confirmacoes += 1;
      }

      await ProcessoCliente.updateOne({ _id: vinculo._id }, { $set: set });
    }
  }

  // Os códigos de acesso, para quem vai entrar no portal durante a revisão.
  const acessos = [];
  for (const cliente of [...propria, ...provisoria]) {
    const vinculos = await ProcessoCliente.find({ usuarioId: uid, clienteId: cliente.doc._id, ativo: true })
      .select("codigoAcesso").sort({ principal: -1 });
    acessos.push({ nome: cliente.nome, estado: cliente.portal, codigos: vinculos.map((v) => v.codigoAcesso) });
  }

  log(`  ${propria.length} clientes com senha própria, ${provisoria.length} com senha provisória, ${confirmacoes} confirmações de leitura`);
  return { propria: propria.length, provisoria: provisoria.length, confirmacoes, acessos };
};

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 8 — DESATIVAÇÕES E REATIVAÇÕES (pelos serviços, com histórico)
// ═══════════════════════════════════════════════════════════════════════════

const desativar = async (ctx, clientes, especificacoes) => {
  const { uid, log } = ctx;
  let processosInativados = 0;
  let clientesInativados = 0;
  let reativados = 0;

  // Processos primeiro: a desativação do processo derruba os vínculos, e é isso
  // que libera o cliente para ser desativado (a rigidez de `deleteClient`).
  for (const spec of especificacoes.filter((s) => s.inativar)) {
    try {
      await deleteProcess(uid, spec.id);
      processosInativados += 1;
    } catch (erro) {
      ctx.falhas.push({ etapa: "desativar-processo", detalhe: `${spec.numeroProcesso}: ${erro.message}` });
    }
  }

  for (const cliente of clientes.filter((c) => c.situacao === "inativar")) {
    try {
      await clientService.deleteClient(uid, cliente.id);
      cliente.situacao = "inativo";
      clientesInativados += 1;
    } catch (erro) {
      ctx.falhas.push({ etapa: "desativar-cliente", detalhe: `${cliente.nome}: ${erro.message}` });
    }
  }

  // Dois processos voltam — a base passa a ter um histórico de desativação E de
  // reativação, e a tela "Reativar" tem o caso completo.
  for (const spec of especificacoes.filter((s) => s.reativar)) {
    try {
      await reactivateProcess(uid, spec.id);
      reativados += 1;
    } catch (erro) {
      ctx.falhas.push({ etapa: "reativar-processo", detalhe: `${spec.numeroProcesso}: ${erro.message}` });
    }
  }

  log(`  ${processosInativados} processos desativados (${reativados} reativados depois), ${clientesInativados} clientes desativados`);
  return { processosInativados, clientesInativados, reativados };
};

// ═══════════════════════════════════════════════════════════════════════════
// O RESUMO — lido do BANCO, e não das constantes
// ═══════════════════════════════════════════════════════════════════════════

const contar = async (Model, uid, filtro = {}) => Model.countDocuments({ usuarioId: uid, ...filtro });

const agrupar = async (Model, uid, campo, filtro = {}) => {
  const linhas = await Model.aggregate([
    { $match: { usuarioId: uid, ...filtro } },
    { $group: { _id: `$${campo}`, n: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  return Object.fromEntries(linhas.map((l) => [String(l._id), l.n]));
};

const resumir = async (uid) => {
  const [
    clientes, clientesInativos, clientesPJ, clientesComPortal,
    processos, processosInativos, comTransito, comLiminar, vinculos,
    fees, parcelas, pagamentos, alocacoes, alocacoesDesfeitas, estornos, anulacoes, reparcelamentos,
    eventos, documentos, docsPortal, feesComSaldo, canceladasComVinculo
  ] = await Promise.all([
    contar(Client, uid, { ativo: true }), contar(Client, uid, { ativo: false }),
    contar(Client, uid, { tipoPessoa: "juridica" }), contar(Client, uid, { senhaPortalHash: { $ne: null } }),
    contar(Process, uid, { ativo: true }), contar(Process, uid, { ativo: false }),
    contar(Process, uid, { ativo: true, transitoEmJulgadoEm: { $ne: null } }),
    contar(Process, uid, { ativo: true, liminar: true }),
    contar(ProcessoCliente, uid, { ativo: true }),
    contar(Fee, uid, { ativo: true }), contar(Installment, uid, { ativo: true }), contar(Payment, uid, { ativo: true }),
    contar(Allocation, uid), contar(Allocation, uid, { estornoId: { $ne: null } }),
    contar(Reversal, uid), contar(Reversal, uid, { tipo: "anulacao" }), contar(Renegotiation, uid),
    contar(Event, uid, { ativo: true }), contar(Document, uid, { ativo: true, ehModelo: false, origem: "gerado" }),
    contar(Document, uid, { ativo: true, visivelPortal: true }),
    contar(Fee, uid, { ativo: true, saldoAdiantado: { $gt: 0 } }),
    contar(Installment, uid, { reparcelamentoId: { $ne: null } })
  ]);

  const [fasesProcesso, statusProcesso, tiposFee, statusFee, statusParcela, tiposPagamento, tiposEvento, papeis] = await Promise.all([
    agrupar(Process, uid, "fase", { ativo: true }), agrupar(Process, uid, "status", { ativo: true }),
    agrupar(Fee, uid, "tipo", { ativo: true }), agrupar(Fee, uid, "status", { ativo: true }),
    agrupar(Installment, uid, "status", { ativo: true }), agrupar(Payment, uid, "tipo", { ativo: true }),
    agrupar(Event, uid, "tipo", { ativo: true }), agrupar(ProcessoCliente, uid, "papel", { ativo: true })
  ]);

  const litisconsorcio = (await ProcessoCliente.aggregate([
    { $match: { usuarioId: uid, ativo: true } },
    { $group: { _id: "$processoId", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: "n" }
  ]))[0]?.n ?? 0;

  return {
    clientes, clientesInativos, clientesPJ, clientesComPortal,
    processos, processosInativos, comTransito, comLiminar, vinculos, litisconsorcio,
    fasesProcesso, statusProcesso, papeis,
    fees, tiposFee, statusFee, parcelas, statusParcela, pagamentos, tiposPagamento,
    alocacoes, alocacoesDesfeitas, estornos, anulacoes, reparcelamentos, feesComSaldo, canceladasComVinculo,
    eventos, tiposEvento, documentos, docsPortal
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// O PONTO DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════

export const gerarVolume = async ({
  uid, hoje, tabelas, modelos, semente = SEMENTE_PADRAO, cpfsExistentes = [], cnpjsExistentes = [], log = console.log
}) => {
  const ctx = {
    uid, hoje, tabelas, log,
    sorteio: criarSorteio(semente),
    falhas: [],
    nomesUsados: new Set(),
    cpfsUsados: new Set(cpfsExistentes),
    cnpjsUsados: new Set(cnpjsExistentes),
    profissoes: BR.PROFISSOES_CANDIDATAS.filter((p) => tabelas.temProfissao(p))
  };

  // Conferência ANTES de gravar qualquer coisa: cada nome do catálogo precisa
  // existir na tabela de domínio, senão o volume "realista" sugeriria uma
  // classe que a tela não conhece.
  const ausentes = [
    ...BR.CASOS.flatMap((c) => [tabelas.temClasse(c.classe) ? null : `classe "${c.classe}"`, tabelas.temAssuntoRaiz(c.area) ? null : `assunto "${c.area}"`]),
    ...COMARCAS_PESOS.map(([nome]) => (tabelas.temComarca(nome) ? null : `comarca "${nome}"`))
  ].filter(Boolean);
  if (ausentes.length > 0) {
    throw new Error(`O catálogo do volume cita nomes que não estão nas tabelas de domínio: ${[...new Set(ausentes)].join("; ")}`);
  }
  if (ctx.profissoes.length < 15) {
    throw new Error("Poucas profissões do catálogo existem na tabela CBO — o volume ficaria repetitivo.");
  }

  const inicio = Date.now();
  const etapa = (nome) => log(`\n▶ ${nome}`);

  etapa("Clientes");
  const clientes = await criarClientes(ctx);

  etapa("Planejando processos");
  const plano = planejarProcessos(ctx, clientes);
  log(`  ${plano.specs.length} processos planejados para ${plano.comProcesso.length} clientes (${plano.semProcesso.length} ficam sem processo)`);

  etapa("Processos");
  const especificacoes = await criarProcessos(ctx, plano.specs);

  etapa("Financeiro");
  const financeiro = await criarFinanceiro(ctx, especificacoes);

  etapa("Agenda");
  const agenda = await criarEventos(ctx, especificacoes);

  etapa("Documentos");
  const documentos = await criarDocumentos(ctx, especificacoes, modelos);

  etapa("Portal do cliente");
  const portal = await configurarPortal(ctx, clientes, documentos);

  etapa("Desativações e reativações");
  const desativacoes = await desativar(ctx, clientes, especificacoes);

  const resumo = await resumir(uid);

  return { resumo, financeiro, agenda, documentos, portal, desativacoes, falhas: ctx.falhas, segundos: Math.round((Date.now() - inicio) / 1000) };
};

export default gerarVolume;

// ═══════════════════════════════════════════════════════════════════════════
// O RELATÓRIO DO VOLUME (impresso no fim do seed)
// ═══════════════════════════════════════════════════════════════════════════

const fmt = (objeto) => Object.entries(objeto).map(([k, v]) => `${k}=${v}`).join("  ");

export const imprimirResumoDoVolume = (volume, log = console.log) => {
  const { resumo: r, financeiro: f, agenda, documentos, portal, desativacoes, falhas, segundos } = volume;
  const L = "=".repeat(66);
  const linha = "-".repeat(66);

  log(`\n${L}\n  VOLUME — O QUE FOI CRIADO (lido do banco)   [${segundos}s]\n${L}`);
  log(`  Clientes            : ${r.clientes} ativos + ${r.clientesInativos} inativos   (PJ: ${r.clientesPJ}; com portal: ${r.clientesComPortal})`);
  log(`  Processos           : ${r.processos} ativos + ${r.processosInativos} inativos`);
  log(`    por fase          : ${fmt(r.fasesProcesso)}`);
  log(`    por status        : ${fmt(r.statusProcesso)}`);
  log(`    trânsito em julgado: ${r.comTransito}     com liminar: ${r.comLiminar}     litisconsórcio: ${r.litisconsorcio}`);
  log(`  Vínculos proc-cli   : ${r.vinculos}   ${fmt(r.papeis)}`);
  log(linha);
  log(`  Honorários          : ${r.fees}   tipos: ${fmt(r.tiposFee)}`);
  log(`    status            : ${fmt(r.statusFee)}`);
  log(`  Parcelas            : ${r.parcelas}   ${fmt(r.statusParcela)}`);
  log(`  Pagamentos          : ${r.pagamentos}   ${fmt(r.tiposPagamento)}`);
  log(`  Alocações           : ${r.alocacoes}  (${r.alocacoesDesfeitas} desfeitas por estorno)`);
  log(`  Estornos            : ${r.estornos}  (${r.anulacoes} anulações)`);
  log(`  Reparcelamentos     : ${r.reparcelamentos}  (${r.canceladasComVinculo} parcelas canceladas com vínculo)`);
  log(`  Honorários com saldo adiantado vivo: ${r.feesComSaldo}`);
  log(`    papéis especiais  : ${fmt(f.papeis)}`);
  log(linha);
  log(`  Eventos             : ${r.eventos}   ${fmt(r.tiposEvento)}`);
  log(`    ${agenda.concluidos} concluídos, ${agenda.atrasados} atrasados (contam no sino), ${agenda.soltos} soltos, sem processo`);
  log(`  Documentos gerados  : ${r.documentos}  (${documentos.editados} editados à mão, ${documentos.recusados} recusados por cadastro incompleto)`);
  log(`  Visíveis no portal  : ${r.docsPortal}`);
  log(linha);
  log(`  Desativações        : ${desativacoes.processosInativados} processos (${desativacoes.reativados} reativados depois), ${desativacoes.clientesInativados} clientes`);
  log(`  Portal              : ${portal.propria} com senha PRÓPRIA (MinhaSenha2026), ${portal.provisoria} com senha PROVISÓRIA (Portal2026), ${portal.confirmacoes} confirmações de leitura`);
  log("  Acessos ao portal (nome — estado — código de cada processo):");
  for (const acesso of portal.acessos) {
    log(`    ${acesso.estado === "propria" ? "própria   " : "provisória"}  ${acesso.codigos.join(" ")}  ${acesso.nome}`);
  }

  if (falhas.length > 0) {
    log(`${linha}\n  ATENCAO — ${falhas.length} FALHA(S) durante o volume (a execução termina com código 1):`);
    for (const falha of falhas.slice(0, 40)) log(`    [${falha.etapa}] ${falha.detalhe}`);
    if (falhas.length > 40) log(`    … e mais ${falhas.length - 40}`);
  }
  log(L);
};
