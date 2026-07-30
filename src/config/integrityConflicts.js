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
export const REGRA_CONFLITO = Object.freeze({
  // Pagamento cujo valor ultrapassa o saldo em aberto da parcela.
  // Acompanha `saldoDisponivel` e `valorParcela`, ambos números.
  PAGAMENTO_EXCEDE_PARCELA: "pagamentoExcedeParcela"
});

export const REGRAS_CONFLITO = Object.freeze(Object.values(REGRA_CONFLITO));
