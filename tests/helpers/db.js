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
  await sincronizarIndices();
  return mongoose.connection;
};

// ── Os índices do banco de teste acompanham o SCHEMA (DEC-048, F-1c.1) ─────
//
// `limparColecoes` usa `deleteMany`, que apaga documento e **não toca em
// índice**. Quando a DEC-048 trocou o índice único de `{feeId, numeroParcela}`
// para `{feeId, planoId, numeroParcela}`, o Mongoose criou o novo na subida e
// deixou o VELHO de pé — e o velho recusava a renumeração com um 409
// "Valor duplicado para feeId" que não tinha nada a ver com o código novo.
//
// `syncIndexes()` derruba o que não está mais no schema e cria o que falta. É
// o equivalente, no banco de teste, ao que
// `scripts/migrarTotalParcelas.js` faz em desenvolvimento e produção — lá a
// troca é explícita e auditada, porque derrubar índice em base real não pode
// ser efeito colateral de subir o app.
//
// Só `Installment`: é o único model cuja definição de índice mudou, e um
// `syncIndexes` geral derrubaria índice de qualquer coleção cuja definição
// tenha divergido por outro motivo — silenciosamente.
const sincronizarIndices = async () => {
  const { default: Installment } = await import("../../src/models/Installment.js");
  await Installment.syncIndexes();
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
