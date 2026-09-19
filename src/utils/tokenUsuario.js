import crypto from "node:crypto";

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN DE E-MAIL (A-2, DEC-064) — confirmação de conta e recuperação de senha
//
// O token que viaja no link é `<idDoUsuario>.<segredo>`:
//
//   • `segredo` são 32 bytes aleatórios (256 bits) em hexadecimal. É a única
//     parte secreta, e é ela que o link entrega.
//   • no banco fica só o SHA-256 do segredo — quem ler a coleção `users` não
//     consegue montar um link válido. É o mesmo raciocínio do `senhaHash`, sem
//     bcrypt: o segredo já é aleatório e longo, então não há o que "esticar".
//   • o `idDoUsuario` na frente só serve para achar o documento por `_id` — sem
//     ele seria preciso um índice sobre o hash. Um ObjectId não é segredo.
//
// A comparação do hash é em tempo constante (`timingSafeEqual`).
// ═══════════════════════════════════════════════════════════════════════════

const FORMA_DO_TOKEN = /^([a-f0-9]{24})\.([a-f0-9]{64})$/;

const sha256 = (valor) => crypto.createHash("sha256").update(valor).digest("hex");

export const gerarToken = (usuarioId) => {
  const segredo = crypto.randomBytes(32).toString("hex");
  return {
    token: `${String(usuarioId)}.${segredo}`,
    tokenHash: sha256(segredo)
  };
};

// `null` para qualquer coisa que não tenha a forma exata — inclusive não-string,
// que é o que chega quando o corpo da requisição não traz o campo.
export const lerToken = (token) => {
  if (typeof token !== "string") return null;

  const partes = FORMA_DO_TOKEN.exec(token.trim());
  if (!partes) return null;

  return { usuarioId: partes[1], tokenHash: sha256(partes[2]) };
};

export const hashesIguais = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  if (bufferA.length === 0 || bufferA.length !== bufferB.length) return false;

  return crypto.timingSafeEqual(bufferA, bufferB);
};

export default { gerarToken, lerToken, hashesIguais };
