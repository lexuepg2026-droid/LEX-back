// scripts/seedDemo.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import User from '../src/models/User.js';
import Client from '../src/models/Client.js';
import Process from '../src/models/Process.js';
import Document from '../src/models/Document.js';
import Fee from '../src/models/Fee.js';
import Installment from '../src/models/Installment.js';
import Payment from '../src/models/Payment.js';
import feeService from '../src/services/feeService.js';
import { criarInstallment } from '../src/services/installmentService.js';
import { create as criarPayment } from '../src/services/paymentService.js';

// ── Guard de ambiente ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'development') {
  console.error('ABORT: seedDemo requer NODE_ENV=development. Não rodar em produção.');
  process.exit(1);
}

const DEMO_EMAIL = 'seed-demo@lex.dev';
const DEMO_SENHA = 'SeedDemo123!';
const IS_CLEAN   = process.argv.includes('--clean');

// ── Dados: Clientes ───────────────────────────────────────────────────────────
// CPF/CNPJ apenas com dígitos e com dígitos verificadores válidos (a nova
// validação rejeita máscara/sequências inválidas). PF com todos os campos
// preenchidos para permitir geração de documentos na Fase 2.
const CLIENTS_DATA = [
  {
    tipoPessoa: 'fisica', nomeCompleto: 'Ana Lima Santos', cpf: '11144477735',
    email: 'ana.lima@demo.lex', telefone: '(41) 99100-2003',
    rg: '12.345.678-9', dataNascimento: '1988-03-12', sexo: 'feminino', estadoCivil: 'solteiro',
    profissao: 'Engenheira Civil', nacionalidade: 'brasileira',
    endereco: { cep: '80010-000', pais: 'Brasil', estado: 'PR', cidade: 'Curitiba', bairro: 'Centro', logradouro: 'Rua XV de Novembro', numero: '100', complemento: 'Apto 12' },
  },
  {
    tipoPessoa: 'fisica', nomeCompleto: 'Carlos Eduardo Ferreira', cpf: '12345678062',
    email: 'carlos.ferreira@demo.lex', telefone: '(41) 99200-3004',
    rg: '23.456.789-0', dataNascimento: '1979-07-25', sexo: 'masculino', estadoCivil: 'casado',
    profissao: 'Administrador', nacionalidade: 'brasileira',
    endereco: { cep: '80020-100', pais: 'Brasil', estado: 'PR', cidade: 'Curitiba', bairro: 'Batel', logradouro: 'Av. do Batel', numero: '1500' },
  },
  {
    tipoPessoa: 'fisica', nomeCompleto: 'Maria Aparecida Costa', cpf: '98765432029',
    email: 'maria.costa@demo.lex', telefone: '(41) 99300-4005',
    rg: '34.567.890-1', dataNascimento: '1992-11-03', sexo: 'feminino', estadoCivil: 'uniao_estavel',
    profissao: 'Professora', nacionalidade: 'brasileira',
    endereco: { cep: '84010-000', pais: 'Brasil', estado: 'PR', cidade: 'Ponta Grossa', bairro: 'Centro', logradouro: 'Rua Sant\'Ana', numero: '250' },
  },
  {
    tipoPessoa: 'fisica', nomeCompleto: 'João Paulo Oliveira', cpf: '24681357090',
    email: 'joao.oliveira@demo.lex', telefone: '(41) 99400-5006',
    rg: '45.678.901-2', dataNascimento: '1975-01-19', sexo: 'masculino', estadoCivil: 'divorciado',
    profissao: 'Contador', nacionalidade: 'brasileira',
    endereco: { cep: '86010-000', pais: 'Brasil', estado: 'PR', cidade: 'Londrina', bairro: 'Centro', logradouro: 'Av. Higienópolis', numero: '800' },
  },
  {
    tipoPessoa: 'fisica', nomeCompleto: 'Beatriz Ramos Pereira', cpf: '13579246070',
    email: 'beatriz.pereira@demo.lex', telefone: '(41) 99500-6007',
    rg: '56.789.012-3', dataNascimento: '1983-09-30', sexo: 'feminino', estadoCivil: 'viuvo',
    profissao: 'Médica', nacionalidade: 'brasileira',
    endereco: { cep: '87010-000', pais: 'Brasil', estado: 'PR', cidade: 'Maringá', bairro: 'Zona 7', logradouro: 'Av. Colombo', numero: '3200' },
  },
  {
    tipoPessoa: 'fisica', nomeCompleto: 'Roberto Silva Mendes', cpf: '86420975310',
    email: 'roberto.mendes@demo.lex', telefone: '(41) 99600-7008',
    rg: '67.890.123-4', dataNascimento: '1968-05-08', sexo: 'masculino', estadoCivil: 'separado_judicialmente',
    profissao: 'Empresário', nacionalidade: 'brasileira',
    endereco: { cep: '80050-000', pais: 'Brasil', estado: 'PR', cidade: 'Curitiba', bairro: 'Juvevê', logradouro: 'Rua Mateus Leme', numero: '500' },
  },
  {
    tipoPessoa: 'juridica', razaoSocial: 'Construtora Horizonte Ltda', nomeFantasia: 'Horizonte Construções',
    cnpj: '11222333000181', email: 'financeiro@horizonte-demo.lex', telefone: '(41) 3200-1040',
    representanteLegal: { nome: 'Fernando Horizonte de Souza', cpf: '10120230364', cargo: 'Diretor Administrativo' },
    endereco: { cep: '81050-000', pais: 'Brasil', estado: 'PR', cidade: 'Curitiba', bairro: 'Portão', logradouro: 'Av. República Argentina', numero: '2500' },
  },
  {
    tipoPessoa: 'juridica', razaoSocial: 'Tech Solutions Brasil S.A.', nomeFantasia: 'TechSol Brasil',
    cnpj: '20304050000170', email: 'juridico@techsol-demo.lex', telefone: '(41) 3300-2050',
    representanteLegal: { nome: 'Juliana Alves Tavares', cpf: '20230340431', cargo: 'Sócia-Administradora' },
    endereco: { cep: '80230-000', pais: 'Brasil', estado: 'PR', cidade: 'Curitiba', bairro: 'Rebouças', logradouro: 'Av. Sete de Setembro', numero: '4200' },
  },
];

// ── Dados: Processos (clienteIdx = índice em clients[]) ──────────────────────
const PROCESSES_DATA = [
  { clienteIdx: 0, titulo: 'Indenização por Danos Morais',           numeroProcesso: '0001234-10.2025.8.16.0001', tipoAcao: 'Indenizatória', area: 'Trabalhista', orgao: 'TRT 9ª Região',    comarca: 'Curitiba',     status: 'ativo'     },
  { clienteIdx: 0, titulo: 'Revisão de Contrato de Financiamento',   numeroProcesso: '0002345-20.2025.8.16.0001', tipoAcao: 'Revisional',    area: 'Cível',       orgao: '1ª Vara Cível',   comarca: 'Curitiba',     status: 'ativo'     },
  { clienteIdx: 1, titulo: 'Divórcio Litigioso',                     numeroProcesso: '0003456-30.2025.8.16.0002', tipoAcao: 'Divórcio',      area: 'Família',     orgao: 'Vara de Família', comarca: 'Curitiba',     status: 'ativo'     },
  { clienteIdx: 1, titulo: 'Ação Trabalhista — Verbas Rescisórias',  numeroProcesso: '0004567-40.2024.8.16.0002', tipoAcao: 'Reclamatória', area: 'Trabalhista', orgao: 'TRT 9ª Região',    comarca: 'Curitiba',     status: 'encerrado' },
  { clienteIdx: 2, titulo: 'Inventário e Partilha de Bens',          numeroProcesso: '0005678-50.2025.8.16.0003', tipoAcao: 'Inventário',    area: 'Família',     orgao: '2ª Vara Família', comarca: 'Ponta Grossa', status: 'ativo'     },
  { clienteIdx: 3, titulo: 'Execução Fiscal — IPTU',                 numeroProcesso: '0006789-60.2024.8.16.0004', tipoAcao: 'Execução',      area: 'Tributário',  orgao: 'Vara de Fazenda', comarca: 'Curitiba',     status: 'suspenso'  },
  { clienteIdx: 4, titulo: 'Usucapião de Imóvel Urbano',             numeroProcesso: '0007890-70.2025.8.16.0005', tipoAcao: 'Usucapião',     area: 'Imobiliário', orgao: '3ª Vara Cível',   comarca: 'Londrina',     status: 'ativo'     },
  { clienteIdx: 5, titulo: 'Ação de Cobrança de Dívida',             numeroProcesso: '0008901-80.2025.8.16.0006', tipoAcao: 'Cobrança',      area: 'Cível',       orgao: '1ª Vara Cível',   comarca: 'Maringá',      status: 'ativo'     },
  { clienteIdx: 6, titulo: 'Disputas Contratuais com Fornecedor',    numeroProcesso: '0009012-90.2024.8.16.0007', tipoAcao: 'Cobrança',      area: 'Cível',       orgao: '2ª Vara Cível',   comarca: 'Curitiba',     status: 'encerrado' },
  { clienteIdx: 7, titulo: 'Processo Administrativo Tributário',     numeroProcesso: '0000123-01.2025.8.16.0008', tipoAcao: 'Administrativo',area: 'Tributário',  orgao: 'SEFAZ-PR',        comarca: 'Curitiba',     status: 'ativo'     },
];

// ── Dados: Documentos (processoIdx = índice em processes[]) ──────────────────
const DOCUMENTS_DATA = [
  { processoIdx: 0, nome: 'Petição Inicial',                    tipo: 'petição',     descricao: 'Petição inicial da ação indenizatória',        urlArquivo: 'https://demo.lex.dev/docs/peticao-inicial-001.pdf'        },
  { processoIdx: 1, nome: 'Contrato de Prestação de Serviços',  tipo: 'contrato',    descricao: 'Contrato firmado com o cliente',               urlArquivo: 'https://demo.lex.dev/docs/contrato-servicos-002.pdf'      },
  { processoIdx: 2, nome: 'Acordo de Divórcio',                 tipo: 'contrato',    descricao: 'Minuta do acordo de divórcio consensual',      urlArquivo: 'https://demo.lex.dev/docs/acordo-divorcio-003.pdf'        },
  { processoIdx: 3, nome: 'Sentença Trabalhista',               tipo: 'sentença',    descricao: 'Sentença homologatória de acordo trabalhista', urlArquivo: 'https://demo.lex.dev/docs/sentenca-trabalhista-004.pdf'   },
  { processoIdx: 4, nome: 'Abertura de Inventário',             tipo: 'comprovante', descricao: 'Protocolo de abertura do inventário',          urlArquivo: 'https://demo.lex.dev/docs/comprovante-inventario-005.pdf' },
  { processoIdx: 5, nome: 'Petição de Suspensão da Execução',   tipo: 'petição',     descricao: 'Pedido de suspensão da execução fiscal',       urlArquivo: 'https://demo.lex.dev/docs/peticao-suspensao-006.pdf'      },
  { processoIdx: 6, nome: 'Contrato de Honorários — Usucapião', tipo: 'contrato',    descricao: 'Contrato de honorários advocatícios',          urlArquivo: 'https://demo.lex.dev/docs/contrato-honorarios-007.pdf'    },
  { processoIdx: 7, nome: 'Notificação Extrajudicial',          tipo: 'petição',     descricao: 'Notificação extrajudicial de cobrança',        urlArquivo: 'https://demo.lex.dev/docs/peticao-cobranca-008.pdf'       },
];

// ── Dados: Honorários + Parcelas + Pagamentos ─────────────────────────────────
// createdAt: backdate para popular gráfico "Honorários por Mês" (últimos 6 meses)
// installments[].payments[]: inseridos via paymentService (overpayment guard ativo)
// valorPago por payment NUNCA excede installment.valor

const FEES_DATA = [
  // ── Processo 0 — Ana / Indenização ──────────────────────────────────────
  {
    processoIdx: 0,
    feeData:   { descricao: 'Honorários advocatícios — fase inicial', valor: 5000, tipo: 'fixo', status: 'pendente', dataVencimento: '2026-06-30' },
    createdAt: new Date(2026, 0, 15), // Jan
    installments: [
      { numeroParcela: 1, valor: 2500, dataVencimento: '2026-04-30', payments: [] },           // vencida, sem pagamento → vencido
      { numeroParcela: 2, valor: 2500, dataVencimento: '2026-07-31', payments: [] },           // futura → pendente
    ],
  },
  {
    processoIdx: 0,
    feeData:   { descricao: 'Honorários de êxito — 10% sobre o valor da causa', valor: 8000, tipo: 'percentual', status: 'pendente', dataVencimento: '2026-08-30' },
    createdAt: new Date(2026, 1, 10), // Fev
    installments: [
      { numeroParcela: 1, valor: 8000, dataVencimento: '2026-08-30', payments: [] },           // futura → pendente
    ],
  },

  // ── Processo 1 — Ana / Revisão Contrato ────────────────────────────────
  {
    processoIdx: 1,
    feeData:   { descricao: 'Consultoria e revisão contratual', valor: 3000, tipo: 'fixo', status: 'pago', dataVencimento: '2026-03-31' },
    createdAt: new Date(2026, 2, 5), // Mar
    installments: [
      {
        numeroParcela: 1, valor: 1000, dataVencimento: '2026-01-31',
        payments: [{ valorPago: 1000, dataPagamento: '2026-01-20', formaPagamento: 'pix',          observacoes: 'Pagamento 1ª parcela' }],
      },
      {
        numeroParcela: 2, valor: 1000, dataVencimento: '2026-02-28',
        payments: [{ valorPago: 1000, dataPagamento: '2026-02-25', formaPagamento: 'transferencia', observacoes: 'Pagamento 2ª parcela' }],
      },
      {
        numeroParcela: 3, valor: 1000, dataVencimento: '2026-03-31',
        payments: [{ valorPago: 600,  dataPagamento: '2026-03-15', formaPagamento: 'dinheiro',      observacoes: 'Pagamento parcial — saldo pendente' }],
      },
    ],
  },

  // ── Processo 2 — Carlos / Divórcio ─────────────────────────────────────
  {
    processoIdx: 2,
    feeData:   { descricao: 'Honorários advocatícios — divórcio litigioso', valor: 6000, tipo: 'fixo', status: 'pendente', dataVencimento: '2026-07-15' },
    createdAt: new Date(2026, 3, 10), // Abr
    installments: [
      { numeroParcela: 1, valor: 3000, dataVencimento: '2026-05-10', payments: [] },           // vencida, sem pagamento → vencido
      { numeroParcela: 2, valor: 3000, dataVencimento: '2026-07-15', payments: [] },           // futura → pendente
    ],
  },

  // ── Processo 4 — Maria / Inventário ────────────────────────────────────
  {
    processoIdx: 4,
    feeData:   { descricao: 'Honorários — inventário e partilha (% sobre monte)', valor: 12000, tipo: 'percentual', status: 'pendente', dataVencimento: '2026-09-30' },
    createdAt: new Date(2026, 4, 1), // Mai
    installments: [
      { numeroParcela: 1, valor: 12000, dataVencimento: '2026-09-30', payments: [] },          // futura → pendente
    ],
  },

  // ── Processo 6 — Beatriz / Usucapião ───────────────────────────────────
  {
    processoIdx: 6,
    feeData:   { descricao: 'Honorários advocatícios — usucapião urbano', valor: 8000, tipo: 'fixo', status: 'pendente', dataVencimento: '2026-06-30' },
    createdAt: new Date(2026, 4, 20), // Mai
    installments: [
      {
        numeroParcela: 1, valor: 4000, dataVencimento: '2026-04-30',
        payments: [{ valorPago: 4000, dataPagamento: '2026-04-25', formaPagamento: 'cartao_credito', observacoes: 'Entrada — cartão de crédito' }],
      },
      { numeroParcela: 2, valor: 4000, dataVencimento: '2026-06-30', payments: [] },           // futura → pendente
    ],
  },

  // ── Processo 7 — Roberto / Cobrança ────────────────────────────────────
  {
    processoIdx: 7,
    feeData:   { descricao: 'Honorários advocatícios — ação de cobrança', valor: 2500, tipo: 'fixo', status: 'pago', dataVencimento: '2026-03-31' },
    createdAt: new Date(2026, 2, 5), // Mar
    installments: [
      {
        numeroParcela: 1, valor: 2500, dataVencimento: '2026-03-31',
        payments: [{ valorPago: 2500, dataPagamento: '2026-03-28', formaPagamento: 'boleto', observacoes: 'Honorários quitados via boleto bancário' }],
      },
    ],
  },
  {
    processoIdx: 7,
    feeData:   { descricao: 'Custas processuais e despesas cartorárias', valor: 1200, tipo: 'custas', status: 'pago', dataVencimento: '2026-04-15' },
    createdAt: new Date(2026, 3, 10), // Abr
    installments: [
      {
        numeroParcela: 1, valor: 1200, dataVencimento: '2026-04-15',
        payments: [{ valorPago: 1200, dataPagamento: '2026-04-10', formaPagamento: 'pix', observacoes: 'Custas pagas via PIX' }],
      },
    ],
  },

  // ── Processo 8 — Construtora / Disputas (encerrado, tudo pago) ─────────
  {
    processoIdx: 8,
    feeData:   { descricao: 'Honorários contratuais — disputa com fornecedor', valor: 15000, tipo: 'fixo', status: 'pago', dataVencimento: '2026-03-31' },
    createdAt: new Date(2026, 0, 20), // Jan
    installments: [
      {
        numeroParcela: 1, valor: 5000, dataVencimento: '2026-01-31',
        payments: [{ valorPago: 5000, dataPagamento: '2026-01-28', formaPagamento: 'transferencia', observacoes: 'Parcela 1/3' }],
      },
      {
        numeroParcela: 2, valor: 5000, dataVencimento: '2026-02-28',
        payments: [{ valorPago: 5000, dataPagamento: '2026-02-25', formaPagamento: 'transferencia', observacoes: 'Parcela 2/3' }],
      },
      {
        numeroParcela: 3, valor: 5000, dataVencimento: '2026-03-31',
        payments: [{ valorPago: 4000, dataPagamento: '2026-05-10', formaPagamento: 'cartao_debito', observacoes: 'Parcela 3/3 — quitação parcial (mai/26)' }],
      },
    ],
  },

  // ── Processo 9 — Tech / Tributário ─────────────────────────────────────
  {
    processoIdx: 9,
    feeData:   { descricao: 'Assessoria tributária — processo administrativo', valor: 7500, tipo: 'fixo', status: 'pendente', dataVencimento: '2026-08-15' },
    createdAt: new Date(2026, 4, 1), // Mai
    installments: [
      {
        numeroParcela: 1, valor: 3750, dataVencimento: '2026-05-10',
        payments: [{ valorPago: 1500, dataPagamento: '2026-05-15', formaPagamento: 'pix', observacoes: 'Sinal — pagamento parcial (mai/26)' }],
      },
      { numeroParcela: 2, valor: 3750, dataVencimento: '2026-08-15', payments: [] },           // futura → pendente
    ],
  },
  {
    processoIdx: 9,
    feeData:   { descricao: 'Honorários complementares — recurso administrativo', valor: 3000, tipo: 'fixo', status: 'pendente', dataVencimento: '2026-07-30' },
    createdAt: new Date(2026, 4, 1), // Mai
    installments: [
      { numeroParcela: 1, valor: 3000, dataVencimento: '2026-07-30', payments: [] },           // futura → pendente
    ],
  },
  {
    processoIdx: 9,
    feeData:   { descricao: 'Custas administrativas — taxas e emolumentos', valor: 800, tipo: 'custas', status: 'cancelado', dataVencimento: '2026-05-01' },
    createdAt: new Date(2026, 1, 10), // Fev
    installments: [], // cancelado — sem parcelas
  },
];

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();

  const existingUser = await User.findOne({ email: DEMO_EMAIL });

  // ── CLEANUP ───────────────────────────────────────────────────────────────
  if (IS_CLEAN) {
    if (!existingUser) {
      console.log('Usuário demo nao encontrado — nada a limpar.');
      process.exit(0);
    }
    const uid = existingUser._id;
    console.log(`Removendo dados do usuario demo (${DEMO_EMAIL})...`);

    const [pay, inst, fee, doc, proc, cli] = await Promise.all([
      Payment.deleteMany({ usuarioId: uid }),
      Installment.deleteMany({ usuarioId: uid }),
      Fee.deleteMany({ usuarioId: uid }),
      Document.deleteMany({ usuarioId: uid }),
      Process.deleteMany({ usuarioId: uid }),
      Client.deleteMany({ usuarioId: uid }),
    ]);
    await User.deleteOne({ _id: uid });

    console.log(`Removidos:`);
    console.log(`  ${pay.deletedCount}  pagamentos`);
    console.log(`  ${inst.deletedCount} parcelas`);
    console.log(`  ${fee.deletedCount}  honorarios`);
    console.log(`  ${doc.deletedCount}  documentos`);
    console.log(`  ${proc.deletedCount} processos`);
    console.log(`  ${cli.deletedCount}  clientes`);
    console.log(`  1  usuario demo`);
    console.log('Cleanup concluido.');
    process.exit(0);
  }

  // ── SEED GUARD ────────────────────────────────────────────────────────────
  if (existingUser) {
    console.error(`Seed ja existe (${DEMO_EMAIL}).`);
    console.error('Para recriar: npm run seed:demo:clean && npm run seed:demo');
    process.exit(1);
  }

  // ── USUARIO DEMO ──────────────────────────────────────────────────────────
  const senhaHash = await bcrypt.hash(DEMO_SENHA, 10);
  const user = await User.create({
    nomeCompleto: 'Demo LEX Advocacia',
    email: DEMO_EMAIL,
    senhaHash,
    cpf: '52998224725',
    telefone: '(42) 99888-7766',
    oab: { numero: '123456', estado: 'PR' },
    advocacia: {
      nome: 'Demo LEX Sociedade Individual de Advocacia',
      chavePix: 'seed-demo@lex.dev',
      instagram: '@demolex.adv',
      site: 'https://demolex.adv.br',
    },
    endereco: {
      cep: '84010-330', pais: 'Brasil', estado: 'PR', cidade: 'Ponta Grossa',
      bairro: 'Centro', logradouro: 'Rua Doutor Colares', numero: '400', complemento: 'Sala 5',
    },
  });
  const uid = user._id;
  console.log(`Usuario demo criado: ${DEMO_EMAIL}`);

  // ── CLIENTES (Mongoose direto — sem side effects) ─────────────────────────
  const clients = await Promise.all(
    CLIENTS_DATA.map(c => Client.create({ ...c, usuarioId: uid }))
  );
  console.log(`${clients.length} clientes criados`);

  // ── PROCESSOS (Mongoose direto) ───────────────────────────────────────────
  const processes = await Promise.all(
    PROCESSES_DATA.map(p => Process.create({
      usuarioId:      uid,
      clienteId:      clients[p.clienteIdx]._id,
      titulo:         p.titulo,
      numeroProcesso: p.numeroProcesso,
      tipoAcao:       p.tipoAcao,
      area:           p.area,
      orgao:          p.orgao,
      comarca:        p.comarca,
      status:         p.status,
    }))
  );
  console.log(`${processes.length} processos criados`);

  // ── DOCUMENTOS (Mongoose direto) ──────────────────────────────────────────
  const documents = await Promise.all(
    DOCUMENTS_DATA.map(d => Document.create({
      usuarioId:  uid,
      processoId: processes[d.processoIdx]._id,
      nome:       d.nome,
      tipo:       d.tipo,
      descricao:  d.descricao,
      urlArquivo: d.urlArquivo,
    }))
  );
  console.log(`${documents.length} documentos criados`);

  // ── HONORÁRIOS + PARCELAS + PAGAMENTOS (via services) ─────────────────────
  let totalFees = 0, totalInstallments = 0, totalPayments = 0;

  for (const spec of FEES_DATA) {
    // Cria honorário via feeService (valida processo, tenant isolation)
    const fee = await feeService.createFee(uid, {
      processoId: processes[spec.processoIdx]._id.toString(),
      ...spec.feeData,
    });
    totalFees++;

    // Retrodata createdAt via driver raw (bypassa imutabilidade Mongoose)
    // necessário para popular gráfico "Honorários por Mês" com dados históricos
    await mongoose.connection.collection('fees').updateOne(
      { _id: fee._id },
      { $set: { createdAt: spec.createdAt } }
    );

    // Cria parcelas via installmentService (recalcularStatusInstallment automático)
    for (const instSpec of spec.installments) {
      const installment = await criarInstallment(uid, {
        feeId:          fee._id.toString(),
        numeroParcela:  instSpec.numeroParcela,
        valor:          instSpec.valor,
        dataVencimento: instSpec.dataVencimento,
      });
      totalInstallments++;

      // Cria pagamentos via paymentService (overpayment guard + recálculo de status)
      for (const paySpec of instSpec.payments) {
        await criarPayment({
          installmentId:  installment._id.toString(),
          valorPago:      paySpec.valorPago,
          dataPagamento:  paySpec.dataPagamento,
          formaPagamento: paySpec.formaPagamento,
          observacoes:    paySpec.observacoes ?? '',
        }, uid);
        totalPayments++;
      }
    }
  }

  console.log(`${totalFees} honorarios criados (via feeService)`);
  console.log(`${totalInstallments} parcelas criadas (via installmentService + recalculo status)`);
  console.log(`${totalPayments} pagamentos criados (via paymentService + overpayment guard)`);

  // ── RESUMO ────────────────────────────────────────────────────────────────
  console.log('\n======================================');
  console.log('SEED DEMO CONCLUIDO');
  console.log('======================================');
  console.log(`Email : ${DEMO_EMAIL}`);
  console.log(`Senha : ${DEMO_SENHA}`);
  console.log('--------------------------------------');
  console.log(`Clientes   : ${clients.length}`);
  console.log(`Processos  : ${processes.length}`);
  console.log(`Documentos : ${documents.length}`);
  console.log(`Honorarios : ${totalFees}`);
  console.log(`Parcelas   : ${totalInstallments}`);
  console.log(`Pagamentos : ${totalPayments}`);
  console.log('======================================');
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Erro fatal no seed:', e.message || e);
    process.exit(1);
  });
