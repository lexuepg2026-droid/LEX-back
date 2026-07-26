// Utilitário de CPF/CNPJ.
// Validação real de dígitos verificadores (não apenas contagem de caracteres),
// porque o plano de teste prevê o cenário "CPF inválido → HTTP 400" e validar
// só o comprimento aceitaria valores como "12345678900".

export const somenteDigitos = (valor) => {
  if (valor === undefined || valor === null) {
    return "";
  }

  return String(valor).replace(/\D/g, "");
};

export const validarCPF = (cpf) => {
  const digitos = somenteDigitos(cpf);

  if (digitos.length !== 11) {
    return false;
  }

  // Rejeita sequências repetidas (00000000000, 11111111111, ...).
  if (/^(\d)\1{10}$/.test(digitos)) {
    return false;
  }

  const calcularDigito = (base, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) {
      soma += Number(base[i]) * (pesoInicial - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const dv1 = calcularDigito(digitos.slice(0, 9), 10);
  if (dv1 !== Number(digitos[9])) {
    return false;
  }

  const dv2 = calcularDigito(digitos.slice(0, 10), 11);
  if (dv2 !== Number(digitos[10])) {
    return false;
  }

  return true;
};

export const validarCNPJ = (cnpj) => {
  const digitos = somenteDigitos(cnpj);

  if (digitos.length !== 14) {
    return false;
  }

  // Rejeita sequências repetidas (00000000000000, ...).
  if (/^(\d)\1{13}$/.test(digitos)) {
    return false;
  }

  const calcularDigito = (base) => {
    // Pesos cíclicos 2..9 aplicados da direita para a esquerda.
    let soma = 0;
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i -= 1) {
      soma += Number(base[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const dv1 = calcularDigito(digitos.slice(0, 12));
  if (dv1 !== Number(digitos[12])) {
    return false;
  }

  const dv2 = calcularDigito(digitos.slice(0, 13));
  if (dv2 !== Number(digitos[13])) {
    return false;
  }

  return true;
};

export const formatarCPF = (cpf) => {
  const digitos = somenteDigitos(cpf);

  if (digitos.length !== 11) {
    return digitos;
  }

  return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
};

export const formatarCNPJ = (cnpj) => {
  const digitos = somenteDigitos(cnpj);

  if (digitos.length !== 14) {
    return digitos;
  }

  return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
};
