import jwt from "jsonwebtoken";
import User from "../models/User.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies?.["lex-token"];

    if (!token) {
      return res.status(401).json({ message: "Token não informado" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT_SECRET não configurado" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const usuario = await User.findById(decoded.id).select("-senhaHash");

    if (!usuario) {
      return res.status(401).json({ message: "Usuário do token não encontrado" });
    }

    req.user = usuario;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Token inválido ou expirado" });
  }
};

export default authMiddleware;