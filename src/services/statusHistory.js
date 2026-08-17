// ═══════════════════════════════════════════════════════════════════════════
// HISTÓRICO DE STATUS DO HONORÁRIO — DEC-038 (Fase F-1)
//
// Ponto ÚNICO de mudança de `Fee.status`. Nenhum outro arquivo escreve o campo
// direto — e é essa exclusividade que faz o histórico valer alguma coisa.
//
// Um array append-only cuja escrita estivesse espalhada por três services
// registraria as transições que alguém lembrou de registrar, e a advogada
// leria os buracos como "não mudou". Pior que histórico nenhum: um incompleto
// parece completo.
//
// ── Por que uma função, e não um hook `pre("save")` ───────────────────────
// O hook não sabe a ORIGEM. `pre("save")` enxerga que `status` mudou de
// `pendente` para `pago`, mas não se foi recálculo, cancelamento explícito ou
// reparcelamento — que é justamente a informação que distingue "o sistema
// derivou" de "alguém decidiu". Passar a origem por uma propriedade temporária
// no documento para o hook ler seria o mesmo acoplamento com um passo a mais.
// ═══════════════════════════════════════════════════════════════════════════

export const ORIGEM_STATUS = Object.freeze({
  CRIACAO: "criacao",
  RECALCULO: "recalculo",
  CANCELAMENTO: "cancelamento",
  REPARCELAMENTO: "reparcelamento"
});

// Aplica o status novo ao documento e registra a transição. NÃO salva — quem
// chama decide quando gravar, porque quase sempre há outras mudanças no mesmo
// `save()`.
//
// Devolve `true` quando houve transição, para o chamador saber se precisa
// gravar. Status igual não vira linha de histórico: um recálculo que confirma
// `pendente` mil vezes encheria o array de ruído e enterraria as mudanças
// reais.
export const registrarStatus = (fee, novoStatus, origem) => {
  if (!fee) return false;
  if (!Object.values(ORIGEM_STATUS).includes(origem)) {
    throw new Error(`origem de status desconhecida: ${origem}`);
  }

  const anterior = fee.status ?? null;
  if (anterior === novoStatus) return false;

  fee.status = novoStatus;

  // `push` e não reatribuição do array: o Mongoose precisa marcar o caminho
  // como modificado, e trocar a referência num array de subdocumentos é o
  // caminho mais fácil de perder a marcação em um `save()` parcial.
  fee.historicoStatus.push({
    de: anterior,
    para: novoStatus,
    data: new Date(),
    origem
  });

  return true;
};

// A linha de NASCIMENTO do honorário. Separada de `registrarStatus` porque a
// criação não é uma transição: não há `de`, e `registrarStatus` recusaria o
// caso justamente por comparar anterior com novo (num honorário recém-criado os
// dois são `pendente`, e ele devolveria `false`).
//
// Sem esta linha o histórico começaria no primeiro pagamento, e a advogada
// leria "pendente → parcialmente_pago" sem nada dizendo desde quando o
// honorário existia. Também mantém verdadeira a invariante de que
// `historicoStatus[0].de === null` — o começo da cadeia é reconhecível.
export const registrarCriacao = (fee) => {
  if (!fee) return false;
  if (fee.historicoStatus?.length > 0) return false;

  fee.historicoStatus.push({
    de: null,
    para: fee.status,
    data: new Date(),
    origem: ORIGEM_STATUS.CRIACAO
  });

  return true;
};

export default { registrarStatus, registrarCriacao, ORIGEM_STATUS };
