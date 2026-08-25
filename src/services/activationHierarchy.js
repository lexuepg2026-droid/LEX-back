// ═══════════════════════════════════════════════════════════════════════════
// DEC-053 (F-2c) — NADA FICA ATIVO DEBAIXO DE COISA INATIVA
//
// ── O achado que gerou a regra ────────────────────────────────────────────
// Na validação da F-2b foi possível REATIVAR um processo cujo cliente estava
// desativado. O estado resultante é um **órfão visível**: o processo aparece
// nas listagens, o cliente não; quem clica no nome do cliente cai num registro
// que o sistema trata como arquivado.
//
// ── Por que a F-2b não pegou ──────────────────────────────────────────────
// A DEC-052 decidiu que reativar o PAI não reativa os FILHOS — para não
// ressuscitar o que foi removido de propósito. Continua valendo. Mas nada foi
// dito sobre o caminho inverso: a cascata sabia o que derrubou, e nada impedia
// um filho de subir sozinho. **A regra existia numa direção só.**
//
// DEC-052 governa a DESCIDA (o pai não arrasta o filho de volta).
// DEC-053 governa a SUBIDA (o filho não sobe sem o pai).
// São a mesma regra vista dos dois lados, e quem mexer numa precisa ler a
// outra.
//
// ── Por que a regra é GERAL, e não "Processo→Cliente" ─────────────────────
// O caso achado era uma INSTÂNCIA de um princípio. Escrever só o caso deixaria
// as outras portas abertas — e a segunda porta não é hipotética: criar um
// honorário novo num processo arquivado faz o órfão NASCER em vez de
// ressuscitar. Por isso a regra tem duas bocas, e as duas são fechadas aqui:
//
//   1. REATIVAR um registro cujo pai está inativo → recusado.
//   2. CRIAR um registro novo sob um pai inativo  → recusado.
//
// ── A recusa NOMEIA o pai ─────────────────────────────────────────────────
// Recusar em silêncio é pior que permitir. A mensagem diz QUAL pai está
// inativo, PELO NOME, e O QUE FAZER. Uma recusa genérica ("não é possível
// reativar") manda a advogada procurar num cadastro de trezentos clientes
// qual deles está fora — e é por isso que a mutação (b) da fase derruba o
// teste: a mensagem genérica É o defeito, não uma variação aceitável.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";

import Client from "../models/Client.js";
import Process from "../models/Process.js";
import Fee from "../models/Fee.js";
import ProcessoCliente from "../models/ProcessoCliente.js";
import { REGRA_CONFLITO } from "../config/integrityConflicts.js";

// ── A ÁRVORE REAL, lida dos models — não presumida ────────────────────────
//
// Levantada na F-2c percorrendo `src/models/*.js`. Só entram aqui as relações
// em que PAI e FILHO têm, os dois, soft delete de verdade (`ativo` que
// significa "excluído"). As exclusões estão anotadas porque a ausência delas é
// o que mais confunde quem chega depois:
//
//   • `Reversal`   — NÃO tem `ativo`, deliberadamente. "Estorno que não vale
//                    mais" é um segundo estorno com `estornoAnuladoId`.
//   • `Allocation` — não tem `ativo`. Sai de cena por `estornoId`.
//   • `Renegotiation` — não tem `ativo`.
//   • `ConfirmacaoVisualizacao` — tem `ativo` por convenção, mas NENHUMA rota
//                    o escreve: é registro probatório, imutável por projeto.
//   • `User`       — é o TENANT, não um pai comum. Fica anotado no fim.
//
// `parentesEfetivos` é a lista de campos que apontam para o pai. Onde há mais
// de um, TODOS contam: um filho com dois pais precisa dos dois de pé.
export const ARVORE_DE_ATIVACAO = Object.freeze({
  Client: Object.freeze({
    colecao: "clients",
    pais: Object.freeze(["User"]),
    // O tenant. Ver a nota no fim do arquivo.
    observacao: "pai é o tenant; não há rota que desative um usuário"
  }),
  Process: Object.freeze({
    colecao: "processes",
    pais: Object.freeze(["Client"]),
    observacao:
      "o pai é o CLIENTE — pelo `clientePrincipalId` e por todo vínculo que a " +
      "cascata da DEC-052 restauraria. É esta relação que produziu o órfão."
  }),
  ProcessoCliente: Object.freeze({
    colecao: "processo_clientes",
    pais: Object.freeze(["Process", "Client"]),
    observacao: "dois pais; o vínculo é a própria aresta Processo↔Cliente"
  }),
  Fee: Object.freeze({
    colecao: "fees",
    pais: Object.freeze(["Process"]),
    // Conferido no model: `Fee` NÃO tem `clienteId`. O cliente alcança o
    // honorário só através do processo, e por isso não é pai direto dele.
    observacao: "Fee não tem clienteId — o único pai é o processo"
  }),
  Installment: Object.freeze({
    colecao: "installments",
    pais: Object.freeze(["Fee", "Process"]),
    observacao: "`processoId` é desnormalizado; `feeId` é o pai de verdade"
  }),
  Payment: Object.freeze({
    colecao: "payments",
    pais: Object.freeze(["Fee", "Process"]),
    observacao: "`ativo` existe por uniformidade; nenhuma rota o escreve"
  }),
  Document: Object.freeze({
    colecao: "documents",
    pais: Object.freeze(["Process", "Client", "Fee"]),
    observacao:
      "`clienteId` e `feeId` são opcionais conforme o tipo. A F-2c mapeou a " +
      "relação e a F-2d fechou as portas: ver a nota do módulo, logo abaixo."
  }),
  Secao: Object.freeze({
    colecao: "secoes",
    pais: Object.freeze(["User"]),
    observacao: "biblioteca da advogada; pai é o tenant"
  }),
  DocumentoSecao: Object.freeze({
    colecao: "documento_secao",
    pais: Object.freeze(["Document", "Secao"]),
    observacao: "dois pais; é a junção documento↔seção"
  }),
  // ── F-3: a DEC-053 alcança Evento ──────────────────────────────────────
  //
  // O pai é OPCIONAL, e é o primeiro da árvore em que isso acontece. Um evento
  // pode existir solto — "nem toda reunião é de um processo" —, e o evento
  // solto simplesmente **não tem pai para estar inativo**: ele não entra na
  // regra, e não porque a regra o dispense, mas porque a pergunta não se aplica.
  //
  // Onde o `processoId` existe, a regra vale inteira e nas duas bocas: o evento
  // não NASCE sob processo desativado e não REATIVA sob processo desativado.
  //
  // Registrar o pai opcional na árvore, em vez de deixar Evento de fora, é o
  // que faz a auditoria de órfãos encontrar o evento vinculado a processo
  // arquivado — que é exatamente o estado que a advogada não veria de outro
  // jeito, porque um compromisso órfão continua aparecendo na agenda dela.
  Event: Object.freeze({
    colecao: "events",
    pais: Object.freeze(["Process"]),
    paiOpcional: true,
    observacao:
      "`processoId` é OPCIONAL — evento solto não tem pai, e a regra não se " +
      "aplica a ele. Onde há processo, as duas bocas valem."
  })
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTO — a lacuna que o passo 204 achou, e o que ela era de fato (F-2d)
//
// ── O achado ─────────────────────────────────────────────────────────────
// A auditoria da F-2c, rodada contra o banco de desenvolvimento em 24/08/2026,
// achou UM órfão, e ele era de Documento:
//
//   Documento → Processo
//     filho ATIVO   : Peticao de Suspensao da Execucao
//     pai   INATIVO : Execucao Fiscal - IPTU
//
// As outras seis relações estavam limpas. A pergunta da F-2d foi: **a cascata
// não alcança o documento, ou alcança e ele escapou?**
//
// ── A resposta, lida dos carimbos do próprio banco ───────────────────────
//   documento criado    : 2026-08-24T13:38:45Z  (nasceu com o processo, ativo)
//   processo desativado : 2026-08-24T13:48:05Z  (`vinculosAfetados: 1`)
//
// **A cascata não o alcança.** O documento nasceu ANTES e continuou ativo: o
// `deleteProcess` derruba os VÍNCULOS processo↔cliente e mais nada — o
// `vinculosAfetados: 1` do histórico é exatamente a contagem deles.
//
// E isso não é defeito da cascata: ela é assim de propósito desde a DEC-052.
// Honorário, parcela e pagamento também não caem junto com o processo. O órfão
// saiu em Documento e não nos outros só porque, nesta base, o processo
// desativado tinha documento e não tinha honorário.
//
// ── Onde a lacuna estava DE VERDADE: a boca 2, com a frase errada ────────
// Os três pontos que criam documento sob um processo — `createDocumentService`,
// a troca de `processoId` no PATCH, e `carregarContexto` da geração —
// **recusavam** o processo inativo. Nunca foi possível criar ali.
//
// Mas recusavam com **404 "Processo não encontrado para este usuário"**, para
// um processo que existe e que a advogada está vendo na tela com a tag
// "Desativado". É literalmente a frase que a DEC-053 nomeou como o defeito, e
// Documento era o único módulo que ainda a dava: a F-2c passou os outros seis
// para `assertProcessoAtivoParaCriar` e deixou este para trás.
//
// A F-2d passa os três. A recusa agora é 409 nomeando o processo.
//
// ── Boca 1 (reativar): fechada POR AUSÊNCIA, e não por guarda ────────────
// **Não existe reativação de documento.** Não há rota (`documentRoutes.js` não
// tem `/reactivate`), `ativo` está fora da allowlist de update, e nenhum
// serviço escreve `ativo: true` num documento já desativado.
//
// Não se acrescenta guarda para um caminho que não existe — é a mesma decisão
// escrita para `PAI_TENANT` no fim deste arquivo, e pelo mesmo motivo: guarda
// que nunca roda é código que ninguém consegue testar sem fabricar o estado por
// fora do sistema. O que se faz é TRAVAR A AUSÊNCIA por teste, para que o dia
// em que a reativação de documento nascer ela nasça já sabendo desta regra.
//
// ── O órfão FICA no banco de desenvolvimento, de propósito ───────────────
// Ele não é consertado por script — a escolha entre desativar o filho e
// reativar o pai é da advogada, e essa regra não muda. Ele fica como **caso
// vivo**: prova que a auditoria continua achando, enquanto os testes provam
// que um novo não pode mais nascer com a mensagem errada.
// ═══════════════════════════════════════════════════════════════════════════

// ── Nome de exibição ──────────────────────────────────────────────────────
//
// A mensagem tem de NOMEAR o pai, e cliente PF e PJ guardam o nome em campos
// diferentes. Sem este ponto único, metade das mensagens sairia com o nome
// vazio para pessoa jurídica — que é o caso em que o "nome" mais importa,
// porque razão social é o que a advogada procura no cadastro.
export const nomeDoCliente = (cliente) =>
  cliente?.nomeCompleto?.trim() ||
  cliente?.razaoSocial?.trim() ||
  cliente?.nomeFantasia?.trim() ||
  "(sem nome)";

export const nomeDoProcesso = (processo) =>
  processo?.titulo?.trim() || processo?.numeroProcesso?.trim() || "(sem título)";

// ── A frase ───────────────────────────────────────────────────────────────
//
// Um pai ou vários, e o texto muda de número — "o cliente X está desativado"
// contra "os clientes X e Y estão desativados". Concordância errada numa
// mensagem que a advogada lê todo dia é o tipo de coisa que faz o sistema
// parecer improvisado.
//
// `acao` é o verbo do que foi recusado ("reativar", "criar"), e a segunda
// frase diz o que fazer — sempre reativar o PAI, que é a única saída.
const listarNomes = (nomes) => {
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
};

const ROTULO_SINGULAR = Object.freeze({
  Client: "o cliente",
  Process: "o processo",
  Fee: "o honorário",
  Document: "o documento",
  Secao: "a seção"
});

const ROTULO_PLURAL = Object.freeze({
  Client: "os clientes",
  Process: "os processos",
  Fee: "os honorários",
  Document: "os documentos",
  Secao: "as seções"
});

const IMPERATIVO = Object.freeze({
  Client: "Reative o cliente primeiro.",
  Process: "Reative o processo primeiro.",
  Fee: "Reative o honorário primeiro.",
  Document: "Reative o documento primeiro.",
  Secao: "Reative a seção primeiro."
});

const IMPERATIVO_PLURAL = Object.freeze({
  Client: "Reative os clientes primeiro.",
  Process: "Reative os processos primeiro.",
  Fee: "Reative os honorários primeiro.",
  Document: "Reative os documentos primeiro.",
  Secao: "Reative as seções primeiro."
});

export const mensagemDePaiInativo = (pais, acao) => {
  const tipos = [...new Set(pais.map((p) => p.tipo))];
  const nomes = pais.map((p) => p.nome);
  const plural = pais.length > 1;

  // Mais de um TIPO de pai bloqueando é possível (um documento sob processo e
  // cliente desativados). A frase então não tenta concordar por tipo — nomeia
  // todos e manda reativar os registros, que é a instrução correta em ambos.
  if (tipos.length > 1) {
    return (
      `Não é possível ${acao}: ${listarNomes(nomes)} estão desativados. ` +
      `Reative-os primeiro.`
    );
  }

  const tipo = tipos[0];
  const rotulo = plural ? ROTULO_PLURAL[tipo] : ROTULO_SINGULAR[tipo];
  const verbo = plural ? "estão desativados" : "está desativado";
  const instrucao = plural ? IMPERATIVO_PLURAL[tipo] : IMPERATIVO[tipo];

  return `Não é possível ${acao}: ${rotulo} ${listarNomes(nomes)} ${verbo}. ${instrucao}`;
};

// O erro. 409 — é conflito entre registros já gravados, não campo de
// formulário inválido; por isso não leva `campo`, pela mesma razão escrita em
// `integrityConflicts.js` para os 409 de integridade.
export const erroDePaiInativo = (pais, acao) => {
  const erro = new Error(mensagemDePaiInativo(pais, acao));
  erro.statusCode = 409;
  erro.regra = REGRA_CONFLITO.PAI_INATIVO;
  erro.errors = {
    paisInativos: pais.map((p) => ({ tipo: p.tipo, id: String(p.id), nome: p.nome }))
  };
  return erro;
};

// ── Boca 1: REATIVAR ──────────────────────────────────────────────────────

// Os pais inativos de um PROCESSO.
//
// Não basta olhar `clientePrincipalId`: um cliente pode ser litisconsorte sem
// nunca ser principal, e reativar o processo restauraria o vínculo dele —
// criando exatamente o mesmo órfão, só que num participante secundário. É a
// mesma razão pela qual `deleteClient` olha a JUNÇÃO e não o campo do processo.
//
// O conjunto examinado é: o principal MAIS todo cliente cujo vínculo a cascata
// da DEC-052 restauraria (`desativadoPorCascataDe: processoId`). Vínculo
// removido À MÃO fica de fora — ele NÃO volta na reativação, então o estado do
// cliente dele não importa aqui. Incluí-lo recusaria a reativação por causa de
// um cliente que continuaria desvinculado.
export const findInactiveParentsOfProcess = async (usuarioId, processo) => {
  const ids = new Set();

  if (processo.clientePrincipalId) {
    ids.add(String(processo.clientePrincipalId._id ?? processo.clientePrincipalId));
  }

  const vinculosQueVoltam = await ProcessoCliente.find({
    usuarioId,
    processoId: processo._id,
    ativo: false,
    desativadoPorCascataDe: processo._id
  }).select("clienteId");

  for (const vinculo of vinculosQueVoltam) ids.add(String(vinculo.clienteId));

  if (ids.size === 0) return [];

  const inativos = await Client.find({
    _id: { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) },
    usuarioId,
    ativo: false
  }).select("nomeCompleto razaoSocial nomeFantasia");

  return inativos.map((c) => ({ tipo: "Client", id: c._id, nome: nomeDoCliente(c) }));
};

// ── A mesma pergunta, para uma PÁGINA inteira ─────────────────────────────
//
// A listagem precisa saber, por linha, se "Reativar" é oferecível — e a tela
// tem de saber ANTES de a advogada clicar, senão ela clica e leva a recusa.
//
// Duas consultas para a página inteira, não duas POR LINHA. Uma listagem de 20
// processos desativados faria 40 idas ao banco pelo caminho ingênuo, e a
// diferença aparece justamente na tela que mais mostra desativado — a filtrada
// por "Somente desativados".
//
// Só processos DESATIVADOS entram: para um processo ativo a pergunta não se
// aplica (ele não vai ser reativado), e incluí-los faria a consulta varrer a
// página toda para descartar quase tudo.
export const findInactiveParentsForProcesses = async (usuarioId, processos) => {
  const desativados = processos.filter((p) => p.ativo === false);
  const porProcesso = new Map();
  if (desativados.length === 0) return porProcesso;

  const idsDeProcesso = desativados.map((p) => p._id);

  // 1ª consulta: os vínculos que a cascata restauraria, de todos eles.
  const vinculos = await ProcessoCliente.find({
    usuarioId,
    processoId: { $in: idsDeProcesso },
    ativo: false,
    desativadoPorCascataDe: { $in: idsDeProcesso }
  }).select("processoId clienteId desativadoPorCascataDe");

  // Candidatos por processo: o principal mais os clientes dos vínculos.
  const candidatos = new Map();
  const todosOsClientes = new Set();

  for (const processo of desativados) {
    const chave = String(processo._id);
    const conjunto = new Set();
    if (processo.clientePrincipalId) {
      const id = String(processo.clientePrincipalId._id ?? processo.clientePrincipalId);
      conjunto.add(id);
      todosOsClientes.add(id);
    }
    candidatos.set(chave, conjunto);
  }

  for (const vinculo of vinculos) {
    // A marca é que diz de QUAL processo o vínculo caiu — e num litisconsórcio
    // o mesmo cliente aparece em vários. Agrupar pelo `processoId` sem olhar a
    // marca misturaria vínculo removido à mão com vínculo de cascata.
    const chave = String(vinculo.desativadoPorCascataDe);
    const id = String(vinculo.clienteId);
    candidatos.get(chave)?.add(id);
    todosOsClientes.add(id);
  }

  if (todosOsClientes.size === 0) return porProcesso;

  // 2ª consulta: quais desses clientes estão inativos. Só os inativos voltam —
  // é a resposta inteira, e trazer os ativos junto seria trazer a página de
  // clientes para descartá-la aqui.
  const inativos = await Client.find({
    _id: { $in: [...todosOsClientes].map((id) => new mongoose.Types.ObjectId(id)) },
    usuarioId,
    ativo: false
  }).select("nomeCompleto razaoSocial nomeFantasia");

  if (inativos.length === 0) return porProcesso;

  const porId = new Map(inativos.map((c) => [String(c._id), c]));

  for (const [chave, conjunto] of candidatos) {
    const bloqueadores = [...conjunto]
      .filter((id) => porId.has(id))
      .map((id) => ({ tipo: "Client", id, nome: nomeDoCliente(porId.get(id)) }));
    if (bloqueadores.length > 0) porProcesso.set(chave, bloqueadores);
  }

  return porProcesso;
};

// ── Boca 2: CRIAR ─────────────────────────────────────────────────────────
//
// Distingue "não existe" de "está desativado".
//
// As duas respostas já eram RECUSA antes da F-2c — todo `findOne` de pai no
// projeto filtra `ativo: true`, e o levantamento da fase confirmou isso em
// `createProcess`, `createFee`, `createInstallment`, `createPayment`,
// `createDocument` e `vincularSecao`. O que muda aqui não é o SE, é o PORQUÊ:
// um 404 "Processo não encontrado" para um processo que existe e está
// arquivado manda a advogada procurar um registro que ela está vendo na tela
// com a tag "Desativado".
export const assertProcessoAtivoParaCriar = async (usuarioId, processoId, acao = "criar") => {
  // Documento INTEIRO, sem `select`: os chamadores desta guarda usam o
  // processo que ela devolve (`ensureProcessBelongsToUser` em `feeService`
  // devolve-o adiante). Uma projeção enxuta aqui economizaria bytes e
  // entregaria ao chamador um documento sem os campos que ele lê — o tipo de
  // regressão que só aparece no consumidor, longe daqui.
  const processo = await Process.findOne({ _id: processoId, usuarioId });

  // Inexistente continua 404, e continua sendo o caminho de quem manda um id
  // de outro usuário — a mensagem não confirma nem nega a existência alheia.
  if (!processo) {
    const erro = new Error("Processo não encontrado para este usuário");
    erro.statusCode = 404;
    throw erro;
  }

  if (!processo.ativo) {
    throw erroDePaiInativo(
      [{ tipo: "Process", id: processo._id, nome: nomeDoProcesso(processo) }],
      acao
    );
  }

  return processo;
};

export const assertFeeAtivoParaCriar = async (usuarioId, feeId, acao = "criar") => {
  // Documento inteiro, pela mesma razão do processo acima: `buscarFeeDoUsuario`
  // e `carregarFeeParaPagamento` devolvem este objeto para quem calcula
  // parcela e alocação em cima dos valores dele.
  const fee = await Fee.findOne({ _id: feeId, usuarioId });

  if (!fee) {
    const erro = new Error("Honorário não encontrado para este usuário");
    erro.statusCode = 404;
    throw erro;
  }

  if (!fee.ativo) {
    throw erroDePaiInativo(
      [{ tipo: "Fee", id: fee._id, nome: fee.descricao?.trim() || "(sem descrição)" }],
      acao
    );
  }

  return fee;
};

// ── Boca 1 para EVENTO: reativar (F-3) ────────────────────────────────────
//
// Diferente de Processo, aqui não há junção a consultar: o evento tem no
// máximo UM pai, e ele está no próprio documento. A função devolve `[]` para o
// evento solto — sem pai, não há pai inativo, e a reativação segue.
//
// Devolve vetor (e não um objeto ou `null`) porque é o formato que
// `erroDePaiInativo` e `errors.paisInativos` já falam, em todo o resto da
// DEC-053. Um formato próprio aqui obrigaria o `errorHandler` e a tela a
// conhecerem dois.
export const findInactiveParentsOfEvent = async (usuarioId, evento) => {
  if (!evento?.processoId) return [];

  const processoId = evento.processoId._id ?? evento.processoId;

  const processo = await Process.findOne({
    _id: processoId,
    usuarioId,
    ativo: false
  }).select("titulo numeroProcesso");

  if (!processo) return [];

  return [{ tipo: "Process", id: processo._id, nome: nomeDoProcesso(processo) }];
};

// ── O tenant não entra na regra, e isso é decisão ─────────────────────────
//
// `Client` e `Secao` penduram em `User`. `User.ativo` existe, mas NENHUMA rota
// o escreve — não há "desativar usuário" no sistema — e o middleware de
// autenticação não filtra por ele. Um usuário inativo, hoje, é um estado que
// só existe se alguém editar o banco à mão.
//
// Fica registrado em vez de implementado: uma guarda contra um estado
// inalcançável é código que nunca roda e que ninguém consegue testar sem
// fabricar o estado por fora do sistema. Quando existir desativação de
// usuário, esta é a linha que precisa virar guarda — e o teste
// `arvore.test.js` trava a árvore para que a relação não suma do mapa
// enquanto isso.
export const PAI_TENANT = Object.freeze(["Client", "Secao"]);

export default {
  ARVORE_DE_ATIVACAO,
  nomeDoCliente,
  nomeDoProcesso,
  mensagemDePaiInativo,
  erroDePaiInativo,
  findInactiveParentsOfProcess,
  findInactiveParentsForProcesses,
  assertProcessoAtivoParaCriar,
  assertFeeAtivoParaCriar,
  findInactiveParentsOfEvent,
  PAI_TENANT
};
