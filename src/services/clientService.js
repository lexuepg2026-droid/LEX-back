import mongoose from "mongoose";
import Client from "../models/Client.js";

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

const normalizeClientData = (data) => {
  const normalizedData = {
    tipoPessoa: data.tipoPessoa,
    nomeCompleto: data.nomeCompleto,
    cpf: onlyNumbers(data.cpf),
    razaoSocial: data.razaoSocial,
    nomeFantasia: data.nomeFantasia,
    cnpj: onlyNumbers(data.cnpj),
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
  }

  if (normalizedData.tipoPessoa === "juridica") {
    normalizedData.nomeCompleto = undefined;
    normalizedData.cpf = undefined;
  }

  return normalizedData;
};

const createClient = async (usuarioId, data) => {
  const normalizedData = normalizeClientData(data);

  const client = await Client.create({
    usuarioId,
    ...normalizedData
  });

  return client;
};

const getAllClients = async (usuarioId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Client.find({ usuarioId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Client.countDocuments({ usuarioId })
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const getClientById = async (usuarioId, clientId) => {
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return null;
  }

  return Client.findOne({ _id: clientId, usuarioId });
};

const updateClient = async (usuarioId, clientId, data) => {
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return null;
  }

  const client = await Client.findOne({ _id: clientId, usuarioId });

  if (!client) {
    return null;
  }

  const nextTipoPessoa =
    data.tipoPessoa !== undefined ? data.tipoPessoa : client.tipoPessoa;

  const nextData = normalizeClientData({
    tipoPessoa: nextTipoPessoa,
    nomeCompleto:
      data.nomeCompleto !== undefined ? data.nomeCompleto : client.nomeCompleto,
    cpf: data.cpf !== undefined ? data.cpf : client.cpf,
    razaoSocial:
      data.razaoSocial !== undefined ? data.razaoSocial : client.razaoSocial,
    nomeFantasia:
      data.nomeFantasia !== undefined ? data.nomeFantasia : client.nomeFantasia,
    cnpj: data.cnpj !== undefined ? data.cnpj : client.cnpj,
    email: data.email !== undefined ? data.email : client.email,
    telefone: data.telefone !== undefined ? data.telefone : client.telefone,
    endereco: data.endereco !== undefined ? data.endereco : client.endereco,
    observacoes:
      data.observacoes !== undefined ? data.observacoes : client.observacoes,
    ativo: data.ativo !== undefined ? data.ativo : client.ativo
  });

  client.tipoPessoa = nextData.tipoPessoa;
  client.nomeCompleto = nextData.nomeCompleto;
  client.cpf = nextData.cpf;
  client.razaoSocial = nextData.razaoSocial;
  client.nomeFantasia = nextData.nomeFantasia;
  client.cnpj = nextData.cnpj;
  client.email = nextData.email;
  client.telefone = nextData.telefone;

  if (nextData.endereco !== undefined) {
    client.endereco = nextData.endereco;
  }

  client.observacoes = nextData.observacoes;
  client.ativo = nextData.ativo;

  await client.save();

  return client;
};

const deleteClient = async (usuarioId, clientId) => {
  if (!mongoose.Types.ObjectId.isValid(clientId)) {
    return null;
  }

  return Client.findOneAndDelete({ _id: clientId, usuarioId });
};

export default {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient
};