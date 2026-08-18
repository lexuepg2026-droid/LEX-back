// ═══════════════════════════════════════════════════════════════════════════
// OS TOTAIS DE UM HONORÁRIO — fonte única (Fase F-1b)
//
// A conta da DEC-040 vivia dentro de `montarFichaFinanceira`, e era a única
// que existia porque a ficha do processo era a única tela que a fazia. A F-1b
// abre a PÁGINA DO HONORÁRIO, que precisa dos mesmos quatro números — e o
// caminho barato seria repetir a fórmula lá.
//
// Repetir seria o mesmo defeito que o preview de alocação existe para evitar,
// um nível acima: duas fórmulas para a mesma pergunta sobre dinheiro divergem
// na primeira mudança, e a advogada leria "em aberto" diferente na ficha e na
// página, sem nenhuma das duas estar obviamente errada.
//
// Por isso a conta saiu para cá inteira, e a ficha passou a chamá-la. Não é
// generalização preventiva: são DOIS chamadores reais, hoje.
//
// ── A REGRA (DEC-040, F-1a.1) ────────────────────────────────────────────
//
//     emAberto = max(0, contratado − pagoLiquidoAlocado)
//
// O `saldoAdiantado` **NÃO entra nesta conta**. Ele é crédito, sai nomeado ao
// lado, e nunca é somado dentro de `recebido` nem subtraído do `emAberto` —
// foi exatamente esse desconto silencioso que o smoke test de 17/08/2026 pegou
// mentindo a favor do cliente num módulo que imprime recibo assinado.
//
// O PISO EM ZERO não é cosmético: sem ele, um honorário com crédito propaga
// negativo para a soma do processo e abate a dívida do honorário vizinho.
// ═══════════════════════════════════════════════════════════════════════════

// Centavos: soma de float acumula resíduo, e resíduo numa ficha financeira é a
// advogada vendo "em aberto: R$ 0,00000000001".
export const emCentavos = (n) => Math.round(Number(n || 0) * 100) / 100;

export const somarCampo = (itens, campo) =>
  emCentavos((itens ?? []).reduce((acc, item) => acc + Number(item?.[campo] || 0), 0));

// `parcelas` são as parcelas ATIVAS do honorário, cada uma com `valorPago`.
// Quem filtra por `ativo` é o chamador: a ficha já lê só as ativas, e passar
// aqui a decisão de o que conta como parcela viva espalharia a regra.
export const totaisDoHonorario = ({ valorContratado, saldoAdiantado, parcelas }) => {
  const contratado = emCentavos(valorContratado);
  const pagoLiquidoAlocado = somarCampo(parcelas, "valorPago");
  const credito = emCentavos(saldoAdiantado);

  return {
    contratado,
    // `pago` mantém o nome que a ficha publicou na 4.1 (o frontend o lê), e
    // ganha o apelido explícito ao lado. Os dois saem da MESMA variável: ter
    // dois nomes é contrato; tê-los divergindo seria o defeito.
    pago: pagoLiquidoAlocado,
    pagoLiquidoAlocado,
    saldoAdiantado: credito,
    emAberto: Math.max(0, emCentavos(contratado - pagoLiquidoAlocado))
  };
};

export default { totaisDoHonorario, somarCampo, emCentavos };
