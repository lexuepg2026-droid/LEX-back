import authService from "../services/authService.js";

const register = async (req, res, next) => {
  try {
    const data = await authService.registerUser(req.body);
    return res.status(201).json(data);
  } catch (error) {
    error.statusCode = error.statusCode || 400;
    return next(error);
  }
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 24 * 60 * 60 * 1000,
};

const login = async (req, res, next) => {
  try {
    const data = await authService.loginUser(req.body);
    res.cookie("lex-token", data.token, COOKIE_OPTIONS);
    return res.json({ usuario: data.usuario });
  } catch (error) {
    error.statusCode = error.statusCode || 400;
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

const me = async (req, res, next) => {
  try {
    const usuario = await authService.getMe(req.user._id);
    return res.json(usuario);
  } catch (error) {
    error.statusCode = error.statusCode || 400;
    return next(error);
  }
};

export default {
  register,
  login,
  logout,
  me
};
