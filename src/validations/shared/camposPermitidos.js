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
export const checarCamposPermitidos = (
  data,
  permitidos,
  { rotaDelete, rotasProprias = {} } = {}
) => {
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

  // Campo que TEM caminho próprio: a recusa diz qual é. Conferido antes do
  // desconhecido genérico pela mesma razão do `ativo` acima — cair na genérica
  // esconderia que existe um caminho certo para o que a pessoa quis fazer.
  const comRota = enviados.find((campo) => rotasProprias[campo] !== undefined);
  if (comRota) {
    return { campo: comRota, mensagem: rotasProprias[comRota] };
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
  //
  // ── DEC-054 (F-2d) ──────────────────────────────────────────────────────
  //
  // ENTRARAM: `transitoEmJulgadoEm`, `motivoEncerramento`, `liminar`,
  // `liminarObservacao`, `liminarEm`. São carimbo e sinalizador — não são "por
  // onde o processo andou", e por isso não precisam de entrada de histórico.
  //
  // NÃO ENTROU `fase`, e a ausência é a decisão. Mudar de fase é o FATO que a
  // linha do tempo mostra; aceitá-la aqui gravaria a mudança SEM histórico,
  // pelo `findOneAndUpdate` de `updateProcess`. Ela entra na lista logo abaixo
  // (`CAMPOS_COM_ROTA_PROPRIA`) para ser recusada com a mensagem que manda a
  // pessoa a `PATCH /api/processes/:id/fase` — a genérica de campo desconhecido
  // não diria por onde ir.
  //
  // `historicoFase` não está em lugar nenhum, como `historicoAtivacao`: é
  // append-only e não há rota que o aceite.
  processes: Object.freeze([
    "titulo", "numeroProcesso", "tipoAcao", "area", "orgao", "vara", "comarca",
    "status", "descricao", "observacoes", "dataDistribuicao",
    "clientePrincipalId", "clienteId",
    "transitoEmJulgadoEm", "motivoEncerramento",
    "liminar", "liminarObservacao", "liminarEm"
  ]),
  fees: Object.freeze([
    "processoId", "descricao", "valor", "tipo", "percentual", "valorBase",
    "status", "dataVencimento"
  ]),
  installments: Object.freeze([
    "feeId", "numeroParcela", "valor", "dataVencimento", "status",
    "dataPagamento", "observacoes"
  ]),
  // ── DEC-032 (F-1): pagamento é IMUTÁVEL ─────────────────────────────────
  //
  // A lista tinha cinco campos e passou a ter UM. `valor`, `data`,
  // `formaPagamento` e o vínculo com a parcela saíram: corrigir dinheiro
  // gravado deixou de ser edição e virou estorno (DEC-033).
  //
  // O motivo é que um registro de pagamento que muda de valor não é registro,
  // é rascunho — e a advogada precisa poder responder, meses depois, "quanto
  // entrou, quando, e por que parte disso voltou". Um PATCH que reescreve o
  // valor apaga exatamente essa pergunta, sem deixar rastro de que houve
  // correção.
  //
  // `observacoes` fica porque é anotação sobre o fato, não o fato.
  payments: Object.freeze(["observacoes"]),
  secoes: Object.freeze(["titulo", "tipo", "texto"]),
  // `ehModelo` fica na lista de propósito, como `clientePrincipalId` em
  // `processes`: é recusado logo depois com mensagem própria, que manda criar
  // modelo por `POST /documents/modelos`. Tirá-lo daqui trocaria aquela
  // orientação pela genérica de campo desconhecido.
  //
  // ── `urlArquivo`, `tamanho` e `dataUpload` SAÍRAM na Fase F-0 ────────────
  //
  // A decisão 16 do módulo de documentos diz que o caminho de upload fica
  // DORMENTE: o campo `origem` existe, o anteprojeto assinado exclui upload do
  // escopo, e a interface não o oferece. A allowlist, porém, mantinha os três
  // campos abertos, e a auditoria de retomada mediu a consequência:
  //
  //     PATCH /documents/<gerado> { urlArquivo, tamanho, dataUpload } → 200
  //     GET   /documents/<gerado> → origem: "gerado", urlArquivo: "https://…"
  //
  // Um documento GERADO passava a declarar que veio de um arquivo enviado.
  // Não é vulnerabilidade — é o dono dos próprios dados —, mas é estado
  // incoerente aceito em silêncio num módulo cuja tese inteira é que documento
  // gerado é congelado e rastreável até a origem.
  //
  // Dormente passa a significar fechado para ESCRITA também. `origem` fica,
  // porque a validação já o recusa com mensagem própria ("urlArquivo é
  // obrigatório quando origem é upload") — e essa frase diz mais do que a
  // genérica de campo desconhecido. Quando o upload sair da dormência, os três
  // voltam junto com a tela que os preenche.
  documents: Object.freeze([
    "processoId", "nome", "tipo", "descricao", "origem", "visivelPortal",
    "ehModelo"
  ]),
  //
  // ── F-3: o evento do calendário ─────────────────────────────────────────
  //
  // NÃO ENTRARAM `concluido` nem `concluidoEm`, e a ausência é a decisão. Os
  // dois descrevem UM fato — "já aconteceu, e ela marcou isso em tal instante"
  // — e têm um ponto de escrita só (`eventService.concluirEvento`). Aceitá-los
  // aqui deixaria gravar `concluido: true` com `concluidoEm: null`, dois campos
  // discordando sobre o mesmo fato. Entram em `CAMPOS_COM_ROTA_PROPRIA` logo
  // abaixo, para a recusa MANDAR a pessoa a `PATCH /api/events/:id/concluir`.
  //
  // É a mesma decisão da `fase` na DEC-054, pela mesma razão.
  events: Object.freeze([
    "tipo", "titulo", "descricao", "local", "data", "hora", "processoId"
  ])
});

// Caminho do DELETE de cada recurso, para a mensagem do `ativo` mandar a
// pessoa ao lugar certo em vez de só recusar.
export const ROTA_DELETE = Object.freeze({
  clients: "/api/clients/:id",
  processes: "/api/processes/:id",
  fees: "/api/fees/:id",
  installments: "/api/installments/:id",
  payments: "/api/payments/:id",
  secoes: "/api/secoes/:id",
  documents: "/api/documents/:id",
  events: "/api/events/:id"
});

// ── DEC-054 — campos cuja escrita tem ROTA PRÓPRIA ────────────────────────
//
// Não são "desconhecidos": são campos reais do model que este PATCH não é o
// lugar de escrever. A mensagem diz por onde ir, como já fazem `ativo` e
// `clientePrincipalId`.
//
// `fase` está aqui porque toda mudança dela precisa gerar entrada de
// histórico, e o `findOneAndUpdate` de `updateProcess` não geraria nenhuma.
export const CAMPOS_COM_ROTA_PROPRIA = Object.freeze({
  processes: Object.freeze({
    fase:
      'O campo "fase" não é alterado por esta rota, porque toda mudança de fase ' +
      "gera um registro de histórico. Use PATCH /api/processes/:id/fase."
  }),
  // F-3 — `concluido` e `concluidoEm` são um fato só, com carimbo. A rota
  // própria é o que impede os dois de serem gravados em desacordo.
  events: Object.freeze({
    concluido:
      'O campo "concluido" não é alterado por esta rota, porque concluir grava ' +
      "também a data da conclusão. Use PATCH /api/events/:id/concluir.",
    concluidoEm:
      'O campo "concluidoEm" é carimbado pela conclusão e não é enviado. ' +
      "Use PATCH /api/events/:id/concluir."
  })
});

// Açúcar para os services: devolve { campo, mensagem } ou null, já com a rota
// de DELETE do recurso preenchida.
export const checarUpdate = (recurso, data) =>
  checarCamposPermitidos(data, CAMPOS_UPDATE[recurso], {
    rotaDelete: ROTA_DELETE[recurso],
    rotasProprias: CAMPOS_COM_ROTA_PROPRIA[recurso] ?? {}
  });

export default {
  checarCamposPermitidos,
  checarUpdate,
  mensagemAtivo,
  CAMPOS_UPDATE,
  CAMPOS_COM_ROTA_PROPRIA,
  ROTA_DELETE
};
