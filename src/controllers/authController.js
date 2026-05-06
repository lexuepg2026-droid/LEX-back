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

const login = async (req, res, next) => {
  try {
    const data = await authService.loginUser(req.body);
    return res.json(data);
  } catch (error) {
    error.statusCode = error.statusCode || 400;
    return next(error);
  }
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
  me
};
