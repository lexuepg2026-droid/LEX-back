import mongoose from "mongoose";
import Client from "../models/Client.js";
import Process from "../models/Process.js";
import ProcessoCliente from "../models/ProcessoCliente.js";

// ═══════════════════════════════════════════════════════════════════════════
// QUAIS PROCESSOS ESTÃO (OU NÃO) LIBERADOS NO PORTAL — uma regra, dois usos
//
// Nasceu em `dashboardService` (DEC-104, revista na DEC-108) para o cartão
// "Processos não liberados" do Início. Na Fase 3.4 (DEC-115) a lista de
// processos ganhou o filtro `?portal=`, e o cartão leva a ela: os dois números
// PRECISAM ser o mesmo. Por isso a regra mora aqui, uma vez, e os dois lados
// a chamam — uma cópia na lista divergiria na primeira correção.
//
// Um vínculo CONTA quando:
//   - está ativo;
//   - o cliente está ativo e TEM acesso ao portal (senha definida — a mesma
//     regra do `temAcessoPortal` de `processoClienteService`);
//   - o processo está ativo (a cascata da desativação já derruba o vínculo, e
//     a conferência é rede).
//
// Devolve os ids (string) dos processos com pelo menos um vínculo que conta e
// tem `liberadoNoPortal` igual ao pedido, ordenados para a resposta ser
// estável.
// ═══════════════════════════════════════════════════════════════════════════
// Fase 3.5 (DEC-119): a regra virou `vinculosQueContam`, que devolve os
// VÍNCULOS; os processos e os clientes saem dela. A lista de clientes pergunta
// "quem tem processo não liberado?" — a mesma regra, lida pelo outro lado do
// vínculo. Uma cópia da regra na lista de clientes divergiria do cartão.
const vinculosQueContam = async (usuarioId, liberado) => {
  const uid = new mongoose.Types.ObjectId(usuarioId);
  const vinculos = await ProcessoCliente.find({
    usuarioId: uid, ativo: true, liberadoNoPortal: liberado === true
  }).select("clienteId processoId");
  if (vinculos.length === 0) return [];

  const [comPortal, processosAtivos] = await Promise.all([
    Client.find({
      _id: { $in: vinculos.map((v) => v.clienteId) },
      usuarioId: uid,
      ativo: true,
      senhaPortalHash: { $nin: [null, ""] }
    }).select("_id"),
    Process.find({
      _id: { $in: vinculos.map((v) => v.processoId) },
      usuarioId: uid,
      ativo: true
    }).select("_id")
  ]);
  const clientes = new Set(comPortal.map((c) => String(c._id)));
  const processos = new Set(processosAtivos.map((p) => String(p._id)));
  return vinculos.filter((v) => clientes.has(String(v.clienteId)) && processos.has(String(v.processoId)));
};

const distintosOrdenados = (ids) => [...new Set(ids.map(String))].sort();

export const processosPorLiberacao = async (usuarioId, liberado) =>
  distintosOrdenados((await vinculosQueContam(usuarioId, liberado)).map((v) => v.processoId));

// `GET /clients?portal=nao_liberado` (DEC-119): clientes com pelo menos um
// vínculo que conta e NÃO está liberado — o mesmo conjunto de vínculos do
// cartão "Processos não liberados", contado por cliente.
export const clientesComProcessoNaoLiberado = async (usuarioId) =>
  distintosOrdenados((await vinculosQueContam(usuarioId, false)).map((v) => v.clienteId));

// `processosNaoLiberados` do Início (DEC-108) e `?portal=nao_liberado`.
export const processosComClienteNaoLiberado = (usuarioId) =>
  processosPorLiberacao(usuarioId, false);

// `?portal=liberado`: pelo menos um vínculo que conta LIBERADO e NENHUM não
// liberado — um processo com um cliente liberado e outro não está no grupo de
// cima, que é o que pede atenção.
export const processosLiberados = async (usuarioId) => {
  const [liberados, naoLiberados] = await Promise.all([
    processosPorLiberacao(usuarioId, true),
    processosComClienteNaoLiberado(usuarioId)
  ]);
  const pendentes = new Set(naoLiberados);
  return liberados.filter((id) => !pendentes.has(id));
};

export default {
  processosPorLiberacao,
  processosComClienteNaoLiberado,
  processosLiberados,
  clientesComProcessoNaoLiberado
};
