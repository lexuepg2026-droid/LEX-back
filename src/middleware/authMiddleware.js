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

    // Segunda tranca do isolamento entre os dois domínios (DEC-029 ponto 7).
    //
    // A primeira é o segredo distinto: um token do portal é assinado com
    // `JWT_PORTAL_SECRET` e a verificação acima já falha. Esta checagem existe
    // para o dia em que alguém apontar as duas variáveis para o mesmo valor
    // sem perceber — aí a assinatura passaria, e só o `tipo` separaria um
    // cliente do cadastro inteiro da advogada.
    //
    // `assertSegredoDoPortal()` (src/config/portalSecret.js) impede essa
    // configuração na subida. As duas defesas são deliberadamente redundantes.
    if (decoded?.tipo === "portal") {
      return res.status(401).json({ message: "Token inválido ou expirado" });
    }

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