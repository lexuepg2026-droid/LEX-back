// ═══════════════════════════════════════════════════════════════════════════
// AUDITORIA DE ÓRFÃOS — DEC-053 (F-2c)
//
// ── ESTE SCRIPT NÃO É DESTRUTIVO. ELE SÓ LÊ. ──────────────────────────────
//
// Está escrito aqui, no alto, de propósito e em voz alta, porque a F-2b criou
// a guarda de `scripts/lib/guardaDeBanco.js` — que INTERROMPE e exige que se
// digite o nome do banco antes de continuar — e todo script novo nesta pasta
// vai provocar a pergunta "cadê a guarda?".
//
// A resposta: **guarda de comando destrutivo não se põe em comando que não
// destrói.** Este script não tem `updateOne`, `deleteMany`, `save` nem
// `createIndex` — só `find` e `countDocuments`. Pôr a guarda aqui treinaria a
// advogada a digitar o nome do banco para rodar um relatório, e o dia em que
// digitar `lex` virar reflexo é o dia em que a guarda dos scripts que DE FATO
// apagam coisas deixa de proteger.
//
// **Quem for mexer neste arquivo:** no minuto em que ele ganhar uma escrita,
// ele ganha a guarda junto. Não existe meio-termo.
//
// ── O que ele faz ─────────────────────────────────────────────────────────
// Percorre a árvore de relações levantada na Parte 1 da F-2c e relata todo
// registro ATIVO cujo pai está INATIVO — o "órfão visível": o filho aparece
// nas listagens, o pai não, e clicar no nome do pai cai num registro que o
// sistema trata como arquivado.
//
// ── Por que ele NÃO CONSERTA ──────────────────────────────────────────────
// Corrigir automaticamente significaria escolher, sem saber, entre DESATIVAR
// O FILHO e REATIVAR O PAI. As duas mudam o que a advogada vê, e as duas
// podem ser a errada:
//
//   • desativar o filho esconde um processo que talvez esteja em andamento;
//   • reativar o pai ressuscita um cadastro que talvez tenha saído de propósito.
//
// **Essa escolha é da advogada.** O relatório é o entregável; a correção é
// decisão humana, feita pela tela, registro a registro — e cada uma delas fica
// no `historicoAtivacao` com autor e data, que é justamente o que uma correção
// em massa por script não deixaria.
//
// ── Uso ───────────────────────────────────────────────────────────────────
//   node scripts/auditarOrfaos.js
//   MONGO_URI=... node scripts/auditarOrfaos.js
//
// Saída: relatório em texto. Código de saída 0 sempre que a auditoria
// COMPLETA — inclusive achando órfãos. Órfão encontrado não é falha do
// script, é o resultado dele; sair diferente de 0 faria um `&&` numa rotina
// futura parar por causa de um relatório bem-sucedido.
// ═══════════════════════════════════════════════════════════════════════════

import "dotenv/config";
import mongoose from "mongoose";

// ── `autoIndex: false` é o que torna "só lê" LITERALMENTE verdade ─────────
//
// O Mongoose, por padrão, constrói os índices declarados nos schemas quando o
// model é compilado sobre uma conexão aberta. Construir índice É ESCRITA no
// banco — idempotente quando o índice já existe, mas escrita — e num script
// que se anuncia como somente-leitura essa é a diferença entre uma afirmação
// exata e uma quase verdade.
//
// Precisa vir ANTES de qualquer import de model: os schemas são avaliados na
// carga do módulo, e um `set` depois disso chegaria tarde.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

import Client from "../src/models/Client.js";
import Process from "../src/models/Process.js";
import ProcessoCliente from "../src/models/ProcessoCliente.js";
import Fee from "../src/models/Fee.js";
import Installment from "../src/models/Installment.js";
import Payment from "../src/models/Payment.js";
import Document from "../src/models/Document.js";
import Secao from "../src/models/Secao.js";
import DocumentoSecao from "../src/models/DocumentoSecao.js";
import { nomeDoCliente, nomeDoProcesso } from "../src/services/activationHierarchy.js";

// ── Nomes de exibição ─────────────────────────────────────────────────────
//
// O relatório NOMEIA pai e filho. Um relatório de ObjectIds obrigaria a
// advogada a procurar cada um deles no banco para saber do que se trata — e
// aí o relatório não é entregável, é matéria-prima.
const nomeDoHonorario = (f) => f?.descricao?.trim() || "(sem descrição)";
// `nome` é o campo do model — conferido em `models/Document.js`, não
// presumido. `descricao` entra como segunda opção porque documento gerado
// nasce sem `nome` preenchido, e um relatório com "(sem título)" na linha
// obriga a advogada a ir ao banco para saber do que se trata. `tipo` fecha,
// e sempre existe.
const nomeDoDocumento = (d) =>
  d?.nome?.trim() || d?.descricao?.trim() || d?.tipo?.trim() || "(sem nome)";
const nomeDaSecao = (s) => s?.titulo?.trim() || "(sem título)";

// Índice `_id → documento` para os pais de um lote. Uma consulta por relação,
// nunca uma por filho: uma base com 400 parcelas faria 400 idas ao banco pelo
// caminho ingênuo.
const indexarPais = async (Model, ids, projecao) => {
  if (ids.length === 0) return new Map();
  const docs = await Model.find({ _id: { $in: ids } }).select(`${projecao} ativo`);
  return new Map(docs.map((d) => [String(d._id), d]));
};

// ── Uma relação da árvore ─────────────────────────────────────────────────
//
// `filhos` são os registros ATIVOS; para cada um, olha-se cada campo de pai
// declarado. Pai ausente (`null`) não é órfão — é campo opcional, e há vários
// na árvore (`Document.clienteId`, `Document.feeId`). Pai que sumiu do banco
// também não entra: isso é integridade referencial quebrada, um problema
// DIFERENTE, e misturar os dois num relatório só faz a advogada não saber qual
// dos dois está lendo.
const auditarRelacao = async ({ filho, Filho, nomeFilho, projecaoFilho, pais }) => {
  const ativos = await Filho.find({ ativo: true }).select(
    `${projecaoFilho} ${pais.map((p) => p.campo).join(" ")}`
  );

  const orfaos = [];
  const paisPorCampo = new Map();

  for (const pai of pais) {
    const ids = [
      ...new Set(
        ativos
          .map((f) => f[pai.campo])
          .filter(Boolean)
          .map(String)
      )
    ].map((id) => new mongoose.Types.ObjectId(id));
    paisPorCampo.set(pai.campo, await indexarPais(pai.Model, ids, pai.projecao));
  }

  for (const registro of ativos) {
    for (const pai of pais) {
      const idDoPai = registro[pai.campo];
      if (!idDoPai) continue;

      const documento = paisPorCampo.get(pai.campo).get(String(idDoPai));
      if (!documento) continue; // referência quebrada: outro assunto
      if (documento.ativo !== false) continue;

      orfaos.push({
        relacao: `${filho} → ${pai.rotulo}`,
        filhoId: String(registro._id),
        filhoNome: nomeFilho(registro),
        paiId: String(idDoPai),
        paiNome: pai.nome(documento)
      });
    }
  }

  return { relacao: filho, examinados: ativos.length, orfaos };
};

// ── A árvore, na ordem em que a advogada a lê ─────────────────────────────
//
// Espelha `ARVORE_DE_ATIVACAO` de `src/services/activationHierarchy.js`, que é
// onde a regra mora. As relações cujo pai é o TENANT (`Client → User`,
// `Secao → User`) ficam de fora: não há rota que desative um usuário, e um
// relatório que listasse a base inteira como órfã no dia em que alguém editar
// `users` à mão não ajudaria ninguém.
const RELACOES = [
  {
    filho: "Processo",
    Filho: Process,
    nomeFilho: nomeDoProcesso,
    projecaoFilho: "titulo numeroProcesso",
    pais: [
      {
        campo: "clientePrincipalId",
        rotulo: "Cliente (principal)",
        Model: Client,
        projecao: "nomeCompleto razaoSocial nomeFantasia",
        nome: nomeDoCliente
      }
    ]
  },
  {
    filho: "Vínculo processo-cliente",
    Filho: ProcessoCliente,
    nomeFilho: (v) => `vínculo ${String(v._id)}`,
    projecaoFilho: "papel",
    pais: [
      {
        campo: "processoId",
        rotulo: "Processo",
        Model: Process,
        projecao: "titulo numeroProcesso",
        nome: nomeDoProcesso
      },
      {
        campo: "clienteId",
        rotulo: "Cliente",
        Model: Client,
        projecao: "nomeCompleto razaoSocial nomeFantasia",
        nome: nomeDoCliente
      }
    ]
  },
  {
    filho: "Honorário",
    Filho: Fee,
    nomeFilho: nomeDoHonorario,
    projecaoFilho: "descricao",
    pais: [
      {
        campo: "processoId",
        rotulo: "Processo",
        Model: Process,
        projecao: "titulo numeroProcesso",
        nome: nomeDoProcesso
      }
    ]
  },
  {
    filho: "Parcela",
    Filho: Installment,
    nomeFilho: (i) => `parcela ${i.numeroParcela ?? "?"}`,
    projecaoFilho: "numeroParcela",
    pais: [
      {
        campo: "feeId",
        rotulo: "Honorário",
        Model: Fee,
        projecao: "descricao",
        nome: nomeDoHonorario
      },
      {
        campo: "processoId",
        rotulo: "Processo",
        Model: Process,
        projecao: "titulo numeroProcesso",
        nome: nomeDoProcesso
      }
    ]
  },
  {
    filho: "Pagamento",
    Filho: Payment,
    nomeFilho: (p) => `pagamento de ${p.valor ?? "?"}`,
    projecaoFilho: "valor",
    pais: [
      {
        campo: "honorarioId",
        rotulo: "Honorário",
        Model: Fee,
        projecao: "descricao",
        nome: nomeDoHonorario
      },
      {
        campo: "processoId",
        rotulo: "Processo",
        Model: Process,
        projecao: "titulo numeroProcesso",
        nome: nomeDoProcesso
      }
    ]
  },
  {
    filho: "Documento",
    Filho: Document,
    nomeFilho: nomeDoDocumento,
    projecaoFilho: "nome descricao tipo",
    pais: [
      {
        campo: "processoId",
        rotulo: "Processo",
        Model: Process,
        projecao: "titulo numeroProcesso",
        nome: nomeDoProcesso
      },
      {
        campo: "clienteId",
        rotulo: "Cliente",
        Model: Client,
        projecao: "nomeCompleto razaoSocial nomeFantasia",
        nome: nomeDoCliente
      },
      {
        campo: "feeId",
        rotulo: "Honorário",
        Model: Fee,
        projecao: "descricao",
        nome: nomeDoHonorario
      }
    ]
  },
  {
    filho: "Seção do documento",
    Filho: DocumentoSecao,
    nomeFilho: (v) => `vínculo ${String(v._id)}`,
    projecaoFilho: "ordem",
    pais: [
      {
        campo: "documentoId",
        rotulo: "Documento",
        Model: Document,
        projecao: "nome descricao tipo",
        nome: nomeDoDocumento
      },
      {
        campo: "secaoId",
        rotulo: "Seção",
        Model: Secao,
        projecao: "titulo",
        nome: nomeDaSecao
      }
    ]
  }
];

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("ABORT: MONGO_URI não definida.");
    process.exit(1);
  }

  await mongoose.connect(uri);

  // O NOME do banco, nunca a URI — ela carrega usuário e senha do cluster.
  // Mesma regra da guarda da F-2b, e vale igual em script que só lê.
  console.log("═".repeat(75));
  console.log("AUDITORIA DE ÓRFÃOS — DEC-053");
  console.log(`Banco: ${mongoose.connection.name}`);
  console.log(`Data:  ${new Date().toISOString()}`);
  console.log("Este script SOMENTE LÊ. Nenhuma escrita é feita em nenhuma coleção.");
  console.log("═".repeat(75));

  let total = 0;
  const resultados = [];

  for (const relacao of RELACOES) {
    const resultado = await auditarRelacao(relacao);
    resultados.push(resultado);
    total += resultado.orfaos.length;
  }

  for (const { relacao, examinados, orfaos } of resultados) {
    console.log("");
    console.log(`── ${relacao} ${"─".repeat(Math.max(0, 60 - relacao.length))}`);
    console.log(`   ativos examinados: ${examinados}`);

    if (orfaos.length === 0) {
      console.log("   nenhum órfão");
      continue;
    }

    console.log(`   ÓRFÃOS: ${orfaos.length}`);
    for (const o of orfaos) {
      console.log(`     • ${o.relacao}`);
      console.log(`       filho ATIVO   : ${o.filhoNome}  [${o.filhoId}]`);
      console.log(`       pai   INATIVO : ${o.paiNome}  [${o.paiId}]`);
    }
  }

  console.log("");
  console.log("═".repeat(75));
  if (total === 0) {
    console.log("RESULTADO: nenhum órfão encontrado.");
  } else {
    console.log(`RESULTADO: ${total} órfão(s) encontrado(s).`);
    console.log("");
    console.log("O script NÃO corrigiu nada, e não vai corrigir.");
    console.log("Para cada um, a escolha é humana e são duas:");
    console.log("  (a) DESATIVAR o filho  — se ele saiu junto e não deveria ter voltado;");
    console.log("  (b) REATIVAR o pai     — se o pai saiu por engano.");
    console.log("As duas se fazem pela tela, registro a registro, e ficam no histórico.");
  }
  console.log("═".repeat(75));

  await mongoose.disconnect();
};

main().catch(async (erro) => {
  console.error(`ABORT: ${erro.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
