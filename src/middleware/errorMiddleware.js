// Tradutor de erros para o cliente.
//
// Erros do Mongoose chegam aqui sem `statusCode` e, sem tratamento, caíam no
// default 500 com a mensagem crua do driver ("is not a valid enum value for
// path `endereco.estado`"): erro de cliente reportado como falha de servidor,
// vazando nomes de path e tipos internos do schema na resposta.

const CAMPOS_LEGIVEIS = {
  email: "e-mail",
  cpf: "CPF",
  cnpj: "CNPJ",
  cep: "CEP",
  rg: "RG",
  oab: "OAB",
  "oab.numero": "número da OAB",
  "oab.estado": "estado da OAB",
  "endereco.estado": "estado do endereço",
  "endereco.cep": "CEP do endereço",
  nomeCompleto: "nome completo",
  razaoSocial: "razão social",
  nomeFantasia: "nome fantasia",
  estadoCivil: "estado civil",
  dataNascimento: "data de nascimento",
  tipoPessoa: "tipo de pessoa",
};

const nomeLegivel = (caminho) => CAMPOS_LEGIVEIS[caminho] || caminho;

// Mensagens de duplicidade alinhadas com as que os services já lançam, para o
// usuário ver sempre o mesmo texto venha o 409 de onde vier.
const MENSAGEM_DUPLICADO = {
  email: "E-mail já cadastrado",
  cpf: "CPF já cadastrado",
  cnpj: "CNPJ já cadastrado",
  oab: "OAB já cadastrada nesta UF",
};

// Converte um ValidatorError do Mongoose em português, sem repassar o texto
// original do driver.
const mensagemDeValidacao = (erro) => {
  const campo = nomeLegivel(erro.path);

  // `match` e validadores customizados do schema já trazem mensagem nossa,
  // escrita em português (ex.: "CPF deve conter 11 dígitos").
  if (erro.kind === "user defined" && erro.properties?.message) {
    return erro.properties.message;
  }

  switch (erro.kind) {
    case "enum":
      return `Valor inválido para ${campo}`;
    case "required":
      return `O campo ${campo} é obrigatório`;
    case "maxlength":
      return `O campo ${campo} excede o tamanho máximo permitido`;
    case "minlength":
      return `O campo ${campo} está abaixo do tamanho mínimo permitido`;
    case "ObjectId":
      return `Identificador inválido para ${campo}`;
    default:
      return erro.name === "CastError"
        ? `O campo ${campo} recebeu um valor de tipo inválido`
        : `Valor inválido para ${campo}`;
  }
};

// O campo duplicado sai do keyPattern do índice único violado. `usuarioId` é
// descartado porque os índices de cliente são compostos (usuarioId + campo).
const campoDuplicado = (err) => {
  const chaves = Object.keys(err.keyPattern || {}).filter((k) => k !== "usuarioId");
  if (chaves.includes("email")) return "email";
  if (chaves.includes("cpf")) return "cpf";
  if (chaves.includes("cnpj")) return "cnpj";
  if (chaves.some((k) => k.startsWith("oab."))) return "oab";
  return chaves[0] || null;
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (process.env.NODE_ENV !== "production") {
    // Em desenvolvimento o erro completo continua no console, inclusive o
    // texto original do Mongoose que deixa de ir para o cliente.
    console.error(`[${err.statusCode || err.name || 500}] ${err.message}`, err.stack);
  }

  // ── Índice único violado ────────────────────────────────────────────────
  if (err.code === 11000) {
    const campo = campoDuplicado(err);
    return res.status(409).json({
      message:
        MENSAGEM_DUPLICADO[campo] ||
        (campo ? `Valor duplicado para ${nomeLegivel(campo)}` : "Registro duplicado"),
      ...(campo ? { campo } : {}),
    });
  }

  // ── ValidationError: um ou mais campos reprovados pelo schema ───────────
  if (err.name === "ValidationError") {
    const errors = {};
    for (const [caminho, detalhe] of Object.entries(err.errors || {})) {
      errors[caminho] = mensagemDeValidacao(detalhe);
    }
    return res.status(400).json({ message: "Dados inválidos", errors });
  }

  // ── CastError solto: tipicamente ObjectId inválido vindo da URL ─────────
  if (err.name === "CastError") {
    const message = mensagemDeValidacao(err);
    return res.status(400).json({ message: "Dados inválidos", errors: { [err.path]: message } });
  }

  // ── Erros lançados pelos services, com statusCode explícito ─────────────
  const status = err.statusCode || 500;
  // Um 500 que não foi atribuído por nós pode carregar detalhe interno.
  const message = err.statusCode ? err.message : "Erro interno do servidor";

  const body = { message: message || "Erro interno do servidor" };
  if (err.errors) body.errors = err.errors;
  if (err.campo) body.campo = err.campo;

  return res.status(status).json(body);
};

export default errorHandler;
