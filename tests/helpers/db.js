// Conexão e limpeza do banco de teste.
//
// Limpeza é DETERMINÍSTICA e por coleção: cada arquivo de teste declara as
// coleções que usa e limpa só essas, no `before` e no `after`. Nunca
// `dropDatabase` cego — com execução serial isso funcionaria hoje e quebraria
// no dia em que alguém ligar paralelismo, do jeito mais difícil de diagnosticar.

import mongoose from "mongoose";
import { MONGO_URI_TESTE, NOME_DO_BANCO, abortar } from "./env.js";

// Todas as coleções do domínio. O nome é o do Mongo, não o do model.
export const COLECOES = Object.freeze({
  USERS: "users",
  CLIENTS: "clients",
  PROCESSES: "processes",
  PROCESSO_CLIENTES: "processo_clientes",
  FEES: "fees",
  INSTALLMENTS: "installments",
  PAYMENTS: "payments",
  SECOES: "secoes",
  DOCUMENTS: "documents",
  DOCUMENTO_SECAO: "documento_secao"
});

export const TODAS_AS_COLECOES = Object.freeze(Object.values(COLECOES));

let conectado = false;

export const conectar = async () => {
  if (conectado) return mongoose.connection;

  await mongoose.connect(MONGO_URI_TESTE);

  // A guarda de `env.js` olha a string; esta olha o que o driver de fato
  // abriu. Se as duas divergirem, quem manda é o driver.
  const nomeReal = mongoose.connection.name;
  if (nomeReal !== NOME_DO_BANCO) {
    abortar(
      `A conexão abriu no banco \`${nomeReal}\`, mas a URI dizia ` +
      `\`${NOME_DO_BANCO}\`.\nA suíte não continua com essa divergência.`
    );
  }

  conectado = true;
  return mongoose.connection;
};

export const desconectar = async () => {
  if (!conectado) return;
  await mongoose.disconnect();
  conectado = false;
};

// Apaga o conteúdo das coleções informadas. Coleção inexistente é no-op — o
// primeiro `before` da vida do banco de teste cai exatamente nesse caso.
export const limparColecoes = async (nomes = TODAS_AS_COLECOES) => {
  await conectar();
  const existentes = new Set(
    (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name)
  );
  for (const nome of nomes) {
    if (existentes.has(nome)) {
      await mongoose.connection.db.collection(nome).deleteMany({});
    }
  }
};

export const contarEm = async (colecao, filtro = {}) => {
  await conectar();
  return mongoose.connection.db.collection(colecao).countDocuments(filtro);
};

export const acharEm = async (colecao, filtro = {}) => {
  await conectar();
  return mongoose.connection.db.collection(colecao).find(filtro).toArray();
};
