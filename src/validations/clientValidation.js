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

// ── Senha do portal do cliente (DEC-029) ───────────────────────────────────
// Mesmo teto de força da senha da advogada (`authValidation.validateSenhaForte`):
// 8 caracteres, ao menos uma letra e um número. Não é o mesmo código porque
// não é a mesma regra — esta tem a recusa de CPF/CNPJ, que lá não faz sentido.
//
// A recusa de CPF/CNPJ existe porque documento NÃO é segredo: ele está na
// procuração, no contrato e no próprio cadastro que a advogada acabou de
// preencher. Senha igual ao documento significa que qualquer pessoa com uma
// cópia da peça entra no portal — e a confirmação de leitura, que é o artefato
// que esta fase existe para produzir, deixaria de provar coisa alguma.
export const TAMANHO_MINIMO_SENHA_PORTAL = 8;

const validateSenhaPortal = (senha, documentos = {}) => {
  if (typeof senha !== "string") {
    return `A senha do portal deve ter no mínimo ${TAMANHO_MINIMO_SENHA_PORTAL} caracteres`;
  }

  // A checagem de documento vem PRIMEIRO, antes das regras de força, e a ordem
  // é o que a faz existir: CPF e CNPJ são só dígitos, então "12345678909" e
  // "123.456.789-09" reprovariam antes por "falta uma letra" e a advogada
  // receberia uma dica de formatação em vez do motivo real. Depois de corrigir
  // para "Cpf123456" ela tentaria de novo — e a senha continuaria derivada do
  // documento. O erro precisa dizer a coisa certa na primeira tentativa.
  //
  // Comparação por dígitos, não pela string: as duas formatações acima são o
  // mesmo documento.
  const digitosDaSenha = onlyNumbers(senha);
  if (digitosDaSenha.length > 0) {
    for (const [rotulo, valor] of [["CPF", documentos.cpf], ["CNPJ", documentos.cnpj]]) {
      const digitosDoDocumento = onlyNumbers(valor);
      if (digitosDoDocumento.length > 0 && digitosDaSenha === digitosDoDocumento) {
        return `A senha do portal não pode ser o ${rotulo} do cliente. O ${rotulo} está na procuração e no contrato — não é segredo.`;
      }
    }
  }

  if (senha.length < TAMANHO_MINIMO_SENHA_PORTAL) {
    return `A senha do portal deve ter no mínimo ${TAMANHO_MINIMO_SENHA_PORTAL} caracteres`;
  }

  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) {
    return "A senha do portal deve conter ao menos uma letra e um número";
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

  const senhaPortalError = validateSenhaPortalDoPayload(data, data);
  if (senhaPortalError) {
    return senhaPortalError;
  }

  return null;
};

// Campos de estado da senha do portal que o cliente HTTP nunca define: eles são
// consequência de definir/trocar a senha, e aceitá-los no payload deixaria a
// advogada marcar `senhaPortalProvisoria: false` sem o cliente ter trocado
// nada — o que esvaziaria o recibo em silêncio.
const CAMPOS_PORTAL_PROTEGIDOS = [
  "senhaPortalHash",
  "senhaPortalProvisoria",
  "senhaPortalDefinidaEm"
];

// `documentos` vem do payload na criação e do cliente já gravado na
// atualização — no PATCH a senha pode chegar sem o CPF junto, e comparar com
// `undefined` não protegeria nada.
const validateSenhaPortalDoPayload = (data, documentos) => {
  for (const campo of CAMPOS_PORTAL_PROTEGIDOS) {
    if (hasOwnProperty(data, campo)) {
      return `O campo "${campo}" não pode ser definido diretamente`;
    }
  }

  if (!hasOwnProperty(data, "senhaPortal")) {
    return null;
  }

  // `null` e "" limpam a senha (revogam o acesso ao portal). É o mesmo
  // vocabulário do resto do projeto: campo apagado grava null.
  if (data.senhaPortal === null || data.senhaPortal === "") {
    return null;
  }

  return validateSenhaPortal(data.senhaPortal, documentos);
};

// tipoPessoaEfetivo = tipo do payload, se enviado; senão o tipo já armazenado
// (resolvido pelo service). Com ele a exclusividade é sempre verificável, mesmo
// quando o PATCH não reenvia tipoPessoa.
const validateUpdateClientPayload = (data, tipoPessoaEfetivo, documentosAtuais = {}) => {
  const enderecoError = validateEndereco(data.endereco);
  if (enderecoError) {
    return enderecoError;
  }

  if (data.tipoPessoa !== undefined && !["fisica", "juridica"].includes(data.tipoPessoa)) {
    return "Tipo de pessoa inválido";
  }

  if (tipoPessoaEfetivo !== undefined) {
    const exclusividadeError = validateExclusividade(data, tipoPessoaEfetivo);
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

  const representanteError = validateRepresentanteLegal(data.representanteLegal, tipoPessoaEfetivo);
  if (representanteError) {
    return representanteError;
  }

  // Documento efetivo = o do payload, se veio; senão o já gravado. Um PATCH que
  // manda só `senhaPortal` precisa ser comparado com o CPF que está no banco.
  const senhaPortalError = validateSenhaPortalDoPayload(data, {
    cpf: hasOwnProperty(data, "cpf") ? data.cpf : documentosAtuais.cpf,
    cnpj: hasOwnProperty(data, "cnpj") ? data.cnpj : documentosAtuais.cnpj
  });
  if (senhaPortalError) {
    return senhaPortalError;
  }

  return null;
};

export { validateSenhaPortal, validateSenhaPortalDoPayload };

export default {
  validateCreateClientPayload,
  validateUpdateClientPayload,
  validateSenhaPortal
};
