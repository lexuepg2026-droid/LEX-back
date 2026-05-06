const onlyNumbers = (value) => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).replace(/\D/g, "");
};

const hasOwnProperty = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const validateEndereco = (endereco) => {
  if (endereco === undefined) {
    return null;
  }

  if (endereco === null || typeof endereco !== "object" || Array.isArray(endereco)) {
    return "Endereço deve ser um objeto válido";
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

  if (data.tipoPessoa === "fisica") {
    if (!data.nomeCompleto || !String(data.nomeCompleto).trim()) {
      return "Nome completo é obrigatório para pessoa física";
    }

    const cpf = onlyNumbers(data.cpf);

    if (!cpf) {
      return "CPF é obrigatório para pessoa física";
    }

    if (cpf.length !== 11) {
      return "CPF deve ter 11 dígitos";
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

    if (cnpj.length !== 14) {
      return "CNPJ deve ter 14 dígitos";
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

  if (hasOwnProperty(data, "cpf")) {
    const cpf = onlyNumbers(data.cpf);

    if (cpf && cpf.length !== 11) {
      return "CPF deve ter 11 dígitos";
    }
  }

  if (hasOwnProperty(data, "cnpj")) {
    const cnpj = onlyNumbers(data.cnpj);

    if (cnpj && cnpj.length !== 14) {
      return "CNPJ deve ter 14 dígitos";
    }
  }

  return null;
};

export default {
  validateCreateClientPayload,
  validateUpdateClientPayload
};