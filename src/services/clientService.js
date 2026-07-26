import mongoose from "mongoose";
import Client from "../models/Client.js";
import clientValidation from "../validations/clientValidation.js";

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

const handleDuplicateKeyError = (error) => {
  if (error?.code === 11000) {
    if (error.keyPattern?.cpf) {
      const err = new Error("CPF já cadastrado para este usuário");
      err.statusCode = 409;
      throw err;
    }
    if (error.keyPattern?.cnpj) {
      const err = new Error("CNPJ já cadastrado para este usuário");
      err.statusCode = 409;
      throw err;
    }
    if (error.keyPattern?.email) {
      const err = new Error("Email já cadastrado para este usuário");
      err.statusCode = 409;
      throw err;
    }
    const err = new Error("Registro duplicado para este usuário");
    err.statusCode = 409;
    throw err;
  }
  throw error;
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
    const client = await Client.create({ usuarioId, ...normalizedData });
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
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return null;
  }

  return Client.findOne({ _id: clientId, usuarioId, ativo: true });
};

const updateClient = async (usuarioId, clientId, data) => {
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return null;
  }

  // Carrega o cliente ANTES de validar: o tipo efetivo (payload ou armazenado)
  // é necessário para detectar campos exclusivos no tipo errado mesmo quando o
  // PATCH não reenvia tipoPessoa — evita descarte silencioso pelo hook do model.
  const client = await Client.findOne({ _id: clientId, usuarioId, ativo: true });

  if (!client) {
    return null;
  }

  const nextTipoPessoa =
    data.tipoPessoa !== undefined ? data.tipoPessoa : client.tipoPessoa;

  const validationError = clientValidation.validateUpdateClientPayload(data, nextTipoPessoa);
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

  try {
    await client.save();
  } catch (error) {
    handleDuplicateKeyError(error);
  }

  return client;
};

const deleteClient = async (usuarioId, clientId) => {
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return null;
  }

  const client = await Client.findOne({ _id: clientId, usuarioId, ativo: true });
  if (!client) return null;
  client.ativo = false;
  await client.save();
  return client;
};

export default {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient
};