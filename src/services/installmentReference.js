// ═══════════════════════════════════════════════════════════════════════════
// A REFERÊNCIA HUMANA DA PARCELA — DEC-048 (Fase F-1c.1)
//
// ── O problema que a DEC-048 criou, e que esta função resolve ─────────────
// Renumerar o plano vigente a partir de 1 faz existirem DUAS parcelas nº 1 no
// mesmo honorário: a cancelada pelo reparcelamento e a que nasceu no lugar
// dela. A partir daí, referenciar parcela por ORDINAL é ambíguo.
//
// É exatamente o defeito que a DEC-045 resolveu para pagamentos, e a solução é
// a mesma: **referência por atributo humano, não por ordinal.**
//
//   viva:      "parcela 1 de 3, vencendo 15/09/2026"
//   cancelada: "parcela 1 de 2, vencendo 10/05/2026 (reparcelada)"
//
// O VENCIMENTO distingue as duas — duas parcelas nº 1 do mesmo honorário nunca
// vencem no mesmo dia, porque a nova nasce de um plano futuro. O
// "(reparcelada)" avisa que aquela linha pertence a uma história encerrada.
//
// **Se a advogada precisar do id para saber de qual parcela a frase fala, a
// DEC-048 falhou mesmo com a suíte verde.**
//
// ── A referência do PAGAMENTO (DEC-045) não muda ─────────────────────────
// São duas referências diferentes — uma de pagamento, uma de parcela — e elas
// convivem na mesma frase do extrato:
//
//   "Do pagamento de R$ 300,00 em dinheiro (10/06/2026, #698600), aplicado na
//    parcela 1 de 3, vencendo 15/09/2026."
//
// ── Função pura, e por quê ───────────────────────────────────────────────
// Mesma razão da DEC-045: a suíte só consegue travar TEXTO que sai de função
// pura. Frase montada dentro do serviço só se testaria por varredura, que
// prova que a linha existe e não que ela nomeia certo.
// ═══════════════════════════════════════════════════════════════════════════

// A data como o Brasil lê. UTC de propósito: as datas são gravadas como
// meia-noite UTC, e sem o fuso fixo um servidor em fuso negativo escreveria o
// dia anterior — a parcela venceria um dia antes na frase e no dia certo na
// tabela.
const dataBR = (valor) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
};

// O rótulo curto: "Parcela 1 de 3", ou "Parcela 1" enquanto o plano está
// aberto. É o que vai na coluna "Nº" da listagem e na lista do honorário.
//
// `totalParcelas` nulo = plano ainda em construção (a advogada cria parcela por
// parcela, e quando a primeira nasce ninguém sabe que serão três). Quem chama
// pode passar o tamanho do plano vigente em `totalNoPlanoVigente`, e aí a
// frase diz a verdade de agora sem gravar nada.
//
// N = 1 não ganha "de 1": "Parcela 1 de 1" é ruído — a única parcela do plano
// já se identifica por ser a única.
// O número da parcela, ou `null`. `Number(null)` é `0` e `Number('')` também —
// os dois são finitos, e sem esta guarda uma alocação órfã viraria
// "parcela 0", que parece um número de parcela e é lido como um.
const numeroOuNulo = (valor) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

export const rotuloDaParcela = ({
  numeroParcela,
  totalParcelas = null,
  totalNoPlanoVigente = null
} = {}) => {
  const numero = numeroOuNulo(numeroParcela);
  if (numero === null) return "Parcela";

  // O congelado tem precedência SEMPRE. É o ponto inteiro da DEC-048: uma
  // parcela cancelada de um plano de 2 continua dizendo "de 2", mesmo que o
  // plano vigente hoje tenha 5.
  const n = numeroOuNulo(totalParcelas ?? totalNoPlanoVigente);

  if (n === null || n <= 1) return `Parcela ${numero}`;
  return `Parcela ${numero} de ${n}`;
};

// A referência longa, para as frases do extrato, do recibo e das mensagens de
// erro. Minúscula no começo porque ela entra no meio de frase ("aplicado na
// parcela 1 de 3, vencendo 15/09/2026").
export const referenciaDaParcela = ({
  numeroParcela,
  totalParcelas = null,
  totalNoPlanoVigente = null,
  dataVencimento = null,
  status = null
} = {}) => {
  // Parcela que não existe mais (alocação órfã, dado de base antiga). A frase
  // precisa continuar legível: "?" no lugar do número é melhor que uma frase
  // pela metade, e foi o que o extrato já fazia antes desta fase.
  if (numeroOuNulo(numeroParcela) === null) return "parcela ?";

  const rotulo = rotuloDaParcela({ numeroParcela, totalParcelas, totalNoPlanoVigente })
    .replace(/^Parcela/, "parcela");

  const vencimento = dataBR(dataVencimento);
  const partes = vencimento ? `${rotulo}, vencendo ${vencimento}` : rotulo;

  // O aviso de história encerrada. Vai no FIM, depois do vencimento, porque é
  // qualificação da frase inteira e não do vencimento.
  return status === "cancelado" ? `${partes} (reparcelada)` : partes;
};

export default { rotuloDaParcela, referenciaDaParcela };
