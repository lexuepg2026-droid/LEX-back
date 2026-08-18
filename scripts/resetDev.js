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
  // Junção processo × cliente (Fase 2B). Precisa cair junto: vínculo órfão
  // reserva `codigoAcesso` no índice único e faz o delete de cliente recusar
  // exclusão por um processo que já não existe.
  'processo_clientes',
  'fees',
  'installments',
  'payments',
  // ── As três coleções da F-1a (acrescentadas na F-1a.2) ─────────────────
  // Faltavam desde a F-1a, e `npm run seed:fresh` vinha acumulando: medido em
  // 17/08/2026, a base de desenvolvimento tinha 160 alocações, 22 estornos e 9
  // reparcelamentos para um seed que cria 14, 1 e 1. Eles ficavam órfãos —
  // apontando para pagamentos e parcelas já derrubados —, então não corrompiam
  // leitura nenhuma; mas `seed:fresh` é a PRÉ-CONDIÇÃO dos passos 156 e 157 do
  // roteiro, e uma base que só cresce é o tipo de coisa que um dia deixa de
  // ser inofensiva sem avisar.
  //
  // A ordem espelha a dependência, como em `seedDemo.js --clean`: alocação e
  // estorno apontam para pagamento, reparcelamento aponta para parcela.
  'alocacoes',
  'estornos',
  'reparcelamentos',
  'documents',
  'secoes',
  'documento_secao',
  // "secaos": nome antigo, da pluralização automática do Mongoose, antes de a
  // coleção ser fixada como "secoes". Fica na lista para limpar bases que
  // rodaram a versão inicial da Fase 2A.
  'secaos',
  // Confirmações de visualização do portal (Fase 3.1). Entram aqui, no reset de
  // DESENVOLVIMENTO, porque `resetDev` derruba a base inteira para o seed
  // recriá-la — é operação de bancada, não cascata de produção. A regra de que
  // confirmação não some por desativação de vínculo, processo ou cliente
  // continua valendo em toda a API; ver `models/ConfirmacaoVisualizacao.js`.
  'confirmacoes_visualizacao',
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
