// ═══════════════════════════════════════════════════════════════════════════
// DEC-055 — O QUE É FATO SE GRAVA; O QUE É DERIVADO SE DERIVA
//
// ── A regra, e é o coração da F-3 ────────────────────────────────────────
// O calendário mostra DUAS naturezas de coisa no mesmo lugar:
//
//   EVENTO PRÓPRIO   audiência, prazo, reunião    → coleção `events`
//   DATA DERIVADA    vencimento de parcela,       → lida de `installments`
//                    vencimento de honorário         e de `fees`, AGORA
//
// **Data derivada NUNCA é gravada como evento.** Ela é lida das parcelas e dos
// honorários no momento da consulta, e some da resposta no instante em que
// sumir da origem.
//
// ── Por que não gravar, dito pelo defeito que gravar produziria ─────────
// Gravar significaria DUAS FONTES para o mesmo vencimento. As duas concordam
// no dia em que são criadas, e divergem no primeiro reparcelamento:
//
//   1. a advogada reparcela um honorário de 5 parcelas em 3;
//   2. a DEC-037 cancela as 5 antigas e cria as 3 novas;
//   3. o calendário, que gravou 5 eventos em setembro, continua mostrando os 5.
//
// E não os mostra como um resto esquecido: mostra-os **com o mesmo peso visual
// de uma audiência**, porque a essa altura eles são eventos como qualquer
// outro. A advogada leria, na agenda dela, cinco cobranças que não existem
// mais, e não haveria nada na tela dizendo qual das duas listas vale.
//
// É a lição da DEC-048 aplicada a data. Lá, `totalParcelas` foi GRAVADO porque
// congelar o passado era o requisito — um recibo entregue não pode mudar de
// significado. Aqui é o contrário, e por isso a decisão é oposta: o calendário
// responde "o que vence", que é uma pergunta sobre o PRESENTE. Uma resposta
// congelada para uma pergunta sobre o presente é uma resposta errada.
//
// ── As três consequências, e todas as três aparecem na tela ────────────
//
//   1. a derivada NÃO É EDITÁVEL no calendário. Clicar nela leva à parcela.
//      Mudar vencimento se faz onde o vencimento mora — e um campo de data
//      editável aqui seria a segunda fonte voltando pela porta da interface.
//
//   2. as duas naturezas se DISTINGUEM NO RELANCE, por cor e marca, com
//      legenda dizendo qual é qual. Sem isso a regra existiria só no backend, e
//      a advogada não teria como saber por que uma linha abre um formulário e a
//      outra a leva embora.
//
//   3. parcela de honorário CANCELADO POR REPARCELAMENTO não aparece. Mesma
//      regra do dashboard, e é ela que fecha o cenário do reparcelamento acima.
//
// ── O discriminador ────────────────────────────────────────────────────
// Todo item traz `natureza: "evento" | "derivada"`. É campo de primeiro nível e
// obrigatório nos dois: uma tela que tivesse de INFERIR a natureza (pela
// presença de `feeId`, digamos) inferiria errado no dia em que um evento
// ganhasse um vínculo com honorário.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";

import Event from "../models/Event.js";
import Process from "../models/Process.js";
import Fee, { STATUS_CANCELADO } from "../models/Fee.js";
import Installment from "../models/Installment.js";
import { filtroPeriodo } from "../utils/filtrosDeConsulta.js";
import {
  escreverDataDeCalendario,
  hojeComoDataDeCalendario,
  inicioDoDiaUTC
} from "../utils/dataDeCalendario.js";
import { projetarEvento } from "./eventService.js";

const erro = (status, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = status;
  Object.assign(error, extra);
  return error;
};

// ── O TETO DE JANELA ─────────────────────────────────────────────────────
//
// 366 dias: a maior coisa que esta interface pede é um ano, e o ano bissexto
// é o maior ano. Sem teto, `de=1900-01-01&ate=2100-01-01` varre a coleção
// inteira do tenant e monta a resposta na memória — e não é preciso má-fé para
// chegar lá, basta um componente de data com o ano em branco.
//
// A recusa é 400 com `campo`, e diz o tamanho pedido: "muito grande" sem o
// número manda a pessoa adivinhar de quanto ela precisa encurtar.
export const MAXIMO_DE_DIAS = 366;

const UM_DIA = 24 * 60 * 60 * 1000;

// ── O INTERVALO ──────────────────────────────────────────────────────────
//
// As duas bordas são OBRIGATÓRIAS, ao contrário das listagens financeiras,
// onde `de` sozinho significa "daqui em diante". Um calendário sempre sabe a
// janela que está mostrando — a grade tem primeiro e último dia, a agenda tem
// o mês —, e um calendário "de junho em diante" não é uma tela que exista.
//
// **A recusa de intervalo invertido é a de `filtroPeriodo`, do passo 174.**
// Reaproveitada, e não reescrita: a regra é a mesma ("as duas datas estão
// trocadas") e uma redação nova aqui daria à advogada duas frases diferentes
// para o mesmo engano, em duas telas do mesmo sistema.
const lerIntervalo = (de, ate) => {
  if (de === undefined || de === null || de === "") {
    throw erro(400, 'O início do período ("de") é obrigatório no calendário.', { campo: "de" });
  }
  if (ate === undefined || ate === null || ate === "") {
    throw erro(400, 'O fim do período ("ate") é obrigatório no calendário.', { campo: "ate" });
  }

  // `filtroPeriodo` faz o resto: formato `AAAA-MM-DD`, dia que não existe, e a
  // recusa de intervalo invertido com a mensagem já publicada. As bordas saem
  // inclusivas (00:00:00.000Z e 23:59:59.999Z do mesmo dia), como em toda
  // listagem desde a F-1b.3.
  const periodo = filtroPeriodo(de, ate, { campoDe: "de", campoAte: "ate" });

  // Sem `+ 1`: `$lte` já é 23:59:59.999 do ÚLTIMO dia, então a diferença bruta
  // já cobre a janela inteira (`01/01` a `31/12` de um bissexto dá 365,99…
  // dias, que arredonda para 366). Somar um a mais recusaria justamente o ano
  // inteiro, que é o maior recorte legítimo desta tela.
  const dias = Math.round((periodo.$lte.getTime() - periodo.$gte.getTime()) / UM_DIA);
  if (dias > MAXIMO_DE_DIAS) {
    throw erro(
      400,
      `O período pedido tem ${dias} dias, e o calendário devolve no máximo ` +
      `${MAXIMO_DE_DIAS}. Peça um intervalo menor.`,
      { campo: "ate" }
    );
  }

  return periodo;
};

// ── Os itens DERIVADOS ───────────────────────────────────────────────────
//
// Nada aqui escreve. Nenhuma função deste bloco chama `create`, `save`,
// `updateOne` ou `insertMany`, e há teste que conta os documentos de `events`
// antes e depois de uma consulta ao calendário para provar exatamente isso.
//
// `link` NÃO é montado aqui. O backend devolve `origem` e o id; quem sabe que
// a parcela mora em `/dashboard/parcelas/editar/:id` é o frontend, e uma rota
// de tela escrita no serviço quebraria calada no dia em que a tela mudasse de
// caminho.
const derivadasDoPeriodo = async (usuarioId, periodo) => {
  const uid = new mongoose.Types.ObjectId(usuarioId);

  // Processos ATIVOS. Mesma fronteira do resumo financeiro: um processo
  // arquivado não devolve vencimento para a agenda, do mesmo modo que não
  // devolve valor para o painel. As duas telas respondendo diferente sobre o
  // mesmo processo é o que faz a advogada não confiar em nenhuma das duas.
  const processos = await Process.find({ usuarioId: uid, ativo: true })
    .select("titulo numeroProcesso");
  if (processos.length === 0) return [];

  const processoIds = processos.map((p) => p._id);
  const porProcesso = new Map(processos.map((p) => [String(p._id), p]));

  // Honorários vigentes. `cancelado` fora de tudo — a cobrança foi desfeita, e
  // é a mesma exclusão que o dashboard faz.
  const honorarios = await Fee.find({
    usuarioId: uid,
    ativo: true,
    status: { $ne: STATUS_CANCELADO },
    processoId: { $in: processoIds }
  }).select("descricao processoId dataVencimento status");

  if (honorarios.length === 0) return [];

  const feeIds = honorarios.map((f) => f._id);
  const honorarioPorId = new Map(honorarios.map((f) => [String(f._id), f]));

  // ── AS PARCELAS ────────────────────────────────────────────────────────
  //
  // `status: { $ne: "cancelado" }` é a linha que cumpre a terceira consequência
  // da DEC-055. Uma parcela cancelada por reparcelamento continua no banco, com
  // `reparcelamentoId` apontando a operação que a substituiu (DEC-037) — ela é
  // legível no extrato, onde a pergunta é "o que aconteceu com esta cobrança",
  // e não pertence ao calendário, onde a pergunta é "o que vence".
  const parcelas = await Installment.find({
    usuarioId: uid,
    ativo: true,
    feeId: { $in: feeIds },
    status: { $ne: "cancelado" },
    dataVencimento: periodo
  }).select("feeId processoId numeroParcela totalParcelas valor valorPago dataVencimento status");

  // ── O VENCIMENTO DO PRÓPRIO HONORÁRIO ─────────────────────────────────
  //
  // Só entra quando o honorário NÃO tem parcela vigente nenhuma. Com um plano
  // emitido, o `dataVencimento` do honorário e a última parcela do plano são a
  // mesma obrigação vista de dois lugares — e mostrar as duas poria dois
  // marcadores no calendário para uma dívida só.
  //
  // É a mesma DEC-055 na direção interna: duas linhas para o mesmo vencimento
  // divergiriam no primeiro reparcelamento, exatamente como as duas fontes que
  // a decisão proíbe. A diferença é que aqui as duas são derivadas, então
  // basta escolher a mais específica — e a parcela é a mais específica, porque
  // é ela que a advogada recebe.
  //
  // A contagem é sobre TODAS as parcelas vigentes do honorário, e não só as do
  // período: um honorário com plano em outubro não deve mostrar o vencimento
  // dele em setembro só porque a janela pedida foi setembro.
  const comParcelaVigente = new Set(
    (
      await Installment.find({
        usuarioId: uid,
        ativo: true,
        feeId: { $in: feeIds },
        status: { $ne: "cancelado" }
      }).select("feeId")
    ).map((p) => String(p.feeId))
  );

  const itens = [];

  for (const parcela of parcelas) {
    const fee = honorarioPorId.get(String(parcela.feeId));
    const processo = porProcesso.get(String(fee?.processoId ?? parcela.processoId));

    itens.push({
      natureza: "derivada",
      origem: "parcela",
      _id: String(parcela._id),
      // O rótulo sai do BACKEND pronto, como o `tipoRotulo` do evento: nenhuma
      // tela monta rótulo por conta própria. "Parcela 1 de 3" é a redação da
      // DEC-048, com o "de N" congelado — e o `null` de plano aberto vira só
      // "Parcela 1", que é a resposta verdadeira enquanto o plano cresce.
      titulo: parcela.totalParcelas
        ? `Parcela ${parcela.numeroParcela} de ${parcela.totalParcelas}`
        : `Parcela ${parcela.numeroParcela}`,
      subtitulo: fee?.descricao ?? null,
      data: escreverDataDeCalendario(parcela.dataVencimento),
      // Derivada não tem hora: um vencimento é o dia inteiro. `null` explícito
      // para o item ter a mesma forma que o evento — uma chave ausente num dos
      // dois obrigaria a tela a testar a natureza antes de ler qualquer campo.
      hora: null,
      valor: parcela.valor,
      valorPago: parcela.valorPago ?? 0,
      status: parcela.status,
      feeId: String(parcela.feeId),
      processoId: processo ? String(processo._id) : null,
      processo: processo
        ? {
            _id: String(processo._id),
            titulo: processo.titulo ?? null,
            numeroProcesso: processo.numeroProcesso ?? null
          }
        : null,
      // A tela precisa disto para desabilitar o que a DEC-055 proíbe, sem
      // deduzir da `natureza`. Explícito porque a proibição é a REGRA, e regra
      // deduzida é regra que a próxima tela deduz ao contrário.
      editavelNoCalendario: false
    });
  }

  for (const fee of honorarios) {
    if (!fee.dataVencimento) continue;
    if (comParcelaVigente.has(String(fee._id))) continue;

    const vencimento = fee.dataVencimento;
    if (vencimento < periodo.$gte || vencimento > periodo.$lte) continue;

    const processo = porProcesso.get(String(fee.processoId));

    itens.push({
      natureza: "derivada",
      origem: "honorario",
      _id: String(fee._id),
      titulo: fee.descricao ?? "Honorário",
      subtitulo: null,
      data: escreverDataDeCalendario(vencimento),
      hora: null,
      valor: null,
      valorPago: 0,
      status: fee.status,
      feeId: String(fee._id),
      processoId: processo ? String(processo._id) : null,
      processo: processo
        ? {
            _id: String(processo._id),
            titulo: processo.titulo ?? null,
            numeroProcesso: processo.numeroProcesso ?? null
          }
        : null,
      editavelNoCalendario: false
    });
  }

  return itens;
};

// ── A ORDENAÇÃO ──────────────────────────────────────────────────────────
//
// Por dia, depois por hora, depois por título. Comparação de STRING
// `AAAA-MM-DD`, cuja ordem lexicográfica é a ordem cronológica — é a
// comparação que não tem fuso para errar.
//
// O sem-hora vem antes do com-hora no mesmo dia: "sem hora" é o compromisso do
// dia inteiro, e pô-lo depois do das 14h30 sugeriria que ele acontece à noite.
// A derivada, que nunca tem hora, cai naturalmente nesse grupo — e é onde ela
// deve estar: um vencimento é o dia todo.
const ordenar = (itens) =>
  itens.sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    const ha = a.hora ?? "";
    const hb = b.hora ?? "";
    if (ha !== hb) return ha < hb ? -1 : 1;
    return String(a.titulo).localeCompare(String(b.titulo), "pt-BR");
  });

// ═══════════════════════════════════════════════════════════════════════════
// O ENDPOINT ÚNICO — um intervalo entra, as duas naturezas saem
// ═══════════════════════════════════════════════════════════════════════════
//
// Um endpoint, e não dois. Duas rotas ("os eventos" e "as derivadas") fariam a
// tela emitir duas requisições, receber duas respostas em tempos diferentes e
// concatená-las — e a grade renderizaria uma vez com metade do mês. Pior: a
// ordenação, que é do CALENDÁRIO e não de cada fonte, teria de ser refeita no
// cliente, e o `+N` do dia cheio dependeria de as duas já terem chegado.
export const lerCalendario = async (usuarioId, { de, ate, processoId } = {}) => {
  const periodo = lerIntervalo(de, ate);

  const filtroDeEventos = { usuarioId, ativo: true, data: periodo };
  if (processoId) {
    if (!mongoose.Types.ObjectId.isValid(processoId)) {
      throw erro(400, 'O filtro "processoId" não é um id válido.', { campo: "processoId" });
    }
    filtroDeEventos.processoId = processoId;
  }

  const [eventos, derivadas] = await Promise.all([
    Event.find(filtroDeEventos).populate("processoId", "titulo numeroProcesso"),
    // O filtro por processo vale para as duas naturezas: quem pediu a agenda de
    // um processo não quer o vencimento de outro. Filtrar depois, em memória, é
    // o mesmo resultado — e o recorte por processo raramente é o caminho quente
    // desta tela, que é o mês inteiro.
    derivadasDoPeriodo(usuarioId, periodo)
  ]);

  const itensDeEvento = eventos.map((evento) => {
    const projetado = projetarEvento(evento);
    return {
      ...projetado,
      natureza: "evento",
      subtitulo: projetado.tipoRotulo,
      // O evento É editável no calendário — é o outro lado da DEC-055, e sai
      // explícito pela mesma razão que a derivada sai com `false`.
      editavelNoCalendario: true
    };
  });

  const derivadasFiltradas = processoId
    ? derivadas.filter((d) => d.processoId === String(processoId))
    : derivadas;

  return {
    de: escreverDataDeCalendario(periodo.$gte),
    ate: escreverDataDeCalendario(periodo.$lte),
    // "Hoje" viaja na resposta em vez de ser calculado na tela. A tela não tem
    // como saber o "hoje" do servidor, e um relógio de máquina atrasado faria a
    // grade destacar o dia errado — no componente cuja única função é dizer que
    // dia é hoje.
    hoje: hojeComoDataDeCalendario(),
    itens: ordenar([...itensDeEvento, ...derivadasFiltradas])
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// O SINO — três casos, sem estado de lido/não lido (F-3, Parte 4)
// ═══════════════════════════════════════════════════════════════════════════
//
// ── Por que NÃO existe "marcar como lido" ───────────────────────────────
// O número muda sozinho com o dia e com o que a advogada resolve. Um contador
// que só zera com clique treina a pessoa a zerar sem olhar — e a partir do dia
// em que zerar vira reflexo, ele deixa de significar qualquer coisa.
//
// Aqui, **resolver o item é o que baixa o número**: concluir o evento, pagar a
// parcela. Clicar no sino abre a lista e não muda nada. É a mesma escolha da
// DEC-052 sobre o `historicoAtivacao` — o estado que importa é o do mundo, não
// o da leitura.
//
// ── E por que os três casos são estes ──────────────────────────────────
// Só entra o que EXIGE ATENÇÃO HOJE. O que está concluído não conta, o que é
// de amanhã não conta, e o que já foi pago não conta.
export const lerAvisos = async (usuarioId) => {
  const uid = new mongoose.Types.ObjectId(usuarioId);

  // Um relógio só para as três contas: duas leituras independentes cairiam em
  // dias diferentes se a virada da meia-noite acontecesse entre elas, e o sino
  // mostraria um total que nenhuma das listas explica.
  const hoje = hojeComoDataDeCalendario();
  const inicioDeHoje = inicioDoDiaUTC(hoje);
  const fimDeHoje = new Date(inicioDeHoje.getTime() + UM_DIA - 1);

  const processos = await Process.find({ usuarioId: uid, ativo: true })
    .select("titulo numeroProcesso");
  const processoIds = processos.map((p) => p._id);
  const porProcesso = new Map(processos.map((p) => [String(p._id), p]));

  const honorarios = await Fee.find({
    usuarioId: uid,
    ativo: true,
    status: { $ne: STATUS_CANCELADO },
    processoId: { $in: processoIds }
  }).select("descricao processoId");
  const feeIds = honorarios.map((f) => f._id);
  const honorarioPorId = new Map(honorarios.map((f) => [String(f._id), f]));

  const [eventosDeHoje, eventosAtrasados, parcelasVencidas] = await Promise.all([
    // Hoje, não concluídos.
    Event.find({
      usuarioId: uid,
      ativo: true,
      concluido: false,
      data: { $gte: inicioDeHoje, $lte: fimDeHoje }
    })
      .populate("processoId", "titulo numeroProcesso")
      .sort({ hora: 1, createdAt: 1 }),

    // Atrasados: data PASSADA e não concluídos. `$lt: inicioDeHoje` e não
    // `$lte`: o de hoje já está na primeira lista, e contá-lo nas duas faria o
    // total do sino somar o mesmo compromisso duas vezes.
    Event.find({
      usuarioId: uid,
      ativo: true,
      concluido: false,
      data: { $lt: inicioDeHoje }
    })
      .populate("processoId", "titulo numeroProcesso")
      .sort({ data: -1, hora: 1 }),

    // Parcelas vencidas. O status é DERIVADO pelo `paymentService` (DEC-028) e
    // é a mesma fonte que o painel conta — o sino não recalcula "vencido" por
    // conta própria, senão os dois números divergiriam no dia em que a
    // derivação mudasse.
    //
    // `cancelado` fora, pela DEC-055 e pela mesma regra do painel.
    Installment.find({
      usuarioId: uid,
      ativo: true,
      feeId: { $in: feeIds },
      status: "vencido"
    })
      .select("feeId processoId numeroParcela totalParcelas valor valorPago dataVencimento status")
      .sort({ dataVencimento: 1 })
  ]);

  const projetarParaAviso = (evento, motivo) => ({
    ...projetarEvento(evento),
    natureza: "evento",
    motivo
  });

  const listaDeHoje = eventosDeHoje.map((e) => projetarParaAviso(e, "hoje"));
  const listaAtrasada = eventosAtrasados.map((e) => projetarParaAviso(e, "atrasado"));

  const listaVencida = parcelasVencidas.map((parcela) => {
    const fee = honorarioPorId.get(String(parcela.feeId));
    const processo = porProcesso.get(String(fee?.processoId ?? parcela.processoId));
    return {
      natureza: "derivada",
      origem: "parcela",
      motivo: "vencida",
      _id: String(parcela._id),
      titulo: parcela.totalParcelas
        ? `Parcela ${parcela.numeroParcela} de ${parcela.totalParcelas}`
        : `Parcela ${parcela.numeroParcela}`,
      subtitulo: fee?.descricao ?? null,
      data: escreverDataDeCalendario(parcela.dataVencimento),
      hora: null,
      valor: parcela.valor,
      valorPago: parcela.valorPago ?? 0,
      status: parcela.status,
      feeId: String(parcela.feeId),
      processoId: processo ? String(processo._id) : null,
      processo: processo
        ? {
            _id: String(processo._id),
            titulo: processo.titulo ?? null,
            numeroProcesso: processo.numeroProcesso ?? null
          }
        : null,
      editavelNoCalendario: false
    };
  });

  return {
    hoje,
    // O total é a SOMA dos três, e vai calculado — a tela não soma. Se ela
    // somasse, o dia em que um quarto caso entrasse ela continuaria mostrando
    // três, e ninguém notaria porque o número continuaria plausível.
    total: listaDeHoje.length + listaAtrasada.length + listaVencida.length,
    contagens: {
      eventosHoje: listaDeHoje.length,
      eventosAtrasados: listaAtrasada.length,
      parcelasVencidas: listaVencida.length
    },
    eventosHoje: listaDeHoje,
    eventosAtrasados: listaAtrasada,
    parcelasVencidas: listaVencida
  };
};

export default {
  lerCalendario,
  lerAvisos,
  MAXIMO_DE_DIAS
};
