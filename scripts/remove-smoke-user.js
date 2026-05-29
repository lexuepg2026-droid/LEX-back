// scripts/remove-smoke-user.js
// One-off cleanup: remove smoke test user from MongoDB Atlas.
// Safe to delete this file after confirmed execution.
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

const SMOKE_EMAIL = 'smoke.test.lex@temp.local';

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Conectado: ${mongoose.connection.host}`);

  const result = await User.deleteOne({ email: SMOKE_EMAIL });

  if (result.deletedCount === 1) {
    console.log(`Removido: ${SMOKE_EMAIL}`);
  } else {
    console.log(`Não encontrado: ${SMOKE_EMAIL} — nada removido.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Erro:', e.message);
    process.exit(1);
  });
