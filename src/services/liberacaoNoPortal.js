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
export const processosPorLiberacao = async (usuarioId, liberado) => {
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
  const distintos = new Set(
    vinculos
      .filter((v) => clientes.has(String(v.clienteId)) && processos.has(String(v.processoId)))
      .map((v) => String(v.processoId))
  );
  return [...distintos].sort();
};

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

export default { processosPorLiberacao, processosComClienteNaoLiberado, processosLiberados };
