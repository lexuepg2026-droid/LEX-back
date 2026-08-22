import mongoose from "mongoose";
import { TAMANHO_CODIGO } from "../utils/accessCode.js";

// ═══════════════════════════════════════════════════════════════════════════
// JUNÇÃO N:N ENTRE PROCESSO E CLIENTE (DEC-026)
//
// A realidade jurídica tem litisconsórcio: casal, herdeiros, empresa e sócio
// no mesmo polo. Um processo por cliente era simplificação do dicionário de
// dados, não do direito.
//
// Esta coleção é a VERDADE sobre quem participa de um processo.
// `Process.clientePrincipalId` é derivado dela e existe só para leitura rápida
// e para resolver as variáveis de template quando o cliente não é informado.
// ═══════════════════════════════════════════════════════════════════════════

export const PAPEIS_PROCESSO_CLIENTE = [
  "autor",
  "reu",
  "terceiro_interessado",
  "litisconsorte"
];

const processoClienteSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    processoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      required: true,
      index: true
    },
    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true
    },
    papel: {
      type: String,
      required: true,
      trim: true,
      enum: PAPEIS_PROCESSO_CLIENTE
    },
    principal: {
      type: Boolean,
      required: true,
      default: false
    },
    // Gerado pelo serviço (src/utils/accessCode.js). Nunca aceito do cliente
    // HTTP e nunca derivado de _id, número do processo ou CPF.
    codigoAcesso: {
      type: String,
      required: true,
      trim: true,
      minlength: TAMANHO_CODIGO,
      maxlength: TAMANHO_CODIGO
    },
    // ── Rastro de uso do portal (Fase 3.1) ──────────────────────────────────
    // ACESSO é automático e não notifica ninguém: é atividade, não recibo.
    // Serve para a advogada saber "esta pessoa entrou alguma vez?" antes de
    // ligar cobrando ciência de uma intimação.
    //
    // Não confundir com CONFIRMAÇÃO, que é clique deliberado, é imutável, vive
    // em coleção própria e é o que notifica. Ver `ConfirmacaoVisualizacao`.
    primeiroAcessoPortal: {
      type: Date,
      default: null
    },
    ultimoAcessoPortal: {
      type: Date,
      default: null
    },
    // Desnormalizado da última confirmação, para a listagem de participantes da
    // advogada não fazer N+1. A coleção de confirmações continua sendo a
    // verdade — este campo é atalho de leitura, como `clientePrincipalId`.
    ultimaConfirmacaoEm: {
      type: Date,
      default: null
    },

    ativo: {
      type: Boolean,
      required: true,
      default: true
    },

    // ── DEC-052: a cascata REGISTRA o que derrubou ─────────────────────────
    //
    // ── O defeito que este campo existe para impedir ─────────────────────
    // Desativar um processo derruba os vínculos dele junto (soft delete em
    // cascata, `processService.deleteProcess`). Até a F-2b essa cascata gravava
    // **o mesmo `ativo: false`** que a remoção manual de um participante grava
    // (`desvincularCliente`). Depois do fato, os dois estados eram
    // **indistinguíveis**.
    //
    // Na hora de reativar o processo, o sistema via três vínculos desativados e
    // não sabia qual caiu por cascata e qual a advogada tirou de propósito. As
    // duas saídas possíveis eram erradas:
    //
    //   restaurar todos   → devolve gente que a advogada removeu de propósito
    //   restaurar nenhum  → devolve um processo VAZIO, estado que o próprio
    //                       sistema declara impossível ("Processo sem cliente
    //                       não faz sentido"), com `clientePrincipalId`
    //                       (required) apontando para vínculo morto
    //
    // Era isso que bloqueava a reativação, e foi por isso que a Parte 4 da F-2a
    // parou.
    //
    // ── A regra, e por que ela é a terceira vez ──────────────────────────
    // **Estado passado não se infere, se registra.** É a MESMA conclusão a que
    // este projeto chegou no estorno (a alocação desfeita guarda que foi
    // desfeita, em vez de ser recalculada) e na DEC-044 (a linha do extrato que
    // deixou de valer DIZ que deixou). Inferência sobre estado passado é o que
    // produziu o pior defeito deste projeto.
    //
    // ── Por que UM campo, e não dois ─────────────────────────────────────
    // Ele responde as duas perguntas de uma vez:
    //
    //   preenchido        → caiu pela cascata do processo X (e diz qual)
    //   `null` + inativo  → foi removido À MÃO
    //   `null` + ativo    → vínculo comum, em uso
    //
    // A reativação restaura só os marcados com o próprio id e **limpa a marca**
    // — vínculo restaurado volta a ser vínculo comum. Sem a limpeza, a próxima
    // remoção manual dele ficaria com marca de cascata velha e ele voltaria
    // sozinho no reativar seguinte. É o caso que o ciclo
    // desativar → reativar → desativar → reativar expõe, e há teste para ele.
    //
    // Guardar o id do processo, e não um booleano, é redundante com
    // `processoId` **hoje** — e é de propósito: o dia em que outra coisa
    // cascatear para cá (a desativação de um cliente, por exemplo), um booleano
    // não saberia dizer QUEM derrubou, e voltaríamos a inferir.
    desativadoPorCascataDe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      default: null
    }
  },
  {
    timestamps: true,
    collection: "processo_clientes"
  }
);

// O mesmo cliente não entra duas vezes no mesmo processo. Parcial em
// `ativo: true` para que um vínculo removido possa ser recriado depois — o
// soft delete não pode virar bloqueio permanente.
processoClienteSchema.index(
  { processoId: 1, clienteId: 1 },
  {
    unique: true,
    partialFilterExpression: { ativo: true }
  }
);

// Único GLOBAL, sem filtro parcial: o código de um vínculo desativado continua
// reservado. Reaproveitá-lo daria acesso ao processo novo a quem guardou o
// código antigo.
processoClienteSchema.index({ codigoAcesso: 1 }, { unique: true });

// Apoia a integridade referencial do DELETE /api/clients/:id, que pergunta
// "este cliente está em algum processo?" — busca por clienteId + ativo, sem
// processoId, e portanto não aproveita o índice composto acima.
processoClienteSchema.index({ clienteId: 1, ativo: 1 });

const ProcessoCliente = mongoose.model("ProcessoCliente", processoClienteSchema);

export default ProcessoCliente;
