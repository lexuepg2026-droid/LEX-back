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
// ── O fluxo, desde a Fase 2.5 (DEC-089) ──────────────────────────────────
//   código PESSOAL → cliente → senha
//
// Até a 2.5 era código do VÍNCULO → vínculo → cliente → senha, e a sessão
// enxergava um processo (DEC-029 ponto 6). A 3ª banca apontou o custo (itens
// 14 e 15): um login por processo. Agora a sessão é da PESSOA, e QUAIS
// processos ela vê é `ProcessoCliente.liberadoNoPortal`, conferido a cada
// requisição pelo middleware (`exigirVinculoLiberado`) — não no login, e não
// guardado no token. Desliberar no meio da sessão vale na próxima requisição.
//
// **Sem transição (DEC-090):** o código de vínculo antigo não autentica. Ele
// nem é consultado aqui — recebe o mesmo 401 de qualquer código inexistente.
// ═══════════════════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import Client from "../models/Client.js";
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
// UMA função, um ponto único. Código inexistente (inclusive o código de
// vínculo antigo, DEC-090), cliente sem senha, senha errada e cliente inativo
// devolvem o MESMO corpo e o MESMO status. "Vínculo inativo" e "processo
// inativo" saíram da lista na 2.5: o login não olha processo nenhum — entrar
// sem nenhum processo liberado é estado válido, e a lista vem vazia.
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

// `escopo: "pessoa"` (Fase 2.5): o token da sessão por vínculo, emitido antes
// da 2.5, tinha `processoClienteId` e nenhum escopo. O middleware exige o
// escopo novo, e o token antigo cai como sessão inválida — volta ao login,
// sem transição (DEC-090). Ele expiraria em 2 h de qualquer forma.
export const ESCOPO_SESSAO_PORTAL = "pessoa";

export const assinarTokenPortal = (cliente) =>
  jwt.sign(
    {
      tipo: TIPO_TOKEN_PORTAL,
      escopo: ESCOPO_SESSAO_PORTAL,
      clienteId: String(cliente._id),
      usuarioId: String(cliente.usuarioId),
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

  // Só o código PESSOAL (DEC-089). O de vínculo não é consultado: digitá-lo
  // cai em "não achei", com o mesmo corpo e o mesmo tempo (DEC-090).
  //
  // Sem filtro de `ativo` na busca, pela mesma razão de antes: o cliente
  // inativo precisa ser encontrado para gastar o mesmo bcrypt e responder o
  // mesmo 401 de um código inexistente. O hash só vem por pedido explícito
  // (`select: false` no schema).
  const cliente = await Client.findOne({ codigoAcessoPessoal: codigo }).select("+senhaPortalHash");

  const podeEntrar =
    Boolean(cliente) &&
    cliente.ativo === true &&
    typeof cliente.senhaPortalHash === "string" &&
    cliente.senhaPortalHash.length > 0;

  // A comparação de senha roda SEMPRE, mesmo quando já se sabe que o acesso
  // será negado. É o que mantém o tempo de resposta indistinguível entre os
  // casos.
  const senhaConfere = await compararSenha(senha, podeEntrar ? cliente.senhaPortalHash : null);

  if (!podeEntrar || !senhaConfere) {
    throw credenciaisInvalidas();
  }

  return {
    token: assinarTokenPortal(cliente),
    senhaPortalProvisoria: cliente.senhaPortalProvisoria === true,
    clienteId: cliente._id
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
// aberta pelo resto das 2 horas. Desde a 2.5 a sessão é da pessoa: não há
// vínculo a reler, só o cliente que acabou de trocar a senha.
export const reemitirSessao = (cliente) => assinarTokenPortal(cliente);

export default { login, trocarSenha, reemitirSessao, assinarTokenPortal };
