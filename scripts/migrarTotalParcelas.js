// scripts/migrarTotalParcelas.js
//
// ═══════════════════════════════════════════════════════════════════════════
// MIGRAÇÃO DA DEC-048 (Fase F-1c.1) — o "de N" congelado e o plano da parcela
//
// Preenche, nas parcelas JÁ GRAVADAS, os dois campos que a DEC-048 introduziu:
//
//   `planoId`        — a operação de reparcelamento que CRIOU a parcela.
//                      `null` = plano original do honorário.
//   `totalParcelas`  — o tamanho do plano a que a parcela pertence, congelado.
//
// ── O que esta migração NÃO faz, e é o ponto mais importante ─────────────
// **Não renumera nada.** Renumerar dado já gravado quebraria a referência de
// recibos já emitidos: um recibo entregue ao cliente dizendo "parcela 3 de 3"
// passaria a apontar para uma parcela que agora se chama outra coisa. A
// renumeração da DEC-048 vale **só para reparcelamentos daqui em diante**.
//
// Ou seja: um honorário reparcelado ANTES desta fase continua com as parcelas
// numeradas 1, 2 (canceladas) e 3, 4, 5 (vivas). O que ele ganha é o "de N"
// correto em cada geração — as canceladas dizendo "de 2" e as novas "de 3" —,
// que já é a metade do problema resolvida sem tocar no passado.
//
// ── De onde sai o plano de cada parcela ──────────────────────────────────
// De `Renegotiation.parcelasNovas`, que guarda os ids das parcelas que
// NASCERAM naquele reparcelamento. É a única fonte confiável: o campo
// `reparcelamentoId` da parcela significa "a operação que me CANCELOU", e não
// "a que me criou" — supor o contrário faria a migração contar o conjunto
// errado.
//
// ── Idempotência ─────────────────────────────────────────────────────────
// Roda quantas vezes for preciso. A segunda execução não altera documento
// nenhum: o filtro de escrita exige o campo ainda vazio, e o relatório final
// separa "preenchidos agora" de "já tinham".
//
// Rodar:  node scripts/migrarTotalParcelas.js
//         node scripts/migrarTotalParcelas.js --dry-run
// ═══════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import mongoose from 'mongoose';
import { exigirConfirmacaoDeBanco } from './lib/guardaDeBanco.js';

// ── Guarda de ambiente ────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  console.error('ABORT: rode a migração com NODE_ENV explícito e backup feito.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('ABORT: MONGO_URI não definida.');
  process.exit(1);
}

const linha = (t = '─') => console.log(t.repeat(70));

async function main() {
  // ── Guarda de banco destrutivo (F-2b) ────────────────────────────────────
  // A migração reescreve parcelas e TROCA UM ÍNDICE ÚNICO. `--dry-run` não
  // escreve nada e por isso não pergunta — é justamente o modo que existe para
  // olhar antes de agir.
  if (!DRY_RUN) {
    await exigirConfirmacaoDeBanco({
      uri,
      acao: 'migração da DEC-048 (reescreve parcelas e troca um índice único)'
    });
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  // O nome do banco é a única coisa que se imprime da conexão: a URI carrega
  // credencial, e credencial não aparece em saída de script nem mascarada.
  console.log(`banco: ${db.databaseName}${DRY_RUN ? '  (DRY RUN — nada será gravado)' : ''}`);
  linha('═');

  const parcelas = db.collection('installments');
  const reparcelamentos = db.collection('reparcelamentos');

  // ── 1. `planoId` a partir de `Renegotiation.parcelasNovas` ──────────────
  const todos = await reparcelamentos.find({}).toArray();
  console.log(`reparcelamentos encontrados: ${todos.length}`);

  let planoPreenchido = 0;
  let planoJaTinha = 0;

  for (const r of todos) {
    const ids = (r.parcelasNovas ?? []).map((x) => new mongoose.Types.ObjectId(String(x)));
    if (ids.length === 0) continue;

    const jaTinham = await parcelas.countDocuments({ _id: { $in: ids }, planoId: r._id });
    planoJaTinha += jaTinham;

    if (!DRY_RUN) {
      const res = await parcelas.updateMany(
        { _id: { $in: ids }, $or: [{ planoId: null }, { planoId: { $exists: false } }] },
        { $set: { planoId: r._id } }
      );
      planoPreenchido += res.modifiedCount;
    } else {
      planoPreenchido += await parcelas.countDocuments({
        _id: { $in: ids },
        $or: [{ planoId: null }, { planoId: { $exists: false } }]
      });
    }
  }

  console.log(`  planoId preenchido agora : ${planoPreenchido}`);
  console.log(`  planoId já correto       : ${planoJaTinha}`);
  linha();

  // ── 2. `totalParcelas` = tamanho do plano ───────────────────────────────
  //
  // Um "plano" é o par (honorário, planoId). O tamanho é a contagem de
  // parcelas ATIVAS daquele par — a desativada não conta para o "de N" que a
  // advogada lê, pelo mesmo motivo que ela não aparece na lista.
  const planos = await parcelas.aggregate([
    { $match: { ativo: { $ne: false } } },
    {
      $group: {
        _id: { feeId: '$feeId', planoId: { $ifNull: ['$planoId', null] } },
        total: { $sum: 1 },
        ids: { $push: '$_id' }
      }
    }
  ]).toArray();

  console.log(`planos distintos (honorário × geração): ${planos.length}`);
  if (DRY_RUN) {
    // No dry run o `planoId` do passo 1 não foi gravado, então as parcelas de
    // reparcelamento ainda caem no grupo do plano original e esta contagem sai
    // otimista. É previsão, não medida — a execução real agrupa certo.
    console.log('  (dry run: a separação por geração só vale na execução real)');
  }

  let totalPreenchido = 0;
  let totalJaTinha = 0;

  for (const plano of planos) {
    const jaTinham = await parcelas.countDocuments({
      _id: { $in: plano.ids },
      totalParcelas: { $ne: null, $exists: true }
    });
    totalJaTinha += jaTinham;

    if (!DRY_RUN) {
      const res = await parcelas.updateMany(
        {
          _id: { $in: plano.ids },
          $or: [{ totalParcelas: null }, { totalParcelas: { $exists: false } }]
        },
        { $set: { totalParcelas: plano.total } }
      );
      totalPreenchido += res.modifiedCount;
    } else {
      totalPreenchido += await parcelas.countDocuments({
        _id: { $in: plano.ids },
        $or: [{ totalParcelas: null }, { totalParcelas: { $exists: false } }]
      });
    }
  }

  console.log(`  totalParcelas preenchido agora : ${totalPreenchido}`);
  console.log(`  totalParcelas já tinha         : ${totalJaTinha}`);
  linha();

  // ── 3. O índice único velho sai, o novo entra ───────────────────────────
  //
  // `{feeId, numeroParcela}` era o que IMPEDIA a renumeração — com ele, a
  // parcela 1 do plano novo colidia com a parcela 1 do plano cancelado.
  // Mongoose cria o índice novo sozinho na subida, mas NÃO derruba o antigo:
  // sem esta parte, o reparcelamento continuaria falhando em produção com a
  // suíte verde.
  const indices = await parcelas.indexes();
  const velho = indices.find((i) => i.name === 'feeId_1_numeroParcela_1');
  const novo = indices.find((i) => i.name === 'feeId_1_planoId_1_numeroParcela_1');

  console.log('índices:');
  if (velho) {
    if (DRY_RUN) {
      console.log('  feeId_1_numeroParcela_1              → seria REMOVIDO');
    } else {
      await parcelas.dropIndex('feeId_1_numeroParcela_1');
      console.log('  feeId_1_numeroParcela_1              → REMOVIDO');
    }
  } else {
    console.log('  feeId_1_numeroParcela_1              → já não existia');
  }

  if (novo) {
    console.log('  feeId_1_planoId_1_numeroParcela_1    → já existia');
  } else if (DRY_RUN) {
    console.log('  feeId_1_planoId_1_numeroParcela_1    → seria CRIADO');
  } else {
    await parcelas.createIndex(
      { feeId: 1, planoId: 1, numeroParcela: 1 },
      { unique: true, name: 'feeId_1_planoId_1_numeroParcela_1' }
    );
    console.log('  feeId_1_planoId_1_numeroParcela_1    → CRIADO');
  }

  linha('═');
  const semTotal = await parcelas.countDocuments({
    ativo: { $ne: false },
    $or: [{ totalParcelas: null }, { totalParcelas: { $exists: false } }]
  });
  console.log(`parcelas ativas ainda sem totalParcelas: ${semTotal}`);
  console.log(
    planoPreenchido + totalPreenchido === 0
      ? 'nada a fazer — a migração já havia sido aplicada (idempotente).'
      : 'migração aplicada.'
  );
  console.log('NUMERAÇÃO NÃO FOI ALTERADA: a renumeração da DEC-048 vale só para');
  console.log('reparcelamentos daqui em diante.');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('ERRO na migração:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
