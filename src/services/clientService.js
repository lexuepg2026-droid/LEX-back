import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Client from "../models/Client.js";
import clientValidation from "../validations/clientValidation.js";
import { contarProcessosDoCliente } from "./processoClienteService.js";
import { DEPENDENCIA } from "../config/integrityConflicts.js";

const onlyNumbers = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalizedValue = String(value).replace(/\D/g, "");
  return normalizedValue || undefined;
};

const normalizeEmail = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalizedValue = String(value).trim().toLowerCase();
  return normalizedValue || undefined;
};

const normalizeEndereco = (endereco) => {
  if (endereco === undefined) {
    return undefined;
  }

  if (!endereco || typeof endereco !== "object" || Array.isArray(endereco)) {
    return {};
  }

  return {
    cep: endereco.cep,
    pais: endereco.pais,
    estado: endereco.estado,
    cidade: endereco.cidade,
    bairro: endereco.bairro,
    logradouro: endereco.logradouro,
    numero: endereco.numero,
    complemento: endereco.complemento
  };
};

const normalizeRepresentante = (representante) => {
  if (representante === undefined) {
    return undefined;
  }
  if (!representante || typeof representante !== "object" || Array.isArray(representante)) {
    return undefined;
  }
  return {
    nome: representante.nome,
    cpf: onlyNumbers(representante.cpf),
    cargo: representante.cargo
  };
};

const normalizeClientData = (data) => {
  const normalizedData = {
    tipoPessoa: data.tipoPessoa,
    nomeCompleto: data.nomeCompleto,
    cpf: onlyNumbers(data.cpf),
    rg: data.rg,
    dataNascimento: data.dataNascimento,
    sexo: data.sexo,
    estadoCivil: data.estadoCivil,
    profissao: data.profissao,
    nacionalidade: data.nacionalidade,
    razaoSocial: data.razaoSocial,
    nomeFantasia: data.nomeFantasia,
    cnpj: onlyNumbers(data.cnpj),
    representanteLegal: normalizeRepresentante(data.representanteLegal),
    email: normalizeEmail(data.email),
    telefone: data.telefone,
    endereco: normalizeEndereco(data.endereco),
    observacoes: data.observacoes,
    ativo: data.ativo
  };

  if (normalizedData.tipoPessoa === "fisica") {
    normalizedData.razaoSocial = undefined;
    normalizedData.nomeFantasia = undefined;
    normalizedData.cnpj = undefined;
    normalizedData.representanteLegal = undefined;
  }

  if (normalizedData.tipoPessoa === "juridica") {
    normalizedData.nomeCompleto = undefined;
    normalizedData.cpf = undefined;
    normalizedData.rg = undefined;
    normalizedData.dataNascimento = undefined;
    normalizedData.sexo = undefined;
    normalizedData.estadoCivil = undefined;
    normalizedData.profissao = undefined;
    normalizedData.nacionalidade = undefined;
  }

  return normalizedData;
};

// `campo` acompanha o 409 para o cliente saber qual input destacar sem ter de
// interpretar o texto da mensagem. A mensagem segue sendo o que o usuário lê.
const conflict = (message, campo) => {
  const error = new Error(message);
  error.statusCode = 409;
  if (campo) error.campo = campo;
  return error;
};

// 409 de integridade referencial. Não leva `campo`: não há input em conflito,
// e sim registros já gravados. Ver `config/integrityConflicts.js`.
const conflictDeDependencia = (message, dependencia, quantidade) => {
  const error = new Error(message);
  error.statusCode = 409;
  error.dependencia = dependencia;
  error.quantidade = quantidade;
  return error;
};

const handleDuplicateKeyError = (error) => {
  if (error?.code === 11000) {
    if (error.keyPattern?.cpf) {
      throw conflict("CPF já cadastrado para este usuário", "cpf");
    }
    if (error.keyPattern?.cnpj) {
      throw conflict("CNPJ já cadastrado para este usuário", "cnpj");
    }
    if (error.keyPattern?.email) {
      throw conflict("Email já cadastrado para este usuário", "email");
    }
    throw conflict("Registro duplicado para este usuário");
  }
  throw error;
};

// ID malformado é erro de requisição, não "não encontrado": 404 sugere que o
// identificador poderia existir. Sem esta checagem o Mongoose lançaria
// CastError, que o errorHandler também converte em 400 — aqui a mensagem sai
// mais específica e a query nem chega ao banco.
const assertIdValido = (clientId) => {
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    const err = new Error("Identificador de cliente inválido");
    err.statusCode = 400;
    throw err;
  }
};

// ── Senha do portal (DEC-029, pontos 2, 3 e 4) ─────────────────────────────
// Quem define aqui é a ADVOGADA, e por isso o resultado é sempre
// `senhaPortalProvisoria: true`: a senha que ela conhece serve para a primeira
// entrada e nada mais. `senhaPortalDefinidaEm` fica nulo — ele marca o momento
// em que o CLIENTE assumiu a senha, e é essa diferença que dá valor ao recibo
// de confirmação.
//
// Enviar `null` ou "" REVOGA o acesso: zera os três campos. Cliente que não usa
// o portal simplesmente não tem senha, e isso é estado válido, não pendência.
const aplicarSenhaPortal = async (client, senhaPortal) => {
  if (senhaPortal === null || senhaPortal === "") {
    client.senhaPortalHash = null;
    client.senhaPortalProvisoria = false;
    client.senhaPortalDefinidaEm = null;
    return;
  }

  // 10 rounds, o mesmo custo da senha da advogada (`authService`). Não é
  // número mágico: é o que já está em produção, e divergir aqui criaria dois
  // perfis de custo para justificar.
  client.senhaPortalHash = await bcrypt.hash(senhaPortal, 10);
  client.senhaPortalProvisoria = true;
  client.senhaPortalDefinidaEm = null;
};

const createClient = async (usuarioId, data) => {
  const validationError = clientValidation.validateCreateClientPayload(data);
  if (validationError) {
    const err = new Error(validationError);
    err.statusCode = 400;
    throw err;
  }

  const normalizedData = normalizeClientData(data);

  try {
    const client = new Client({ usuarioId, ...normalizedData });

    if (Object.prototype.hasOwnProperty.call(data, "senhaPortal")) {
      await aplicarSenhaPortal(client, data.senhaPortal);
    }

    await client.save();
    return client;
  } catch (error) {
    handleDuplicateKeyError(error);
  }
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getAllClients = async (usuarioId, { page = 1, limit = 20, busca } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { usuarioId, ativo: true };
  if (busca && typeof busca === 'string') {
    const termo = busca.slice(0, 80).trim();
    if (termo) {
      const regex = new RegExp(escapeRegex(termo), 'i');
      filter.$or = [{ nomeCompleto: regex }, { razaoSocial: regex }, { email: regex }];
    }
  }
  const [data, total] = await Promise.all([
    Client.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Client.countDocuments(filter)
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getClientById = async (usuarioId, clientId) => {
  assertIdValido(clientId);

  return Client.findOne({ _id: clientId, usuarioId, ativo: true });
};

const updateClient = async (usuarioId, clientId, data) => {
  assertIdValido(clientId);

  // Carrega o cliente ANTES de validar: o tipo efetivo (payload ou armazenado)
  // é necessário para detectar campos exclusivos no tipo errado mesmo quando o
  // PATCH não reenvia tipoPessoa — evita descarte silencioso pelo hook do model.
  const client = await Client.findOne({ _id: clientId, usuarioId, ativo: true });

  if (!client) {
    return null;
  }

  const nextTipoPessoa =
    data.tipoPessoa !== undefined ? data.tipoPessoa : client.tipoPessoa;

  const validationError = clientValidation.validateUpdateClientPayload(data, nextTipoPessoa, {
    cpf: client.cpf,
    cnpj: client.cnpj
  });
  if (validationError) {
    const err = new Error(validationError);
    err.statusCode = 400;
    throw err;
  }

  const pick = (campo) => (data[campo] !== undefined ? data[campo] : client[campo]);

  const nextData = normalizeClientData({
    tipoPessoa: nextTipoPessoa,
    nomeCompleto: pick("nomeCompleto"),
    cpf: pick("cpf"),
    rg: pick("rg"),
    dataNascimento: pick("dataNascimento"),
    sexo: pick("sexo"),
    estadoCivil: pick("estadoCivil"),
    profissao: pick("profissao"),
    nacionalidade: pick("nacionalidade"),
    razaoSocial: pick("razaoSocial"),
    nomeFantasia: pick("nomeFantasia"),
    cnpj: pick("cnpj"),
    representanteLegal: pick("representanteLegal"),
    email: pick("email"),
    telefone: pick("telefone"),
    endereco: data.endereco !== undefined ? data.endereco : client.endereco,
    observacoes: pick("observacoes"),
    ativo: pick("ativo")
  });

  client.tipoPessoa = nextData.tipoPessoa;
  client.nomeCompleto = nextData.nomeCompleto;
  client.cpf = nextData.cpf;
  client.rg = nextData.rg;
  client.dataNascimento = nextData.dataNascimento;
  client.sexo = nextData.sexo;
  client.estadoCivil = nextData.estadoCivil;
  client.profissao = nextData.profissao;
  client.nacionalidade = nextData.nacionalidade;
  client.razaoSocial = nextData.razaoSocial;
  client.nomeFantasia = nextData.nomeFantasia;
  client.cnpj = nextData.cnpj;
  client.representanteLegal = nextData.representanteLegal;
  client.email = nextData.email;
  client.telefone = nextData.telefone;

  if (nextData.endereco !== undefined) {
    client.endereco = nextData.endereco;
  }

  client.observacoes = nextData.observacoes;
  client.ativo = nextData.ativo;

  // Fora do `normalizeClientData` de propósito: a senha não é campo de cadastro
  // que se copia de um lado para o outro, é operação com efeito colateral
  // (hash + reset do estado provisório). Só toca quando a chave veio no payload.
  if (Object.prototype.hasOwnProperty.call(data, "senhaPortal")) {
    await aplicarSenhaPortal(client, data.senhaPortal);
  }

  try {
    await client.save();
  } catch (error) {
    handleDuplicateKeyError(error);
  }

  return client;
};

// Revogação do acesso ao portal. Existe como operação PRÓPRIA, e não só como
// `PATCH { senhaPortal: null }`, porque revogar acesso é ação deliberada com
// consequência imediata para uma pessoa de fora — merece rota que diga o que
// faz, e log de intenção legível quando alguém for auditar o histórico.
//
// NÃO apaga confirmações de visualização já registradas: elas são prova de que
// a informação foi entregue, e prova que some não serve. Ver o comentário de
// imutabilidade em `models/ConfirmacaoVisualizacao.js`.
const revogarAcessoPortal = async (usuarioId, clientId) => {
  assertIdValido(clientId);

  const client = await Client.findOne({ _id: clientId, usuarioId, ativo: true });
  if (!client) return null;

  await aplicarSenhaPortal(client, null);
  await client.save();

  return client;
};

// AUDITORIA (Fase 2B): até aqui o soft delete de cliente não verificava
// processo nenhum — nem pelo `clienteId` antigo de Process. Um cliente com
// processo em andamento saía do cadastro e o processo ficava apontando para um
// registro inativo, que a listagem já não populava.
//
// A verificação passa a existir e olha a JUNÇÃO, não `Process.clientePrincipalId`:
// a junção é a verdade sobre quem participa, e um cliente pode ser
// litisconsorte sem nunca ser o principal de coisa alguma. Mesma regra de
// honorário (parcelas vinculadas) e parcela (pagamentos vinculados).
const deleteClient = async (usuarioId, clientId) => {
  assertIdValido(clientId);

  const client = await Client.findOne({ _id: clientId, usuarioId, ativo: true });
  if (!client) return null;

  const vinculosAtivos = await contarProcessosDoCliente(usuarioId, clientId);

  if (vinculosAtivos > 0) {
    const plural = vinculosAtivos === 1 ? "processo" : "processos";
    throw conflictDeDependencia(
      `Não é possível excluir este cliente: ele participa de ${vinculosAtivos} ${plural} ativo${vinculosAtivos === 1 ? "" : "s"}. Desvincule-o dos processos antes.`,
      DEPENDENCIA.PROCESSOS,
      vinculosAtivos
    );
  }

  client.ativo = false;
  await client.save();
  return client;
};

export default {
  revogarAcessoPortal,
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient
};