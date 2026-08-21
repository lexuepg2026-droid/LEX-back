// ════════════════════════════════════════════════════════════════════════════
// A SESSÃO DA ADVOGADA — e a ÚNICA origem legítima de 401 nesta área (DEC-050)
//
// **Todo 401 deste middleware significa uma coisa só: não sei quem você é.**
// Token faltando, expirado, malformado, do domínio errado, ou apontando para um
// usuário que não existe mais — em todos, a sessão está ausente ou inválida, e
// descartá-la é a reação certa.
//
// A DEC-050 reserva o 401 a exatamente isto. Qualquer outra falha de credencial
// que aconteça DEPOIS daqui — ou seja, dentro de uma sessão que este middleware
// já aprovou — responde 422, nunca 401. O caso que originou a regra é a senha
// atual errada em `POST /auth/alterar-senha` (`services/authService.js`).
//
// O que a regra compra: o interceptor do frontend desloga em 401 e pronto. Ele
// não precisa conhecer rota nenhuma, e nenhuma rota nova pode expulsá-la por
// engano — para isso, teria de vir deste arquivo.
// ════════════════════════════════════════════════════════════════════════════

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