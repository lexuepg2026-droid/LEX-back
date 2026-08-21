// ═══════════════════════════════════════════════════════════════════════════
// AUTENTICAÇÃO DO PORTAL DO CLIENTE (DEC-029)
//
// Arquivo PRÓPRIO, sem estender `authService`. Os dois domínios têm sujeitos
// diferentes (advogada × cliente), segredos diferentes, tempos de sessão
// diferentes e regras de erro diferentes — o login da advogada distingue
// "e-mail não existe" de "senha errada", e aqui isso seria enumeração de
// códigos de acesso válidos. Compartilhar código faria as duas regras
// derivarem uma para a outra na primeira refatoração.
//
// ── O fluxo ───────────────────────────────────────────────────────────────
//   código de acesso → vínculo (ProcessoCliente) → cliente → senha
//
// A sessão é escopada ao VÍNCULO, não ao cliente (DEC-029 ponto 6). Um cliente
// com três processos tem três códigos e uma senha; cada código abre uma sessão
// que enxerga um processo. Sem isso, entrar com o código do processo A daria
// acesso ao processo B, e o código deixaria de significar alguma coisa.
// ═══════════════════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import ProcessoCliente from "../models/ProcessoCliente.js";
import Client from "../models/Client.js";
import Process from "../models/Process.js";
import { isCodigoAcessoValido } from "../utils/accessCode.js";
import { ERRO_PORTAL, MENSAGEM_CREDENCIAIS_INVALIDAS } from "../config/portalErrors.js";
import { validateSenhaPortal } from "../validations/clientValidation.js";

// Sessão do portal: 2 horas, contra 1 dia (`expiresIn: "1d"`) da advogada.
//
// O portal é sessão de CONSULTA — o cliente entra, lê, confirma e sai. Não há
// jornada de trabalho a sustentar como na tela da advogada. E o fator de risco
// é diferente: o código de acesso circula por WhatsApp e por papel, então
// "aparelho emprestado com sessão viva" é cenário realista, não hipótese. Duas
// horas limitam essa janela sem custo prático, porque entrar de novo é barato.
export const EXPIRACAO_SESSAO_PORTAL = "2h";
export const MAX_AGE_COOKIE_PORTAL_MS = 2 * 60 * 60 * 1000;

export const NOME_COOKIE_PORTAL = "lex-portal-token";

// `tipo: "portal"` é a SEGUNDA tranca. A primeira é o segredo distinto, que
// faz a assinatura não conferir do outro lado. Esta existe para o caso de
// alguém, um dia, apontar as duas variáveis para o mesmo valor sem perceber —
// e é conferida nos dois middlewares.
export const TIPO_TOKEN_PORTAL = "portal";

// ── O 401 unificado (DEC-029 ponto 11) ────────────────────────────────────
// CONTINUA 401 sob a DEC-050: é o LOGIN do portal, e ali não há sessão — é o
// pedido para criar uma. O interceptor do portal já não reage a ele (a rota
// está fora da reação por não trazer `sessaoPortalInvalida`).
// UMA função, um ponto único. Código inexistente, vínculo inativo, cliente sem
// senha, senha errada, cliente inativo e processo inativo devolvem o MESMO
// corpo e o MESMO status.
//
// Não é preciosismo: o código de acesso tem formato conhecido e alfabeto de 32
// símbolos. Distinguir "esse código não existe" de "senha errada" transforma o
// login num oráculo que confirma quais códigos são válidos — e um código
// válido já identifica um processo e uma pessoa, mesmo sem a senha.
const credenciaisInvalidas = () => {
  const error = new Error(MENSAGEM_CREDENCIAIS_INVALIDAS);
  error.statusCode = 401;
  error.codigo = ERRO_PORTAL.CREDENCIAIS_INVALIDAS;
  return error;
};

// Hash descartável, com o mesmo custo dos reais, usado quando não há senha para
// comparar. Sem ele, "código inexistente" responderia sem passar por bcrypt e
// "senha errada" gastaria ~80 ms — diferença medível de fora, que reintroduz
// pela lateral exatamente a distinção que o 401 unificado apaga.
//
// Gerado uma vez, na carga: gerar por requisição custaria o dobro do tempo no
// caminho do erro e voltaria a destoar.
const HASH_FALSO = bcrypt.hashSync("senha-que-nao-existe-em-lugar-nenhum", 10);

const compararSenha = async (senha, hash) => {
  // `bcrypt.compare` com hash falso devolve false e consome o mesmo tempo.
  const alvo = typeof hash === "string" && hash.length > 0 ? hash : HASH_FALSO;
  const confere = await bcrypt.compare(String(senha ?? ""), alvo);
  // Se o alvo era o falso, o resultado nunca pode ser aceito, mesmo que por
  // algum acaso a comparação passasse.
  return confere && alvo !== HASH_FALSO;
};

// Carimbo do estado da senha no momento da emissão.
//
// JWT não tem revogação: um token assinado continua válido até expirar, e
// "reemitir a sessão" sozinho não invalidaria o anterior — os dois teriam a
// mesma assinatura válida pelas 2 horas seguintes. Como o token anterior foi
// emitido num estado em que a ADVOGADA conhecia a senha, deixá-lo vivo
// manteria aberta exatamente a janela que a troca obrigatória fecha.
//
// A solução, sem blacklist e sem estado novo: o token carrega o carimbo da
// senha, e o middleware — que já carrega o Client para checar
// `senhaPortalProvisoria` — compara. Trocou a senha, o carimbo muda, todo token
// emitido antes deixa de casar. Custo zero: nenhuma consulta a mais.
export const carimboDaSenha = (cliente) =>
  cliente?.senhaPortalDefinidaEm ? new Date(cliente.senhaPortalDefinidaEm).toISOString() : null;

export const assinarTokenPortal = (vinculo, cliente) =>
  jwt.sign(
    {
      tipo: TIPO_TOKEN_PORTAL,
      processoClienteId: String(vinculo._id),
      clienteId: String(vinculo.clienteId),
      processoId: String(vinculo.processoId),
      usuarioId: String(vinculo.usuarioId),
      senhaCarimbo: carimboDaSenha(cliente)
    },
    process.env.JWT_PORTAL_SECRET,
    { expiresIn: EXPIRACAO_SESSAO_PORTAL }
  );

// ── Login ─────────────────────────────────────────────────────────────────
export const login = async ({ codigoAcesso, senha }) => {
  // Formato inválido morre aqui, com o MESMO erro dos demais casos. Responder
  // 400 "formato inválido" separaria o espaço de busca antes mesmo da consulta.
  if (!isCodigoAcessoValido(String(codigoAcesso ?? "").trim().toUpperCase())) {
    await compararSenha(senha, null); // gasta o mesmo tempo
    throw credenciaisInvalidas();
  }

  const codigo = String(codigoAcesso).trim().toUpperCase();

  // Sem filtro de `ativo` na busca: o vínculo inativo PRECISA ser encontrado
  // para que o código continue reservado globalmente (Fase 2B) e para que a
  // resposta seja a mesma de um código inexistente. Filtrar aqui devolveria
  // "não achei" mais rápido para vínculo desativado.
  const vinculo = await ProcessoCliente.findOne({ codigoAcesso: codigo });

  if (!vinculo) {
    await compararSenha(senha, null);
    throw credenciaisInvalidas();
  }

  // O hash só vem por pedido explícito: `select: false` no schema.
  const cliente = await Client.findById(vinculo.clienteId).select("+senhaPortalHash");
  const processo = await Process.findById(vinculo.processoId);

  const podeEntrar =
    vinculo.ativo === true &&
    Boolean(cliente) &&
    cliente.ativo === true &&
    Boolean(processo) &&
    processo.ativo === true &&
    typeof cliente.senhaPortalHash === "string" &&
    cliente.senhaPortalHash.length > 0;

  // A comparação de senha roda SEMPRE, mesmo quando já se sabe que o acesso
  // será negado. É o que mantém o tempo de resposta indistinguível entre os
  // seis casos.
  const senhaConfere = await compararSenha(senha, podeEntrar ? cliente.senhaPortalHash : null);

  if (!podeEntrar || !senhaConfere) {
    throw credenciaisInvalidas();
  }

  return {
    token: assinarTokenPortal(vinculo, cliente),
    senhaPortalProvisoria: cliente.senhaPortalProvisoria === true,
    clienteId: cliente._id,
    processoId: processo._id,
    processoClienteId: vinculo._id
  };
};

// ── Troca de senha (DEC-029 ponto 4) ──────────────────────────────────────
//
// ATENÇÃO A QUEM FOR "SIMPLIFICAR" ISTO NO FUTURO:
//
// A troca obrigatória no primeiro acesso NÃO é conveniência de usabilidade, e
// remover a obrigatoriedade não é economia de uma tela. Ela é o que sustenta o
// valor probatório da confirmação de visualização.
//
// A senha inicial é definida pela advogada e entregue ao cliente. Enquanto for
// essa senha, a advogada consegue entrar no portal como se fosse o cliente —
// e, portanto, consegue clicar em "confirmo que li". Uma confirmação registrada
// nesse estado é REPUDIÁVEL: o cliente pode dizer, com razão, que não foi ele.
// O recibo não provaria nada, e o artefato que esta fase inteira existe para
// produzir viraria enfeite.
//
// Só depois que o cliente define uma senha que apenas ele conhece é que a
// confirmação passa a ser atribuível a ele. Por isso a confirmação é recusada
// enquanto `senhaPortalProvisoria` for `true`, com código de erro próprio.
export const trocarSenha = async ({ clienteId, senhaAtual, novaSenha }) => {
  const cliente = await Client.findById(clienteId).select("+senhaPortalHash");

  // CONTINUA 401 sob a DEC-050: o token era válido, mas o cliente por trás dele
  // sumiu ou foi desativado. A sessão perdeu o sujeito e não vale mais — o
  // portal deve mesmo descartá-la e voltar ao login.
  if (!cliente || cliente.ativo !== true) {
    const error = new Error("Sessão inválida.");
    error.statusCode = 401;
    error.codigo = ERRO_PORTAL.SESSAO_INVALIDA;
    throw error;
  }

  // 422 pela DEC-050, e não 400: a sessão do portal é VÁLIDA (o middleware já
  // a conferiu), o corpo está bem formado, e o que falha é a CONFERÊNCIA da
  // senha contra o hash gravado. É o mesmo caso da troca de senha da advogada,
  // e responde o mesmo número.
  //
  // Era 400 — não chegou a causar o defeito V-2, porque o interceptor do portal
  // só reage a 401 com `sessaoPortalInvalida`. Mas deixar a MESMA condição
  // respondendo 400 aqui e 422 do outro lado é o que faz a próxima pessoa
  // copiar o que vir primeiro. Uma pergunta, uma resposta.
  const atualConfere = await compararSenha(senhaAtual, cliente.senhaPortalHash);
  if (!atualConfere) {
    const error = new Error("A senha atual está incorreta.");
    error.statusCode = 422;
    error.campo = "senhaAtual";
    throw error;
  }

  // Mesma régua de força da definição pela advogada, mais a recusa de CPF/CNPJ.
  const erroDeForca = validateSenhaPortal(novaSenha, {
    cpf: cliente.cpf,
    cnpj: cliente.cnpj
  });
  if (erroDeForca) {
    const error = new Error(erroDeForca);
    error.statusCode = 400;
    error.campo = "novaSenha";
    throw error;
  }

  // A nova senha não pode ser a provisória. Sem esta checagem, "trocar" a senha
  // repetindo a que a advogada entregou marcaria `senhaPortalProvisoria: false`
  // com a advogada ainda conhecendo a senha — o recibo continuaria repudiável,
  // agora com um carimbo dizendo que não é.
  const repetiuAAtual = await compararSenha(novaSenha, cliente.senhaPortalHash);
  if (repetiuAAtual) {
    const error = new Error(
      "A nova senha não pode ser igual à senha atual. Ela precisa ser uma senha que só você conhece."
    );
    error.statusCode = 400;
    error.campo = "novaSenha";
    throw error;
  }

  cliente.senhaPortalHash = await bcrypt.hash(novaSenha, 10);
  cliente.senhaPortalProvisoria = false;
  cliente.senhaPortalDefinidaEm = new Date();
  await cliente.save();

  return cliente;
};

// Reemissão da sessão depois da troca. O token anterior foi emitido num estado
// em que a advogada conhecia a senha; mantê-lo válido deixaria essa janela
// aberta pelo resto das 2 horas.
export const reemitirSessao = async (processoClienteId, cliente) => {
  const vinculo = await ProcessoCliente.findById(processoClienteId);
  if (!vinculo) {
    const error = new Error("Sessão inválida.");
    error.statusCode = 401;
    error.codigo = ERRO_PORTAL.SESSAO_INVALIDA;
    throw error;
  }
  return assinarTokenPortal(vinculo, cliente);
};

export default { login, trocarSenha, reemitirSessao, assinarTokenPortal };
