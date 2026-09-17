// scripts/migrarNomeExibicao.js
//
// ═══════════════════════════════════════════════════════════════════════════
// MIGRAÇÃO DA DEC-062 (A-1) — a chave de ordenação nos clientes já gravados
//
// ── O que ela preenche ───────────────────────────────────────────────────
//   `nomeExibicao` — `nomeCompleto` (PF) ou `razaoSocial`/`nomeFantasia` (PJ),
//                    resolvido por `src/utils/nomeExibicao.js`, que é a MESMA
//                    função que o hook do model usa.
//
// ── Por que ela é necessária ─────────────────────────────────────────────
// O campo é derivado por hook `pre("validate")`, e hook **só roda em
// gravação**. Um cliente cadastrado antes da A-1 e nunca editado desde então
// fica com `nomeExibicao` ausente — e ausente ordena ANTES de qualquer nome,
// em bloco, na ordem de inserção.
//
// O sintoma é o pior possível para uma listagem alfabética: ela parece
// funcionar (os clientes editados recentemente saem em ordem) e mente sobre o
// resto. Sem este script, a ordenação valeria só para quem foi cadastrado
// depois da fase.
//
// ── Por que NÃO se resolve no seed ───────────────────────────────────────
// `npm run seed:fresh` derruba e repovoa: lá o hook roda e o campo nasce
// preenchido. Isso cobre o banco de DEMONSTRAÇÃO e não cobre nenhum outro —
// é a mesma razão pela qual `migrarTotalParcelas.js` continua no repositório
// mesmo com o seed gravando o plano inteiro desde a F-2a.
//
// ── Idempotência ─────────────────────────────────────────────────────────
// Roda quantas vezes for preciso. O script recalcula o valor de TODOS os
// clientes e só grava onde o valor gravado difere do derivado — a segunda
// execução não altera documento nenhum, e o relatório diz isso em voz alta.
//
// Recalcular tudo (em vez de filtrar por "campo ausente") é deliberado: assim
// ele também CORRIGE um `nomeExibicao` que tenha divergido por qualquer
// caminho, e não só preenche o que falta.
//
// ── A guarda ─────────────────────────────────────────────────────────────
// Este script ESCREVE, e por isso leva a guarda de banco da F-2b. `--dry-run`
// não leva, porque é justamente o modo que existe para olhar antes de agir.
// Ver `scripts/lib/guardaDeBanco.js`.
//
// Rodar: node scripts/migrarNomeExibicao.js
//        node scripts/migrarNomeExibicao.js --dry-run
// ═══════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import mongoose from 'mongoose';
import { exigirConfirmacaoDeBanco } from './lib/guardaDeBanco.js';
import { nomeExibicaoDoCliente } from '../src/utils/nomeExibicao.js';

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
  if (!DRY_RUN) {
    await exigirConfirmacaoDeBanco({
      uri,
      acao: 'migração da DEC-062 (grava nomeExibicao em todos os clientes)'
    });
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  // O NOME do banco, nunca a URI — ela carrega usuário e senha do cluster.
  console.log(`banco: ${db.databaseName}${DRY_RUN ? '  (DRY RUN — nada será gravado)' : ''}`);
  linha('═');

  const clientes = db.collection('clients');
  const total = await clientes.countDocuments({});
  console.log(`clientes na coleção: ${total}`);
  linha();

  // Só os campos que a derivação lê — não se baixa o cadastro inteiro para
  // calcular uma string, e `observacoes` é o campo mais sensível do schema.
  const docs = await clientes
    .find({}, { projection: { nomeCompleto: 1, razaoSocial: 1, nomeFantasia: 1, nomeExibicao: 1 } })
    .toArray();

  const aGravar = [];
  let jaCorretos = 0;
  const semNome = [];

  for (const doc of docs) {
    const derivado = nomeExibicaoDoCliente(doc);
    if (derivado === '') semNome.push(String(doc._id));

    if ((doc.nomeExibicao ?? '') === derivado) {
      jaCorretos += 1;
      continue;
    }
    aGravar.push({ _id: doc._id, de: doc.nomeExibicao, para: derivado });
  }

  console.log(`  nomeExibicao já correto : ${jaCorretos}`);
  console.log(`  a gravar                : ${aGravar.length}`);
  linha();

  if (aGravar.length > 0) {
    // As dez primeiras, para a pessoa conferir que a derivação faz sentido
    // antes de aceitar o número. Um relatório que só diz "gravei 137" não
    // permite desconfiar de nada.
    console.log('amostra (até 10):');
    for (const item of aGravar.slice(0, 10)) {
      const de = item.de === undefined ? '(ausente)' : JSON.stringify(item.de);
      console.log(`  ${String(item._id)}  ${de} → ${JSON.stringify(item.para)}`);
    }
    if (aGravar.length > 10) console.log(`  … e mais ${aGravar.length - 10}`);
    linha();
  }

  // ── Clientes SEM nome nenhum ────────────────────────────────────────────
  //
  // Eles ficam com `nomeExibicao: ""`, e não com "(sem nome)". O "(sem nome)"
  // é decisão de EXIBIÇÃO (`nomeDoCliente`, em `activationHierarchy.js`);
  // gravá-lo como chave de ordenação colocaria esses clientes no meio da letra
  // P, como se "(sem nome)" fosse um nome.
  //
  // Em tese o hook do model impede que existam (PF exige `nomeCompleto`, PJ
  // exige `razaoSocial`), então este bloco só imprime se algo foi gravado por
  // fora do model. É informação, não erro.
  if (semNome.length > 0) {
    console.log(`⚠ clientes sem nome nenhum: ${semNome.length}`);
    console.log('  ficam com nomeExibicao "" e ordenam no começo da lista.');
    console.log('  não é erro deste script: é cadastro sem nome, gravado fora do model.');
    for (const id of semNome.slice(0, 10)) console.log(`    ${id}`);
    linha();
  }

  if (DRY_RUN) {
    console.log('DRY RUN — nada foi gravado.');
  } else if (aGravar.length === 0) {
    console.log('nada a fazer — a migração já havia sido aplicada (idempotente).');
  } else {
    const ops = aGravar.map((item) => ({
      updateOne: { filter: { _id: item._id }, update: { $set: { nomeExibicao: item.para } } }
    }));
    const r = await clientes.bulkWrite(ops, { ordered: false });
    console.log(`gravados: ${r.modifiedCount}`);
  }

  linha('═');
  console.log('Depois desta migração, a listagem de clientes sai em ordem alfabética');
  console.log('para TODOS os cadastros, e não só para os gravados depois da A-1.');

  await mongoose.disconnect();
}

main().catch(async (erro) => {
  console.error('ABORT:', erro.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
