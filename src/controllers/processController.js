import {
  createProcess,
  deleteProcess,
  getProcessById,
  listProcesses,
  mudarFase,
  previewDeAtivacao,
  reactivateProcess,
  updateProcess
} from "../services/processService.js";
import {
  alterarPapel,
  desvincularCliente,
  listarParticipantes,
  obterCodigoAcesso,
  promoverAPrincipal,
  vincularCliente
} from "../services/processoClienteService.js";
import confirmacaoService from "../services/confirmacaoService.js";
import { lerVersaoVista } from "../services/concurrencyGuard.js";
import { lerLinhaDoTempo } from "../services/timelineService.js";

export const create = async (req, res, next) => {
  try {
    const process = await createProcess(req.user._id, req.body);
    return res.status(201).json(process);
  } catch (error) {
    return next(error);
  }
};

export const list = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    // DEC-054: `fase` e `liminar` entram como os demais — a leitura dos
    // valores é do serviço, que é onde o vocabulário mora.
    const { busca, status, situacao, fase, liminar } = req.query;
    const result = await listProcesses(req.user._id, {
      page, limit, busca, status, situacao, fase, liminar
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getById = async (req, res, next) => {
  try {
    const process = await getProcessById(req.user._id, req.params.id);
    return res.status(200).json(process);
  } catch (error) {
    return next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const process = await updateProcess(req.user._id, req.params.id, req.body);
    return res.status(200).json(process);
  } catch (error) {
    return next(error);
  }
};

// DEC-054 — a única escrita de `fase`, e por isso a única que grava histórico.
export const mudarFaseDoProcesso = async (req, res, next) => {
  try {
    const process = await mudarFase(req.user._id, req.params.id, req.body, {
      versaoVista: lerVersaoVista(req)
    });
    return res.status(200).json(process);
  } catch (error) {
    return next(error);
  }
};

export const remove = async (req, res, next) => {
  try {
    await deleteProcess(req.user._id, req.params.id);
    return res.status(200).json({ message: "Processo removido com sucesso" });
  } catch (error) {
    return next(error);
  }
};

// DEC-052 — a volta. Restaura o processo e SÓ os vínculos que a cascata dele
// derrubou; participante removido à mão continua fora.
//
// `PATCH` e sub-rota própria pelo mesmo motivo do cliente: `ativo` está fora da
// allowlist de update desde a Fase 4.5, e reabri-lo devolveria a porta que a
// auditoria fechou.
export const reactivate = async (req, res, next) => {
  try {
    const processo = await reactivateProcess(req.user._id, req.params.id);
    return res.status(200).json({
      message: "Processo reativado com sucesso",
      processo,
      aviso: "O cliente deste processo não foi reativado. Cada registro se reativa por si."
    });
  } catch (error) {
    return next(error);
  }
};

// O número que a tela mostra ANTES de confirmar. Serve às duas ações: no
// processo ativo diz quantos vínculos VÃO CAIR; no desativado, quantos VOLTAM.
//
// Endpoint próprio, e não um campo na listagem: a contagem da reativação exige
// contar vínculos INATIVOS marcados, que a listagem não carrega — e carregá-la
// para toda linha de toda página pagaria uma agregação por processo para um
// número que só é lido quando a advogada abre um menu.
export const previewAtivacao = async (req, res, next) => {
  try {
    return res.status(200).json(await previewDeAtivacao(req.user._id, req.params.id));
  } catch (error) {
    return next(error);
  }
};

// ── Participantes do processo (junção processo × cliente) ──────────────────

export const listClientes = async (req, res, next) => {
  try {
    const participantes = await listarParticipantes(req.user._id, req.params.id);
    return res.status(200).json(participantes);
  } catch (error) {
    return next(error);
  }
};

export const addCliente = async (req, res, next) => {
  try {
    const vinculo = await vincularCliente(req.user._id, req.params.id, req.body);
    return res.status(201).json(vinculo);
  } catch (error) {
    return next(error);
  }
};

export const updateClientePapel = async (req, res, next) => {
  try {
    const vinculo = await alterarPapel(
      req.user._id,
      req.params.id,
      req.params.clienteId,
      req.body
    );
    return res.status(200).json(vinculo);
  } catch (error) {
    return next(error);
  }
};

export const setClientePrincipal = async (req, res, next) => {
  try {
    const vinculo = await promoverAPrincipal(
      req.user._id,
      req.params.id,
      req.params.clienteId
    );
    return res.status(200).json(vinculo);
  } catch (error) {
    return next(error);
  }
};

export const removeCliente = async (req, res, next) => {
  try {
    await desvincularCliente(req.user._id, req.params.id, req.params.clienteId);
    return res.status(200).json({ message: "Cliente desvinculado do processo" });
  } catch (error) {
    return next(error);
  }
};

// ── Confirmações de visualização do processo (Fase 3.1) ────────────────────

export const listConfirmacoes = async (req, res, next) => {
  try {
    const resultado = await confirmacaoService.listarConfirmacoesDoProcesso(
      req.user._id,
      req.params.id
    );
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

// Marca TODAS as não vistas do processo de uma vez. A advogada abre a ficha e
// vê todas juntas; marcar uma a uma exigiria N chamadas para a mesma ação
// humana. É a única mutação permitida sobre uma confirmação.
export const marcarConfirmacoesVistas = async (req, res, next) => {
  try {
    const resultado = await confirmacaoService.marcarComoVistas(
      req.user._id,
      req.params.id
    );
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

export const getCodigoAcesso = async (req, res, next) => {
  try {
    const resultado = await obterCodigoAcesso(
      req.user._id,
      req.params.id,
      req.params.clienteId
    );
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
};

// ── DEC-056 (F-3) — a linha do tempo do processo ──────────────────────────
//
// Só leitura, e nenhuma coleta: o substrato é o `historicoFase` que a DEC-054
// já grava desde a F-2d. Ver `services/timelineService.js`.
export const getTimeline = async (req, res, next) => {
  try {
    const linha = await lerLinhaDoTempo(req.user._id, req.params.id);
    return res.status(200).json(linha);
  } catch (error) {
    return next(error);
  }
};
