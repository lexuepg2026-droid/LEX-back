import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import authValidation from "../validations/authValidation.js";
import { somenteDigitos } from "../utils/documentos.js";

const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    const error = new Error("JWT_SECRET não configurado");
    error.statusCode = 500;
    throw error;
  }

  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

// ── 422: credencial conferida DENTRO de uma sessão válida (DEC-050) ────────
//
// Não é 401, e a diferença não é de gosto. O 401 estava sendo usado para duas
// perguntas diferentes:
//
//   "não sei quem você é"                        → sessão ausente ou inválida
//   "sei quem você é, e este dado está errado"   → credencial conferida aqui
//
// Só a primeira justifica descartar a sessão. Enquanto as duas responderam
// 401, o interceptor do axios — que trata todo 401 como sessão perdida — EXPULSAVA
// a advogada do sistema por ela ter errado a digitação da própria senha atual
// na tela de troca de senha (defeito V-2).
//
// A correção é semântica, e não no interceptor: com o 401 reservado a sessão,
// o interceptor fica trivialmente correto e não precisa conhecer rota nenhuma.
// Lista de exceção de rota no frontend resolveria ESTE caso e apodreceria no
// próximo — a rota seguinte que devolvesse 401 por engano não estaria nela, e
// o defeito voltaria calado.
//
// 422 e não 400: o corpo está bem formado e os campos são válidos: o que falha
// é a CONFERÊNCIA do valor contra o que está gravado. É a mesma leitura que o
// módulo de documentos já dá ao 422 desde a Fase 4.6.
const unprocessable = (message, campo) => {
  const error = new Error(message);
  error.statusCode = 422;
  if (campo) error.campo = campo;
  return error;
};

// `campo` acompanha o 409 para o cliente rotear sem depender do texto da
// mensagem (o RegisterPage decidia a etapa de retorno por regex; qualquer
// reescrita do texto quebrava o roteamento em silêncio). A mensagem continua
// sendo o que o usuário lê; `campo` é só para a lógica.
const conflict = (message, campo) => {
  const error = new Error(message);
  error.statusCode = 409;
  if (campo) error.campo = campo;
  return error;
};

// Rede de segurança: se dois requests concorrentes passarem pelas checagens
// prévias, o índice único do Mongo dispara 11000 — identificamos qual violou.
const handleDuplicateKeyError = (error) => {
  if (error?.code === 11000) {
    const pattern = error.keyPattern || {};
    if (pattern.email) {
      throw conflict("E-mail já cadastrado", "email");
    }
    if (pattern.cpf) {
      throw conflict("CPF já cadastrado", "cpf");
    }
    if (pattern["oab.numero"] || pattern["oab.estado"]) {
      throw conflict("OAB já cadastrada nesta UF", "oab");
    }
    throw conflict("Registro duplicado");
  }
  throw error;
};

const sanitizeUser = (usuario) => {
  return {
    id: usuario._id,
    nomeCompleto: usuario.nomeCompleto,
    email: usuario.email,
    cpf: usuario.cpf,
    telefone: usuario.telefone,
    oab: usuario.oab,
    advocacia: usuario.advocacia,
    endereco: usuario.endereco,
    ativo: usuario.ativo,
    ultimoLogin: usuario.ultimoLogin,
    createdAt: usuario.createdAt,
    updatedAt: usuario.updatedAt
  };
};

const registerUser = async (data) => {
  const validationError = authValidation.validateRegisterPayload(data);
  if (validationError) {
    throw badRequest(validationError);
  }

  const normalizedEmail = data.email.toLowerCase().trim();
  const cpf = somenteDigitos(data.cpf);
  const oabNumero = somenteDigitos(data.oab.numero);
  const oabEstado = String(data.oab.estado).trim().toUpperCase();

  if (await User.findOne({ email: normalizedEmail })) {
    throw conflict("E-mail já cadastrado", "email");
  }
  if (await User.findOne({ cpf })) {
    throw conflict("CPF já cadastrado", "cpf");
  }
  if (await User.findOne({ "oab.numero": oabNumero, "oab.estado": oabEstado })) {
    throw conflict("OAB já cadastrada nesta UF", "oab");
  }

  const senhaHash = await bcrypt.hash(data.senha, 10);

  try {
    const novoUsuario = await User.create({
      nomeCompleto: data.nomeCompleto.trim(),
      email: normalizedEmail,
      senhaHash,
      cpf,
      telefone: data.telefone,
      oab: { numero: oabNumero, estado: oabEstado },
      advocacia: {
        nome: data.advocacia.nome,
        chavePix: data.advocacia.chavePix,
        instagram: data.advocacia.instagram,
        site: data.advocacia.site
      },
      endereco: data.endereco
    });

    // Devolve token junto: quem acabou de se cadastrar já está autenticado, e
    // o controller emite o mesmo cookie `lex-token` do login. Mandar a
    // advogada digitar de novo a senha que ela escolheu dois campos atrás é
    // atrito sem contrapartida de segurança — a identidade acabou de ser
    // comprovada pelo próprio cadastro.
    return {
      message: "Usuário cadastrado com sucesso",
      token: generateToken(novoUsuario._id),
      usuario: sanitizeUser(novoUsuario)
    };
  } catch (error) {
    handleDuplicateKeyError(error);
  }
};

const loginUser = async ({ email, senha }) => {
  const validationError = authValidation.validateLoginPayload({ email, senha });
  if (validationError) {
    throw badRequest(validationError);
  }

  const normalizedEmail = email.toLowerCase().trim();

  const usuario = await User.findOne({ email: normalizedEmail });

  // E-mail inexistente e senha errada respondem exatamente igual (401,
  // "Credenciais inválidas") para não permitir enumeração de contas.
  // authLimiter já cobre força bruta; não vale complexidade extra aqui.
  //
  // CONTINUA 401 sob a DEC-050, e é o significado certo: aqui não HÁ sessão —
  // é justamente o pedido para criar uma. "Não sei quem você é" é literalmente
  // a resposta. O interceptor não desloga ninguém por isto porque não há
  // sessão para perder; ver `api/axiosConfig.js` no frontend.
  if (!usuario) {
    const error = new Error("Credenciais inválidas");
    error.statusCode = 401;
    throw error;
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);

  if (!senhaValida) {
    const error = new Error("Credenciais inválidas");
    error.statusCode = 401;
    throw error;
  }

  // updateOne em vez de save() para não disparar hooks/validators desnecessários.
  await User.updateOne({ _id: usuario._id }, { $set: { ultimoLogin: new Date() } });
  usuario.ultimoLogin = new Date();

  const token = generateToken(usuario._id);

  return {
    token,
    usuario: sanitizeUser(usuario)
  };
};

const getMe = async (userId) => {
  const usuario = await User.findById(userId).select("-senhaHash");

  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  return sanitizeUser(usuario);
};

// Aplica no destino apenas as chaves presentes em source (atualização parcial).
const mergePresent = (target, source, keys) => {
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = source[key];
    }
  }
};

const updateMe = async (userId, payload) => {
  const validationError = authValidation.validateUpdateProfilePayload(payload);
  if (validationError) {
    throw badRequest(validationError);
  }

  const usuario = await User.findById(userId);
  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  mergePresent(usuario, payload, ["nomeCompleto", "telefone"]);

  if (Object.prototype.hasOwnProperty.call(payload, "cpf")) {
    const cpf = somenteDigitos(payload.cpf);
    if (cpf !== usuario.cpf) {
      if (await User.findOne({ cpf, _id: { $ne: userId } })) {
        throw conflict("CPF já cadastrado", "cpf");
      }
    }
    usuario.cpf = cpf;
  }

  // Subdocumentos aninhados: mesclar campo a campo para não descartar os que
  // não vieram no PATCH (ex.: alterar oab.numero sem reenviar oab.estado).
  if (payload.oab && typeof payload.oab === "object") {
    if (!usuario.oab) usuario.oab = {};
    mergePresent(usuario.oab, payload.oab, ["numero", "estado"]);
    if (Object.prototype.hasOwnProperty.call(payload.oab, "numero")) {
      usuario.oab.numero = somenteDigitos(payload.oab.numero);
    }
    if (Object.prototype.hasOwnProperty.call(payload.oab, "estado") && usuario.oab.estado) {
      usuario.oab.estado = String(usuario.oab.estado).trim().toUpperCase();
    }
    if (await User.findOne({
      "oab.numero": usuario.oab.numero,
      "oab.estado": usuario.oab.estado,
      _id: { $ne: userId }
    })) {
      throw conflict("OAB já cadastrada nesta UF", "oab");
    }
  }

  if (payload.advocacia && typeof payload.advocacia === "object") {
    if (!usuario.advocacia) usuario.advocacia = {};
    mergePresent(usuario.advocacia, payload.advocacia, [
      "nome", "chavePix", "instagram", "site", "logoBase64"
    ]);

    // Remover o logo é mandar null ou "". Guardar a string vazia faria o
    // renderizador tratar "tem logo" como verdadeiro e montar o cabeçalho com
    // uma imagem que não existe.
    //
    // Grava `null`, não `undefined`: a convenção do projeto é que campo apagado
    // vira null. `undefined` some do documento e faz o GET /me devolver a chave
    // ausente em vez de nula, e o frontend não consegue distinguir "logo
    // removido" de "campo que nunca existiu". O renderizador testa por
    // falsidade, então null e undefined lhe são equivalentes.
    if (
      Object.prototype.hasOwnProperty.call(payload.advocacia, "logoBase64") &&
      !payload.advocacia.logoBase64
    ) {
      usuario.advocacia.logoBase64 = null;
    }
  }

  if (payload.endereco && typeof payload.endereco === "object") {
    if (!usuario.endereco) usuario.endereco = {};
    mergePresent(usuario.endereco, payload.endereco, [
      "cep", "pais", "estado", "cidade", "bairro", "logradouro", "numero", "complemento"
    ]);
  }

  try {
    await usuario.save();
  } catch (error) {
    handleDuplicateKeyError(error);
  }

  return sanitizeUser(usuario);
};

const changePassword = async (userId, payload) => {
  const validationError = authValidation.validateChangePasswordPayload(payload);
  if (validationError) {
    throw badRequest(validationError);
  }

  const usuario = await User.findById(userId);
  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  // A sessão desta requisição é VÁLIDA — `authMiddleware` já a conferiu antes
  // de chegar aqui. O que está errado é o dado enviado, e por isso a resposta
  // é 422 e não 401 (DEC-050). A advogada continua logada: erro de digitação
  // não é motivo para expulsá-la do sistema.
  const senhaValida = await bcrypt.compare(payload.senhaAtual, usuario.senhaHash);
  if (!senhaValida) {
    throw unprocessable("Senha atual incorreta", "senhaAtual");
  }

  usuario.senhaHash = await bcrypt.hash(payload.novaSenha, 10);
  await usuario.save();

  return { message: "Senha alterada com sucesso" };
};

export default {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  changePassword
};
