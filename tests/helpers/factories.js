// Fábricas de dado de teste.
//
// Regra da suíte: NENHUM teste depende do seed. Cada arquivo cria as suas
// próprias fixtures. Teste ancorado em dado do seed quebra quando o seed muda,
// e o seed muda toda fase.
//
// ── Aviso caro ─────────────────────────────────────────────────────────────
// A auditoria geral perdeu uma rodada inteira porque um gerador de CNPJ usava
// base de 11 dígitos em vez de 12, produzindo documento que o backend recusava
// — e a falha aparecia como "cadastro de PJ quebrado", não como "gerador
// errado". Por isso os dois geradores abaixo são escritos contra o algoritmo
// de `src/utils/documentos.js`, e `tests/infra/factories.test.js` prova, com
// o validador REAL importado, que o que sai daqui é aceito.

import { randomUUID } from "node:crypto";

// Contador de processo + aleatório: dois arquivos de teste rodando em
// processos diferentes não podem colidir em índice único.
let sequencia = 0;
const proximo = () => {
  sequencia += 1;
  return `${process.pid}${Date.now()}${sequencia}`;
};

// ── Documentos ─────────────────────────────────────────────────────────────

// Espelha `calcularDigito` de `validarCPF`: pesos decrescentes a partir de
// `pesoInicial`, `(soma * 10) % 11`, e 10 vira 0.
const digitoCpf = (base, pesoInicial) => {
  let soma = 0;
  for (let i = 0; i < base.length; i += 1) {
    soma += Number(base[i]) * (pesoInicial - i);
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
};

export const cpfValido = () => {
  // 9 dígitos de base. Sequência repetida é rejeitada pelo validador, então o
  // laço tenta de novo em vez de devolver algo inválido.
  for (;;) {
    const base = String(proximo()).slice(-9).padStart(9, "1");
    if (/^(\d)\1{8}$/.test(base)) continue;
    const dv1 = digitoCpf(base, 10);
    const dv2 = digitoCpf(`${base}${dv1}`, 11);
    const cpf = `${base}${dv1}${dv2}`;
    if (!/^(\d)\1{10}$/.test(cpf)) return cpf;
  }
};

// Espelha `calcularDigito` de `validarCNPJ`: pesos cíclicos 2..9 da DIREITA
// para a esquerda, `soma % 11`, resto < 2 vira 0.
//
// A base tem 12 dígitos — não 11. Foi exatamente aqui que a auditoria errou.
const digitoCnpj = (base) => {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
};

export const cnpjValido = () => {
  for (;;) {
    // 8 dígitos de raiz + "0001" de filial = 12 de base. O `padStart` garante
    // o comprimento mesmo se `proximo()` encurtar.
    const raiz = String(proximo()).slice(-8).padStart(8, "1");
    const base = `${raiz}0001`;
    if (base.length !== 12) continue;
    if (/^(\d)\1{11}$/.test(base)) continue;
    const dv1 = digitoCnpj(base);
    const dv2 = digitoCnpj(`${base}${dv1}`);
    const cnpj = `${base}${dv1}${dv2}`;
    if (!/^(\d)\1{13}$/.test(cnpj)) return cnpj;
  }
};

export const emailUnico = (prefixo = "teste") =>
  `${prefixo}-${randomUUID().slice(0, 8)}@lex.test`;

export const SENHA_PADRAO = "Teste123456";

// ── Payloads ───────────────────────────────────────────────────────────────

// `advocacia` é OBRIGATÓRIO no cadastro (`validateRegisterPayload` →
// `validateAdvocacia({ obrigatorio: true })`), e `endereco` alimenta
// `enderecoEscritorio` e `cidadeEscritorio` no catálogo de variáveis. Sem os
// dois, todo teste de geração cairia em 422 por pendência que o teste não pediu.
export const dadosUsuario = (extra = {}) => ({
  nomeCompleto: "Advogada de Teste",
  email: emailUnico("adv"),
  senha: SENHA_PADRAO,
  confirmarSenha: SENHA_PADRAO,
  cpf: cpfValido(),
  telefone: "(42) 99888-7766",
  oab: { numero: String(proximo()).slice(-6), estado: "PR" },
  advocacia: {
    nome: "Advocacia de Teste",
    chavePix: "advocacia@lex.test",
    instagram: "@advocaciateste",
    site: "https://advocacia.test"
  },
  endereco: {
    logradouro: "Rua do Escritório",
    numero: "45",
    bairro: "Centro",
    cidade: "Ponta Grossa",
    estado: "PR",
    cep: "84010200"
  },
  ...extra
});

// PF completo: todos os campos que o catálogo de variáveis consome, para que a
// geração de documento não caia em 422 por pendência a menos que o teste queira.
export const dadosClientePF = (extra = {}) => ({
  tipoPessoa: "fisica",
  nomeCompleto: "Cliente PF de Teste",
  cpf: cpfValido(),
  rg: "12.345.678-9",
  dataNascimento: "1985-03-14",
  sexo: "feminino",
  estadoCivil: "solteiro",
  profissao: "engenheira",
  nacionalidade: "brasileira",
  email: emailUnico("cliente"),
  telefone: "(42) 99111-2233",
  endereco: {
    logradouro: "Rua das Acácias",
    numero: "120",
    bairro: "Centro",
    cidade: "Ponta Grossa",
    estado: "PR",
    cep: "84010000"
  },
  ...extra
});

export const dadosClientePJ = (extra = {}) => ({
  tipoPessoa: "juridica",
  razaoSocial: "Empresa de Teste Ltda",
  nomeFantasia: "Teste",
  cnpj: cnpjValido(),
  email: emailUnico("empresa"),
  telefone: "(42) 3222-1100",
  endereco: {
    logradouro: "Avenida Central",
    numero: "900",
    bairro: "Centro",
    cidade: "Ponta Grossa",
    estado: "PR",
    cep: "84010100"
  },
  representanteLegal: {
    nome: "Representante de Teste",
    cpf: cpfValido(),
    cargo: "sócio-administrador"
  },
  ...extra
});

export const dadosProcesso = (clientes, extra = {}) => ({
  titulo: "Processo de Teste",
  numeroProcesso: `${String(proximo()).slice(-15)}`,
  status: "ativo",
  tipoAcao: "Ação de Teste",
  area: "Cível",
  orgao: "TJPR",
  vara: "2ª Vara Cível",
  comarca: "Ponta Grossa",
  dataDistribuicao: "2026-01-15",
  clientes,
  ...extra
});

export const dadosHonorario = (processoId, extra = {}) => ({
  processoId,
  descricao: "Honorário de Teste",
  valor: 3000,
  tipo: "fixo",
  status: "pendente",
  dataVencimento: "2026-12-01",
  ...extra
});

export const dadosParcela = (feeId, numeroParcela, extra = {}) => ({
  feeId,
  numeroParcela,
  valor: 1000,
  dataVencimento: `2026-${String((numeroParcela % 12) + 1).padStart(2, "0")}-10`,
  ...extra
});

export const dadosPagamento = (installmentId, extra = {}) => ({
  installmentId,
  valorPago: 1000,
  dataPagamento: "2026-02-10",
  formaPagamento: "pix",
  ...extra
});

export const dadosSecao = (extra = {}) => ({
  titulo: `Seção de Teste ${randomUUID().slice(0, 8)}`,
  tipo: "clausula",
  texto: "Texto da seção sem variável nenhuma.",
  ...extra
});

export const dadosModelo = (extra = {}) => ({
  nome: `Modelo de Teste ${randomUUID().slice(0, 8)}`,
  tipo: "procuracao",
  descricao: "Modelo criado pela suíte.",
  ...extra
});

// `dadosDocumento` foi REMOVIDA na Fase F-0.
//
// Montava o payload de um documento pelo caminho de upload, e não tinha
// chamador: os três testes que criam documento avulso
// (`portal/consulta.test.js`, e duas vezes `isolation/tenant.test.js`) escrevem
// o corpo inline — e escrevem de propósito, porque o `nome` de cada um é a
// descrição do caso ("Upload da advogada", "Documento próprio de B",
// "Documento de B sobre processo de A"). Um nome aleatório de fábrica apagaria
// essa informação da saída do teste.
//
// Somado à Parte 4 desta fase, que fechou os campos de upload para PATCH: o
// caminho está mais dormente do que antes, e criar indireção compartilhada
// sobre ele agora seria antecipar uma tela que o anteprojeto exclui do escopo.
