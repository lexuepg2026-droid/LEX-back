// ═══════════════════════════════════════════════════════════════════════════
// PROJEÇÃO ALLOWLIST DO PORTAL (DEC-029, registrada desde a Fase 2E.2)
//
// Toda resposta do portal é montada AQUI, campo a campo, por escrita
// explícita. Não existe spread de documento, não existe `delete obj.campo`,
// não existe `.select("-campo")`.
//
// ── Por que allowlist e não blocklist ──────────────────────────────────────
// Blocklist protege o schema de hoje. No dia em que alguém acrescentar um
// campo ao `Client` — uma anotação, um telefone de emergência, um valor de
// acordo —, ele entra na resposta do portal SOZINHO, sem ninguém decidir isso,
// e sem nenhum teste falhar. Com allowlist, o campo novo simplesmente não
// aparece até alguém escrever a linha, e essa linha é a decisão.
//
// ── Por que não reaproveitar os services da advogada ───────────────────────
// `clientService`, `processService` e `documentService` devolvem o documento
// inteiro. Chamar qualquer um deles aqui e "limpar depois" reintroduz a
// blocklist pela porta dos fundos, com o agravante de que o vazamento
// aconteceria dentro de um service que ninguém suspeita. Quem precisa de dado
// desses models lê o model direto e projeta aqui.
//
// ── Fora, sempre ───────────────────────────────────────────────────────────
//   `observacoes` (cliente e processo) — anotação INTERNA da advogada sobre a
//       parte. "Cliente confuso, ligar sempre pela manhã" não é informação
//       para o cliente. É o campo mais perigoso do schema.
//   `senhaPortalHash`, `usuarioId`, `__v`
//   `codigoAcesso` de qualquer vínculo — inclusive o da própria sessão: o
//       cliente já tem o dele, e devolvê-lo o exporia em log e em print de
//       tela sem necessidade nenhuma.
//   todo campo financeiro — honorário, parcela, pagamento (DEC-029 ponto 8).
//   outros participantes do processo (DEC-029 ponto 10).
// ═══════════════════════════════════════════════════════════════════════════

// Data para a resposta: ISO ou null, nunca `undefined`. `undefined` some do
// JSON e o portal não distingue "não tem" de "esqueci de projetar".
const data = (valor) => (valor ? new Date(valor).toISOString() : null);
const texto = (valor) => (valor === undefined || valor === null ? null : String(valor));

// ── Processo ───────────────────────────────────────────────────────────────
// O que o cliente pode ver do processo dele. `descricao` entra: é o resumo que
// a advogada escreve PARA ser lido. `observacoes` não entra, nunca.
export const projetarProcesso = (processo, vinculo) => ({
  id: String(processo._id),
  numeroProcesso: texto(processo.numeroProcesso),
  titulo: texto(processo.titulo),
  tipoAcao: texto(processo.tipoAcao),
  area: texto(processo.area),
  orgao: texto(processo.orgao),
  vara: texto(processo.vara),
  comarca: texto(processo.comarca),
  status: texto(processo.status),
  descricao: texto(processo.descricao),
  dataDistribuicao: data(processo.dataDistribuicao),
  // O papel do PRÓPRIO cliente, não a lista de participantes.
  meuPapel: texto(vinculo.papel),
  souPrincipal: vinculo.principal === true
});

// ── Cliente (só o que identifica a própria pessoa na tela) ─────────────────
// Existe para o portal escrever "Olá, Fulana" e o cliente conferir que entrou
// na conta certa. Não é ficha cadastral: sem endereço, sem RG, sem estado
// civil, sem profissão — o cliente já sabe esses dados, e exibi-los só cria
// superfície de vazamento se um dia a sessão for de outra pessoa.
export const projetarClienteDaSessao = (cliente) => ({
  id: String(cliente._id),
  nome: texto(cliente.tipoPessoa === "juridica" ? cliente.razaoSocial : cliente.nomeCompleto),
  tipoPessoa: texto(cliente.tipoPessoa),
  senhaPortalProvisoria: cliente.senhaPortalProvisoria === true
});

// ── Documento ──────────────────────────────────────────────────────────────
// Metadado do que está liberado, sem o conteúdo. `textoResolvido` fica fora de
// propósito: o portal entrega o ARQUIVO, pela rota de download, e o texto cru
// na listagem seria conteúdo integral trafegando em toda abertura de tela.
//
// `geradoDeModeloId`, `honorarioId`, `substituidoPorId` e `editadoManualmente`
// ficam fora: são rastreabilidade interna. Que a advogada tenha editado a peça
// à mão não é assunto do cliente.
export const projetarDocumento = (documento) => ({
  id: String(documento._id),
  nome: texto(documento.nome),
  tipo: texto(documento.tipo),
  descricao: texto(documento.descricao),
  dataGeracao: data(documento.dataGeracao),
  formatosDisponiveis: ["pdf", "docx"]
});

export const projetarDocumentos = (documentos) => documentos.map(projetarDocumento);

// ── Confirmação de visualização ────────────────────────────────────────────
export const projetarConfirmacao = (confirmacao) => ({
  id: String(confirmacao._id),
  dataHora: data(confirmacao.dataHora),
  textoConfirmado: texto(confirmacao.textoConfirmado),
  instantaneo: {
    statusProcesso: texto(confirmacao.instantaneo?.statusProcesso),
    quantidadeDocumentos: Number(confirmacao.instantaneo?.quantidadeDocumentos ?? 0),
    documentosVisiveis: (confirmacao.instantaneo?.documentosVisiveis ?? []).map(String)
  }
});

export const projetarConfirmacoes = (confirmacoes) => confirmacoes.map(projetarConfirmacao);

// ── Rastro de acesso, para o portal mostrar ao próprio cliente ─────────────
export const projetarAcesso = (vinculo) => ({
  primeiroAcesso: data(vinculo.primeiroAcessoPortal),
  ultimoAcesso: data(vinculo.ultimoAcessoPortal),
  ultimaConfirmacao: data(vinculo.ultimaConfirmacaoEm)
});

export default {
  projetarProcesso,
  projetarClienteDaSessao,
  projetarDocumento,
  projetarDocumentos,
  projetarConfirmacao,
  projetarConfirmacoes,
  projetarAcesso
};
