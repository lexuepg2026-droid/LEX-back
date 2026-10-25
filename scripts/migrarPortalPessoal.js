// scripts/migrarPortalPessoal.js
//
// ═══════════════════════════════════════════════════════════════════════════
// MIGRAÇÃO DA FASE 2.5 — o portal passa a ser por PESSOA (DEC-089 a DEC-091,
// DEC-094)
//
// ── O que ela preenche ───────────────────────────────────────────────────
//   `clients.codigoAcessoPessoal`         — para todo cliente COM senha de
//                                           portal que ainda não tem código.
//                                           Mesmo gerador do serviço, que
//                                           consulta os DOIS espaços de código.
//   `processo_clientes.liberadoNoPortal`  — `true` em todo vínculo ATIVO que
//                                           ainda não tem o campo: era o que a
//                                           pessoa já via com o código daquele
//                                           processo. Vínculo inativo recebe
//                                           `false` — não havia acesso a
//                                           preservar, e se ele for reativado
//                                           a advogada decide.
//
// ── O que ela NÃO faz ────────────────────────────────────────────────────
// Não toca em senha (`senhaPortalHash`, `senhaPortalProvisoria` e
// `senhaPortalDefinidaEm` já eram da pessoa), não apaga nem altera
// `codigoAcesso` dos vínculos (continua reservado, DEC-090) e não mexe em
// confirmação nenhuma.
//
// ── Idempotência ─────────────────────────────────────────────────────────
// Todo filtro de escrita exige o campo AUSENTE. A segunda execução não altera
// documento nenhum — e o script diz isso em voz alta. Há teste rodando-o duas
// vezes (`tests/integrity/migracaoPortal.test.js`).
//
// ── Saída ────────────────────────────────────────────────────────────────
// SÓ contagens. Nenhum código, nenhum id, nenhum nome: o código pessoal é
// metade da credencial do cliente, e um log de migração é o tipo de arquivo
// que vai parar num print de tela.
//
// ── A guarda ─────────────────────────────────────────────────────────────
// Este script ESCREVE, e por isso leva a guarda de banco da F-2b. `--dry-run`
// não escreve nada e por isso não pergunta. Ver `scripts/lib/guardaDeBanco.js`.
//
// Rodar:  npm run migrar:portal-pessoal
//         npm run migrar:portal-pessoal -- --dry-run
// ═══════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import mongoose from 'mongoose';
import { exigirConfirmacaoDeBanco } from './lib/guardaDeBanco.js';
import { gerarCodigoPessoal, ehColisaoDeCodigoPessoal } from '../src/services/codigoPessoal.js';

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
    await exigirConfirmacaoDeBanco({ uri, acao: 'migração do portal por pessoa (Fase 2.5)' });
  }

  await mongoose.connect(uri);
  // O índice novo (`codigoAcessoPessoal` único e sparse) precisa existir
  // ANTES da escrita: é ele que segura a corrida dentro do espaço pessoal.
  // `createIndexes`, e não `syncIndexes`: este só CRIA; o outro apagaria do
  // banco qualquer índice que não esteja no schema.
  await mongoose.model('Client').createIndexes();

  const clients = mongoose.connection.collection('clients');
  const vinculos = mongoose.connection.collection('processo_clientes');

  linha('═');
  console.log(`migração do portal por pessoa${DRY_RUN ? ' — DRY RUN, nada será gravado' : ''}`);
  console.log(`banco: ${mongoose.connection.name}`);
  linha('═');

  // ── 1. Códigos pessoais ─────────────────────────────────────────────────
  const comSenha = { senhaPortalHash: { $type: 'string', $ne: '' } };
  const totalComSenha = await clients.countDocuments(comSenha);
  const pendentes = await clients
    .find({ ...comSenha, codigoAcessoPessoal: { $exists: false } })
    .project({ _id: 1 })
    .toArray();

  let gerados = 0;
  for (const { _id } of pendentes) {
    if (DRY_RUN) {
      gerados += 1;
      continue;
    }
    // Uma tentativa por colisão no índice, como no serviço. O filtro exige o
    // campo ausente: se outra execução tiver gravado no meio, não sobrescreve.
    for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
      try {
        const res = await clients.updateOne(
          { _id, codigoAcessoPessoal: { $exists: false } },
          { $set: { codigoAcessoPessoal: await gerarCodigoPessoal() } }
        );
        gerados += res.modifiedCount;
        break;
      } catch (erro) {
        if (!ehColisaoDeCodigoPessoal(erro) || tentativa === 5) throw erro;
      }
    }
  }

  console.log(`clientes com senha de portal          : ${totalComSenha}`);
  console.log(`  código pessoal gerado agora         : ${gerados}`);
  console.log(`  já tinham código pessoal            : ${totalComSenha - pendentes.length}`);
  linha();

  // ── 2. Liberação dos vínculos ───────────────────────────────────────────
  const semCampo = { liberadoNoPortal: { $exists: false } };
  const ativosPendentes = await vinculos.countDocuments({ ...semCampo, ativo: true });
  const inativosPendentes = await vinculos.countDocuments({ ...semCampo, ativo: { $ne: true } });
  const jaTinham = await vinculos.countDocuments({ liberadoNoPortal: { $exists: true } });

  let liberados = ativosPendentes;
  let naoLiberados = inativosPendentes;
  if (!DRY_RUN) {
    liberados = (await vinculos.updateMany(
      { ...semCampo, ativo: true },
      { $set: { liberadoNoPortal: true } }
    )).modifiedCount;
    naoLiberados = (await vinculos.updateMany(
      { ...semCampo, ativo: { $ne: true } },
      { $set: { liberadoNoPortal: false } }
    )).modifiedCount;
  }

  console.log(`vínculos ativos marcados liberados    : ${liberados}`);
  console.log(`vínculos inativos marcados NÃO liber. : ${naoLiberados}`);
  console.log(`vínculos que já tinham o campo        : ${jaTinham}`);
  linha();

  // ── 3. Fecho ────────────────────────────────────────────────────────────
  const restamClientes = await clients.countDocuments({
    ...comSenha, codigoAcessoPessoal: { $exists: false }
  });
  const restamVinculos = await vinculos.countDocuments(semCampo);

  linha('═');
  console.log(`clientes com senha e sem código       : ${restamClientes}`);
  console.log(`vínculos sem liberadoNoPortal          : ${restamVinculos}`);
  const nada = gerados === 0 && liberados === 0 && naoLiberados === 0;
  console.log(
    DRY_RUN
      ? 'dry run: as contagens acima são o que seria gravado.'
      : nada
        ? 'nada a fazer — a migração já havia sido aplicada (idempotente).'
        : 'migração aplicada.'
  );
  console.log('Senhas, códigos de vínculo e confirmações NÃO foram alterados.');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('ERRO na migração:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
