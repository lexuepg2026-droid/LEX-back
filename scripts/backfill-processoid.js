// scripts/backfill-processoid.js
// One-off: populate processoId in installments and payments via chain lookup.
// Idempotent — safe to run multiple times.
import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
console.log(`Conectado: ${mongoose.connection.host}`);

const db           = mongoose.connection.db;
const installments = db.collection('installments');
const payments     = db.collection('payments');
const fees         = db.collection('fees');

// ── Installments: feeId → fee.processoId ─────────────────────────────────────
const allInstallments = await installments.find({}).toArray();
let instUpdated = 0, instSkipped = 0;

for (const inst of allInstallments) {
  const fee = await fees.findOne({ _id: inst.feeId });
  if (!fee) {
    console.warn(`  SKIP installment ${inst._id} — fee ${inst.feeId} não encontrado`);
    instSkipped++;
    continue;
  }
  await installments.updateOne({ _id: inst._id }, { $set: { processoId: fee.processoId } });
  instUpdated++;
}
console.log(`Installments: ${instUpdated} atualizados, ${instSkipped} ignorados`);

// ── Payments: installmentId → feeId → fee.processoId ─────────────────────────
const allPayments = await payments.find({}).toArray();
let payUpdated = 0, paySkipped = 0;

for (const pay of allPayments) {
  const inst = await installments.findOne({ _id: pay.installmentId });
  if (!inst) {
    console.warn(`  SKIP payment ${pay._id} — installment ${pay.installmentId} não encontrado`);
    paySkipped++;
    continue;
  }
  const fee = await fees.findOne({ _id: inst.feeId });
  if (!fee) {
    console.warn(`  SKIP payment ${pay._id} — fee ${inst.feeId} não encontrado`);
    paySkipped++;
    continue;
  }
  await payments.updateOne({ _id: pay._id }, { $set: { processoId: fee.processoId } });
  payUpdated++;
}
console.log(`Payments:      ${payUpdated} atualizados, ${paySkipped} ignorados`);

// ── Verification ──────────────────────────────────────────────────────────────
const instMissing = await installments.countDocuments({ processoId: { $exists: false } });
const payMissing  = await payments.countDocuments({ processoId: { $exists: false } });

if (instMissing > 0 || payMissing > 0) {
  console.error(`ERRO: ${instMissing} installments e ${payMissing} payments ainda sem processoId`);
  await mongoose.disconnect();
  process.exit(1);
}

console.log('Verificação: todos os documentos têm processoId ✓');
await mongoose.disconnect();
