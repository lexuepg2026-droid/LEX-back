// Vocabulário FECHADO do 409 de integridade referencial.
//
// Quando a exclusão de um recurso é recusada porque outros recursos ativos
// dependem dele, o erro carrega `dependencia` e `quantidade` além da mensagem.
// A mensagem é o que a advogada lê; as duas chaves são para o frontend decidir
// o que oferecer ("ver as 3 parcelas") sem extrair o número por regex de dentro
// da prosa. Foi assim que a Fase 1.3 quebrou, quando o roteamento de etapa do
// cadastro dependia de `/mail/i` bater na mensagem.
//
// `campo` NÃO se usa aqui. `campo` existe para destacar um input em formulário,
// e num 409 de integridade não há input em conflito — o conflito é entre
// registros já gravados.
//
// A lista é fechada e vive só neste arquivo. Sem isso, em três fases existiriam
// `parcelas`, `parcela` e `installments` como valores possíveis e o frontend
// voltaria a chutar. Os valores acompanham a convenção do projeto: nome da
// coleção dependente, em português, no plural.
export const DEPENDENCIA = Object.freeze({
  // Cliente que participa de processos ativos (a junção `processo_clientes`).
  PROCESSOS: "processos",
  // Honorário que tem parcelas ativas.
  PARCELAS: "parcelas",
  // Parcela que tem pagamentos ativos.
  PAGAMENTOS: "pagamentos",
  // Seção vinculada a documentos ativos.
  DOCUMENTOS: "documentos"
});

// Derivado do mapa, e não escrito à mão, para que os dois não possam divergir —
// mesmo recurso usado por `NOMES_VARIAVEIS` em `templateVariables.js`.
export const DEPENDENCIAS = Object.freeze(Object.values(DEPENDENCIA));

// Regras de negócio que também respondem 409 mas NÃO são contagem de
// dependente. `dependencia`/`quantidade` não descreveriam nada nelas, então
// cada uma declara as chaves que descrevem a própria regra. Ver o contrato de
// cada uma no CLAUDE.md.
// ── `pagamentoExcedeParcela` FOI REVOGADA na Fase F-1a ─────────────────────
//
// Ela recusava um FATO: o cliente depositou mais do que a parcela comportava, e
// o sistema mandava a advogada registrar outra coisa. Com a DEC-035 o valor
// atravessa as parcelas seguintes, e com a DEC-036 o que sobra vira
// `saldoAdiantado` — nada se perde e nada é inventado.
//
// Não fica como valor "depreciado" na lista: vocabulário fechado com entrada
// morta é como, em duas fases, alguém volta a emitir a regra achando que ela
// ainda vale. `tests/financial/derivacao.test.js` trava a ausência dela em
// resposta nenhuma.
export const REGRA_CONFLITO = Object.freeze({
  // ── Regras do Financeiro 2.0 (F-1a) ────────────────────────────────────
  //
  // Todas levam os números dentro de `errors`, e não em chave solta: é o que
  // impede a allowlist do `errorHandler` de crescer uma linha por regra.

  // 409 — pagamento ou reparcelamento contra honorário cancelado.
  HONORARIO_CANCELADO: "honorarioCancelado",

  // 422 — estorno acima do líquido. `errors.estornavel` diz o teto.
  ESTORNO_ACIMA_DO_LIQUIDO: "estornoAcimaDoLiquido",
  // 422 — não há mais nada a estornar. `errors.estornavel` sai 0.
  PAGAMENTO_TOTALMENTE_ESTORNADO: "pagamentoTotalmenteEstornado",

  // 409 — a cadeia de anulação de estorno.
  ESTORNO_JA_ANULADO: "estornoJaAnulado",
  ANULACAO_DE_ANULACAO: "anulacaoDeAnulacao",
  ESTORNO_INEXISTENTE: "estornoInexistente",

  // 422 — reparcelamento. `errors.saldoEsperado` e `errors.somaInformada`.
  SOMA_DIVERGE_DO_SALDO: "somaDivergeDoSaldo",
  SEM_SALDO_PARA_REPARCELAR: "semSaldoParaReparcelar"
});

export const REGRAS_CONFLITO = Object.freeze(Object.values(REGRA_CONFLITO));
