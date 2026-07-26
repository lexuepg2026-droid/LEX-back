import { somenteDigitos, validarCPF, validarCNPJ } from "../utils/documentos.js";

const SEXOS = ["feminino", "masculino"];
const ESTADOS_CIVIS = [
  "solteiro", "casado", "separado_judicialmente", "divorciado", "viuvo", "uniao_estavel"
];

// Campos exclusivos de cada tipo de pessoa. Enviar um deles no tipo errado é
// erro explícito (400) — o descarte silencioso fazia o usuário achar que salvou.
const CAMPOS_PF = ["nomeCompleto", "cpf", "rg", "dataNascimento", "sexo", "estadoCivil", "profissao", "nacionalidade"];
const CAMPOS_PJ = ["razaoSocial", "nomeFantasia", "cnpj", "representanteLegal"];

const onlyNumbers = (value) => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).replace(/\D/g, "");
};

const hasOwnProperty = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// "Preenchido" = presente e com conteúdo real (string não vazia, objeto não vazio).
const isFilled = (value) => {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    return Object.values(value).some((v) => v !== undefined && v !== null && String(v).trim() !== "");
  }
  return true;
};

const validateEndereco = (endereco) => {
  if (endereco === undefined) {
    return null;
  }

  if (endereco === null || typeof endereco !== "object" || Array.isArray(endereco)) {
    return "Endereço deve ser um objeto válido";
  }

  return null;
};

const validateDataNascimento = (value) => {
  if (!isFilled(value)) {
    return null;
  }

  const data = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(data.getTime())) {
    return "Data de nascimento inválida";
  }

  const hoje = new Date();
  if (data >= hoje) {
    return "Data de nascimento deve ser anterior a hoje";
  }

  const limiteInferior = new Date();
  limiteInferior.setFullYear(limiteInferior.getFullYear() - 120);
  if (data < limiteInferior) {
    return "Data de nascimento muito antiga (limite de 120 anos)";
  }

  return null;
};

// Validações de formato aplicadas a create e update quando o campo está presente.
const validateCamposComuns = (data) => {
  if (hasOwnProperty(data, "rg") && data.rg !== undefined && data.rg !== null && String(data.rg).length > 20) {
    return "RG deve ter no máximo 20 caracteres";
  }
  if (hasOwnProperty(data, "profissao") && data.profissao !== undefined && data.profissao !== null && String(data.profissao).length > 60) {
    return "Profissão deve ter no máximo 60 caracteres";
  }
  if (hasOwnProperty(data, "nacionalidade") && data.nacionalidade !== undefined && data.nacionalidade !== null && String(data.nacionalidade).length > 50) {
    return "Nacionalidade deve ter no máximo 50 caracteres";
  }
  if (isFilled(data.sexo) && !SEXOS.includes(data.sexo)) {
    return "Sexo inválido";
  }
  if (isFilled(data.estadoCivil) && !ESTADOS_CIVIS.includes(data.estadoCivil)) {
    return "Estado civil inválido";
  }

  const dataNascError = validateDataNascimento(data.dataNascimento);
  if (dataNascError) {
    return dataNascError;
  }

  return null;
};

const validateRepresentanteLegal = (representante, tipoPessoaConhecido) => {
  if (!isFilled(representante)) {
    return null;
  }

  if (typeof representante !== "object" || Array.isArray(representante)) {
    return "Representante legal deve ser um objeto válido";
  }

  // Só é aceito em pessoa jurídica.
  if (tipoPessoaConhecido !== undefined && tipoPessoaConhecido !== "juridica") {
    return "Representante legal só é permitido para pessoa jurídica";
  }

  if (!isFilled(representante.nome)) {
    return "Nome do representante legal é obrigatório";
  }
  if (String(representante.nome).length > 255) {
    return "Nome do representante legal deve ter no máximo 255 caracteres";
  }
  if (isFilled(representante.cargo) && String(representante.cargo).length > 60) {
    return "Cargo do representante legal deve ter no máximo 60 caracteres";
  }
  if (isFilled(representante.cpf) && !validarCPF(representante.cpf)) {
    return "CPF do representante legal inválido";
  }

  return null;
};

// Rejeita campos exclusivos enviados no tipo errado (com valor preenchido).
const validateExclusividade = (data, tipoPessoa) => {
  const proibidos = tipoPessoa === "fisica" ? CAMPOS_PJ : CAMPOS_PF;
  for (const campo of proibidos) {
    if (hasOwnProperty(data, campo) && isFilled(data[campo])) {
      const alvo = tipoPessoa === "fisica" ? "pessoa física" : "pessoa jurídica";
      return `O campo "${campo}" não é permitido para ${alvo}`;
    }
  }
  return null;
};

const validateCreateClientPayload = (data) => {
  if (!data.tipoPessoa) {
    return "Tipo de pessoa é obrigatório";
  }

  if (!["fisica", "juridica"].includes(data.tipoPessoa)) {
    return "Tipo de pessoa inválido";
  }

  const enderecoError = validateEndereco(data.endereco);
  if (enderecoError) {
    return enderecoError;
  }

  const exclusividadeError = validateExclusividade(data, data.tipoPessoa);
  if (exclusividadeError) {
    return exclusividadeError;
  }

  if (data.tipoPessoa === "fisica") {
    if (!data.nomeCompleto || !String(data.nomeCompleto).trim()) {
      return "Nome completo é obrigatório para pessoa física";
    }

    const cpf = onlyNumbers(data.cpf);
    if (!cpf) {
      return "CPF é obrigatório para pessoa física";
    }
    if (!validarCPF(cpf)) {
      return "CPF inválido";
    }

    const comunsError = validateCamposComuns(data);
    if (comunsError) {
      return comunsError;
    }
  }

  if (data.tipoPessoa === "juridica") {
    if (!data.razaoSocial || !String(data.razaoSocial).trim()) {
      return "Razão social é obrigatória para pessoa jurídica";
    }

    if (!data.nomeFantasia || !String(data.nomeFantasia).trim()) {
      return "Nome fantasia é obrigatório para pessoa jurídica";
    }

    const cnpj = onlyNumbers(data.cnpj);
    if (!cnpj) {
      return "CNPJ é obrigatório para pessoa jurídica";
    }
    if (!validarCNPJ(cnpj)) {
      return "CNPJ inválido";
    }

    const representanteError = validateRepresentanteLegal(data.representanteLegal, "juridica");
    if (representanteError) {
      return representanteError;
    }
  }

  return null;
};

const validateUpdateClientPayload = (data) => {
  const enderecoError = validateEndereco(data.endereco);
  if (enderecoError) {
    return enderecoError;
  }

  if (data.tipoPessoa !== undefined && !["fisica", "juridica"].includes(data.tipoPessoa)) {
    return "Tipo de pessoa inválido";
  }

  // Exclusividade só é verificável quando o tipo é informado no próprio PATCH.
  if (data.tipoPessoa !== undefined) {
    const exclusividadeError = validateExclusividade(data, data.tipoPessoa);
    if (exclusividadeError) {
      return exclusividadeError;
    }
  }

  if (hasOwnProperty(data, "cpf")) {
    const cpf = onlyNumbers(data.cpf);
    if (cpf && !validarCPF(cpf)) {
      return "CPF inválido";
    }
  }

  if (hasOwnProperty(data, "cnpj")) {
    const cnpj = onlyNumbers(data.cnpj);
    if (cnpj && !validarCNPJ(cnpj)) {
      return "CNPJ inválido";
    }
  }

  const comunsError = validateCamposComuns(data);
  if (comunsError) {
    return comunsError;
  }

  const representanteError = validateRepresentanteLegal(data.representanteLegal, data.tipoPessoa);
  if (representanteError) {
    return representanteError;
  }

  return null;
};

export default {
  validateCreateClientPayload,
  validateUpdateClientPayload
};
