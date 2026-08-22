import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// HISTÓRICO DE ATIVAÇÃO — compartilhado por Process e Client (DEC-052)
//
// ── Por que existe ───────────────────────────────────────────────────────
// Desativar e reativar são mudanças de estado, e mudança de estado sem registro
// é a coisa que este projeto já decidiu três vezes que não se faz: o estorno
// guarda que desfez, a linha do extrato que deixou de valer DIZ que deixou
// (DEC-044), e agora a cascata registra o que derrubou.
//
// Sem isto, a advogada abre um processo reativado e não tem como saber que ele
// esteve fora — nem quando, nem quantos participantes voltaram com ele.
//
// ── Append-only ──────────────────────────────────────────────────────────
// Nunca editado, nunca podado. Quem escreve são os quatro pontos de mudança de
// estado (`deleteProcess`, `reactivateProcess`, `deleteClient`,
// `reactivateClient`); **não há rota que aceite este campo** — ele está fora da
// allowlist de update dos dois módulos, como `historicoStatus` do honorário.
//
// ── Por que UM schema para os dois models ────────────────────────────────
// Cliente e processo respondem à mesma pergunta ("este registro esteve fora?") e
// a resposta tem a mesma forma. Dois schemas iguais divergiriam no primeiro
// campo que um ganhasse — e aí a tela precisaria saber de qual model o
// histórico veio para saber lê-lo.
//
// ── Por que NÃO é o histórico de status do processo ──────────────────────
// A F-2c vai trazer `de → para` de STATUS do processo, quando o vocabulário da
// Laís chegar. É outra coisa: status é o andamento jurídico ("em recurso",
// "arquivado"), ativação é se o registro existe para o sistema. Um processo
// arquivado continua ATIVO; um desativado por engano não tem status nenhum que
// explique isso.
//
// Ficam separados de propósito. Se um dia fizer sentido uni-los, a união é
// trivial (os dois são append-only e carimbados com data); o contrário — nascer
// junto e ter de separar — obrigaria a migrar dado já gravado.
// ═══════════════════════════════════════════════════════════════════════════

const historicoAtivacaoSchema = new mongoose.Schema(
  {
    acao: {
      type: String,
      required: true,
      enum: ["desativacao", "reativacao"]
    },
    data: {
      type: Date,
      required: true,
      default: Date.now
    },
    // Quantos vínculos caíram (ou voltaram) junto. `null` no cliente, que não
    // cascateia — e o `null` é informação: diz que a pergunta não se aplica,
    // enquanto `0` diria "cascateou e não pegou ninguém".
    vinculosAfetados: {
      type: Number,
      default: null
    }
  },
  { _id: false }
);

export default historicoAtivacaoSchema;
