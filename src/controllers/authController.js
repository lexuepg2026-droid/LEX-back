import authService from "../services/authService.js";

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

const changePassword = async (req, res, next) => {
  try {
    const data = await authService.changePassword(req.user._id, req.body);
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
  changePassword
};
