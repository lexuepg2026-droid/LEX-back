import mongoose from "mongoose";
import historicoAtivacaoSchema from "./shared/historicoAtivacaoSchema.js";
import enderecoSchema from "./shared/enderecoSchema.js";
import { nomeExibicaoDoCliente } from "../utils/nomeExibicao.js";

const representanteLegalSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      trim: true,
      maxlength: 255
    },
    cpf: {
      type: String,
      trim: true
    },
    cargo: {
      type: String,
      trim: true,
      maxlength: 60
    }
  },
  {
    _id: false
  }
);

const clientSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    tipoPessoa: {
      type: String,
      enum: ["fisica", "juridica"],
      required: true
    },

    nomeCompleto: {
      type: String,
      trim: true
    },
    cpf: {
      type: String,
      trim: true
    },

    // ── Campos exclusivos de pessoa física (todos opcionais nesta fase) ──────
    rg: {
      type: String,
      trim: true,
      maxlength: 20
    },
    dataNascimento: {
      type: Date
    },
    sexo: {
      type: String,
      enum: ["feminino", "masculino"]
    },
    // estadoCivil: o valor "uniao_estavel" atende ao apontamento da banca sobre "amasiado".
    // Mantido o termo do Código Civil como valor técnico; o frontend exibe o rótulo
    // "União estável (amasiado)". São a mesma situação jurídica, nomes diferentes.
    estadoCivil: {
      type: String,
      enum: ["solteiro", "casado", "separado_judicialmente", "divorciado", "viuvo", "uniao_estavel"]
    },
    profissao: {
      type: String,
      trim: true,
      maxlength: 60
    },

    paisOrigem: {
      type: String,
      trim: true
    },
    
    nacionalidade: {
      type: String,
      trim: true,
      maxlength: 50,
      default: "brasileira"
    },

    razaoSocial: {
      type: String,
      trim: true
    },
    nomeFantasia: {
      type: String,
      trim: true
    },
    cnpj: {
      type: String,
      trim: true
    },
    // representanteLegal: quem assina pela empresa em procuração/contrato de PJ.
    // Opcional nesta fase; obrigatoriedade será reavaliada na Fase 2.
    representanteLegal: {
      type: representanteLegalSchema
    },

    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    telefone: {
      type: String,
      trim: true
    },
    endereco: {
      type: enderecoSchema,
      default: {}
    },
    observacoes: {
      type: String,
      trim: true
    },

    // ── Portal do cliente (DEC-029) ─────────────────────────────────────────
    // A senha é do CLIENTE, não do vínculo: um cliente com três processos tem
    // três códigos de acesso e uma senha só. Códigos identificam qual processo
    // a sessão enxerga; a senha identifica a pessoa.
    //
    // `select: false` é a defesa de base. Toda leitura do projeto usa
    // `Client.find`/`findOne` sem projeção explícita, então sem isto o hash
    // sairia em TODA resposta de cliente — listagem, detalhe, populate de
    // participante. Quem precisar do hash pede por `.select("+senhaPortalHash")`,
    // e hoje só o login do portal e a troca de senha pedem.
    senhaPortalHash: {
      type: String,
      select: false
    },
    // Enquanto for `true`, o portal só oferece a tela de troca. É o que
    // sustenta o recibo: se a advogada continuar conhecendo a senha, a
    // confirmação de leitura é repudiável e não prova que o cliente foi
    // informado. Ver o comentário em `portalAuthService.trocarSenha`.
    senhaPortalProvisoria: {
      type: Boolean,
      default: false
    },
    // Quando o CLIENTE definiu a própria senha. Fica nulo enquanto a senha for
    // a provisória da advogada — é justamente a diferença que dá valor ao
    // recibo, e por isso é campo próprio e não um booleano derivado.
    senhaPortalDefinidaEm: {
      type: Date,
      default: null
    },

    // ── DEC-062: a chave de ordenação alfabética ────────────────────────────
    //
    // DERIVADO, nunca entrada do usuário. É `nomeCompleto` (PF) ou
    // `razaoSocial`/`nomeFantasia` (PJ), resolvido por `utils/nomeExibicao.js`
    // e gravado pelo hook `pre("validate")` no fim deste arquivo — o mesmo
    // mecanismo de `Secao.variaveis`, e pela mesma razão: campo derivado que
    // alguém pode escrever é campo que diverge.
    //
    // Existe porque PF e PJ guardam o nome em campos DIFERENTES, e ordenar por
    // um só deles jogaria metade da lista para o fim. Uma alternativa seria
    // derivá-lo na consulta, por agregação — e ela foi descartada com motivo:
    // `$addFields` produz um campo que **nenhum índice alcança**, então a
    // ordenação passaria a acontecer em memória por construção, sem escolha.
    //
    // Fora da allowlist de update (`validations/shared/camposPermitidos.js`):
    // nenhuma rota o aceita.
    nomeExibicao: {
      type: String,
      trim: true,
      default: ""
    },

    ativo: {
      type: Boolean,
      default: true
    },

    // DEC-052 — append-only. Desativar e reativar são mudanças de estado, e
    // mudança de estado sem registro é o que este projeto já decidiu três vezes
    // que não se faz. Ver `models/shared/historicoAtivacaoSchema.js`.
    //
    // Fora da allowlist de update: nenhuma rota aceita este campo. Quem escreve
    // são os pontos de desativação e reativação do serviço.
    historicoAtivacao: {
      type: [historicoAtivacaoSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

clientSchema.index(
  { usuarioId: 1, cpf: 1 },
  {
    unique: true,
    partialFilterExpression: {
      cpf: { $exists: true, $type: "string" }
    }
  }
);

clientSchema.index(
  { usuarioId: 1, cnpj: 1 },
  {
    unique: true,
    partialFilterExpression: {
      cnpj: { $exists: true, $type: "string" }
    }
  }
);

clientSchema.index(
  { usuarioId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $exists: true, $type: "string" }
    }
  }
);

// ── DEC-062: o índice que a ordenação alfabética usa ───────────────────────
//
// **A collation é do ÍNDICE, e não só da consulta.** Um índice sem collation
// não serve a uma consulta com collation: o MongoDB o ignora e ordena em
// memória (`SORT` no plano de execução). Os dois lados precisam declarar a
// MESMA collation, e é por isso que ela aparece duas vezes — aqui e em
// `clientService.getAllClients`.
//
// `strength: 1` compara **só a letra base**: ignora acento e caixa. É o que
// faz "Álvaro" ficar junto de "Alvaro" (e "alvaro" junto dos dois) em vez de
// depois do Z. Medido contra o Atlas antes de escolher — sem collation, a
// ordenação binária põe TODO nome acentuado depois de "Zeca".
//
// O preço do `strength: 1` é que "Álvaro" e "Alvaro" ficam **empatados**, e
// empate não ordena. Quem desempata é o `_id` na consulta — sem ele a
// paginação repetiria e pularia linhas, que é a mesma razão pela qual o
// extrato ordena por data E id desde a F-1a.
export const COLLATION_PT = Object.freeze({ locale: "pt", strength: 1 });

clientSchema.index({ usuarioId: 1, nomeExibicao: 1, _id: 1 }, { collation: COLLATION_PT });

// Rede de segurança do schema (o clientValidation já barra estes casos antes).
// Precisa de statusCode: sem ele o errorHandler trata como falha interna e
// mascara a mensagem, que aqui é informação útil para o cliente.
const erroDeCampoObrigatorio = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

clientSchema.pre("validate", function () {
  if (this.tipoPessoa === "fisica") {
    this.razaoSocial = undefined;
    this.nomeFantasia = undefined;
    this.cnpj = undefined;
    this.representanteLegal = undefined;

    if (!this.nomeCompleto) {
      throw erroDeCampoObrigatorio("Nome completo é obrigatório para pessoa física");
    }

    if (!this.cpf) {
      throw erroDeCampoObrigatorio("CPF é obrigatório para pessoa física");
    }
  }

  if (this.tipoPessoa === "juridica") {
    this.nomeCompleto = undefined;
    this.cpf = undefined;
    this.rg = undefined;
    this.dataNascimento = undefined;
    this.sexo = undefined;
    this.estadoCivil = undefined;
    this.profissao = undefined;
    this.nacionalidade = undefined;

    if (!this.razaoSocial) {
      throw erroDeCampoObrigatorio("Razão social é obrigatória para pessoa jurídica");
    }

    if (!this.nomeFantasia) {
      throw erroDeCampoObrigatorio("Nome fantasia é obrigatório para pessoa jurídica");
    }

    if (!this.cnpj) {
      throw erroDeCampoObrigatorio("CNPJ é obrigatório para pessoa jurídica");
    }
  }

  // DEC-062 — a chave de ordenação, derivada DEPOIS da limpeza acima.
  //
  // A ordem dentro do hook é o que torna isto correto: os blocos anteriores
  // apagam os campos do tipo errado (PF não tem `razaoSocial`, PJ não tem
  // `nomeCompleto`), e derivar antes deles leria um nome que a gravação vai
  // descartar — um cliente que mudasse de PF para PJ ficaria ordenado para
  // sempre pelo nome de pessoa física que ele deixou de ter.
  this.nomeExibicao = nomeExibicaoDoCliente(this);
});

const Client = mongoose.model("Client", clientSchema);

export default Client;
