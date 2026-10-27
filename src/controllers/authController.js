import authService from "../services/authService.js";
import { emitirExemploTimbrado } from "../services/letterheadSampleService.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 24 * 60 * 60 * 1000,
};

// Cadastro e login emitem o MESMO cookie e o MESMO envelope `{ usuario }`.
// Antes, o cadastro devolvia o usuário sem cookie e o frontend jogava a
// advogada de volta na tela de login — ela terminava o assistente de duas
// etapas e a primeira coisa que via era um formulário pedindo a senha que
// tinha acabado de escolher.
const register = async (req, res, next) => {
  try {
    const data = await authService.registerUser(req.body);
    res.cookie("lex-token", data.token, COOKIE_OPTIONS);
    return res.status(201).json({ message: data.message, usuario: data.usuario });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const data = await authService.loginUser(req.body);
    res.cookie("lex-token", data.token, COOKIE_OPTIONS);
    return res.json({ usuario: data.usuario });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

const logout = (req, res) => {
  res.clearCookie("lex-token", {
    httpOnly: COOKIE_OPTIONS.httpOnly,
    sameSite: COOKIE_OPTIONS.sameSite,
    secure: COOKIE_OPTIONS.secure,
    path: COOKIE_OPTIONS.path,
  });
  return res.json({ message: "Logout realizado com sucesso" });
};

// `{ usuario }` — o mesmo envelope de /login e /register. Devolver o usuário
// cru aqui obrigava o AuthContext a saber, endpoint a endpoint, se desembrulha
// ou não; um envelope só para os três elimina a exceção.
const me = async (req, res, next) => {
  try {
    const usuario = await authService.getMe(req.user._id);
    return res.json({ usuario });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const usuario = await authService.updateMe(req.user._id, req.body);
    return res.json({ usuario });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

// Fase 3.6 (DEC-126): a folha de exemplo do timbrado, com os dados SALVOS da
// advogada da sessão. Os mesmos headers do recibo e do download de documento,
// inclusive o `Access-Control-Expose-Headers` — sem ele o front não lê o nome.
// Nada da requisição além da sessão é lido: não há como pedir o de outra conta.
const letterheadSample = async (req, res, next) => {
  try {
    const { buffer, contentType, nomeArquivo } = await emitirExemploTimbrado(req.user._id);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    return res.status(200).send(buffer);
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const data = await authService.changePassword(req.user._id, req.body);
    return res.json(data);
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

// ── A-2 (DEC-064) ───────────────────────────────────────────────────────────
// Nenhuma destas rotas emite cookie: confirmar o e-mail ou redefinir a senha
// NÃO abre sessão. Quem redefine volta ao login e digita a senha nova — é o que
// garante que o link, sozinho, nunca vale como credencial de sessão.
const confirmEmail = async (req, res, next) => {
  try {
    const data = await authService.confirmEmail(req.body);
    return res.json(data);
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

const resendConfirmation = async (req, res, next) => {
  try {
    const data = await authService.resendConfirmation(req.user._id);
    return res.json(data);
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const data = await authService.forgotPassword(req.body);
    return res.json(data);
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const data = await authService.resetPassword(req.body);
    return res.json(data);
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    return next(error);
  }
};

export default {
  register,
  login,
  logout,
  me,
  updateMe,
  letterheadSample,
  changePassword,
  confirmEmail,
  resendConfirmation,
  forgotPassword,
  resetPassword
};
