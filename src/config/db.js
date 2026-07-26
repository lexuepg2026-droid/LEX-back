import mongoose from "mongoose";
import Client from "../models/Client.js";
import User from "../models/User.js";

// Sincroniza índices de um model sem derrubar o boot: índice é otimização,
// não pré-requisito para servir requisição. Se falhar (ex.: dados legados que
// violam um novo índice único), loga aviso acionável e segue.
const syncModelIndexes = async (model) => {
  try {
    const resultado = await model.syncIndexes();
    console.log(`Indexes sincronizados de ${model.modelName}:`, resultado);
  } catch (error) {
    console.warn(
      `[AVISO] Falha ao sincronizar índices de ${model.modelName}: ${error.message}. ` +
      `A aplicação subiu, mas os índices podem estar desatualizados. ` +
      `Rode "npm run reset:dev" se a base tiver dados antigos.`
    );
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);

    console.log(`MongoDB conectado: ${conn.connection.host}`);
    console.log(`Banco em uso: ${conn.connection.name}`);
  } catch (error) {
    // Sem banco não há aplicação — este é o único caso que aborta o boot.
    console.error("Erro ao conectar no MongoDB:", error.message);
    process.exit(1);
  }

  // Cada model tem seu próprio try/catch para que a falha de um não impeça o outro.
  await syncModelIndexes(Client);
  await syncModelIndexes(User);
};

export default connectDB;
