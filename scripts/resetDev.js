// scripts/resetDev.js
// Derruba as coleções do ambiente de desenvolvimento para recriar via seed.
// A base atual contém apenas dados de teste — não há backfill/migração.
import 'dotenv/config';
import mongoose from 'mongoose';

// ── Guard de ambiente ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  console.error('ABORT: resetDev não pode rodar com NODE_ENV=production.');
  process.exit(1);
}

const COLLECTIONS = [
  'users',
  'clients',
  'processes',
  'fees',
  'installments',
  'payments',
  'documents',
];

async function main() {
  // Conexão direta (sem connectDB) para não disparar syncIndexes sobre dados
  // legados antes de derrubar as coleções — a sincronização acontece no seed.
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB conectado: ${mongoose.connection.host}`);

  const db = mongoose.connection.db;
  const existentes = new Set((await db.listCollections().toArray()).map((c) => c.name));

  for (const nome of COLLECTIONS) {
    if (existentes.has(nome)) {
      await db.dropCollection(nome);
      console.log(`  derrubada: ${nome}`);
    } else {
      console.log(`  inexistente (ignorada): ${nome}`);
    }
  }

  console.log('Reset de desenvolvimento concluído.');
  await mongoose.connection.close();
}

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('Erro fatal no resetDev:', e.message || e);
    try {
      await mongoose.connection.close();
    } catch {
      // ignore
    }
    process.exit(1);
  });
