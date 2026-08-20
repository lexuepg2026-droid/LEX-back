import Fee from "../models/Fee.js";
import Process from "../models/Process.js";
import { regexTermoSimples } from "../utils/texto.js";

// ═══════════════════════════════════════════════════════════════════════════
// O `?busca=` DAS TRÊS LISTAGENS FINANCEIRAS — Fase F-1b.3
//
// ── A pergunta que o campo responde ──────────────────────────────────────
// "Achar um lançamento sem lembrar de qual honorário ele é." O que a advogada
// tem na cabeça quando procura não é o id: é o nome da cobrança ("execução
// fiscal"), o número do processo que o cliente mandou por mensagem, ou a
// anotação que ela mesma escreveu na linha. São esses três alvos.
//
// ── Por que resolver os ids ANTES, e não agregar ─────────────────────────
// Descrição do honorário e número do processo vivem em OUTRAS coleções, e
// `Payment` guarda deles só o id. As saídas eram três:
//
//   1. `$lookup` numa agregação — casa tudo numa consulta e custa uma varredura
//      com join por página, sem índice utilizável para o regex.
//   2. campo sombra desnormalizado no pagamento — rápido de ler e caro de
//      manter: toda edição de descrição de honorário teria de reescrever os
//      pagamentos, e o dia em que uma delas falhar a busca mente.
//   3. duas consultas de PROJEÇÃO (`_id` apenas) sobre coleções pequenas —
//      honorários e processos são dezenas por usuária, não milhões — e o
//      filtro principal vira um `$in` sobre índice.
//
// Escolhida a 3. É a única que não paga custo de escrita nem de join, e o
// enunciado da fase pediu explicitamente para reduzir o alcance em vez de
// inventar consulta cara. O teto do termo (80 caracteres) e o escape de
// metacaractere vêm de `regexTermoSimples`, unificado na F-0.
//
// ── O alcance REAL, e o que ficou de fora ────────────────────────────────
// `observacoes` só existe em `Payment`. Parcela e honorário não têm o campo —
// então nas listagens deles a busca casa descrição do honorário e número do
// processo, e nada mais. Declarado, e não simulado: inventar um alvo que o
// schema não tem faria o campo prometer um recorte que ele não entrega.
// ═══════════════════════════════════════════════════════════════════════════

// `null` quando não há termo utilizável — e aí o chamador simplesmente não
// aplica filtro nenhum, que é a regra "filtro ausente não filtra".
export const alvosDaBusca = async (termo, usuarioId) => {
  const regex = regexTermoSimples(termo);
  if (!regex) return null;

  const [honorarios, processos] = await Promise.all([
    Fee.find({ usuarioId, descricao: regex }).select("_id"),
    Process.find({ usuarioId, numeroProcesso: regex }).select("_id")
  ]);

  return {
    regex,
    honorarioIds: honorarios.map((f) => f._id),
    processoIds: processos.map((p) => p._id)
  };
};

// As cláusulas do `$or`, montadas a partir dos nomes que cada coleção dá aos
// mesmos vínculos: o honorário é `honorarioId` no pagamento e `feeId` na
// parcela, e no próprio honorário é o `_id`.
//
// `campoObservacoes` só é passado por quem TEM o campo. Um `$or` com uma
// cláusula sobre campo inexistente não quebra — devolve sempre falso — mas
// escrever a cláusula ali sugeriria um alcance que a listagem não tem.
export const clausulasDaBusca = (
  alvos,
  { campoHonorario = "honorarioId", campoProcesso = "processoId", campoObservacoes = null } = {}
) => {
  const clausulas = [];
  if (campoHonorario) clausulas.push({ [campoHonorario]: { $in: alvos.honorarioIds } });
  if (campoProcesso) clausulas.push({ [campoProcesso]: { $in: alvos.processoIds } });
  if (campoObservacoes) clausulas.push({ [campoObservacoes]: alvos.regex });
  return clausulas;
};

export default { alvosDaBusca, clausulasDaBusca };
