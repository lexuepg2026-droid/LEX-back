// scripts/migrarFaseProcesso.js
//
// ═══════════════════════════════════════════════════════════════════════════
// MIGRAÇÃO DA DEC-054 (F-2d) — os campos de fase e encerramento nos processos
// já gravados
//
// ── O que ela preenche ───────────────────────────────────────────────────
//   `fase`                 — uma das quatro da Laís. Ver o mapeamento abaixo.
//   `historicoFase`        — a primeira entrada, `de: null → para: <fase>`.
//   `transitoEmJulgadoEm`  — `null`.
//   `motivoEncerramento`   — `null`.
//   `liminar`              — `false`.
//   `liminarObservacao`    — `null`.
//   `liminarEm`            — `null`.
//
// ── O MAPEAMENTO, e por que ele é quase todo "não sei" ───────────────────
// O processo tinha (e continua tendo) um campo `status` com três valores:
// `ativo`, `encerrado`, `suspenso`. A pergunta da fase era "para que fase cada
// um deles vai?", e a resposta, lida do banco de desenvolvimento, é:
//
//   **nenhum deles carrega informação de fase.**
//
//   `ativo`     — diz que o processo está em andamento. Um processo em
//                 conhecimento está "ativo"; um em recursos também. O valor
//                 não distingue as quatro.
//   `suspenso`  — diz que o andamento PAROU. Também não distingue: suspende-se
//                 processo em qualquer fase.
//   `encerrado` — diz que acabou. É o EIXO DO ENCERRAMENTO, não o da fase — e
//                 é justamente a confusão que a DEC-054 desfez. Mapeá-lo para
//                 "recursos" inventaria um trajeto; mapeá-lo para
//                 `transitoEmJulgadoEm` inventaria uma DATA, que é pior: um
//                 carimbo com data errada parece informação e não é.
//
// Portanto: **`fase` recebe o padrão (`conhecimento`) em todos**, e o script
// LISTA quantos ficaram assim e por quê. Chute silencioso em migração é o
// defeito que ninguém acha depois — e um mapeamento inventado teria produzido
// exatamente isso.
//
// Os `status: "encerrado"` saem NOMEADOS no relatório, como candidatos à
// revisão da advogada: o sistema sabe que eles acabaram, mas não sabe COMO
// (acordo cumprido? sentença transitada?) nem QUANDO. As duas respostas são
// dela, e se dão pela tela, registro a registro.
//
// ── Idempotência ─────────────────────────────────────────────────────────
// Roda quantas vezes for preciso. Todo filtro de escrita exige o campo ainda
// AUSENTE, e o relatório separa "preenchidos agora" de "já tinham". A segunda
// execução não altera documento nenhum — e o script diz isso em voz alta.
//
// ── A guarda ─────────────────────────────────────────────────────────────
// Este script ESCREVE, e por isso leva a guarda de banco da F-2b. `--dry-run`
// não escreve nada e por isso não pergunta — é o modo que existe para olhar
// antes de agir. Ver `scripts/lib/guardaDeBanco.js`.
//
// Rodar:  node scripts/migrarFaseProcesso.js
//         node scripts/migrarFaseProcesso.js --dry-run
// ═══════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import mongoose from 'mongoose';
import { exigirConfirmacaoDeBanco } from './lib/guardaDeBanco.js';
import { FASE_PADRAO, rotuloDaFase } from '../src/config/fasesProcesso.js';

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

// ── O mapeamento, EXPLÍCITO ───────────────────────────────────────────────
//
// Uma entrada por valor de `status` encontrado, com a fase de destino e a
// razão. Escrito como tabela e não como `if` para que a próxima pessoa leia a
// DECISÃO, e não a consequência dela.
//
// `fase: null` significa **não sei mapear** — e o script então usa o padrão e
// conta o registro na lista dos não mapeados. É o oposto de escolher em
// silêncio.
const MAPEAMENTO = Object.freeze({
  ativo: {
    fase: null,
    razao: 'diz que está em andamento; não distingue nenhuma das quatro fases'
  },
  suspenso: {
    fase: null,
    razao: 'diz que o andamento parou; suspende-se processo em qualquer fase'
  },
  encerrado: {
    fase: null,
    razao:
      'é o EIXO DO ENCERRAMENTO, não o da fase — mapeá-lo inventaria trajeto ' +
      'ou data'
  }
});

const nomeDoProcesso = (p) =>
  (p?.titulo ?? '').trim() || (p?.numeroProcesso ?? '').trim() || '(sem título)';

async function main() {
  if (!DRY_RUN) {
    await exigirConfirmacaoDeBanco({
      uri,
      acao: 'migração da DEC-054 (grava fase, histórico de fase e liminar em todos os processos)'
    });
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  // O NOME do banco, nunca a URI — ela carrega usuário e senha do cluster.
  console.log(`banco: ${db.databaseName}${DRY_RUN ? '  (DRY RUN — nada será gravado)' : ''}`);
  linha('═');

  const processos = db.collection('processes');
  const total = await processos.countDocuments({});
  console.log(`processos na coleção: ${total}`);
  linha();

  // ── 1. Os valores REAIS de `status`, lidos do banco ─────────────────────
  //
  // Lidos, não presumidos. O enum do model diz três; o banco é quem diz quais
  // existem de fato, e quantos de cada — inclusive um valor fora do enum, que
  // uma escrita antiga poderia ter deixado.
  const porStatus = await processos
    .aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    .toArray();

  console.log('valores de `status` encontrados no banco:');
  for (const { _id, n } of porStatus) {
    const regra = MAPEAMENTO[_id];
    const destino = regra?.fase
      ? `→ ${rotuloDaFase(regra.fase)}`
      : `→ ${rotuloDaFase(FASE_PADRAO)}  (NÃO MAPEADO)`;
    const razao = regra ? regra.razao : 'valor fora do enum do model';
    console.log(`  ${String(_id).padEnd(12)} ${String(n).padStart(4)}  ${destino}`);
    console.log(`  ${' '.repeat(12)}      ${razao}`);
  }
  linha();

  // ── 2. `fase` e os campos de andamento ──────────────────────────────────
  //
  // Um `updateMany` por valor de status, e não um só para a coleção inteira:
  // o dia em que um `status` GANHAR mapeamento, a mudança é uma linha na
  // tabela acima — e não uma reescrita do laço.
  let preenchidos = 0;
  let jaTinham = 0;
  const naoMapeados = [];

  for (const { _id: status, n } of porStatus) {
    const regra = MAPEAMENTO[status];
    const fase = regra?.fase ?? FASE_PADRAO;

    if (!regra?.fase) naoMapeados.push({ status, quantidade: n });

    const filtro = { status, fase: { $exists: false } };
    const pendentes = await processos.countDocuments(filtro);
    jaTinham += n - pendentes;

    if (pendentes === 0) continue;

    if (DRY_RUN) {
      preenchidos += pendentes;
      continue;
    }

    // `$set` e `$push` no mesmo update: a fase e a primeira entrada do
    // histórico são o mesmo fato. Gravar em duas passadas deixaria a falha da
    // segunda produzir processo COM fase e SEM linha do tempo — que é
    // exatamente o estado que a F-2e não teria como distinguir de "nunca mudou".
    const alvos = await processos
      .find(filtro)
      .project({ _id: 1, usuarioId: 1 })
      .toArray();

    const agora = new Date();
    const operacoes = alvos.map((p) => ({
      updateOne: {
        filter: { _id: p._id, fase: { $exists: false } },
        update: {
          $set: {
            fase,
            transitoEmJulgadoEm: null,
            motivoEncerramento: null,
            liminar: false,
            liminarObservacao: null,
            liminarEm: null,
            historicoFase: [
              { de: null, para: fase, data: agora, motivo: null, autorId: p.usuarioId }
            ]
          }
        }
      }
    }));

    const res = await processos.bulkWrite(operacoes, { ordered: false });
    preenchidos += res.modifiedCount;
  }

  console.log(`  fase preenchida agora : ${preenchidos}`);
  console.log(`  fase já tinha         : ${jaTinham}`);
  linha();

  // ── 3. O que NÃO foi mapeado, em voz alta ───────────────────────────────
  if (naoMapeados.length > 0) {
    console.log('NÃO MAPEADOS — ficaram na fase padrão:');
    for (const { status, quantidade } of naoMapeados) {
      console.log(
        `  status "${status}": ${quantidade} processo(s) → ${rotuloDaFase(FASE_PADRAO)}`
      );
    }
    console.log('');
    console.log('  Nenhum valor de `status` carrega informação de FASE. O mapeamento');
    console.log('  não existe porque os dois campos nunca foram o mesmo eixo — e');
    console.log('  inventá-lo produziria dado que parece informação e não é.');
  } else {
    console.log('Todos os valores de `status` tinham mapeamento declarado.');
  }
  linha();

  // ── 4. Os `encerrado`, NOMEADOS — decisão da advogada ───────────────────
  //
  // O script não escreve `transitoEmJulgadoEm` em nenhum deles. Ele os LISTA,
  // porque a informação existe ("este processo acabou") e o que falta é COMO e
  // QUANDO — as duas respostas são dela.
  const encerrados = await processos
    .find({ status: 'encerrado' })
    .project({ titulo: 1, numeroProcesso: 1, transitoEmJulgadoEm: 1 })
    .toArray();

  if (encerrados.length > 0) {
    console.log(`processos com status "encerrado" — para a advogada revisar (${encerrados.length}):`);
    for (const p of encerrados) {
      const carimbo = p.transitoEmJulgadoEm
        ? `trânsito em julgado já registrado: ${new Date(p.transitoEmJulgadoEm).toISOString().slice(0, 10)}`
        : 'sem trânsito em julgado registrado';
      console.log(`  • ${nomeDoProcesso(p)}  [${p._id}]`);
      console.log(`    ${carimbo}`);
    }
    console.log('');
    console.log('  O script NÃO carimbou nenhum deles. "Encerrado" diz que acabou, e');
    console.log('  não diz COMO nem QUANDO — e uma data inventada é pior que nenhuma.');
    console.log('  O encerramento se registra pela tela, processo a processo.');
    linha();
  }

  // ── 5. Fecho ────────────────────────────────────────────────────────────
  const semFase = await processos.countDocuments({ fase: { $exists: false } });
  const semHistorico = await processos.countDocuments({
    fase: { $exists: true },
    $or: [{ historicoFase: { $exists: false } }, { historicoFase: { $size: 0 } }]
  });

  linha('═');
  console.log(`processos ainda sem \`fase\`          : ${semFase}`);
  console.log(`processos com fase e sem histórico  : ${semHistorico}`);
  console.log(
    preenchidos === 0
      ? 'nada a fazer — a migração já havia sido aplicada (idempotente).'
      : 'migração aplicada.'
  );
  console.log('O campo `status` NÃO foi alterado nem apagado: é outro eixo, e a');
  console.log('listagem filtra por ele desde a Fase 2.');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('ERRO na migração:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
