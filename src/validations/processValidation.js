import mongoose from "mongoose";
import { PAPEIS_PROCESSO_CLIENTE } from "../models/ProcessoCliente.js";

const validStatus = ["ativo", "encerrado", "suspenso"];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isValidDate = (value) => {
  if (!value) return true;

  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

export const PAPEL_PADRAO = "autor";

// Normaliza os participantes do payload de criação para a forma única
// { clienteId, papel, principal } que o service grava na junção.
//
// Aceita dois formatos:
//   1. `clientes: [{ clienteId, papel, principal }]` — o formato da Fase 2B;
//   2. `clientePrincipalId` isolado — compatibilidade com o seed e com
//      chamadas anteriores à junção, tratado como participante único
//      `principal: true` e `papel: "autor"`.
//
// Devolve `{ errors, clientes }`. Com `errors` não vazio, `clientes` não deve
// ser usado.
export const normalizarClientesDoPayload = (data) => {
  const errors = [];

  if (data.clientes !== undefined && !Array.isArray(data.clientes)) {
    return { errors: ["clientes deve ser um array"], clientes: [] };
  }

  const temArray = Array.isArray(data.clientes) && data.clientes.length > 0;

  // Compatibilidade: sem array, um clientePrincipalId isolado vira o único
  // participante. Aceita também o nome antigo `clienteId` para não quebrar
  // integrações que ainda não migraram.
  if (!temArray) {
    const legado = data.clientePrincipalId ?? data.clienteId;

    if (legado === undefined || legado === null || legado === "") {
      return {
        errors: ["informe ao menos um cliente no processo (campo clientes)"],
        clientes: []
      };
    }

    if (!isValidObjectId(legado)) {
      return { errors: ["clientePrincipalId inválido"], clientes: [] };
    }

    return {
      errors: [],
      clientes: [{ clienteId: String(legado), papel: PAPEL_PADRAO, principal: true }]
    };
  }

  const clientes = [];
  const vistos = new Set();

  data.clientes.forEach((item, indice) => {
    const posicao = `clientes[${indice}]`;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${posicao} deve ser um objeto`);
      return;
    }

    const clienteId = item.clienteId;

    if (!clienteId) {
      errors.push(`${posicao}.clienteId é obrigatório`);
    } else if (!isValidObjectId(clienteId)) {
      errors.push(`${posicao}.clienteId inválido`);
    } else if (vistos.has(String(clienteId))) {
      errors.push(`${posicao}.clienteId repetido no mesmo processo`);
    } else {
      vistos.add(String(clienteId));
    }

    const papel = item.papel === undefined ? PAPEL_PADRAO : String(item.papel).trim();

    if (!PAPEIS_PROCESSO_CLIENTE.includes(papel)) {
      errors.push(
        `${posicao}.papel inválido. Valores aceitos: ${PAPEIS_PROCESSO_CLIENTE.join(", ")}`
      );
    }

    if (item.principal !== undefined && typeof item.principal !== "boolean") {
      errors.push(`${posicao}.principal deve ser booleano`);
    }

    clientes.push({
      clienteId: String(clienteId),
      papel,
      principal: item.principal === true
    });
  });

  const principais = clientes.filter((c) => c.principal).length;

  // Zero ou dois principais deixariam `clientePrincipalId` indefinido ou
  // ambíguo — e é dele que sai a qualificação do documento gerado sem cliente
  // explícito. Exigir exatamente um aqui evita processo em estado inválido.
  if (principais === 0) {
    errors.push("exatamente um cliente deve ser marcado como principal");
  } else if (principais > 1) {
    errors.push(`exatamente um cliente deve ser marcado como principal (recebidos ${principais})`);
  }

  return { errors, clientes };
};

export const validateCreateProcess = (data) => {
  const errors = [];

  const { errors: errosClientes } = normalizarClientesDoPayload(data);
  errors.push(...errosClientes);

  if (!data.titulo || !String(data.titulo).trim()) {
    errors.push("titulo é obrigatório");
  }

  if (data.status && !validStatus.includes(data.status)) {
    errors.push("status inválido");
  }

  if (!isValidDate(data.dataDistribuicao)) {
    errors.push("dataDistribuicao inválida");
  }

  return errors;
};

export const validateUpdateProcess = (data) => {
  const errors = [];

  if (data.clientePrincipalId !== undefined && !isValidObjectId(data.clientePrincipalId)) {
    errors.push("clientePrincipalId inválido");
  }

  if (data.titulo !== undefined && !String(data.titulo).trim()) {
    errors.push("titulo não pode ser vazio");
  }

  if (data.status !== undefined && !validStatus.includes(data.status)) {
    errors.push("status inválido");
  }

  if (data.dataDistribuicao !== undefined && !isValidDate(data.dataDistribuicao)) {
    errors.push("dataDistribuicao inválida");
  }

  return errors;
};

export const validateProcessId = (id) => {
  if (!isValidObjectId(id)) {
    return ["id do processo inválido"];
  }

  return [];
};

// Corpo de POST /api/processes/:id/clientes e PATCH .../:clienteId.
export const validateVinculoPayload = (data, { exigirClienteId = true } = {}) => {
  const errors = [];

  if (exigirClienteId) {
    if (!data?.clienteId) {
      errors.push("clienteId é obrigatório");
    } else if (!isValidObjectId(data.clienteId)) {
      errors.push("clienteId inválido");
    }
  }

  if (data?.papel === undefined) {
    if (!exigirClienteId) {
      errors.push("papel é obrigatório");
    }
  } else if (!PAPEIS_PROCESSO_CLIENTE.includes(String(data.papel).trim())) {
    errors.push(
      `papel inválido. Valores aceitos: ${PAPEIS_PROCESSO_CLIENTE.join(", ")}`
    );
  }

  return errors;
};

export const validateClienteId = (id) => {
  if (!isValidObjectId(id)) {
    return ["id do cliente inválido"];
  }

  return [];
};
