import { UFS } from "../models/shared/enderecoSchema.js";
import { somenteDigitos, validarCPF } from "../utils/documentos.js";

// Mesmo contrato de clientValidation: cada função retorna uma string de erro
// (a primeira encontrada) ou null quando o payload é válido.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const hasOwnProperty = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const validateSenhaForte = (senha, label = "senha") => {
  if (typeof senha !== "string" || senha.length < 8) {
    return `A ${label} deve ter no mínimo 8 caracteres`;
  }
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) {
    return `A ${label} deve conter ao menos uma letra e um número`;
  }
  return null;
};

const validateOab = (oab, { obrigatorio }) => {
  if (oab === undefined) {
    return obrigatorio ? "OAB é obrigatória" : null;
  }

  if (oab === null || typeof oab !== "object" || Array.isArray(oab)) {
    return "OAB deve ser um objeto válido";
  }

  if (obrigatorio || hasOwnProperty(oab, "numero")) {
    const numero = somenteDigitos(oab.numero);
    if (!numero) {
      return "Número da OAB é obrigatório";
    }
    if (numero.length < 1 || numero.length > 6) {
      return "Número da OAB deve ter de 1 a 6 dígitos";
    }
  }

  if (obrigatorio || hasOwnProperty(oab, "estado")) {
    if (!isNonEmptyString(oab.estado)) {
      return "Estado da OAB é obrigatório";
    }
    if (!UFS.includes(oab.estado.trim().toUpperCase())) {
      return "Estado da OAB inválido";
    }
  }

  return null;
};

// ── Logo do escritório ──────────────────────────────────────────────────────

export const LOGO_MIMES_ACEITOS = ["image/png", "image/jpeg"];
export const LOGO_LIMITE_BYTES = 200 * 1024;

const LOGO_DATA_URI_REGEX = /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

const formatarKB = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// O limite é sobre a string base64 inteira, que é o que de fato vai para o
// banco e volta em toda requisição autenticada — não sobre o binário decodificado
// (~25% menor). Medir o decodificado deixaria passar payload maior do que o
// custo real.
const validateLogo = (logoBase64) => {
  if (logoBase64 === undefined) {
    return null;
  }

  // null e "" removem o logo: é assim que o botão "Remover" do perfil funciona.
  if (logoBase64 === null || logoBase64 === "") {
    return null;
  }

  if (typeof logoBase64 !== "string") {
    return "Logo deve ser uma string em data URI (data:image/png;base64,...)";
  }

  const match = LOGO_DATA_URI_REGEX.exec(logoBase64.trim());
  if (!match) {
    return 'Logo deve estar em data URI válido, no formato "data:image/png;base64,..."';
  }

  const [, mime] = match;
  if (!LOGO_MIMES_ACEITOS.includes(mime.toLowerCase())) {
    return `Formato de logo não aceito: ${mime}. Use PNG ou JPEG.`;
  }

  const tamanho = Buffer.byteLength(logoBase64.trim(), "utf8");
  if (tamanho > LOGO_LIMITE_BYTES) {
    return `Logo muito grande: ${formatarKB(tamanho)}. O limite é ${formatarKB(LOGO_LIMITE_BYTES)}.`;
  }

  return null;
};

const validateAdvocacia = (advocacia, { obrigatorio }) => {
  if (advocacia === undefined) {
    return obrigatorio ? "Dados da advocacia são obrigatórios" : null;
  }

  if (advocacia === null || typeof advocacia !== "object" || Array.isArray(advocacia)) {
    return "Advocacia deve ser um objeto válido";
  }

  if (obrigatorio || hasOwnProperty(advocacia, "nome")) {
    if (!isNonEmptyString(advocacia.nome)) {
      return "Nome da advocacia é obrigatório";
    }
    if (advocacia.nome.trim().length > 100) {
      return "Nome da advocacia deve ter no máximo 100 caracteres";
    }
  }

  if (advocacia.chavePix !== undefined && advocacia.chavePix !== null && String(advocacia.chavePix).length > 120) {
    return "Chave PIX deve ter no máximo 120 caracteres";
  }
  if (advocacia.instagram !== undefined && advocacia.instagram !== null && String(advocacia.instagram).length > 50) {
    return "Instagram deve ter no máximo 50 caracteres";
  }
  if (advocacia.site !== undefined && advocacia.site !== null && String(advocacia.site).length > 200) {
    return "Site deve ter no máximo 200 caracteres";
  }

  const logoError = validateLogo(advocacia.logoBase64);
  if (logoError) {
    return logoError;
  }

  return null;
};

const validateEndereco = (endereco) => {
  if (endereco === undefined) {
    return null;
  }

  if (endereco === null || typeof endereco !== "object" || Array.isArray(endereco)) {
    return "Endereço deve ser um objeto válido";
  }

  if (isNonEmptyString(endereco.estado) && !UFS.includes(endereco.estado.trim().toUpperCase())) {
    return "Estado do endereço inválido";
  }

  if (isNonEmptyString(endereco.cep) && somenteDigitos(endereco.cep).length !== 8) {
    return "CEP deve ter 8 dígitos";
  }

  return null;
};

const validateRegisterPayload = (data) => {
  if (data === null || typeof data !== "object") {
    return "Payload inválido";
  }

  if (!isNonEmptyString(data.nomeCompleto)) {
    return "Nome completo é obrigatório";
  }

  if (!isNonEmptyString(data.email) || !EMAIL_REGEX.test(data.email.trim())) {
    return "E-mail inválido";
  }

  const senhaError = validateSenhaForte(data.senha);
  if (senhaError) {
    return senhaError;
  }

  if (!validarCPF(data.cpf)) {
    return "CPF inválido";
  }

  const oabError = validateOab(data.oab, { obrigatorio: true });
  if (oabError) {
    return oabError;
  }

  const advocaciaError = validateAdvocacia(data.advocacia, { obrigatorio: true });
  if (advocaciaError) {
    return advocaciaError;
  }

  const enderecoError = validateEndereco(data.endereco);
  if (enderecoError) {
    return enderecoError;
  }

  return null;
};

const validateLoginPayload = (data) => {
  if (data === null || typeof data !== "object") {
    return "Payload inválido";
  }

  if (!isNonEmptyString(data.email)) {
    return "E-mail é obrigatório";
  }

  if (typeof data.senha !== "string" || data.senha.length === 0) {
    return "Senha é obrigatória";
  }

  return null;
};

const CAMPOS_PROTEGIDOS = ["email", "senhaHash", "senha", "ativo"];

const validateUpdateProfilePayload = (data) => {
  if (data === null || typeof data !== "object") {
    return "Payload inválido";
  }

  for (const campo of CAMPOS_PROTEGIDOS) {
    if (hasOwnProperty(data, campo)) {
      return `O campo "${campo}" não pode ser alterado por esta rota`;
    }
  }

  if (hasOwnProperty(data, "nomeCompleto") && !isNonEmptyString(data.nomeCompleto)) {
    return "Nome completo não pode ser vazio";
  }

  if (hasOwnProperty(data, "cpf") && !validarCPF(data.cpf)) {
    return "CPF inválido";
  }

  const oabError = validateOab(data.oab, { obrigatorio: false });
  if (oabError) {
    return oabError;
  }

  const advocaciaError = validateAdvocacia(data.advocacia, { obrigatorio: false });
  if (advocaciaError) {
    return advocaciaError;
  }

  const enderecoError = validateEndereco(data.endereco);
  if (enderecoError) {
    return enderecoError;
  }

  return null;
};

const validateChangePasswordPayload = (data) => {
  if (data === null || typeof data !== "object") {
    return "Payload inválido";
  }

  if (typeof data.senhaAtual !== "string" || data.senhaAtual.length === 0) {
    return "Senha atual é obrigatória";
  }

  const senhaError = validateSenhaForte(data.novaSenha, "nova senha");
  if (senhaError) {
    return senhaError;
  }

  if (data.novaSenha === data.senhaAtual) {
    return "A nova senha deve ser diferente da senha atual";
  }

  return null;
};

export default {
  validateRegisterPayload,
  validateLoginPayload,
  validateUpdateProfilePayload,
  validateChangePasswordPayload,
  LOGO_MIMES_ACEITOS,
  LOGO_LIMITE_BYTES
};
