// ═══════════════════════════════════════════════════════════════════════════
// CONSULTA DO PORTAL DO CLIENTE
//
// Lê os models DIRETO e projeta por `portalProjection`. Não chama
// `clientService`, `processService` nem `documentService` — eles devolvem o
// documento inteiro, e usá-los aqui vazaria `observacoes` no dia em que
// alguém acrescentasse um campo, sem nenhum teste falhar.
//
// ── A checagem tripla ─────────────────────────────────────────────────────
// Todo documento que o portal entrega precisa satisfazer, ao mesmo tempo:
//   `processoId` == o processo da SESSÃO
//   `clienteId`  == o cliente da SESSÃO
//   `visivelPortal: true` && `ativo: true` && `origem: "gerado"`
//
// O filtro por `clienteId` não é redundante com o de processo: num
// litisconsórcio, o processo é o mesmo e cada participante tem a SUA
// procuração. Sem ele, um litisconsorte leria a peça do outro — dado pessoal
// de terceiro, dentro do mesmo processo.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";

import Document from "../models/Document.js";
import ProcessoCliente from "../models/ProcessoCliente.js";
import Process from "../models/Process.js";
import {
  projetarProcesso, projetarClienteDaSessao, projetarDocumentos,
  projetarDocumento, projetarAcesso, projetarResumoDoProcesso
} from "./portalProjection.js";

// Filtro único dos documentos visíveis ao portal. Fica em função para que as
// três rotas que precisam dele (listagem, download, instantâneo da
// confirmação) não possam divergir — se divergirem, o instantâneo do recibo
// deixaria de descrever o que o cliente de fato via.
export const filtroDocumentosVisiveis = ({ processoId, clienteId }) => ({
  processoId,
  clienteId,
  visivelPortal: true,
  ativo: true,
  origem: "gerado"
});

export const listarDocumentosVisiveis = ({ processoId, clienteId }) =>
  Document.find(filtroDocumentosVisiveis({ processoId, clienteId })).sort({ dataGeracao: -1 });

// ── "Seus processos" (Fase 2.5, DEC-092) ─────────────────────────────────
// Os vínculos ATIVOS e LIBERADOS da pessoa, de processos ATIVOS da mesma
// advogada — o mesmo filtro que `exigirVinculoLiberado` aplica a cada
// requisição, para a lista nunca mostrar um processo que abrir recusaria.
//
// Os indicadores saem de UMA consulta aos documentos visíveis de todos os
// processos da lista, e não de uma por processo:
//   `documentosVisiveis`   quantos documentos ela pode ver;
//   `documentosNovos`      quantos chegaram DEPOIS da última confirmação dela
//                          naquele processo (todos, se nunca confirmou);
//   `confirmacaoPendente`  há documento novo — o mesmo critério do selo
//                          "acessou, não confirmou" do lado da advogada.
export const listarProcessos = async (portal) => {
  const vinculos = await ProcessoCliente.find({
    clienteId: portal.clienteId,
    usuarioId: portal.usuarioId,
    ativo: true,
    liberadoNoPortal: true
  });

  const processos = await Process.find({
    _id: { $in: vinculos.map((v) => v.processoId) },
    usuarioId: portal.usuarioId,
    ativo: true
  }).sort({ createdAt: -1, _id: -1 });

  const documentos = await Document.find({
    ...filtroDocumentosVisiveis({ processoId: null, clienteId: portal.clienteId }),
    processoId: { $in: processos.map((p) => p._id) }
  }).select("processoId dataGeracao");

  const vinculoDe = new Map(vinculos.map((v) => [String(v.processoId), v]));

  const data = processos.map((processo) => {
    const vinculo = vinculoDe.get(String(processo._id));
    const confirmadoEm = vinculo.ultimaConfirmacaoEm ? new Date(vinculo.ultimaConfirmacaoEm) : null;
    const doProcesso = documentos.filter((d) => String(d.processoId) === String(processo._id));
    const novos = doProcesso.filter(
      (d) => !confirmadoEm || (d.dataGeracao && new Date(d.dataGeracao) > confirmadoEm)
    ).length;
    return projetarResumoDoProcesso(processo, vinculo, {
      documentosVisiveis: doProcesso.length,
      documentosNovos: novos
    });
  });

  return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
};

export const obterProcesso = (portal) => ({
  processo: projetarProcesso(portal.processo, portal.vinculo),
  cliente: projetarClienteDaSessao(portal.cliente),
  acesso: projetarAcesso(portal.vinculo)
});

export const obterDocumentos = async (portal) => {
  const documentos = await listarDocumentosVisiveis({
    processoId: portal.processoId,
    clienteId: portal.clienteId
  });

  const data = projetarDocumentos(documentos);

  // Mesmo envelope de listagem do resto da API. O conjunto é pequeno por
  // natureza (documentos de UM processo, de UM participante) e não pagina:
  // uma página só, `limit` igual ao tamanho — a mesma forma que
  // `listarParticipantes` já usa.
  return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
};

// Documento fora do escopo → 404, NUNCA 403.
//
// 403 significa "existe, mas você não pode": confirma a existência do
// documento para quem só tem o id. Com 404 o portal não distingue "não existe"
// de "não é seu" — que é a mesma escolha já feita em
// `processoClienteService.assertClientesDoUsuario`.
export const obterDocumentoParaDownload = async (portal, documentoId) => {
  if (!mongoose.Types.ObjectId.isValid(documentoId)) {
    const error = new Error("Documento não encontrado");
    error.statusCode = 404;
    throw error;
  }

  const documento = await Document.findOne({
    _id: documentoId,
    ...filtroDocumentosVisiveis({
      processoId: portal.processoId,
      clienteId: portal.clienteId
    })
  });

  if (!documento) {
    const error = new Error("Documento não encontrado");
    error.statusCode = 404;
    throw error;
  }

  return documento;
};

export const obterDocumento = async (portal, documentoId) =>
  projetarDocumento(await obterDocumentoParaDownload(portal, documentoId));

// ── Registro de acesso (Parte 4.3) ────────────────────────────────────────
// Atividade, não recibo: NÃO notifica a advogada e não é confirmação.
//
// UMA operação, por pipeline de atualização, e não duas.
//
// A primeira versão fazia dois `updateOne` — um condicional para o primeiro
// acesso, outro para o último — e ainda por cima sem `await`, para não atrasar
// a resposta. Isso produzia corrida: a escrita podia não ter terminado quando
// a requisição seguinte lia o vínculo, e o teste do rastro falhava de forma
// intermitente. Rastro que às vezes grava é pior que rastro nenhum, porque a
// advogada olharia "nunca acessou" para alguém que acessou.
//
// O pipeline resolve os dois campos numa ida só: `$ifNull` mantém o primeiro
// acesso se já existir, e `$$NOW` é a hora do BANCO — mesma referência para
// todas as instâncias da API, ao contrário de `new Date()` do processo.
//
// Agora é aguardado. Uma ida ao banco por requisição de portal é custo aceitável
// para que o rastro seja determinístico e observável.
//
// O `catch` continua: erro ao gravar atividade não pode impedir o cliente de
// ler o processo dele. É exceção deliberada à regra do projeto de propagar erro.
// `updatePipeline: true` é EXIGIDO pelo Mongoose 9 para update por pipeline —
// sem ele lança "Cannot pass an array to query updates". O `catch` abaixo
// engoliu exatamente esse erro na primeira versão, e o rastro simplesmente não
// gravava, em silêncio. Por isso o catch passa a berrar no console fora de
// produção, como o `errorHandler` já faz: engolir erro é decisão sobre o que
// acontece com a REQUISIÇÃO, não licença para esconder o defeito de quem está
// desenvolvendo.
export const registrarAcesso = async (processoClienteId) => {
  try {
    await ProcessoCliente.updateOne(
      { _id: processoClienteId },
      [
        {
          $set: {
            primeiroAcessoPortal: { $ifNull: ["$primeiroAcessoPortal", "$$NOW"] },
            ultimoAcessoPortal: "$$NOW"
          }
        }
      ],
      { updatePipeline: true }
    );
  } catch (error) {
    // Rastro de atividade não vale uma requisição quebrada — mas também não
    // pode falhar sem ninguém ficar sabendo.
    if (process.env.NODE_ENV !== "production") {
      console.error("[portal] falha ao registrar acesso:", error.message);
    }
  }
};

export default {
  listarProcessos,
  obterProcesso,
  obterDocumentos,
  obterDocumento,
  obterDocumentoParaDownload,
  listarDocumentosVisiveis,
  filtroDocumentosVisiveis,
  registrarAcesso
};
