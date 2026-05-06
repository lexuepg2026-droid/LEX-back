import jwt from "jsonwebtoken";
import User from "../models/User.js";

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Token não informado"
      });
    }

    const parts = authHeader.split(" ");

    if (parts.length !== 2) {
      return res.status(401).json({
        message: "Token mal formatado"
      });
    }

    const [scheme, token] = parts;

    if (scheme !== "Bearer") {
      return res.status(401).json({
        message: "Tipo de token inválido"
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT_SECRET não configurado"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const usuario = await User.findById(decoded.id).select("-senhaHash");

    if (!usuario) {
      return res.status(401).json({
        message: "Usuário do token não encontrado"
      });
    }

    req.user = usuario;

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Token inválido ou expirado"
    });
  }
};

export default authMiddleware;