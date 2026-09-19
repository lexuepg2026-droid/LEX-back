import mongoose from "mongoose";
import enderecoSchema, { UFS } from "./shared/enderecoSchema.js";

// A usuária do sistema é uma advogada autônoma (pessoa física).
// Não existe CNPJ de escritório — apenas dados pessoais + OAB + advocacia.

const oabSchema = new mongoose.Schema(
  {
    numero: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{1,6}$/, "OAB deve ter de 1 a 6 dígitos"]
    },
    estado: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: UFS
    }
  },
  {
    _id: false
  }
);

const advocaciaSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    chavePix: {
      type: String,
      trim: true,
      maxlength: 120
    },
    instagram: {
      type: String,
      trim: true,
      maxlength: 50
    },
    site: {
      type: String,
      trim: true,
      maxlength: 200
    },
    // Imagem completa em data URI ("data:image/png;base64,..."), não só o
    // payload — o renderizador precisa do mime type para montar o timbrado.
    //
    // Teto de 200 KB, imposto em authValidation. NÃO é limite estético: o User
    // é carregado em toda requisição autenticada (authMiddleware), então um
    // logo grande entra no custo de cada chamada da API, não só na do perfil.
    // Se um dia precisar de imagem maior, o caminho é guardar o binário fora
    // do User e referenciar por URL — não aumentar este número.
    logoBase64: {
      type: String,
      trim: true
    }
  },
  {
    _id: false
  }
);

// ── Token de e-mail (A-2, DEC-064) ─────────────────────────────────────────
// Confirmação de conta e recuperação de senha usam a MESMA forma, em dois
// campos separados: um pedido de recuperação não pode invalidar o link de
// confirmação que ainda está na caixa de entrada, e vice-versa.
//
// Guarda só o HASH do segredo (ver `utils/tokenUsuario.js`) — o segredo em si
// só existe no e-mail. Um por finalidade: pedir de novo SUBSTITUI o anterior,
// e é isso que invalida o link antigo.
const tokenDeEmailSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },
    expiraEm: { type: Date, required: true },
    // Quando o último e-mail foi emitido: sustenta o intervalo mínimo entre
    // envios (um pedido a cada minuto por conta), que impede usar o sistema
    // para lotar a caixa de entrada de alguém.
    enviadoEm: { type: Date, required: true }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    nomeCompleto: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    senhaHash: {
      type: String,
      required: true
    },
    cpf: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{11}$/, "CPF deve conter 11 dígitos"]
    },
    telefone: {
      type: String,
      trim: true
    },
    oab: {
      type: oabSchema,
      required: true
    },
    advocacia: {
      type: advocaciaSchema,
      required: true
    },
    endereco: {
      type: enderecoSchema,
      default: {}
    },
    ativo: {
      type: Boolean,
      required: true,
      default: true
    },
    ultimoLogin: {
      type: Date,
      default: null
    },

    // ── A-2 (DEC-064) ─────────────────────────────────────────────────────
    // `null` = e-mail ainda não confirmado. **Não bloqueia o login**: decisão
    // do Daniel, por causa da demonstração — se o e-mail não chegar, o avaliador
    // entra do mesmo jeito e vê um aviso. Contas anteriores à A-2 também são
    // `null`, e por isso também mostram o aviso até confirmarem.
    emailConfirmadoEm: {
      type: Date,
      default: null
    },

    // Quando a senha foi trocada POR RECUPERAÇÃO. O `authMiddleware` derruba
    // todo token emitido antes deste instante: é o que "encerrar as sessões
    // ativas" quer dizer num JWT sem estado. `null` = nunca houve.
    //
    // A troca feita DENTRO da sessão (`alterar-senha`) NÃO escreve aqui: a
    // advogada que trocou a própria senha continua logada (DEC-050).
    senhaAlteradaEm: {
      type: Date,
      default: null
    },

    // `select: false`: os hashes de token não saem em nenhuma leitura comum
    // (o `authMiddleware` carrega o usuário em TODA requisição). Quem precisa
    // pede por `.select("+confirmacaoEmail")`.
    confirmacaoEmail: {
      type: tokenDeEmailSchema,
      select: false
    },
    recuperacaoSenha: {
      type: tokenDeEmailSchema,
      select: false
    }
  },
  {
    timestamps: true
  }
);

userSchema.index({ cpf: 1 }, { unique: true });
// O número da OAB só é único dentro da UF; unicidade global estaria errada.
userSchema.index({ "oab.numero": 1, "oab.estado": 1 }, { unique: true });

const User = mongoose.model("User", userSchema);

export default User;
