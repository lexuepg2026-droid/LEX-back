// scripts/seedDemo.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import User from '../src/models/User.js';
import Client from '../src/models/Client.js';
import Process from '../src/models/Process.js';
import ProcessoCliente from '../src/models/ProcessoCliente.js';
import Document from '../src/models/Document.js';
import Secao from '../src/models/Secao.js';
import DocumentoSecao from '../src/models/DocumentoSecao.js';
import Fee from '../src/models/Fee.js';
import Installment from '../src/models/Installment.js';
import Payment from '../src/models/Payment.js';
import feeService from '../src/services/feeService.js';
import { createProcess } from '../src/services/processService.js';
import { criarInstallment } from '../src/services/installmentService.js';
import { create as criarPayment } from '../src/services/paymentService.js';
import { gerarDocumentoService, atualizarTextoService } from '../src/services/documentGenerationService.js';
import { detectarLacunas } from '../src/utils/lacunas.js';

// ── Guard de ambiente ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'development') {
  console.error('ABORT: seedDemo requer NODE_ENV=development. Não rodar em produção.');
  process.exit(1);
}

const DEMO_EMAIL = 'demo@lex.dev';
const DEMO_SENHA = 'Lex123456';
const IS_CLEAN   = process.argv.includes('--clean');

// ── Logo de demonstracao ──────────────────────────────────────────────────────
// Monograma "LEX" 96x96, PNG embutido como constante: 450 caracteres, 0,22% do
// teto de 200 KB. Constante e nao arquivo para o seed nao depender de binario
// versionado — e para deixar evidente que o limite de 200 KB e folgado para um
// logo de verdade.
const DEMO_LOGO_BASE64 =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAABB0lEQVR42u3cSw6DIBQFUFfUQffn' +
  'jp01nXcBjYggCo+TvKHekBPla1y+n00lakEACBCgjoBe63vyAgQIECBAkYBij+KAAAECBAgQIECA' +
  'AAECBAgQIECAAAECBAjQ6ED1iJWHDZltOBsCaCagw2YUJACaDCjRkrLb+wW6ahgClBWVHw4I0FGP' +
  'FmSiCKgt0J5RnKUGoOZAZZnDTxQBXQYU/BUD1BYo/jAPyFIDkO0OQOGAJtpyBfRMQpxjH0BtE4ov' +
  'uwmo/ly0MgFQKiH/WQME6C/hVIcFqBsgH1ABAgQIECBAgAABAgQIECBAgAABAgQIECBA9wP5VSkg' +
  'QIAAARoFSAECBAhQR/UDgQj+JCz56MMAAAAASUVORK5CYII=';

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
    observacoes: 'Cliente preferencial. Prefere contato por e-mail em horario comercial.',
  },
  {
    tipoPessoa: 'fisica', nomeCompleto: 'Carlos Eduardo Ferreira', cpf: '12345678062',
    email: 'carlos.ferreira@demo.lex', telefone: '(41) 99200-3004',
    rg: '23.456.789-0', dataNascimento: '1979-07-25', sexo: 'masculino', estadoCivil: 'casado',
    profissao: 'Administrador', nacionalidade: 'brasileira',
    endereco: { cep: '80020-100', pais: 'Brasil', estado: 'PR', cidade: 'Curitiba', bairro: 'Batel', logradouro: 'Av. do Batel', numero: '1500', complemento: 'Sala 302' },
    observacoes: 'Casado em comunhao parcial de bens. Conjuge ciente do processo de divorcio.',
  },
  {
    tipoPessoa: 'fisica', nomeCompleto: 'Maria Aparecida Costa', cpf: '98765432029',
    email: 'maria.costa@demo.lex', telefone: '(41) 99300-4005',
    rg: '34.567.890-1', dataNascimento: '1992-11-03', sexo: 'feminino', estadoCivil: 'uniao_estavel',
    profissao: 'Professora', nacionalidade: 'brasileira',
    endereco: { cep: '84010-000', pais: 'Brasil', estado: 'PR', cidade: 'Ponta Grossa', bairro: 'Centro', logradouro: 'Rua Sant\'Ana', numero: '250', complemento: 'Casa 2' },
    observacoes: 'Uniao estavel reconhecida em escritura publica de 2019.',
  },
  {
    tipoPessoa: 'fisica', nomeCompleto: 'Joao Paulo Oliveira', cpf: '24681357090',
    email: 'joao.oliveira@demo.lex', telefone: '(41) 99400-5006',
    rg: '45.678.901-2', dataNascimento: '1975-01-19', sexo: 'masculino', estadoCivil: 'divorciado',
    profissao: 'Contador', nacionalidade: 'brasileira',
    endereco: { cep: '86010-000', pais: 'Brasil', estado: 'PR', cidade: 'Londrina', bairro: 'Centro', logradouro: 'Av. Higienopolis', numero: '800', complemento: 'Conjunto 41' },
    observacoes: 'Divorcio averbado em 2021. Possui dois dependentes menores.',
  },
  {
    // LACUNA INTENCIONAL: este cliente NAO tem `profissao`.
    // Serve para demonstrar, sem editar nada a mao, a tela de pendencia da
    // geracao de documento (HTTP 422 apontando {{profissaoCliente}}).
    // Nao preencher: o processo 6 depende desta lacuna.
    tipoPessoa: 'fisica', nomeCompleto: 'Beatriz Ramos Pereira', cpf: '13579246070',
    email: 'beatriz.pereira@demo.lex', telefone: '(41) 99500-6007',
    rg: '56.789.012-3', dataNascimento: '1983-09-30', sexo: 'feminino', estadoCivil: 'viuvo',
    nacionalidade: 'brasileira',
    endereco: { cep: '87010-000', pais: 'Brasil', estado: 'PR', cidade: 'Maringa', bairro: 'Zona 7', logradouro: 'Av. Colombo', numero: '3200', complemento: 'Bloco B, apto 44' },
    observacoes: 'Cadastro incompleto de proposito no seed: falta a profissao, para exercitar o 422 da geracao de documento.',
  },
  {
    tipoPessoa: 'juridica', razaoSocial: 'Construtora Horizonte Ltda', nomeFantasia: 'Horizonte Construcoes',
    cnpj: '11222333000181', email: 'financeiro@horizonte-demo.lex', telefone: '(41) 3200-1040',
    representanteLegal: { nome: 'Fernando Horizonte de Souza', cpf: '10120230364', cargo: 'Diretor Administrativo' },
    endereco: { cep: '81050-000', pais: 'Brasil', estado: 'PR', cidade: 'Curitiba', bairro: 'Portao', logradouro: 'Av. Republica Argentina', numero: '2500', complemento: 'Torre A, 8o andar' },
    observacoes: 'Contrato guarda-chuva de assessoria juridica renovado anualmente.',
  },
  {
    tipoPessoa: 'juridica', razaoSocial: 'Tech Solutions Brasil S.A.', nomeFantasia: 'TechSol Brasil',
    cnpj: '20304050000170', email: 'juridico@techsol-demo.lex', telefone: '(41) 3300-2050',
    representanteLegal: { nome: 'Juliana Alves Tavares', cpf: '20230340431', cargo: 'Socia-Administradora' },
    endereco: { cep: '80230-000', pais: 'Brasil', estado: 'PR', cidade: 'Curitiba', bairro: 'Reboucas', logradouro: 'Av. Sete de Setembro', numero: '4200', complemento: 'Cj. 1201' },
    observacoes: 'Demandas concentradas em direito tributario e societario.',
  },
  {
    // SEM representanteLegal, de proposito: permite ver na tela de detalhe os
    // dois estados possiveis de pessoa juridica (com e sem representante).
    tipoPessoa: 'juridica', razaoSocial: 'Agro Campos Gerais Ltda', nomeFantasia: 'Agro Campos',
    cnpj: '31820457000176', email: 'contato@agrocampos-demo.lex', telefone: '(42) 3400-3060',
    endereco: { cep: '84035-000', pais: 'Brasil', estado: 'PR', cidade: 'Ponta Grossa', bairro: 'Uvaranas', logradouro: 'Av. Carlos Cavalcanti', numero: '1900', complemento: 'Galpao 3' },
    observacoes: 'Representante legal ainda nao informado pelo cliente.',
  },
];

// ── Dados: Processos ─────────────────────────────────────────────────────────
// Participantes (Fase 2B — junção processo × cliente):
//   `clienteIdx`         atalho para o caso comum — participante unico, papel
//                        'autor', principal;
//   `clientes: [...]`    forma explicita, para litisconsorcio ou papel
//                        diferente de 'autor'. Cada item: { idx, papel,
//                        principal }. Exatamente um principal por processo.
const PROCESSES_DATA = [
  // clienteIdx: 0-4 = PF (4 = Beatriz, sem profissao) | 5-7 = PJ (7 = sem representante)
  { clienteIdx: 0, titulo: 'Indenizacao por Danos Morais', numeroProcesso: '0001234-10.2025.8.16.0001', tipoAcao: 'Indenizatoria', area: 'Trabalhista', orgao: 'TRT 9a Regiao', vara: '1a Vara do Trabalho de Curitiba', comarca: 'Curitiba', status: 'ativo', dataDistribuicao: '2025-02-10',
    descricao: 'Acao indenizatoria por danos morais decorrentes de assedio moral no ambiente de trabalho.',
    observacoes: 'Audiencia de instrucao designada. Cliente ja apresentou rol de testemunhas.' },
  { clienteIdx: 0, titulo: 'Revisao de Contrato de Financiamento', numeroProcesso: '0002345-20.2025.8.16.0001', tipoAcao: 'Revisional', area: 'Civel', orgao: '1a Vara Civel', vara: '1a Vara Civel de Curitiba', comarca: 'Curitiba', status: 'ativo', dataDistribuicao: '2025-03-05',
    descricao: 'Revisao de clausulas de financiamento imobiliario com pedido de recalculo de juros.',
    observacoes: 'Aguardando laudo pericial contabil.' },
  { clienteIdx: 1, titulo: 'Divorcio Litigioso', numeroProcesso: '0003456-30.2025.8.16.0002', tipoAcao: 'Divorcio', area: 'Familia', orgao: 'Vara de Familia', vara: '2a Vara de Familia e Sucessoes de Curitiba', comarca: 'Curitiba', status: 'ativo', dataDistribuicao: '2025-01-22',
    descricao: 'Divorcio litigioso com partilha de bens e definicao de guarda compartilhada.',
    observacoes: 'Tentativa de conciliacao infrutifera na primeira audiencia.' },
  { clienteIdx: 1, titulo: 'Acao Trabalhista - Verbas Rescisorias', numeroProcesso: '0004567-40.2024.8.16.0002', tipoAcao: 'Reclamatoria', area: 'Trabalhista', orgao: 'TRT 9a Regiao', vara: '3a Vara do Trabalho de Curitiba', comarca: 'Curitiba', status: 'encerrado', dataDistribuicao: '2024-08-14',
    descricao: 'Reclamatoria trabalhista para cobranca de verbas rescisorias nao pagas.',
    observacoes: 'Encerrado por acordo homologado. Valores quitados em duas parcelas.' },
  // LITISCONSORCIO — o caso que justifica a Fase 2B inteira.
  // Inventario com dois herdeiros no mesmo polo: Maria (autora, principal) e
  // Joao Paulo (litisconsorte). Papeis diferentes de proposito. Os dois tem
  // cadastro completo, entao os dois geram procuracao sem pendencia — e e
  // deste processo que saem os dois documentos do mesmo modelo, mais abaixo.
  { clientes: [{ idx: 2, papel: 'autor', principal: true },
               { idx: 3, papel: 'litisconsorte', principal: false }],
    titulo: 'Inventario e Partilha de Bens', numeroProcesso: '0005678-50.2025.8.16.0003', tipoAcao: 'Inventario', area: 'Familia', orgao: '2a Vara Familia', vara: '2a Vara de Familia e Sucessoes de Ponta Grossa', comarca: 'Ponta Grossa', status: 'ativo', dataDistribuicao: '2025-04-02',
    descricao: 'Inventario judicial com quatro herdeiros e imovel rural a partilhar.',
    observacoes: 'Litisconsorcio ativo: dois herdeiros representados no mesmo processo. Cada um assina a sua propria procuracao.' },
  // Papel 'reu': na execucao fiscal o cliente e o executado, nao o autor.
  // Terceiro interessado aparece no processo 9 (cobranca).
  { clientes: [{ idx: 3, papel: 'reu', principal: true }],
    titulo: 'Execucao Fiscal - IPTU', numeroProcesso: '0006789-60.2024.8.16.0004', tipoAcao: 'Execucao', area: 'Tributario', orgao: 'Vara de Fazenda', vara: '1a Vara da Fazenda Publica de Curitiba', comarca: 'Curitiba', status: 'suspenso', dataDistribuicao: '2024-11-19',
    descricao: 'Execucao fiscal de IPTU dos exercicios de 2021 a 2023.',
    observacoes: 'Suspenso por parcelamento administrativo do debito. Cliente figura no polo passivo.' },
  { clienteIdx: 4, titulo: 'Usucapiao de Imovel Urbano', numeroProcesso: '0007890-70.2025.8.16.0005', tipoAcao: 'Usucapiao', area: 'Imobiliario', orgao: '3a Vara Civel', vara: '3a Vara Civel de Maringa', comarca: 'Maringa', status: 'ativo', dataDistribuicao: '2025-05-08',
    descricao: 'Usucapiao extraordinaria de imovel urbano com posse mansa superior a quinze anos.',
    observacoes: 'Processo do cliente sem profissao cadastrada: usar para ver o 422 da geracao de documento.' },
  { clienteIdx: 5, titulo: 'Disputas Contratuais com Fornecedor', numeroProcesso: '0009012-90.2024.8.16.0007', tipoAcao: 'Cobranca', area: 'Civel', orgao: '2a Vara Civel', vara: '2a Vara Civel de Curitiba', comarca: 'Curitiba', status: 'ativo', dataDistribuicao: '2024-09-30',
    descricao: 'Cobranca de multa contratual por atraso na entrega de insumos de obra.',
    observacoes: 'Processo de cliente PJ: usado para gerar a procuracao de pessoa juridica.' },
  { clienteIdx: 6, titulo: 'Processo Administrativo Tributario', numeroProcesso: '0000123-01.2025.8.16.0008', tipoAcao: 'Administrativo', area: 'Tributario', orgao: 'SEFAZ-PR', vara: 'Setor de Julgamento Administrativo - SEFAZ/PR', comarca: 'Curitiba', status: 'ativo', dataDistribuicao: '2025-03-18',
    descricao: 'Defesa em auto de infracao de ICMS com pedido de reducao de multa.',
    observacoes: 'Impugnacao protocolada dentro do prazo de trinta dias.' },
  // Segundo caso com mais de um participante, agora entre pessoas juridicas, e
  // o unico com papel 'terceiro_interessado' — cobre o quarto valor do enum.
  { clientes: [{ idx: 7, papel: 'autor', principal: true },
               { idx: 6, papel: 'terceiro_interessado', principal: false }],
    titulo: 'Acao de Cobranca de Divida', numeroProcesso: '0008901-80.2025.8.16.0006', tipoAcao: 'Cobranca', area: 'Civel', orgao: '1a Vara Civel', vara: '1a Vara Civel de Ponta Grossa', comarca: 'Ponta Grossa', status: 'encerrado', dataDistribuicao: '2025-06-11',
    descricao: 'Cobranca de duplicatas vencidas emitidas contra cooperativa agricola.',
    observacoes: 'Encerrado com pagamento integral apos citacao. Tech Solutions figura como terceira interessada na duplicata.' },
];

// ── Dados: Documentos de upload (processoIdx = índice em processes[]) ────────
// origem 'upload' explícita: são arquivos anexados, não gerados por template.
const DOCUMENTS_DATA = [
  { processoIdx: 0, nome: 'Peticao Inicial',                    tipo: 'peticao',                     descricao: 'Peticao inicial da acao indenizatoria',        urlArquivo: 'https://demo.lex.dev/docs/peticao-inicial-001.pdf',        tamanho: 184320 },
  // Unico documento visivel no portal do cliente: caso de teste pronto para a Fase 3.
  { processoIdx: 1, nome: 'Contrato de Prestacao de Servicos',  tipo: 'contrato_prestacao_servicos', descricao: 'Contrato firmado com o cliente',               urlArquivo: 'https://demo.lex.dev/docs/contrato-servicos-002.pdf',      tamanho: 262144, visivelPortal: true },
  { processoIdx: 2, nome: 'Acordo de Divorcio',                 tipo: 'contrato_prestacao_servicos', descricao: 'Minuta do acordo de divorcio consensual',      urlArquivo: 'https://demo.lex.dev/docs/acordo-divorcio-003.pdf',        tamanho: 143360 },
  { processoIdx: 3, nome: 'Sentenca Trabalhista',               tipo: 'sentenca',                    descricao: 'Sentenca homologatoria de acordo trabalhista', urlArquivo: 'https://demo.lex.dev/docs/sentenca-trabalhista-004.pdf',   tamanho: 98304  },
  { processoIdx: 4, nome: 'Abertura de Inventario',             tipo: 'comprovante',                 descricao: 'Protocolo de abertura do inventario',          urlArquivo: 'https://demo.lex.dev/docs/comprovante-inventario-005.pdf', tamanho: 51200  },
  { processoIdx: 5, nome: 'Peticao de Suspensao da Execucao',   tipo: 'peticao',                     descricao: 'Pedido de suspensao da execucao fiscal',       urlArquivo: 'https://demo.lex.dev/docs/peticao-suspensao-006.pdf',      tamanho: 76800  },
  { processoIdx: 6, nome: 'Contrato de Honorarios - Usucapiao', tipo: 'contrato_prestacao_servicos', descricao: 'Contrato de honorarios advocaticios',          urlArquivo: 'https://demo.lex.dev/docs/contrato-honorarios-007.pdf',    tamanho: 122880 },
  { processoIdx: 7, nome: 'Notificacao Extrajudicial',          tipo: 'peticao',                     descricao: 'Notificacao extrajudicial de cobranca',        urlArquivo: 'https://demo.lex.dev/docs/peticao-cobranca-008.pdf',       tamanho: 65536  },
];

// ── Dados: Seções (templates reutilizáveis) ─────────────────────────────────
// Só usam variáveis do catálogo fechado (src/config/templateVariables.js).
// Evitam de propósito varaProcesso e dataDistribuicao, que os processos do seed
// não preenchem — assim a geração do documento demo sai sem pendências.
const SECOES_DATA = [
  {
    chave: 'qualificacao_pf',
    titulo: 'Qualificação do outorgante — pessoa física',
    tipo: 'qualificacao',
    texto: 'OUTORGANTE: {{nomeCliente}}, {{nacionalidadeCliente}}, {{estadoCivilCliente}}, {{profissaoCliente}}, nascido(a) em {{dataNascimentoCliente}}, sexo {{sexoCliente}}, portador(a) do RG nº {{rgCliente}} e inscrito(a) no CPF sob o nº {{cpfCliente}}, residente e domiciliado(a) em {{enderecoCliente}}.\n\nDados para intimação e correspondência: e-mail {{emailCliente}}, telefone {{telefoneCliente}}, município de {{cidadeCliente}}/{{estadoCliente}}, CEP {{cepCliente}}.',
  },
  {
    chave: 'qualificacao_pj',
    titulo: 'Qualificação da outorgante — pessoa jurídica',
    tipo: 'qualificacao',
    texto: 'OUTORGANTE: {{razaoSocialCliente}}, também denominada {{nomeFantasiaCliente}}, pessoa jurídica de direito privado inscrita no CNPJ sob o nº {{cnpjCliente}}, com sede em {{enderecoCliente}}, neste ato representada por {{representanteLegalNome}}, {{representanteLegalCargo}}, inscrito(a) no CPF sob o nº {{representanteLegalCpf}}.',
  },
  {
    chave: 'outorgado',
    titulo: 'Qualificação do outorgado',
    tipo: 'qualificacao',
    texto: 'OUTORGADO: {{nomeAdvogado}}, inscrito(a) no CPF sob o nº {{cpfAdvogado}}, advogado(a) inscrito(a) na OAB/{{estadoOAB}} sob o nº {{numOAB}}, integrante de {{nomeAdvocacia}}, com escritório profissional em {{enderecoEscritorio}}, telefone {{telefoneEscritorio}}, e-mail {{emailEscritorio}} e chave PIX {{chavePix}} para fins de pagamento de honorários.',
  },
  {
    chave: 'poderes_procuracao',
    titulo: 'Objeto — poderes da procuração',
    tipo: 'objeto',
    texto: 'PODERES: pelo presente instrumento particular de procuração, o(a) outorgante confere ao(à) outorgado(a) os poderes da cláusula ad judicia et extra, para o foro em geral, em especial para atuar nos autos do processo nº {{numeroProcesso}} ({{tituloProcesso}}), ação de natureza {{tipoAcao}}, da área {{areaProcesso}}, distribuída em {{dataDistribuicao}} perante {{orgaoProcesso}}, {{varaProcesso}}, comarca de {{comarcaProcesso}}, atualmente com status {{statusProcesso}}, podendo propor as ações cabíveis, contestar, recorrer, requerer, transigir, desistir, firmar compromissos e substabelecer, com ou sem reserva de poderes.\n\n{{cidadeEscritorio}}, {{dataAtualExtenso}} ({{dataAtual}}).',
  },
  {
    chave: 'objeto_contrato',
    titulo: 'Objeto do contrato de prestação de serviços',
    tipo: 'objeto',
    texto: 'OBJETO: constitui objeto do presente contrato a prestação de serviços advocatícios pelo(a) CONTRATADO(A) ao(à) CONTRATANTE, com atuação no processo nº {{numeroProcesso}}, referente a {{tituloProcesso}}, na área {{areaProcesso}}, perante {{orgaoProcesso}}, comarca de {{comarcaProcesso}}.',
  },
  {
    // Fase 2C: passa a usar as variaveis de honorario, inclusive o extenso.
    // E o extenso que da valor juridico ao numero — divergindo os dois, e ele
    // que prevalece.
    chave: 'clausula_honorarios',
    titulo: 'Cláusula de honorários e forma de pagamento',
    tipo: 'clausula',
    texto: 'DOS HONORÁRIOS: pela prestação dos serviços descritos nesta avença, o(a) CONTRATANTE pagará ao(à) CONTRATADO(A) honorários do tipo {{tipoHonorario}}, no valor de {{valorHonorario}} ({{valorHonorarioExtenso}}), com vencimento em {{dataVencimentoHonorario}}.\n\nO pagamento será feito em {{numeroParcelas}} parcela(s) de {{valorParcela}}, admitido o pagamento por meio da chave PIX {{chavePix}}, de titularidade de {{nomeAdvocacia}}. O inadimplemento autoriza a cobrança na forma da lei, sem prejuízo dos honorários de sucumbência, que pertencem ao(à) advogado(a).',
  },
  {
    chave: 'obrigacoes',
    titulo: 'Obrigações das partes',
    tipo: 'fundamentacao',
    texto: 'DAS OBRIGAÇÕES: o(a) CONTRATADO(A) obriga-se a conduzir a causa com zelo e a manter o(a) CONTRATANTE informado(a) do andamento processual, podendo ser contatado(a) pelo telefone {{telefoneEscritorio}} ou pelo e-mail {{emailEscritorio}}. O(A) CONTRATANTE obriga-se a fornecer documentos e informações verídicas, respondendo por eventual omissão.',
  },
  {
    // LACUNA INTENCIONAL: o "[...]" nao e erro. E o marcador de trecho a
    // preencher depois — aqui, o que so se define na audiencia. Serve para o
    // aviso de lacuna ter o que detectar, e para demonstrar que lacuna NAO
    // bloqueia geracao nem download (diferente de pendencia, que bloqueia).
    chave: 'foro_e_condicoes',
    titulo: 'Foro e condições a combinar',
    tipo: 'clausula',
    texto: 'DAS CONDIÇÕES ESPECIAIS: as partes ajustam que eventuais despesas com diligências, cópias e deslocamentos correrão por conta do(a) CONTRATANTE, mediante prestação de contas.\n\nCondições complementares acordadas em audiência: [...]\n\nDO FORO: fica eleito o foro da comarca de {{cidadeEscritorio}} para dirimir as questões oriundas deste contrato.',
  },
  {
    chave: 'encerramento',
    titulo: 'Encerramento com local e data',
    tipo: 'encerramento',
    texto: 'E por estarem assim justos e contratados, firmam o presente instrumento.\n\n{{cidadeEscritorio}}, {{dataAtualExtenso}}.',
  },
  {
    chave: 'assinatura',
    titulo: 'Bloco de assinaturas',
    tipo: 'assinatura',
    texto: '_______________________________________\n{{nomeCliente}}\nCPF {{cpfCliente}}\n\n_______________________________________\n{{nomeAdvogado}}\nOAB/{{estadoOAB}} nº {{numOAB}}',
  },
];

// ── Dados: Modelos (documento com ehModelo: true, sem processo) ─────────────
const MODELOS_DATA = [
  {
    chave: 'procuracao',
    nome: 'Procuração Ad Judicia',
    tipo: 'procuracao',
    descricao: 'Modelo de procuração para atuação judicial',
    secoes: ['qualificacao_pf', 'outorgado', 'poderes_procuracao'],
  },
  {
    chave: 'contrato',
    nome: 'Contrato de Prestação de Serviços Advocatícios',
    tipo: 'contrato_prestacao_servicos',
    descricao: 'Modelo de contrato de honorários e prestação de serviços',
    secoes: ['qualificacao_pf', 'objeto_contrato', 'clausula_honorarios', 'foro_e_condicoes', 'encerramento'],
  },
  {
    // Modelo de PJ: é o único que resolve razaoSocialCliente, nomeFantasiaCliente,
    // cnpjCliente e os três de representanteLegal — as 6 variáveis do catálogo
    // que nenhum documento de pessoa física consegue exercitar.
    chave: 'procuracao_pj',
    nome: 'Procuração Ad Judicia — Pessoa Jurídica',
    tipo: 'procuracao',
    descricao: 'Modelo de procuração para cliente pessoa jurídica',
    secoes: ['qualificacao_pj', 'outorgado', 'poderes_procuracao'],
  },
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

    const [pay, inst, fee, vinc, sec, doc, procCli, proc, cli] = await Promise.all([
      Payment.deleteMany({ usuarioId: uid }),
      Installment.deleteMany({ usuarioId: uid }),
      Fee.deleteMany({ usuarioId: uid }),
      DocumentoSecao.deleteMany({ usuarioId: uid }),
      Secao.deleteMany({ usuarioId: uid }),
      Document.deleteMany({ usuarioId: uid }),
      // Antes de Process, por leitura: o vinculo é filho do processo. A ordem
      // não importa aqui (são deleteMany independentes), mas espelha a cascata.
      ProcessoCliente.deleteMany({ usuarioId: uid }),
      Process.deleteMany({ usuarioId: uid }),
      Client.deleteMany({ usuarioId: uid }),
    ]);
    await User.deleteOne({ _id: uid });

    console.log(`Removidos:`);
    console.log(`  ${pay.deletedCount}  pagamentos`);
    console.log(`  ${inst.deletedCount} parcelas`);
    console.log(`  ${fee.deletedCount}  honorarios`);
    console.log(`  ${vinc.deletedCount} vinculos documento-secao`);
    console.log(`  ${sec.deletedCount}  secoes`);
    console.log(`  ${doc.deletedCount}  documentos`);
    console.log(`  ${procCli.deletedCount} vinculos processo-cliente`);
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
      chavePix: 'demo@lex.dev',
      instagram: '@demolex.adv',
      site: 'https://demolex.adv.br',
      // Aparece no timbrado do PDF e do DOCX baixados.
      logoBase64: DEMO_LOGO_BASE64,
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

  // ── PROCESSOS (via processService, nunca por insert direto) ───────────────
  // Passa pelo mesmo caminho da API: valida os participantes, grava processo e
  // vinculos na mesma transacao e deriva `clientePrincipalId` do principal. Se
  // a junção regredir, o seed quebra — que é o que se quer de um seed.
  //
  // Sequencial, e nao Promise.all: as transacoes concorrem pelo indice unico de
  // `numeroProcesso` e a paralelizacao so troca clareza por milissegundos.
  const processes = [];
  for (const p of PROCESSES_DATA) {
    const participantes = p.clientes
      ? p.clientes.map(c => ({
          clienteId: clients[c.idx]._id.toString(),
          papel:     c.papel,
          principal: c.principal === true,
        }))
      : [{ clienteId: clients[p.clienteIdx]._id.toString(), papel: 'autor', principal: true }];

    processes.push(await createProcess(uid, {
      clientes:       participantes,
      titulo:         p.titulo,
      numeroProcesso: p.numeroProcesso,
      tipoAcao:       p.tipoAcao,
      area:           p.area,
      orgao:          p.orgao,
      vara:           p.vara,
      comarca:        p.comarca,
      status:         p.status,
      dataDistribuicao: p.dataDistribuicao,
      descricao:      p.descricao,
      observacoes:    p.observacoes,
    }));
  }
  const totalVinculos = processes.reduce((n, p) => n + p.participantes.length, 0);
  console.log(`${processes.length} processos criados (${totalVinculos} vinculos processo-cliente)`);

  // ── DOCUMENTOS (Mongoose direto) ──────────────────────────────────────────
  const documents = await Promise.all(
    DOCUMENTS_DATA.map(d => Document.create({
      usuarioId:  uid,
      processoId: processes[d.processoIdx]._id,
      nome:       d.nome,
      tipo:       d.tipo,
      descricao:  d.descricao,
      urlArquivo: d.urlArquivo,
      tamanho:    d.tamanho,
      origem:     'upload',
      visivelPortal: d.visivelPortal === true,
    }))
  );
  console.log(`${documents.length} documentos de upload criados`);

  // ── SEÇÕES (templates reutilizáveis) ──────────────────────────────────────
  const secoesPorChave = {};
  for (const spec of SECOES_DATA) {
    const secao = await Secao.create({
      usuarioId: uid,
      titulo:    spec.titulo,
      tipo:      spec.tipo,
      texto:     spec.texto,
    });
    secoesPorChave[spec.chave] = secao;
  }
  console.log(`${SECOES_DATA.length} secoes criadas (variaveis extraidas pelo hook)`);

  // ── MODELOS + vínculos ordenados ──────────────────────────────────────────
  const modelosPorChave = {};
  for (const spec of MODELOS_DATA) {
    const modelo = await Document.create({
      usuarioId: uid,
      nome:      spec.nome,
      tipo:      spec.tipo,
      descricao: spec.descricao,
      ehModelo:  true,
    });

    await DocumentoSecao.insertMany(
      spec.secoes.map((chave, i) => ({
        usuarioId:   uid,
        documentoId: modelo._id,
        secaoId:     secoesPorChave[chave]._id,
        ordem:       i + 1,
      }))
    );

    modelosPorChave[spec.chave] = modelo;
    console.log(`  modelo "${spec.nome}" com ${spec.secoes.length} secoes`);
  }
  console.log(`${MODELOS_DATA.length} modelos criados`);

  // ── DOCUMENTOS GERADOS (pelo service real, nunca por insert direto) ───────
  // Passam pelo mesmo caminho da API: resolvem as variáveis, recusam se houver
  // pendência e gravam o texto congelado. Se a resolução regredir, o seed quebra.
  const gerados = [];

  // Pessoa física: processo 0 (Ana Lima Santos, cadastro completo).
  gerados.push(await gerarDocumentoService(
    modelosPorChave.procuracao._id,
    uid,
    { processoId: processes[0]._id.toString() }
  ));

  // Pessoa jurídica: processo 7 (Construtora Horizonte, com representante legal).
  // É o que exercita as 6 variáveis de PJ do catálogo.
  gerados.push(await gerarDocumentoService(
    modelosPorChave.procuracao_pj._id,
    uid,
    { processoId: processes[7]._id.toString() }
  ));

  // LITISCONSORCIO — a prova da Fase 2B: o MESMO modelo e o MESMO processo,
  // gerados duas vezes, uma para cada herdeiro. Sai um par de procuracoes com
  // qualificacoes diferentes. Antes da junção isto era impossivel: a variavel
  // {{nomeCliente}} so sabia resolver para o cliente unico do processo.
  const litisconsorcio = processes[4];
  const geradosLitisconsorcio = [];
  for (const participante of litisconsorcio.participantes) {
    geradosLitisconsorcio.push(await gerarDocumentoService(
      modelosPorChave.procuracao._id,
      uid,
      {
        processoId: litisconsorcio._id.toString(),
        clienteId:  (participante.clienteId._id ?? participante.clienteId).toString(),
      }
    ));
  }
  gerados.push(...geradosLitisconsorcio);

  console.log(`${gerados.length} documentos gerados a partir dos modelos:`);
  gerados.forEach(g => console.log(`  "${g.nome}" — ${g.textoResolvido.length} caracteres, 0 pendencias`));

  // Confere que os dois documentos do litisconsorcio saíram com qualificacoes
  // DIFERENTES. Textos identicos significariam que o clienteId foi ignorado e
  // ambos caíram no principal — falha silenciosa que o seed nao pode deixar
  // passar, porque é exatamente o que a fase entrega.
  const [docA, docB] = geradosLitisconsorcio;
  if (docA.textoResolvido === docB.textoResolvido) {
    throw new Error(
      'Os dois documentos do litisconsorcio saíram com o mesmo texto: o clienteId nao foi aplicado.'
    );
  }
  console.log('  litisconsorcio: 2 procuracoes do mesmo modelo, com qualificacoes distintas:');
  geradosLitisconsorcio.forEach(g =>
    console.log(`    -> ${g.variaveisResolvidas.nomeCliente} (CPF ${g.variaveisResolvidas.cpfCliente})`)
  );

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

  // ── CONTRATOS COM HONORÁRIO (depois das FEES, de proposito) ───────────────
  // O modelo de contrato usa {{valorHonorario}} e {{valorHonorarioExtenso}};
  // sem honorario cadastrado a geracao pararia com 422. Por isso este bloco
  // vem DEPOIS do de honorarios, e nao junto com as procuracoes.
  //
  // Os dois processos escolhidos tem exatamente UM honorario ativo, entao o
  // `honorarioId` e resolvido sozinho — o caso ambiguo (varios honorarios)
  // fica no processo 0, para exercitar o 422 que pede a escolha.
  const contratoAna = await gerarDocumentoService(
    modelosPorChave.contrato._id,
    uid,
    { processoId: processes[1]._id.toString() }
  );

  const contratoCarlos = await gerarDocumentoService(
    modelosPorChave.contrato._id,
    uid,
    { processoId: processes[2]._id.toString() }
  );

  console.log('2 contratos gerados com honorario resolvido:');
  for (const c of [contratoAna, contratoCarlos]) {
    console.log(`  "${c.nome}" -> ${c.variaveisResolvidas.valorHonorario} (${c.variaveisResolvidas.valorHonorarioExtenso})`);
  }

  // ── DOCUMENTO EDITADO A MAO ───────────────────────────────────────────────
  // Passa pelo service real, marcando `editadoManualmente`. E o caso que faz
  // regerar este contrato devolver 409 sem `confirmarSobrescrita: true`.
  const textoAjustado = contratoCarlos.textoResolvido.replace(
    'Condições complementares acordadas em audiência: [...]',
    'Condições complementares acordadas em audiência: desconto de 10% em caso de quitação antecipada, conforme tratado na sessão de conciliação de 22/01/2025.'
  );

  await atualizarTextoService(contratoCarlos._id, uid, textoAjustado);
  console.log(`1 documento editado a mao: "${contratoCarlos.nome}" (processo de Carlos) — regerar exige confirmarSobrescrita`);

  // ── RESUMO ────────────────────────────────────────────────────────────────
  // Contagens lidas do banco, não das constantes: se algo deixar de ser criado,
  // o resumo mostra o número real em vez de repetir a expectativa.
  const [nClients, nProcesses, nProcCli, nDocs, nUploads, nModelos, nGerados, nSecoes, nVinculos,
         nFees, nInst, nPay, nPortal] = await Promise.all([
    Client.countDocuments({ usuarioId: uid, ativo: true }),
    Process.countDocuments({ usuarioId: uid, ativo: true }),
    ProcessoCliente.countDocuments({ usuarioId: uid, ativo: true }),
    Document.countDocuments({ usuarioId: uid, ativo: true }),
    Document.countDocuments({ usuarioId: uid, ativo: true, origem: 'upload' }),
    Document.countDocuments({ usuarioId: uid, ativo: true, ehModelo: true }),
    Document.countDocuments({ usuarioId: uid, ativo: true, ehModelo: false, origem: 'gerado' }),
    Secao.countDocuments({ usuarioId: uid, ativo: true }),
    DocumentoSecao.countDocuments({ usuarioId: uid, ativo: true }),
    Fee.countDocuments({ usuarioId: uid, ativo: true }),
    Installment.countDocuments({ usuarioId: uid, ativo: true }),
    Payment.countDocuments({ usuarioId: uid, ativo: true }),
    Document.countDocuments({ usuarioId: uid, ativo: true, visivelPortal: true }),
  ]);

  const porStatus = async (Model) => {
    const r = await Model.aggregate([
      { $match: { usuarioId: uid, ativo: true } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return r.map(x => `${x._id}=${x.n}`).join('  ');
  };
  const statusParcelas = await porStatus(Installment);
  const statusProcessos = await porStatus(Process);

  const nEditados = await Document.countDocuments({
    usuarioId: uid, ativo: true, editadoManualmente: true
  });

  // Conta pelo texto congelado, não pelas seções: é o texto que vai para o PDF.
  const comTexto = await Document.find({
    usuarioId: uid, ativo: true, ehModelo: false, origem: 'gerado'
  }).select('textoResolvido');
  const nComLacuna = comTexto.filter(d => detectarLacunas(d.textoResolvido).length > 0).length;

  const papeis = await ProcessoCliente.aggregate([
    { $match: { usuarioId: uid, ativo: true } },
    { $group: { _id: '$papel', n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).then(r => r.map(x => `${x._id}=${x.n}`).join('  '));

  // Códigos de acesso do par cliente/processo. Ficam no resumo porque na Fase 3
  // (portal do cliente) é por eles que se entra — e, sem endpoint de portal
  // ainda, o terminal do seed é o único lugar onde aparecem. É a mesma via de
  // leitura restrita do GET .../codigo-acesso: nunca saem em listagem.
  const vinculosResumo = await ProcessoCliente.find({ usuarioId: uid, ativo: true })
    .populate('clienteId', 'nomeCompleto razaoSocial')
    .populate('processoId', 'titulo')
    .sort({ processoId: 1, principal: -1 });

  const L = '='.repeat(66);
  console.log(`\n${L}`);
  console.log('  SEED DE DEMONSTRACAO CONCLUIDO');
  console.log(L);
  console.log('  ACESSO');
  console.log(`    Email    : ${DEMO_EMAIL}`);
  console.log(`    Senha    : ${DEMO_SENHA}`);
  console.log('    Frontend : http://localhost:5173');
  console.log('    Backend  : http://localhost:3001/api');
  console.log('    (suba o backend com "npm run dev" e o frontend com "npm run dev")');
  console.log('-'.repeat(66));
  console.log('  DADOS CRIADOS');
  console.log(`    Usuario           : 1`);
  console.log(`    Clientes          : ${nClients}   (5 PF + 3 PJ)`);
  console.log(`    Processos         : ${nProcesses}  ${statusProcessos}`);
  console.log(`    Vinculos proc-cli : ${nProcCli}  ${papeis}`);
  console.log(`    Honorarios        : ${nFees}`);
  console.log(`    Parcelas          : ${nInst}  ${statusParcelas}`);
  console.log(`    Pagamentos        : ${nPay}`);
  console.log(`    Documentos        : ${nDocs}  (${nUploads} upload + ${nModelos} modelos + ${nGerados} gerados)`);
  console.log(`    Secoes            : ${nSecoes}`);
  console.log(`    Vinculos doc-secao: ${nVinculos}`);
  console.log(`    Visiveis no portal: ${nPortal}`);
  console.log('-'.repeat(66));
  console.log('  CODIGOS DE ACESSO POR PAR CLIENTE/PROCESSO (Fase 3 — portal)');
  console.log('    Nao aparecem em GET /api/processes nem no detalhe. Saem so em');
  console.log('    GET /api/processes/:id/clientes/:clienteId/codigo-acesso.');
  {
    let processoAtual = null;
    for (const v of vinculosResumo) {
      const tituloProcesso = v.processoId?.titulo ?? '(processo removido)';
      if (tituloProcesso !== processoAtual) {
        processoAtual = tituloProcesso;
        console.log(`    ${tituloProcesso}`);
      }
      const nome = v.clienteId?.nomeCompleto ?? v.clienteId?.razaoSocial ?? '(cliente removido)';
      const marca = v.principal ? '*' : ' ';
      console.log(`      ${marca} ${v.codigoAcesso}  ${nome}  [${v.papel}]`);
    }
    console.log('    (* = participante principal do processo)');
  }
  console.log('-'.repeat(66));
  console.log('  LITISCONSORCIO (o caso da Fase 2B)');
  console.log(`    Processo "${litisconsorcio.titulo}" tem 2 participantes:`);
  litisconsorcio.participantes.forEach(p => {
    const nome = p.clienteId?.nomeCompleto ?? p.clienteId?.razaoSocial ?? '(sem nome)';
    console.log(`      - ${nome} [${p.papel}]${p.principal ? ' (principal)' : ''}`);
  });
  console.log('    Foram geradas 2 procuracoes do MESMO modelo, uma por cliente,');
  console.log('    cada uma com a qualificacao do seu proprio outorgante.');
  console.log('-'.repeat(66));
  console.log('  FASE 2C — RENDERIZACAO');
  console.log(`    Logo do escritorio : ${DEMO_LOGO_BASE64.length} caracteres ` +
              `(${(DEMO_LOGO_BASE64.length / 1024).toFixed(1)} KB de 200 KB)`);
  console.log(`    Contratos c/ honorario resolvido : 2`);
  console.log(`      - ${contratoAna.variaveisResolvidas.valorHonorario} (${contratoAna.variaveisResolvidas.valorHonorarioExtenso})`);
  console.log(`      - ${contratoCarlos.variaveisResolvidas.valorHonorario} (${contratoCarlos.variaveisResolvidas.valorHonorarioExtenso})`);
  console.log(`    Documentos editados a mao       : ${nEditados}`);
  console.log(`    Documentos com lacuna ([...])   : ${nComLacuna}`);
  console.log('    Baixe qualquer documento gerado em:');
  console.log('      GET /api/documents/:id/download?formato=pdf');
  console.log('      GET /api/documents/:id/download?formato=docx');
  console.log('-'.repeat(66));
  console.log('  LACUNAS INTENCIONAIS (nao sao bug)');
  console.log('    - Cliente "Beatriz Ramos Pereira" (PF) nao tem profissao.');
  console.log('      Gerar documento para o processo "Usucapiao de Imovel Urbano"');
  console.log('      retorna 422 apontando {{profissaoCliente}} — e o comportamento');
  console.log('      esperado, serve para ver a tela de pendencia.');
  console.log('    - Cliente "Agro Campos Gerais Ltda" (PJ) nao tem representante');
  console.log('      legal, para exibir os dois estados na tela de detalhe.');
  console.log(L);

}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Erro fatal no seed:', e.message || e);
    process.exit(1);
  });
