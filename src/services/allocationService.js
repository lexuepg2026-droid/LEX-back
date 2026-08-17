import Allocation from "../models/Allocation.js";
import Installment from "../models/Installment.js";
import Fee from "../models/Fee.js";

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE ALOCAÇÃO — DEC-035 e DEC-036 (Fase F-1)
//
// O arquivo que decide para onde o dinheiro vai. Tudo o que ele faz é criar
// linhas de `Allocation` e mexer em `Fee.saldoAdiantado`; quem recalcula
// status é `paymentService`, na cadeia que já existia desde a 4.1.
//
// ── As duas ordens, e por que são opostas ─────────────────────────────────
// **Alocar: do vencimento mais ANTIGO para o mais novo.** É o que qualquer
// pessoa faz com uma dívida — paga o que está vencido primeiro. Alocar no mais
// novo deixaria a parcela vencida em aberto com dinheiro no caixa, e a
// listagem mostraria "vencida" para quem acabou de pagar.
//
// **Desalocar: do mais NOVO para o mais antigo.** Espelhada, e não igual. Um
// estorno desfaz o efeito do pagamento na ordem inversa em que ele aconteceu:
// o último centavo a encontrar destino é o primeiro a voltar. Desalocar do
// mais antigo faria uma parcela antiga voltar a dever enquanto uma nova
// continuasse quitada pelo mesmo dinheiro estornado — estado que nenhuma
// leitura humana explica.
//
// ── Centavos, sempre ──────────────────────────────────────────────────────
// Toda conta passa por `emCentavos`. Somar float em cima de float acumula
// resíduo, e resíduo aqui é a advogada lendo "em aberto: R$ 0,00000000001" ou,
// pior, uma parcela que nunca fecha porque falta 1e-13.
// ═══════════════════════════════════════════════════════════════════════════

export const emCentavos = (n) => Math.round(Number(n || 0) * 100) / 100;

// Quanto uma parcela ainda precisa receber. Lê as alocações ATIVAS, e não
// `Installment.valorPago`: o campo desnormalizado é escrito pelo recálculo, que
// roda DEPOIS desta função no mesmo fluxo — usá-lo aqui leria o valor de antes.
const emAbertoDaParcela = (parcela, alocadoPorParcela) => {
  const alocado = alocadoPorParcela.get(String(parcela._id)) ?? 0;
  return emCentavos(Number(parcela.valor) - alocado);
};

// Parcelas que podem receber dinheiro, na ordem de alocação.
//
// `cancelado` fica de fora: parcela cancelada por reparcelamento saiu de
// circulação, e alocar nela ressuscitaria uma cobrança que a advogada desfez.
// Desempate por `numeroParcela` — duas parcelas no mesmo vencimento precisam de
// ordem estável, senão a alocação vira loteria entre execuções.
export const listarAlocaveis = async (feeId, usuarioId) =>
  Installment.find({
    feeId,
    usuarioId,
    ativo: true,
    status: { $ne: "cancelado" }
  }).sort({ dataVencimento: 1, numeroParcela: 1 });

// Mapa parcelaId → total já alocado (ativo). Uma consulta para o honorário
// inteiro, não uma por parcela.
export const mapaDeAlocado = async (feeId, usuarioId) => {
  const alocacoes = await Allocation.find({
    honorarioId: feeId,
    usuarioId,
    estornoId: null
  }).select("parcelaId valor");

  const mapa = new Map();
  for (const a of alocacoes) {
    const chave = String(a.parcelaId);
    mapa.set(chave, emCentavos((mapa.get(chave) ?? 0) + Number(a.valor)));
  }
  return mapa;
};

// ═══════════════════════════════════════════════════════════════════════════
// O PLANO — função pura, e é de propósito
//
// Recebe o que já se sabe e devolve o que vai acontecer, sem tocar no banco.
// É ela que o preview da tela consome (`POST /payments/preview`) e é ela que a
// criação executa. Uma função para as duas coisas significa que o preview não
// pode mentir: se ele mostrar algo diferente do que o POST faz, é porque
// alguém escreveu a regra duas vezes — e aqui não há como.
// ═══════════════════════════════════════════════════════════════════════════
export const planejarAlocacao = (valor, parcelas, alocadoPorParcela) => {
  let restante = emCentavos(valor);
  const destinos = [];

  for (const parcela of parcelas) {
    if (restante <= 0) break;

    const emAberto = emAbertoDaParcela(parcela, alocadoPorParcela);
    if (emAberto <= 0) continue;

    const aAlocar = emCentavos(Math.min(restante, emAberto));
    destinos.push({
      parcelaId: parcela._id,
      numeroParcela: parcela.numeroParcela,
      dataVencimento: parcela.dataVencimento,
      valorParcela: emCentavos(parcela.valor),
      emAbertoAntes: emAberto,
      valor: aAlocar,
      // Uma parcela "quita" quando a alocação cobre todo o em aberto dela. É o
      // que a tela usa para dizer "quita a parcela 2" em vez de "abate".
      quita: aAlocar >= emAberto
    });
    restante = emCentavos(restante - aAlocar);
  }

  // O que sobrou não se perde nem é recusado: vira saldo adiantado (DEC-036).
  return { destinos, sobra: emCentavos(restante) };
};

// ═══════════════════════════════════════════════════════════════════════════
// EXECUÇÃO
// ═══════════════════════════════════════════════════════════════════════════

// Grava as alocações de um plano e devolve os documentos criados.
const gravarDestinos = async ({ destinos, pagamentoId, feeId, usuarioId, data, origem }) => {
  if (destinos.length === 0) return [];

  return Allocation.insertMany(
    destinos.map((d) => ({
      usuarioId,
      pagamentoId,
      parcelaId: d.parcelaId,
      honorarioId: feeId,
      valor: d.valor,
      data,
      origem
    }))
  );
};

// Aloca o valor de um pagamento recém-criado. Devolve as alocações e a sobra
// que foi para o saldo.
export const alocarPagamento = async ({ pagamento, fee, usuarioId }) => {
  // Adiantamento não disputa parcela: vai inteiro para o saldo, por decisão da
  // advogada. Ela pode ter um motivo que o sistema não conhece — um acerto
  // combinado para o mês que vem — e adivinhar destino seria justamente a
  // "mágica" que a DEC-035 proíbe.
  if (pagamento.tipo === "adiantamento") {
    fee.saldoAdiantado = emCentavos(Number(fee.saldoAdiantado || 0) + Number(pagamento.valor));
    await fee.save();
    return { alocacoes: [], sobra: emCentavos(pagamento.valor) };
  }

  const parcelas = await listarAlocaveis(fee._id, usuarioId);
  const alocado = await mapaDeAlocado(fee._id, usuarioId);
  const { destinos, sobra } = planejarAlocacao(pagamento.valor, parcelas, alocado);

  const alocacoes = await gravarDestinos({
    destinos,
    pagamentoId: pagamento._id,
    feeId: fee._id,
    usuarioId,
    data: pagamento.data,
    origem: "pagamento"
  });

  if (sobra > 0) {
    fee.saldoAdiantado = emCentavos(Number(fee.saldoAdiantado || 0) + sobra);
    await fee.save();
  }

  return { alocacoes, sobra };
};

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-ALOCAÇÃO DO SALDO — DEC-036
//
// Chamada quando parcelas NOVAS nascem (criação avulsa, criação em lote,
// reparcelamento). Consome `saldoAdiantado` do primeiro vencimento em diante.
//
// As alocações nascem com `origem: "saldoAdiantado"` e sem pagamento novo: o
// dinheiro já tinha entrado, e o extrato precisa distinguir "entrou hoje" de
// "encontrou destino hoje". Sem essa distinção, o cartão "recebido no mês"
// contaria duas vezes o mesmo real.
//
// `pagamentoId` aponta o pagamento que ORIGINOU o saldo — o mais antigo que
// ainda o alimenta. Sem ele, a alocação não teria de onde vir, e a coluna
// "de onde" do extrato ficaria vazia justo no caso que mais precisa de
// explicação.
// ═══════════════════════════════════════════════════════════════════════════
export const autoAlocarSaldo = async ({ fee, usuarioId, pagamentoOrigemId }) => {
  const saldo = emCentavos(Number(fee.saldoAdiantado || 0));
  if (saldo <= 0) return { alocacoes: [], consumido: 0 };

  const parcelas = await listarAlocaveis(fee._id, usuarioId);
  if (parcelas.length === 0) return { alocacoes: [], consumido: 0 };

  const alocado = await mapaDeAlocado(fee._id, usuarioId);
  const { destinos, sobra } = planejarAlocacao(saldo, parcelas, alocado);
  if (destinos.length === 0) return { alocacoes: [], consumido: 0 };

  const alocacoes = await gravarDestinos({
    destinos,
    pagamentoId: pagamentoOrigemId ?? null,
    feeId: fee._id,
    usuarioId,
    data: new Date(),
    origem: "saldoAdiantado"
  });

  fee.saldoAdiantado = sobra;
  await fee.save();

  return { alocacoes, consumido: emCentavos(saldo - sobra) };
};

// ═══════════════════════════════════════════════════════════════════════════
// DESALOCAÇÃO — o estorno desfazendo o efeito do pagamento
//
// Ordem ESPELHADA: do vencimento mais novo para o mais antigo. Ver o cabeçalho.
//
// Devolve quanto saiu de parcela e quanto saiu do saldo adiantado — a soma dos
// dois é sempre o valor do estorno, e é isso que o teste de conservação
// verifica. O saldo é consumido PRIMEIRO: é o dinheiro que ainda não tinha
// destino, e tirá-lo de lá não desfaz nenhuma quitação.
// ═══════════════════════════════════════════════════════════════════════════
export const desalocarPorEstorno = async ({
  pagamento,
  fee,
  estorno,
  usuarioId,
  // Quanto deste pagamento JÁ tinha sido estornado antes deste estorno. Vem do
  // chamador (`reversalService`), que é quem conhece a cadeia de estornos.
  // Calcular aqui obrigaria este arquivo a conhecer anulação — e a regra de
  // "estorno ativo" tem um dono só.
  jaEstornado = 0
}) => {
  let restante = emCentavos(estorno.valor);

  // 1. o saldo adiantado que ESTE pagamento gerou e que ninguém consumiu.
  //
  // Só se o pagamento em questão tiver contribuído: estornar o pagamento A não
  // pode comer o saldo que o pagamento B deixou. A conta é o valor do
  // pagamento menos o que ele alocou — o resto dele foi para o saldo.
  const alocacoesDoPagamento = await Allocation.find({
    pagamentoId: pagamento._id,
    usuarioId,
    estornoId: null
  }).sort({ data: -1 });

  const alocadoPeloPagamento = emCentavos(
    alocacoesDoPagamento.reduce((t, a) => t + Number(a.valor), 0)
  );
  const contribuiuAoSaldo = emCentavos(
    Number(pagamento.valor) - alocadoPeloPagamento - emCentavos(jaEstornado)
  );

  let doSaldo = 0;
  if (contribuiuAoSaldo > 0 && restante > 0) {
    doSaldo = emCentavos(
      Math.min(restante, contribuiuAoSaldo, emCentavos(Number(fee.saldoAdiantado || 0)))
    );
    if (doSaldo > 0) {
      fee.saldoAdiantado = emCentavos(Number(fee.saldoAdiantado || 0) - doSaldo);
      restante = emCentavos(restante - doSaldo);
    }
  }

  // 2. as alocações, do vencimento mais NOVO para o mais antigo.
  const parcelas = await listarAlocaveis(fee._id, usuarioId);
  const ordemPorParcela = new Map(parcelas.map((p, i) => [String(p._id), i]));
  const ordenadas = [...alocacoesDoPagamento].sort((a, b) => {
    const ia = ordemPorParcela.get(String(a.parcelaId)) ?? -1;
    const ib = ordemPorParcela.get(String(b.parcelaId)) ?? -1;
    return ib - ia; // decrescente = vencimento mais novo primeiro
  });

  const desalocadas = [];
  const parcelasAfetadas = new Set();

  for (const alocacao of ordenadas) {
    if (restante <= 0) break;

    const valorAlocacao = emCentavos(alocacao.valor);
    parcelasAfetadas.add(String(alocacao.parcelaId));

    if (valorAlocacao <= restante) {
      // Desfaz a alocação inteira: carimba o estorno e ela deixa de contar.
      alocacao.estornoId = estorno._id;
      alocacao.desalocadoEm = estorno.data;
      await alocacao.save();
      desalocadas.push(alocacao);
      restante = emCentavos(restante - valorAlocacao);
      continue;
    }

    // Estorno parcial DENTRO de uma alocação: a linha original é carimbada e
    // uma linha nova, com o que sobrou, toma o lugar dela.
    //
    // Alternativa descartada: reduzir `valor` da alocação existente. Seria uma
    // linha a menos e uma mentira — o registro passaria a dizer que sempre
    // alocou o valor menor, e o extrato perderia a informação de que houve
    // alocação maior antes. Registro imutável não se reescreve; se substitui.
    alocacao.estornoId = estorno._id;
    alocacao.desalocadoEm = estorno.data;
    await alocacao.save();
    desalocadas.push(alocacao);

    const resto = emCentavos(valorAlocacao - restante);
    const [substituta] = await Allocation.insertMany([
      {
        usuarioId,
        pagamentoId: alocacao.pagamentoId,
        parcelaId: alocacao.parcelaId,
        honorarioId: alocacao.honorarioId,
        valor: resto,
        data: alocacao.data,
        origem: alocacao.origem
      }
    ]);
    desalocadas.push({ substituta: true, doc: substituta });
    restante = 0;
  }

  if (doSaldo > 0) await fee.save();

  return {
    doSaldo,
    dasParcelas: emCentavos(Number(estorno.valor) - doSaldo - restante),
    naoAbsorvido: restante,
    parcelasAfetadas: [...parcelasAfetadas]
  };
};

// Total líquido alocado a um honorário = Σ alocações ativas.
export const totalAlocadoDoFee = async (feeId, usuarioId) => {
  const alocacoes = await Allocation.find({
    honorarioId: feeId,
    usuarioId,
    estornoId: null
  }).select("valor");
  return emCentavos(alocacoes.reduce((t, a) => t + Number(a.valor), 0));
};

export default {
  planejarAlocacao,
  listarAlocaveis,
  mapaDeAlocado,
  alocarPagamento,
  autoAlocarSaldo,
  desalocarPorEstorno,
  totalAlocadoDoFee,
  emCentavos
};
