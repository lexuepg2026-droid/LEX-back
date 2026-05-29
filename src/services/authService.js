import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

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

const sanitizeUser = (usuario) => {
  return {
    id: usuario._id,
    nomeCompleto: usuario.nomeCompleto,
    email: usuario.email,
    createdAt: usuario.createdAt,
    updatedAt: usuario.updatedAt
  };
};

const registerUser = async ({ nomeCompleto, email, senha }) => {
  if (!nomeCompleto || !email || !senha) {
    throw new Error("nomeCompleto, email e senha são obrigatórios");
  }

  const normalizedEmail = email.toLowerCase().trim();

  const usuarioExistente = await User.findOne({ email: normalizedEmail });

  if (usuarioExistente) {
    const error = new Error("Email já cadastrado");
    error.statusCode = 409;
    throw error;
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const novoUsuario = await User.create({
    nomeCompleto: nomeCompleto.trim(),
    email: normalizedEmail,
    senhaHash
  });

  return {
    message: "Usuário cadastrado com sucesso",
    usuario: sanitizeUser(novoUsuario)
  };
};

const loginUser = async ({ email, senha }) => {
  if (!email || !senha) {
    throw new Error("email e senha são obrigatórios");
  }

  const normalizedEmail = email.toLowerCase().trim();

  const usuario = await User.findOne({ email: normalizedEmail });

  if (!usuario) {
    const error = new Error("Usuário não encontrado");
    error.statusCode = 404;
    throw error;
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);

  if (!senhaValida) {
    const error = new Error("Senha inválida");
    error.statusCode = 401;
    throw error;
  }

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

export default {
  registerUser,
  loginUser,
  getMe
};