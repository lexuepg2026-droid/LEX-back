// ═══════════════════════════════════════════════════════════════════════════
// ALLOWLIST DE CAMPOS DE UPDATE — o contorno do `ativo` fechado (Fase 4.5)
//
// Achados #1, #2 e #11 da Auditoria Geral nº 2, corrigidos juntos porque são o
// mesmo assunto: enquanto UM módulo aceitar campo desconhecido, o `ativo` entra
// por ele.
//
// ── O que a auditoria mediu, e o que esta fase confirmou por execução ──────
// `PATCH { "ativo": false }` contra a base do seed, antes da correção:
//
//   clients       200  → desativado
//   processes     404  → desativado  ← ver o parágrafo seguinte
//   fees          200  → desativado
//   installments  200  → desativado
//   payments      200  → desativado  (`ativo` estava na allowlist DE PROPÓSITO)
//   secoes        400  → bloqueado   (única fechada antes desta fase)
//   documents     400  → bloqueado   (guarda própria, desde a Fase 2A)
//
// O caso do processo é o pior dos sete e não estava no relatório da auditoria:
// `updateProcess` grava com `findOneAndUpdate({ ativo: true })` e depois relê
// por `getProcessById`, que também filtra `ativo: true`. Com `ativo: false` no
// corpo, a escrita ACONTECE e a releitura não encontra mais nada — a rota
// responde "Processo não encontrado" para uma requisição que acabou de
// desativar o processo. Destruição relatada como erro de busca.
//
// ── A regra ───────────────────────────────────────────────────────────────
// `ativo` NÃO pertence a allowlist nenhuma. Desativar é papel do DELETE, que é
// onde moram os 409 de integridade com `dependencia`/`quantidade` — e é
// justamente essa checagem que o corpo do PATCH pulava. Reativar é papel das
// rotas de reativação da Fase 4.5, que têm guardas próprias.
//
// Campo fora da allowlist responde 400 com `campo`, para a tela destacar o
// input em vez de exibir um erro solto. A mensagem nomeia o campo recusado:
// "campo desconhecido" sem dizer qual é inútil num formulário de 15 campos.
// ═══════════════════════════════════════════════════════════════════════════

// Mensagem única do `ativo`, para os seis módulos dizerem a mesma coisa. O
// caminho do DELETE entra montado pelo chamador porque cada recurso tem o seu.
export const mensagemAtivo = (rotaDelete) =>
  `O campo "ativo" não é alterado por esta rota. Use DELETE ${rotaDelete} para desativar, ` +
  `e a rota de reativação para reativar.`;

// Devolve { campo, mensagem } para o PRIMEIRO campo recusado, ou null.
//
// `ativo` é conferido antes dos demais desconhecidos: é o campo com mensagem
// própria, e cair na genérica ("campo desconhecido: ativo") esconderia que
// existe um caminho certo para o que a pessoa quis fazer.
export const checarCamposPermitidos = (data, permitidos, { rotaDelete } = {}) => {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { campo: null, mensagem: "Payload inválido" };
  }

  const enviados = Object.keys(data);

  if (enviados.includes("ativo")) {
    return {
      campo: "ativo",
      mensagem: rotaDelete
        ? mensagemAtivo(rotaDelete)
        : 'O campo "ativo" não é alterado por esta rota.'
    };
  }

  const desconhecido = enviados.find((campo) => !permitidos.includes(campo));
  if (desconhecido) {
    return {
      campo: desconhecido,
      mensagem: `Campo não permitido nesta atualização: "${desconhecido}"`
    };
  }

  return null;
};

// ── As allowlists, num lugar só ────────────────────────────────────────────
//
// Ficam aqui e não em cada `*Validation.js` porque o contrato desta fase é
// "todos os módulos recusam o desconhecido do mesmo jeito". Espalhadas, o
// próximo módulo a nascer copiaria o formato de um dos seis e a uniformidade
// duraria uma fase.
//
// Nenhuma inclui `ativo`. `payments` incluía até esta fase, DE PROPÓSITO
// (`CAMPOS_PERMITIDOS_UPDATE` em `paymentValidation.js`) — era o único módulo
// em que o contorno não era descuido, e é mudança de contrato consciente.
//
// `processes` mantém `clientePrincipalId` e `clienteId` na lista de propósito:
// os dois são recusados logo depois, com a mensagem que manda usar
// `PATCH /processes/:id/clientes/:clienteId/principal`. Tirá-los daqui trocaria
// aquela orientação pela genérica de campo desconhecido — perda de informação.
export const CAMPOS_UPDATE = Object.freeze({
  clients: Object.freeze([
    "tipoPessoa", "nomeCompleto", "cpf", "rg", "dataNascimento", "sexo",
    "estadoCivil", "profissao", "nacionalidade", "razaoSocial", "nomeFantasia",
    "cnpj", "representanteLegal", "email", "telefone", "endereco",
    "observacoes", "senhaPortal"
  ]),
  processes: Object.freeze([
    "titulo", "numeroProcesso", "tipoAcao", "area", "orgao", "vara", "comarca",
    "status", "descricao", "observacoes", "dataDistribuicao",
    "clientePrincipalId", "clienteId"
  ]),
  fees: Object.freeze([
    "processoId", "descricao", "valor", "tipo", "percentual", "valorBase",
    "status", "dataVencimento"
  ]),
  installments: Object.freeze([
    "feeId", "numeroParcela", "valor", "dataVencimento", "status",
    "dataPagamento", "observacoes"
  ]),
  payments: Object.freeze([
    "installmentId", "valorPago", "dataPagamento", "formaPagamento",
    "observacoes"
  ]),
  secoes: Object.freeze(["titulo", "tipo", "texto"])
});

// Caminho do DELETE de cada recurso, para a mensagem do `ativo` mandar a
// pessoa ao lugar certo em vez de só recusar.
export const ROTA_DELETE = Object.freeze({
  clients: "/api/clients/:id",
  processes: "/api/processes/:id",
  fees: "/api/fees/:id",
  installments: "/api/installments/:id",
  payments: "/api/payments/:id",
  secoes: "/api/secoes/:id"
});

// Açúcar para os services: devolve { campo, mensagem } ou null, já com a rota
// de DELETE do recurso preenchida.
export const checarUpdate = (recurso, data) =>
  checarCamposPermitidos(data, CAMPOS_UPDATE[recurso], {
    rotaDelete: ROTA_DELETE[recurso]
  });

export default {
  checarCamposPermitidos,
  checarUpdate,
  mensagemAtivo,
  CAMPOS_UPDATE,
  ROTA_DELETE
};
