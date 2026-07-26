import mongoose from "mongoose";
import Client from "../models/Client.js";
import User from "../models/User.js";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);

    console.log(`MongoDB conectado: ${conn.connection.host}`);
    console.log(`Banco em uso: ${conn.connection.name}`);

    const clientIndexes = await Client.syncIndexes();
    console.log("Indexes sincronizados de Client:", clientIndexes);

    const userIndexes = await User.syncIndexes();
    console.log("Indexes sincronizados de User:", userIndexes);
  } catch (error) {
    console.error("Erro ao conectar no MongoDB:", error.message);
    process.exit(1);
  }
};

export default connectDB;